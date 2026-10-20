// EMERTEAM Monitoreo Ambiental · procesamiento inmediato
// La base la llama (trigger en mon_eventos) cuando se crea un evento o cambian su fecha, lugar o días de armado.
// Dispara el workflow de GitHub Actions "Pronósticos y niveles" para no esperar la vuelta programada (cada 2 h).
// Token: secreto GITHUB_DISPARO_TOKEN (token de acceso de GitHub con permiso "Actions: read and write" sobre el repositorio).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const REPO = "dpizzini-emerteam/emerteam-monitoreo";
const WORKFLOW = "pronosticos.yml";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  const clave = req.headers.get("x-mon-cron") ?? "";
  const { data: ok } = clave ? await supabase.rpc("mon_validar_cron", { clave }) : { data: false };
  if (!ok) return json({ error: "no autorizado" }, 401);
  const token = Deno.env.get("GITHUB_DISPARO_TOKEN");
  if (!token) return json({ ok: false, motivo: "sin token de GitHub: queda la vuelta programada cada 2 h" });

  // Varios cambios seguidos no se acumulan: el workflow usa un grupo de concurrencia y deja una sola corrida en espera
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "EMERTEAM-Monitoreo" },
    body: JSON.stringify({ ref: "main", inputs: { forzar: "false" } }),
  });
  if (r.status !== 204) return json({ ok: false, status: r.status, error: (await r.text()).slice(0, 300) }, 502);
  return json({ ok: true, disparado: true });
});
