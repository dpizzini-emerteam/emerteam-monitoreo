// EMERTEAM Monitoreo Ambiental · alertas oficiales del SMN
// Lee el feed CAP del SMN (alertas y avisos a corto plazo), cruza cada polígono con la ubicación
// de los eventos en monitoreo y guarda las vigentes en mon_alertas_smn.
// Lo dispara pg_cron cada 5 minutos con una clave guardada en Vault (encabezado x-mon-cron).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { XMLParser } from "npm:fast-xml-parser@4.5.0";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const INDICE = "https://ssl.smn.gob.ar/CAP/AR.php";
const CORTO = "https://ssl.smn.gob.ar/feeds/CAP/avisocortoplazo/";
const MINUTOS_CORTO = 12; // ventana de búsqueda de avisos a corto plazo (corre cada 5 min)

// Severidad CAP → color del SMN (convención OMM; Severe = naranja verificado contra el mapa del SMN)
const COLOR: Record<string, string> = { Minor: "amarillo", Moderate: "amarillo", Severe: "naranja", Extreme: "rojo" };

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });
const lista = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

type Evento = {
  id: string; nombre: string; largada: string; lat: number; lon: number; armado_dias: number;
  participantes: number | null; duracion_propia_min: number | null; demora_largada_min: number | null;
  mon_modalidades: { distancia_km: number; largada: string | null }[] | null;
};
type Fila = {
  id: string; evento_id: string; fenomeno: string; color: string; desde: string | null; hasta: string | null;
  emitida: string | null; estado: string; zona: string | null; tipo: string; severidad: string; fuente_url: string;
  descripcion: string | null; instruccion: string | null;
};

/** Texto del CAP con las entidades numéricas resueltas (&#xE1; → á) y espacios normalizados */
function textoCap(x: unknown): string | null {
  if (x == null) return null;
  const t = String(x)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 3000) : null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Punto en polígono (ray casting). Polígono CAP: "lat,lon lat,lon ..." */
function dentro(lat: number, lon: number, poligono: string): boolean {
  const p = poligono.trim().split(/\s+/).map((par) => par.split(",").map(Number)).filter((v) => v.length === 2 && v.every(Number.isFinite));
  let adentro = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [yi, xi] = p[i];
    const [yj, xj] = p[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) adentro = !adentro;
  }
  return adentro;
}

// Réplica de pipeline/mon/ventanas.py y web/src/ventanas.ts (config/umbrales.json → ventanas):
// del inicio del armado (00:00 del día de largada menos los días de armado) al fin del desarme (fin de carrera + 24 h)
const ANCLAS: [number, number][] = [[0, 0], [3, 54], [5, 75], [10, 120], [21.0975, 180], [42.195, 360]];
function duracionEstimadaMin(km: number): number {
  if (km >= 42.195) return (360 * km) / 42.195;
  for (let i = 0; i < ANCLAS.length - 1; i++) {
    const [k0, d0] = ANCLAS[i], [k1, d1] = ANCLAS[i + 1];
    if (km >= k0 && km <= k1) return d0 + ((d1 - d0) * (km - k0)) / (k1 - k0);
  }
  return 0;
}
function ventana(ev: Evento): [number, number] {
  const largada = new Date(ev.largada).getTime();
  const demora = ev.demora_largada_min ?? ((ev.participantes ?? 0) / 1000) * 1;
  let fin = largada;
  if (ev.duracion_propia_min) fin = largada + (demora + ev.duracion_propia_min) * 60_000;
  else {
    for (const m of ev.mon_modalidades?.length ? ev.mon_modalidades : [{ distancia_km: 10, largada: null }]) {
      const ini = m.largada ? new Date(m.largada).getTime() : largada;
      fin = Math.max(fin, ini + (demora + duracionEstimadaMin(Number(m.distancia_km))) * 60_000);
    }
  }
  const local = new Date(largada - 3 * 3600_000);
  const dia0 = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 3);
  return [dia0 - (ev.armado_dias || 3) * 86400_000, fin + 1440 * 60_000];
}

async function hash(texto: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(texto));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

function limpiarFenomeno(info: Record<string, unknown>, tipo: string): string {
  let t = String(info.event ?? info.headline ?? "Alerta").trim();
  t = t.replace(/\s*-\s*AVISO\s+(AMARILLO|NARANJA|ROJO)\s*$/i, "");
  if (t === t.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase();
  return tipo === "aviso_corto_plazo" ? `${t} (aviso a corto plazo)` : t;
}

async function traer(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      // El SMN responde HTML si el pedido acepta cualquier formato: se pide XML explícitamente
      headers: { "user-agent": "EMERTEAM-Monitoreo/1.0 (info@emerteam.com.ar)", accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8" },
    });
    if (!r.ok) return null;
    const t = await r.text();
    return t.trimStart().startsWith("<") ? t : null;
  } catch {
    return null;
  }
}

/** Nombres de archivo de avisos a corto plazo de los últimos minutos (hora argentina, UTC−3) */
function nombresCorto(ahora: number): string[] {
  const out: string[] = [];
  for (let m = 0; m < MINUTOS_CORTO; m++) {
    const d = new Date(ahora - m * 60_000 - 3 * 3600_000);
    const z = (n: number) => String(n).padStart(2, "0");
    out.push(`${CORTO}${d.getUTCFullYear()}_${z(d.getUTCMonth() + 1)}_${z(d.getUTCDate())}_${z(d.getUTCHours())}${z(d.getUTCMinutes())}_cap_es.xml`);
  }
  return out;
}

async function enLotes<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(f))));
  return out;
}

Deno.serve(async (req) => {
  const clave = req.headers.get("x-mon-cron") ?? "";
  const { data: ok } = clave ? await supabase.rpc("mon_validar_cron", { clave }) : { data: false };
  if (!ok) return json({ error: "no autorizado" }, 401);
  const ahora = Date.now();

  const { data: evs, error } = await supabase
    .from("mon_eventos")
    .select("id,nombre,largada,lat,lon,armado_dias,participantes,duracion_propia_min,demora_largada_min,mon_modalidades(distancia_km,largada)")
    .eq("estado", "activo")
    .gte("largada", new Date(ahora - 2 * 86400_000).toISOString())
    .lte("largada", new Date(ahora + 16 * 86400_000).toISOString());
  if (error) return json({ error: error.message }, 500);
  const eventos = (evs ?? []) as Evento[];
  if (!eventos.length) return json({ ok: true, eventos: 0 });

  // 1. Índice general de alertas (RSS) + avisos a corto plazo de los últimos minutos
  const indice = await traer(INDICE);
  const enlaces = indice
    ? [...indice.matchAll(/https:\/\/ssl\.smn\.gob\.ar\/feeds\/CAP\/[^"'<>\s]+\.xml/g)].map((m) => m[0])
    : [];
  const unicos = [...new Set(enlaces)];
  const cortos = nombresCorto(ahora);

  // Archivos del índice ya leídos en corridas anteriores (un CAP publicado no cambia)
  const { data: cache } = await supabase.from("mon_smn_cache").select("url,alerta").limit(2000);
  const enCache = new Map((cache ?? []).map((c) => [c.url as string, c.alerta as Record<string, unknown> | null]));
  const aLeer = [...unicos.filter((u) => !enCache.has(u)).map((u) => ({ u, tipo: "alerta" })), ...cortos.map((u) => ({ u, tipo: "aviso_corto_plazo" }))];
  const leidos = await enLotes(aLeer, 8, async (x) => {
    const xml = await traer(x.u);
    let alerta: Record<string, unknown> | null = null;
    if (xml) {
      try { alerta = (parser.parse(xml) as Record<string, Record<string, unknown>>).alert ?? null; } catch { alerta = null; }
    }
    return { ...x, alerta, leido: !!xml };
  });
  const nuevosCache = leidos.filter((d) => d.tipo === "alerta" && d.leido).map((d) => ({ url: d.u, alerta: d.alerta }));
  if (nuevosCache.length) await supabase.from("mon_smn_cache").upsert(nuevosCache, { onConflict: "url" });
  // Limpieza: lo que salió del índice hace más de 3 días
  await supabase.from("mon_smn_cache").delete().lt("leido_en", new Date(ahora - 3 * 86400_000).toISOString());
  const docs = [
    ...unicos.filter((u) => enCache.has(u)).map((u) => ({ u, tipo: "alerta", alerta: enCache.get(u) ?? null })),
    ...leidos.filter((d) => d.alerta).map((d) => ({ u: d.u, tipo: d.tipo, alerta: d.alerta })),
  ];

  // 2. Cruce con cada evento
  const filas = new Map<string, Fila>();
  for (const d of docs) {
    const alerta = d.alerta as Record<string, unknown> | null;
    if (!alerta || alerta.status !== "Actual" || alerta.msgType === "Cancel") continue;
    const tipo = d.u.includes("/avisocortoplazo/") || String(alerta.identifier ?? "").includes("corto") ? "aviso_corto_plazo" : d.tipo;
    for (const info of lista(alerta.info as Record<string, unknown> | Record<string, unknown>[])) {
      const severidad = String(info.severity ?? "");
      const color = COLOR[severidad];
      if (!color) continue;
      const desde = String(info.onset ?? info.effective ?? alerta.sent ?? "") || null;
      const hasta = String(info.expires ?? "") || null;
      const t0 = desde ? new Date(desde).getTime() : ahora;
      const t1 = hasta ? new Date(hasta).getTime() : t0 + 6 * 3600_000;
      if (t1 < ahora) continue;
      for (const area of lista(info.area as Record<string, unknown> | Record<string, unknown>[])) {
        for (const pol of lista(area.polygon as string | string[])) {
          for (const ev of eventos) {
            const [v0, v1] = ventana(ev);
            if (t1 < v0 || t0 > v1) continue;
            if (!dentro(Number(ev.lat), Number(ev.lon), String(pol))) continue;
            const fenomeno = limpiarFenomeno(info, tipo);
            const id = await hash([tipo, ev.id, fenomeno, color, desde, hasta].join("|"));
            filas.set(id, {
              id, evento_id: ev.id, fenomeno, color, desde, hasta,
              emitida: String(alerta.sent ?? "") || null, estado: "vigente",
              zona: String(area.areaDesc ?? "").trim().slice(0, 500) || null,
              tipo, severidad, fuente_url: d.u,
              descripcion: textoCap(info.description), instruccion: textoCap(info.instruction),
            });
          }
        }
      }
    }
  }

  // 3. Guardar nuevas (las ya registradas quedan igual)
  const nuevas = [...filas.values()];
  if (nuevas.length) {
    const { error: e1 } = await supabase.from("mon_alertas_smn").upsert(nuevas, { onConflict: "id", ignoreDuplicates: true });
    if (e1) return json({ error: e1.message }, 500);
    // Texto oficial en las ya registradas que no lo tenían
    for (const n of nuevas.filter((x) => x.descripcion || x.instruccion)) {
      await supabase.from("mon_alertas_smn").update({ descripcion: n.descripcion, instruccion: n.instruccion }).eq("id", n.id).is("descripcion", null);
    }
    // Una alerta que se había dado por levantada y vuelve a figurar, vuelve a estar vigente
    await supabase.from("mon_alertas_smn").update({ estado: "vigente" }).in("id", nuevas.map((n) => n.id)).eq("estado", "levantada");
  }

  // 4. Alertas que dejaron de figurar en el índice: levantadas (solo si el índice se leyó bien)
  let levantadas = 0;
  if (indice) {
    const { data: vigentes } = await supabase
      .from("mon_alertas_smn").select("id")
      .eq("tipo", "alerta").eq("estado", "vigente").in("evento_id", eventos.map((e) => e.id));
    const fuera = (vigentes ?? []).map((v) => v.id as string).filter((id) => !filas.has(id));
    if (fuera.length) {
      await supabase.from("mon_alertas_smn").update({ estado: "levantada" }).in("id", fuera);
      levantadas = fuera.length;
    }
  }

  return json({
    ok: true, eventos: eventos.length, indice: !!indice, cap_en_indice: unicos.length, cap_descargados: leidos.filter((d) => d.leido).length,
    vigentes_para_eventos: nuevas.length, levantadas,
  });
});
