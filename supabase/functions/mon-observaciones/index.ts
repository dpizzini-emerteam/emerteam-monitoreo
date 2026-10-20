// EMERTEAM Monitoreo Ambiental · observaciones horarias del SMN (datos abiertos)
// Cada hora: actualiza (semanalmente) el listado de estaciones, elige las estaciones cercanas a cada evento
// en monitoreo y guarda sus observaciones de los últimos 3 días en mon_observaciones.
// Sirven para medir el error de los modelos en la zona del evento y corregirlo (ver pipeline/mon/correccion.py).
// Lo dispara pg_cron con la clave de Vault (encabezado x-mon-cron).

import { unzipSync } from "npm:fflate@0.8.2";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const UA = { "user-agent": "EMERTEAM-Monitoreo/1.0 (info@emerteam.com.ar)" };
const BASE = "https://ssl.smn.gob.ar/dpd";
const RADIO_KM = 60;      // estaciones consideradas para cada evento
const POR_EVENTO = 2;     // la más cercana y una de respaldo
const DIAS = 3;           // días de observaciones que se releen en cada corrida

export type Estacion = { nombre: string; provincia: string; lat: number; lon: number; altura: number | null; nro: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function distanciaKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** estaciones_smn.txt: ancho fijo; latitud y longitud en grados y minutos */
function leerEstaciones(texto: string): Estacion[] {
  const out: Estacion[] = [];
  for (const l of texto.split(/\r?\n/)) {
    const nombre = l.slice(0, 31).trim();
    const provincia = l.slice(31, 68).trim();
    const t = l.slice(68).trim().split(/\s+/);
    if (!nombre || t.length < 6 || !/^-?\d+$/.test(t[0])) continue;
    const g = (deg: string, min: string) => {
      const d = parseInt(deg, 10);
      const s = deg.trim().startsWith("-") ? -1 : 1;
      return s * (Math.abs(d) + parseInt(min, 10) / 60);
    };
    out.push({ nombre, provincia, lat: g(t[0], t[1]), lon: g(t[2], t[3]), altura: Number.isFinite(+t[4]) ? +t[4] : null, nro: t[5] });
  }
  return out;
}

async function estaciones(): Promise<Estacion[]> {
  const { data } = await supabase.from("mon_estado").select("valor,actualizado_en").eq("clave", "smn_estaciones").maybeSingle();
  if (data && Date.now() - new Date(data.actualizado_en).getTime() < 7 * 86400_000) return JSON.parse(String(data.valor)) as Estacion[];
  const r = await fetch(`${BASE}/zipopendata.php?dato=estaciones`, { headers: UA });
  if (!r.ok) throw new Error(`estaciones: HTTP ${r.status}`);
  const archivos = unzipSync(new Uint8Array(await r.arrayBuffer()));
  const nombre = Object.keys(archivos).find((n) => /estaciones/i.test(n));
  if (!nombre) throw new Error("estaciones: el zip no trae el listado");
  const lista = leerEstaciones(new TextDecoder("latin1").decode(archivos[nombre]));
  if (lista.length < 50) throw new Error(`estaciones: solo ${lista.length} leídas`);
  await supabase.from("mon_estado").upsert({ clave: "smn_estaciones", valor: JSON.stringify(lista), actualizado_en: new Date().toISOString() });
  return lista;
}

const num = (s: string) => {
  const t = s.trim();
  if (!t) return null;
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
};

/** datohorarioAAAAMMDD.txt: FECHA (DDMMAAAA) y HORA en hora oficial argentina (UTC−3) */
function leerHorario(texto: string, buscadas: Set<string>) {
  const filas: Record<string, unknown>[] = [];
  for (const l of texto.split(/\r?\n/)) {
    if (!/^\d{8}\s/.test(l)) continue;
    const nombre = l.slice(43).trim();
    if (!buscadas.has(nombre)) continue;
    const f = l.slice(0, 8);
    const hora = parseInt(l.slice(8, 14), 10);
    if (!Number.isFinite(hora)) continue;
    const valido = new Date(Date.UTC(+f.slice(4, 8), +f.slice(2, 4) - 1, +f.slice(0, 2), hora + 3));
    const dd = num(l.slice(33, 38));
    filas.push({
      estacion: nombre, valido: valido.toISOString(),
      temp: num(l.slice(14, 20)), hr: num(l.slice(20, 25)), presion: num(l.slice(25, 33)),
      dir_viento: dd != null && dd <= 360 ? Math.round(dd) : null, viento: num(l.slice(38, 43)),
    });
  }
  return filas;
}

Deno.serve(async (req) => {
  const clave = req.headers.get("x-mon-cron") ?? "";
  const { data: ok } = clave ? await supabase.rpc("mon_validar_cron", { clave }) : { data: false };
  if (!ok) return json({ error: "no autorizado" }, 401);
  const ahora = Date.now();

  try {
    const { data: evs, error } = await supabase.from("mon_eventos").select("id,nombre,lat,lon")
      .eq("estado", "activo").gte("largada", new Date(ahora - 2 * 86400_000).toISOString())
      .lte("largada", new Date(ahora + 20 * 86400_000).toISOString());
    if (error) throw error;
    if (!evs?.length) return json({ ok: true, eventos: 0 });

    const lista = await estaciones();
    const buscadas = new Set<string>();
    const asignadas: Record<string, { estacion: string; km: number }[]> = {};
    for (const ev of evs) {
      const p = { lat: Number(ev.lat), lon: Number(ev.lon) };
      const cerca = lista.map((e) => ({ e, km: distanciaKm(p, e) })).filter((x) => x.km <= RADIO_KM)
        .sort((a, b) => a.km - b.km).slice(0, POR_EVENTO);
      asignadas[ev.nombre] = cerca.map((x) => ({ estacion: x.e.nombre, km: Math.round(x.km * 10) / 10 }));
      cerca.forEach((x) => buscadas.add(x.e.nombre));
    }
    if (!buscadas.size) return json({ ok: true, eventos: evs.length, estaciones: 0, asignadas });

    let filas: Record<string, unknown>[] = [];
    const dias: string[] = [];
    for (let k = 0; k < DIAS; k++) {
      const d = new Date(ahora - 3 * 3600_000 - k * 86400_000);
      const n = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
      const r = await fetch(`${BASE}/descarga_opendata.php?file=observaciones/datohorario${n}.txt`, { headers: UA });
      const t = r.ok ? await r.text() : "";
      const leidas = leerHorario(t, buscadas);
      dias.push(`${n}:${leidas.length}`);
      filas = filas.concat(leidas);
    }
    if (filas.length) {
      const { error: e2 } = await supabase.from("mon_observaciones").upsert(filas, { onConflict: "estacion,valido" });
      if (e2) throw e2;
    }
    await supabase.from("mon_observaciones").delete().lt("valido", new Date(ahora - 30 * 86400_000).toISOString());
    return json({ ok: true, eventos: evs.length, estaciones: [...buscadas], asignadas, dias, filas: filas.length });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
