// EMERTEAM Monitoreo Ambiental · función de ingesta
// Puente entre el procesamiento automático (GitHub Actions) y la base.
// Autenticación: token OIDC de GitHub Actions (sin secretos compartidos).
// Solo se aceptan tokens emitidos para el repositorio y la rama autorizados.
// Usa la service role disponible dentro de la función; nunca se expone fuera.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const REPO = "dpizzini-emerteam/emerteam-monitoreo";
const AUDIENCIA = "mon-ingesta";
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function autorizado(req: Request): Promise<boolean> {
  const h = req.headers.get("x-mon-oidc") ?? "";
  if (!h) return false;
  try {
    const { payload } = await jwtVerify(h, JWKS, {
      issuer: "https://token.actions.githubusercontent.com",
      audience: AUDIENCIA,
    });
    return payload.repository === REPO && payload.ref === "refs/heads/main";
  } catch {
    return false;
  }
}

function distanciaKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const FUENTES = new Set(["gfs", "ecmwf", "icon", "wrf_smn", "met_no"]);

Deno.serve(async (req) => {
  if (!(await autorizado(req))) return json({ error: "no autorizado" }, 401);
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      // Eventos en monitoreo: activos y con desarme no terminado
      const desde = new Date(Date.now() - 2 * 86400_000).toISOString();
      const { data: eventos, error } = await supabase
        .from("mon_eventos")
        .select("id,nombre,largada,lat,lon,participantes,armado_dias,duracion_propia_min,demora_largada_min,portico,disciplina,natacion_min,mon_modalidades(nombre,distancia_km,participantes,largada)")
        .eq("estado", "activo")
        .gte("largada", desde);
      if (error) throw error;

      const respuesta: Record<string, unknown> = { eventos };

      // Última corrida procesada por fuente
      const ultimas: Record<string, string> = {};
      for (const fuente of FUENTES) {
        const { data, error: e2 } = await supabase
          .from("mon_pronosticos")
          .select("corrida")
          .eq("fuente", fuente)
          .order("corrida", { ascending: false })
          .limit(1);
        if (e2) throw e2;
        if (data?.[0]) ultimas[fuente] = data[0].corrida;
      }
      respuesta.ultimas_corridas = ultimas;

      // Última corrida por evento y fuente: un evento nuevo (o con fecha/lugar cambiados) se procesa
      // aunque la corrida ya esté guardada para los demás
      const porEvento: Record<string, Record<string, string>> = {};
      for (const ev of eventos ?? []) {
        porEvento[ev.id] = {};
        for (const fuente of ["gfs", "ecmwf", "wrf_smn"]) {
          const { data } = await supabase.from("mon_pronosticos").select("corrida")
            .eq("evento_id", ev.id).eq("fuente", fuente).order("corrida", { ascending: false }).limit(1);
          if (data?.[0]) porEvento[ev.id][fuente] = data[0].corrida;
        }
      }
      respuesta.ultimas_por_evento = porEvento;

      // Ensambles: sesgo vigente por evento y fuente, y última corrida de ensamble ya guardada por evento
      if (url.searchParams.get("incluir") === "ensambles" && eventos?.length) {
        const ids = eventos.map((e) => e.id);
        const { data: sesgos, error: es } = await supabase.from("mon_sesgos").select("*").in("evento_id", ids);
        if (es) throw es;
        respuesta.sesgos = sesgos;
        const ultimas: Record<string, string> = {};
        for (const id of ids) {
          const { data } = await supabase.from("mon_ens_prob").select("corrida").eq("evento_id", id).eq("modelo", "mezcla")
            .order("corrida", { ascending: false }).limit(1);
          if (data?.[0]) ultimas[id] = data[0].corrida;
        }
        respuesta.ens_ultimas = ultimas;
      }

      if (url.searchParams.get("incluir") === "pronosticos" && eventos?.length) {
        const ids = eventos.map((e) => e.id);
        const pron: unknown[] = [];
        // La API devuelve como máximo 1000 filas por pedido: se pagina
        for (let desde = 0; ; desde += 1000) {
          const { data, error: e3 } = await supabase
            .from("mon_pronosticos")
            .select("*")
            .in("evento_id", ids)
            .gte("valido", new Date(Date.now() - 20 * 86400_000).toISOString())
            .order("evento_id")
            .order("fuente")
            .order("valido")
            .range(desde, desde + 999);
          if (e3) throw e3;
          pron.push(...(data ?? []));
          if (!data || data.length < 1000) break;
        }
        respuesta.pronosticos = pron;

        // Estaciones del SMN a 60 km o menos de cada evento (las dos más cercanas) y sus observaciones de los últimos 4 días
        const { data: est } = await supabase.from("mon_estado").select("valor").eq("clave", "smn_estaciones").maybeSingle();
        const lista = est ? (JSON.parse(String(est.valor)) as { nombre: string; lat: number; lon: number }[]) : [];
        const estaciones: Record<string, { nombre: string; lat: number; lon: number; km: number }> = {};
        const estacionesEvento: Record<string, { nombre: string; lat: number; lon: number; km: number }[]> = {};
        for (const ev of eventos) {
          const cerca = lista.map((e) => ({ nombre: e.nombre, lat: e.lat, lon: e.lon,
            km: Math.round(distanciaKm({ lat: Number(ev.lat), lon: Number(ev.lon) }, e) * 10) / 10 }))
            .filter((e) => e.km <= 60).sort((a, b) => a.km - b.km).slice(0, 2);
          if (cerca.length) { estaciones[ev.id] = cerca[0]; estacionesEvento[ev.id] = cerca; }
        }
        respuesta.estaciones = estaciones;
        respuesta.estaciones_evento = estacionesEvento;
        const nombres = [...new Set(Object.values(estacionesEvento).flat().map((e) => e.nombre))];
        const observaciones: Record<string, unknown[]> = {};
        if (nombres.length) {
          const { data: obs, error: e4 } = await supabase.from("mon_observaciones").select("estacion,valido,temp,hr,viento,dir_viento")
            .in("estacion", nombres).gte("valido", new Date(Date.now() - 4 * 86400_000).toISOString()).order("valido").limit(10000);
          if (e4) throw e4;
          for (const o of obs ?? []) (observaciones[o.estacion as string] ??= []).push(o);
        }
        respuesta.observaciones = observaciones;
      }
      return json(respuesta);
    }

    if (req.method === "POST") {
      const body = await req.json();

      if (body.tipo === "pronosticos") {
        const filas = (body.filas ?? []) as Record<string, unknown>[];
        if (!filas.every((f) => FUENTES.has(String(f.fuente)))) {
          return json({ error: "fuente desconocida" }, 400);
        }
        for (let i = 0; i < filas.length; i += 500) {
          const { error } = await supabase
            .from("mon_pronosticos")
            .upsert(filas.slice(i, i + 500), { onConflict: "evento_id,fuente,valido" });
          if (error) throw error;
        }
        return json({ ok: true, filas: filas.length });
      }

      if (body.tipo === "correcciones") {
        // Solo actualiza las columnas *_corr de filas ya guardadas
        const permitidas = ["evento_id", "fuente", "corrida", "valido", "t2m_corr", "td2m_corr", "hr_corr", "viento10_corr", "rafaga10_corr", "wbgt_corr"];
        const filas = ((body.filas ?? []) as Record<string, unknown>[]).map((f) => Object.fromEntries(permitidas.map((k) => [k, f[k] ?? null])));
        if (!filas.every((f) => FUENTES.has(String(f.fuente)))) return json({ error: "fuente desconocida" }, 400);
        for (let i = 0; i < filas.length; i += 500) {
          const { error } = await supabase.from("mon_pronosticos").upsert(filas.slice(i, i + 500), { onConflict: "evento_id,fuente,valido" });
          if (error) throw error;
        }
        return json({ ok: true, filas: filas.length });
      }

      if (body.tipo === "sesgos") {
        const filas = (body.filas ?? []) as Record<string, unknown>[];
        if (filas.length) {
          const { error } = await supabase.from("mon_sesgos").upsert(filas, { onConflict: "evento_id,fuente" });
          if (error) throw error;
        }
        return json({ ok: true, filas: filas.length });
      }

      if (body.tipo === "uv") {
        // Índice UV con cielo despejado: reemplaza la serie de cada evento desde la primera hora informada
        const porEvento = (body.eventos ?? {}) as Record<string, Record<string, unknown>[]>;
        const permitidas = ["evento_id", "valido", "uv", "interpolado", "fuente", "actualizado_en"];
        let total = 0;
        for (const [eventoId, filas0] of Object.entries(porEvento)) {
          const filas = filas0.map((f) => ({ ...Object.fromEntries(permitidas.map((k) => [k, f[k] ?? null])), evento_id: eventoId, fuente: "met_no" }));
          if (!filas.length) continue;
          // Se conservan las horas pasadas (para el informe posterior); se reemplaza desde la primera hora nueva
          const desde = filas.map((f) => String(f.valido)).sort()[0];
          const { error: ed } = await supabase.from("mon_uv").delete().eq("evento_id", eventoId).gte("valido", desde);
          if (ed) throw ed;
          for (let i = 0; i < filas.length; i += 500) {
            const { error } = await supabase.from("mon_uv").insert(filas.slice(i, i + 500));
            if (error) throw error;
          }
          total += filas.length;
        }
        return json({ ok: true, filas: total });
      }

      if (body.tipo === "ensambles") {
        // Cada emisión se guarda sin borrar las anteriores; reprocesar la misma corrida la reemplaza
        const probs = (body.prob ?? []) as Record<string, unknown>[];
        const horas = (body.horas ?? []) as Record<string, unknown>[];
        const modelos = new Set(["ecmwf", "gefs", "mezcla"]);
        if (![...probs, ...horas].every((f) => modelos.has(String(f.modelo)))) return json({ error: "modelo desconocido" }, 400);
        for (let i = 0; i < probs.length; i += 500) {
          const { error } = await supabase.from("mon_ens_prob").upsert(probs.slice(i, i + 500), { onConflict: "evento_id,corrida,modelo,variable,nivel,ventana" });
          if (error) throw error;
        }
        for (let i = 0; i < horas.length; i += 500) {
          const { error } = await supabase.from("mon_ens_horas").upsert(horas.slice(i, i + 500), { onConflict: "evento_id,corrida,modelo,variable,valido" });
          if (error) throw error;
        }
        return json({ ok: true, prob: probs.length, horas: horas.length });
      }

      if (body.tipo === "niveles") {
        // Reemplaza los niveles calculados desde pronóstico para cada evento informado
        const porEvento = (body.eventos ?? {}) as Record<string, Record<string, unknown>[]>;
        let total = 0;
        for (const [eventoId, filas] of Object.entries(porEvento)) {
          const { error: ed } = await supabase
            .from("mon_niveles")
            .delete()
            .eq("evento_id", eventoId)
            .eq("origen", "pronostico");
          if (ed) throw ed;
          for (let i = 0; i < filas.length; i += 500) {
            const { error } = await supabase.from("mon_niveles").insert(filas.slice(i, i + 500));
            if (error) throw error;
          }
          total += filas.length;
        }
        return json({ ok: true, filas: total });
      }

      return json({ error: "tipo desconocido" }, 400);
    }

    return json({ error: "método no permitido" }, 405);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
