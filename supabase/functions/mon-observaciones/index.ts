// EMERTEAM Monitoreo Ambiental · observaciones horarias del SMN (datos abiertos)
// Cada hora: actualiza (semanalmente) el listado de estaciones, elige las estaciones cercanas a cada evento
// en monitoreo y guarda sus observaciones en mon_observaciones. Dos archivos:
// · tiepre (tiempo presente): último parte de cada estación, se renueva cada hora. Da pares casi en tiempo real.
// · datohorario: el día completo, publicado al día siguiente. Es el registro oficial y reemplaza lo de tiepre.
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
const DIAS = 3;           // días de datohorario que se releen en cada corrida

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

/** AAAAMMDD en hora oficial argentina */
const fechaAR = (t: number) => {
  const d = new Date(t - 3 * 3600_000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
};

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

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const RUMBOS: Record<string, number> = {
  NORTE: 0, NORNORESTE: 22.5, NORESTE: 45, ESTENORESTE: 67.5, ESTE: 90, ESTESUDESTE: 112.5, SUDESTE: 135, SUDSUDESTE: 157.5,
  SUR: 180, SUDSUDOESTE: 202.5, SUDOESTE: 225, OESTESUDOESTE: 247.5, OESTE: 270, OESTENOROESTE: 292.5, NOROESTE: 315, NORNOROESTE: 337.5,
};
// Nombres de tiepre que no se resuelven con las reglas generales
const ALIAS: Record<string, string> = {
  "AEROPARQUE BUENOS AIRES": "AEROPARQUE AERO", "PILAR OBS.": "PILAR OBSERVATORIO", "JUJUY UNIVERSIDAD NACIONAL": "JUJUY U N",
  "PCIA. ROQUE SAENZ PENA": "PRESIDENCIA ROQUE SAENZ PEÑA A", "ESC. AVIACION MILITAR": "ESCUELA DE AVIACION MILITAR AE",
  "BASE CARLINI": "BASE CARLINI (EX JUBANY)", "SANTA ROSA DEL CONLARA": "SANTA ROSA DE CONLARA AERO",
  "VILLA MARIA DEL RIO SECO": "VILLA DE MARIA DEL RIO SECO", "TERMAS DE RIO HONDO": "TERMAS DE RIO HONDO AERO",
};
export const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** Nombre de tiepre → nombre del listado de estaciones (null si no hay correspondencia segura) */
export function estacionDeTiepre(nombre: string, listado: Set<string>): string | null {
  const n = normalizar(nombre);
  if (ALIAS[n]) return ALIAS[n];
  for (const c of [n, `${n} AERO`, `${n} OBSERVATORIO`]) if (listado.has(c)) return c;
  return null;
}

/** tiepre: nombre;dd-mes-aaaa;HH:MM;cielo;visibilidad;temp;sensación;HR;viento;presión (hora oficial, UTC−3) */
export function leerTiepre(texto: string, buscadas: Set<string>, listado: Set<string>, ahora: number) {
  const filas: Record<string, unknown>[] = [];
  for (const l of texto.split(/\r?\n/)) {
    const c = l.split(";");
    if (c.length < 10) continue;
    const est = estacionDeTiepre(c[0], listado);
    if (!est || !buscadas.has(est)) continue;
    const f = /^(\d{1,2})-([a-z]+)-(\d{4})$/i.exec(c[1].trim());
    const h = /^(\d{1,2}):(\d{2})$/.exec(c[2].trim());
    if (!f || !h) continue;
    const mes = MESES.indexOf(f[2].toLowerCase());
    if (mes < 0) continue;
    const valido = new Date(Date.UTC(+f[3], mes, +f[1], +h[1] + 3, +h[2]));
    if (valido.getUTCMinutes() !== 0 || valido.getTime() > ahora + 3600_000 || ahora - valido.getTime() > 12 * 3600_000) continue;
    const v = normalizar(c[8]);
    let dir: number | null = null, vel: number | null = null;
    if (v.startsWith("CALMA")) vel = 0;
    else {
      const m = /^([A-Z]+)\s+(\d+(?:\.\d+)?)$/.exec(v);
      if (m) { vel = +m[2]; dir = RUMBOS[m[1]] ?? null; }
    }
    filas.push({
      estacion: est, valido: valido.toISOString(), temp: num(c[5]), hr: num(c[7]),
      presion: num(c[9].split("/")[0]), dir_viento: dir == null ? null : Math.round(dir), viento: vel, origen: "tiepre",
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

    // Tiempo presente: no pisa lo ya guardado (el horario oficial manda)
    const listado = new Set(lista.map((e) => e.nombre));
    let tiepre = 0;
    // Pasada la medianoche el archivo del día puede no existir todavía: se prueba el del día anterior
    for (const t0 of [ahora, ahora - 86400_000]) {
      const r = await fetch(`${BASE}/descarga_opendata.php?file=observaciones/tiepre${fechaAR(t0)}.txt`, { headers: UA });
      const t = r.ok ? new TextDecoder("latin1").decode(new Uint8Array(await r.arrayBuffer())) : "";
      if (t.length > 500) {
        const leidas = leerTiepre(t, buscadas, listado, ahora);
        if (leidas.length) {
          const { error: e1 } = await supabase.from("mon_observaciones").upsert(leidas, { onConflict: "estacion,valido", ignoreDuplicates: true });
          if (e1) throw e1;
        }
        tiepre = leidas.length;
        break;
      }
    }

    let filas: Record<string, unknown>[] = [];
    const dias: string[] = [];
    for (let k = 0; k < DIAS; k++) {
      const d = new Date(ahora - 3 * 3600_000 - k * 86400_000);
      const n = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
      const r = await fetch(`${BASE}/descarga_opendata.php?file=observaciones/datohorario${n}.txt`, { headers: UA });
      const t = r.ok ? new TextDecoder("latin1").decode(new Uint8Array(await r.arrayBuffer())) : "";
      const leidas = leerHorario(t, buscadas).map((f) => ({ ...f, origen: "datohorario" }));
      dias.push(`${n}:${leidas.length}`);
      filas = filas.concat(leidas);
    }
    if (filas.length) {
      const { error: e2 } = await supabase.from("mon_observaciones").upsert(filas, { onConflict: "estacion,valido" });
      if (e2) throw e2;
    }
    await supabase.from("mon_observaciones").delete().lt("valido", new Date(ahora - 30 * 86400_000).toISOString());
    return json({ ok: true, eventos: evs.length, estaciones: [...buscadas], asignadas, tiepre, dias, filas: filas.length });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
