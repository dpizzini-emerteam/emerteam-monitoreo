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
        .select("id,nombre,largada,lat,lon,participantes,armado_dias,duracion_propia_min,demora_largada_min,portico,mon_modalidades(nombre,distancia_km,participantes,largada)")
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
