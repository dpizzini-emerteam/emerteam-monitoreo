// EMERTEAM Monitoreo Ambiental · rayos por satélite (GOES-19, Geostationary Lightning Mapper)
// Cada 5 minutos, solo si hay un evento entre el inicio del armado y el fin del desarme:
// lee los archivos GLM-L2-LCFA nuevos (uno cada 20 s, NOAA en AWS, dominio público), toma los
// destellos con calidad buena y guarda los que caen a menos de 50 km de cada evento.
// Precisión de ubicación del GLM: del orden de 8–10 km; por debajo manda el detector en terreno y el trueno.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import h5wasm from "npm:h5wasm@0.7.8";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const BUCKET = "https://noaa-goes19.s3.amazonaws.com";
const PRODUCTO = "GLM-L2-LCFA";
const RADIO_KM = 50;
const MAX_ARCHIVOS = 36; // hasta 12 minutos de datos por corrida
const CLAVE_ESTADO = "glm_ultimo_archivo";

type Evento = { id: string; largada: string; lat: number; lon: number; armado_dias: number };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function distanciaKm(a: number, b: number, c: number, d: number): number {
  const r = Math.PI / 180;
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}

/** Prefijo de una hora UTC: GLM-L2-LCFA/AAAA/DDD/HH/ */
function prefijo(t: number): string {
  const d = new Date(t);
  const inicio = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dia = Math.floor((t - inicio) / 86400_000) + 1;
  return `${PRODUCTO}/${d.getUTCFullYear()}/${String(dia).padStart(3, "0")}/${String(d.getUTCHours()).padStart(2, "0")}/`;
}

/** Inicio del archivo según su nombre: ..._sAAAADDDHHMMSSt_... */
function inicioArchivo(clave: string): number | null {
  const m = clave.match(/_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})(\d)_/);
  if (!m) return null;
  const [, a, ddd, hh, mm, ss, dec] = m;
  return Date.UTC(Number(a), 0, 1) + (Number(ddd) - 1) * 86400_000 + Number(hh) * 3600_000 + Number(mm) * 60_000 + Number(ss) * 1000 + Number(dec) * 100;
}

async function listar(pref: string): Promise<string[]> {
  const r = await fetch(`${BUCKET}/?list-type=2&prefix=${pref}`);
  if (!r.ok) return [];
  const xml = await r.text();
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
}

Deno.serve(async (req) => {
  const clave = req.headers.get("x-mon-cron") ?? "";
  const { data: ok } = clave ? await supabase.rpc("mon_validar_cron", { clave }) : { data: false };
  if (!ok) return json({ error: "no autorizado" }, 401);
  const ahora = Date.now();

  // Eventos en ventana activa: desde el inicio del armado hasta 24 h después de la largada + 8 h de carrera
  const { data: evs } = await supabase.from("mon_eventos").select("id,largada,lat,lon,armado_dias")
    .eq("estado", "activo")
    .gte("largada", new Date(ahora - 2 * 86400_000).toISOString())
    .lte("largada", new Date(ahora + 11 * 86400_000).toISOString());
  const activos = ((evs ?? []) as Evento[]).filter((e) => {
    const l = new Date(e.largada).getTime();
    return ahora >= l - ((e.armado_dias || 3) + 1) * 86400_000 && ahora <= l + 32 * 3600_000;
  });
  if (!activos.length) return json({ ok: true, activos: 0 });

  const { data: est } = await supabase.from("mon_estado").select("valor").eq("clave", CLAVE_ESTADO).maybeSingle();
  const ultimo = (est?.valor as string | undefined) ?? "";
  const desde = Math.max(ahora - 12 * 60_000, ultimo ? (inicioArchivo(ultimo) ?? 0) : 0);

  const claves = [...new Set([...(await listar(prefijo(ahora - 3600_000))), ...(await listar(prefijo(ahora)))])]
    .filter((k) => k.endsWith(".nc") && k > ultimo && (inicioArchivo(k) ?? 0) >= desde)
    .sort()
    .slice(0, MAX_ARCHIVOS);
  if (!claves.length) return json({ ok: true, activos: activos.length, archivos: 0 });

  const { FS } = await h5wasm.ready;
  const filas: Record<string, unknown>[] = [];
  let procesados = 0;
  for (let i = 0; i < claves.length; i += 6) {
    const lote = claves.slice(i, i + 6);
    const datos = await Promise.all(lote.map(async (k) => {
      try {
        const r = await fetch(`${BUCKET}/${k}`);
        return r.ok ? { k, buf: new Uint8Array(await r.arrayBuffer()) } : { k, buf: null };
      } catch {
        return { k, buf: null };
      }
    }));
    for (const { k, buf } of datos) {
      if (!buf) continue;
      const ruta = `/tmp/${k.split("/").pop()}`;
      try {
        FS.writeFile(ruta, buf);
        const f = new h5wasm.File(ruta, "r");
        const lat = (f.get("flash_lat") as { value: Float32Array } | null)?.value ?? new Float32Array();
        const lon = (f.get("flash_lon") as { value: Float32Array } | null)?.value ?? new Float32Array();
        const cal = (f.get("flash_quality_flag") as { value: Int16Array } | null)?.value;
        f.close();
        const t0 = inicioArchivo(k) ?? ahora;
        for (let j = 0; j < lat.length; j++) {
          if (cal && cal[j] !== 0) continue; // solo destellos con calidad buena
          for (const ev of activos) {
            const dkm = distanciaKm(Number(ev.lat), Number(ev.lon), lat[j], lon[j]);
            if (dkm <= RADIO_KM) {
              filas.push({
                evento_id: ev.id, ocurrido_en: new Date(t0).toISOString(), lat: Number(lat[j].toFixed(4)),
                lon: Number(lon[j].toFixed(4)), distancia_km: Number(dkm.toFixed(1)), fuente: "glm", archivo: k.split("/").pop(),
              });
            }
          }
        }
        procesados++;
      } catch {
        // archivo ilegible: se saltea
      } finally {
        try { FS.unlink(ruta); } catch { /* ya borrado */ }
      }
    }
  }

  if (filas.length) {
    const { error } = await supabase.from("mon_rayos").upsert(filas, { onConflict: "evento_id,archivo,lat,lon", ignoreDuplicates: true });
    if (error) return json({ error: error.message }, 500);
  }
  await supabase.from("mon_estado").upsert({ clave: CLAVE_ESTADO, valor: claves[claves.length - 1], actualizado_en: new Date().toISOString() });
  // Se conservan 30 días para el informe post-evento
  await supabase.from("mon_rayos").delete().lt("ocurrido_en", new Date(ahora - 30 * 86400_000).toISOString());

  return json({ ok: true, activos: activos.length, archivos: procesados, rayos_cercanos: filas.length, ultimo: claves[claves.length - 1] });
});
