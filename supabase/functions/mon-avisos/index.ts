// EMERTEAM Monitoreo Ambiental · correos de aviso
// Cada 5 minutos compara el estado de cada evento con el último avisado y envía un correo cuando:
//  · el SMN emite, modifica o levanta una alerta para la zona del evento;
//  · sube el nivel de alguna variable en alguna fase (dentro del horizonte confiable de 5 días);
//  · el satélite detecta rayos a menos de 24 km;
//  · una variable que estaba por encima del umbral vuelve a quedar por debajo (un único aviso de normalización).
// Histéresis: las bajadas parciales no generan correo. Sin credencial de envío, registra sin enviar.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const WEB = Deno.env.get("MON_URL_WEB") ?? "https://emerteam-monitoreo.netlify.app";
const HORIZONTE_MS = 5 * 86400_000;

const COLOR = ["#2FA34C", "#C79000", "#FF6A1A", "#FF3B30", "#7A1610"];
const TEXTO = ["#111111", "#111111", "#111111", "#111111", "#FFFFFF"];
const COLOR_WA = ["#FFFFFF", "#B8D484", "#FBBC43", "#E83F43", "#1D1D1B"];
const COLOR_SMN: Record<string, string> = { amarillo: "#F5C400", naranja: "#FF6A1A", rojo: "#FF3B30" };
const FASE: Record<string, string> = { armado: "Armado", carrera: "Carrera", personal: "Jornada del personal", desarme: "Desarme" };
const VARIABLE: Record<string, string> = {
  wbgt: "Estrés térmico de corredores", calor_personal: "Estrés térmico del personal",
  viento_A: "Viento · estructuras ultralivianas", viento_B: "Viento · superficies de vela", viento_C: "Viento · estructuras ingenieriles",
  tormenta: "Tormenta", lluvia: "Lluvia y suelo",
};
const WA = ["Riesgo bajo", "Precaución", "Advertencia", "Advertencia severa", "Peligro"];
const VIENTO = ["Bajo umbral", "Vigilancia", "Reforzar", "Retirar", "Despejar área"];
const ELEMENTOS: Record<string, string> = {
  A: "gazebos plegables, fly banners y arco inflable",
  B: "lonas en vallas, banners en truss, cartelería y columnas de sonido",
  C: "pórtico de truss, carpas estructurales y pantalla LED",
};

function nombreNivel(variable: string, n: number): string {
  if (variable === "wbgt") return WA[n];
  if (variable.startsWith("viento_")) return variable === "viento_C" && n === 4 ? "Despejar / suspender" : VIENTO[n];
  if (variable === "calor_personal") return ["Bajo límite", "Excede carga pesada", "Excede carga moderada"][n] ?? "—";
  if (variable === "tormenta") return ["Sin señal", "Tormenta posible", "Tormenta probable"][n] ?? "—";
  if (variable === "lluvia") return ["Sin efecto", "Suelo saturado", "Lluvia intensa"][n] ?? "—";
  return String(n);
}

function recomendacion(variable: string, n: number, fase: string): string {
  if (n <= 0) return "";
  if (variable === "wbgt") return [
    "",
    "Exhibir bandera de precaución en largada, llegada y puestos. Incluir el aviso de calor en el anuncio previo a la largada. Reforzar hidratación y enfriamiento en el último cuarto.",
    "Advertir a los corredores que regulen el ritmo. Reforzar puntos de enfriamiento y la capacidad de inmersión en agua fría en la llegada. Vigilancia activa del último cuarto y del grupo de mayor riesgo.",
    "Evaluar cambio de horario, acortamiento o retiro voluntario de corredores no aclimatados. Máxima capacidad de enfriamiento en llegada y recorrido.",
    "Evaluar la suspensión o postergación de la carrera.",
  ][n];
  if (variable.startsWith("viento_")) {
    const cat = variable.slice(-1);
    const el = ELEMENTOS[cat];
    return ["", `Vigilar ${el}. Verificar lastre y anclajes.`, `Reforzar ${el}: lastre adicional, retirar laterales y lonas no esenciales.`,
      `Retirar ${el}${cat === "A" ? " (desinflar el arco)" : ""}. No montar en esta franja.`,
      `Despejar el área alrededor de ${el} (radio de 1,5 veces su altura)${cat === "C" ? "; evaluar suspensión" : ""}.`][n];
  }
  if (variable === "calor_personal") return n === 1
    ? "Tareas pesadas por encima del límite para personal no aclimatado: pausas, sombra, hidratación y rotación de cuadrillas."
    : "Tareas moderadas y pesadas por encima del límite: reprogramar el trabajo físico a una franja más fresca.";
  if (variable === "tormenta") return fase === "carrera"
    ? "Activar el protocolo de tormenta eléctrica: alerta a 24 km, demora de largada a 19 km, suspensión y evacuación a 13 km o ante trueno audible. Reanudar con 30 min sin actividad."
    : "Activar el protocolo de tormenta eléctrica: bajar al personal de altura desde los 19 km y suspender el trabajo a 13 km o ante trueno audible.";
  if (variable === "lluvia") return n === 1
    ? "Suelo saturado: sumar lastre en carpas y gazebos, revisar drenaje en la llegada y en los puestos médicos."
    : "Lluvia intensa: proteger tableros y cableado eléctrico, revisar anegamiento de la zona de llegada y puestos médicos.";
  return "";
}

/** Texto sugerido para que el organizador comunique a los corredores (solo variables que los afectan) */
function textoCorredores(variable: string, n: number): string {
  if (variable === "wbgt") return [
    "",
    "Se prevé calor moderado para la carrera. Hidratate desde el día anterior, usá ropa clara y gorra, y ajustá el ritmo: no es un día para buscar marcas. Si sentís mareo, confusión o escalofríos, detenete y pedí asistencia.",
    "Se esperan condiciones de calor elevadas. Bajá el ritmo desde la largada, tomá agua en cada puesto, mojate la cabeza y el cuello, y no corras si estuviste enfermo o dormiste mal. Si ves a otro corredor desorientado, avisá al personal más cercano.",
    "Se prevé calor extremo. Si no entrenaste con calor, considerá no largar o pasarte a una distancia menor. Corré sin objetivo de tiempo, hidratate y enfriate en todos los puestos, y ante cualquier síntoma detenete y pedí asistencia.",
    "Las condiciones de calor previstas son peligrosas. La organización está evaluando cambios en la carrera: seguí los canales oficiales.",
  ][n] ?? "";
  if (variable === "tormenta" && n > 0) return "Hay probabilidad de tormentas eléctricas el día de la carrera. Si se demora o suspende la largada, seguí las indicaciones del personal y buscá refugio en edificios o vehículos cerrados; no te refugies bajo árboles ni junto a estructuras metálicas.";
  if (variable === "lluvia" && n > 0) return "Se espera lluvia el día de la carrera: usá ropa que no retenga agua, prevení rozaduras y tené cuidado con superficies resbaladizas en la llegada.";
  return "";
}

type Evento = { id: string; nombre: string; largada: string; organizador_email: string };
type Nivel = { evento_id: string; fase: string; variable: string; desde: string; hasta: string; nivel: number; confianza: string | null };
type Alerta = { id: string; evento_id: string; fenomeno: string; color: string; desde: string | null; hasta: string | null; estado: string; tipo: string };
type Estado = { niveles: Record<string, number>; smn: string[]; glm: number };
type Cambio =
  | { tipo: "sube" | "normaliza"; fase: string; variable: string; antes: number; ahora: number; desde: string; confianza: string | null }
  | { tipo: "smn_nueva" | "smn_levantada"; alerta: Alerta }
  | { tipo: "rayos"; nivel: number; km: number };

const fmt = (iso: string) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tituloAlerta = (a: Alerta) => `${a.tipo === "aviso_corto_plazo" ? "Aviso a corto plazo" : "Alerta"} ${a.color} del SMN · ${a.fenomeno.replace(/\s*\(aviso a corto plazo\)$/, "")}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function etiqueta(texto: string, fondo: string, color: string) {
  return `<span style="display:inline-block;background:${fondo};color:${color};font:800 13px Arial,sans-serif;text-transform:uppercase;letter-spacing:.03em;padding:3px 9px;border-radius:3px;${fondo === "#FFFFFF" ? "border:1px solid #1D1D1B;" : ""}">${esc(texto)}</span>`;
}

function armarCorreo(ev: Evento, cambios: Cambio[]): { asunto: string; html: string; texto: string } {
  const partes: string[] = [];
  const lineas: string[] = [];
  const corredores = new Set<string>();
  for (const c of cambios) {
    if (c.tipo === "sube" || c.tipo === "normaliza") {
      const wa = c.variable === "wbgt";
      const fondo = wa ? COLOR_WA[c.ahora] : COLOR[c.ahora];
      const color = c.ahora === 4 ? "#FFFFFF" : TEXTO[c.ahora];
      const titulo = c.tipo === "sube"
        ? `${VARIABLE[c.variable] ?? c.variable} · ${FASE[c.fase] ?? c.fase}`
        : `${VARIABLE[c.variable] ?? c.variable} · ${FASE[c.fase] ?? c.fase} · vuelve a quedar bajo el umbral`;
      const reco = c.tipo === "sube" ? recomendacion(c.variable, c.ahora, c.fase) : "Se levantan las medidas indicadas para esta variable. El monitoreo continúa.";
      partes.push(`<tr><td style="padding:14px 18px;border-left:5px solid ${c.tipo === "sube" ? (fondo === "#FFFFFF" ? "#1D1D1B" : fondo) : "#2FA34C"};background:#f7f6f4">
        <div style="margin-bottom:6px">${etiqueta(c.tipo === "sube" ? nombreNivel(c.variable, c.ahora) : "Bajo umbral", c.tipo === "sube" ? fondo : "#2FA34C", c.tipo === "sube" ? color : "#111111")}</div>
        <div style="font:700 16px Arial,sans-serif;color:#111">${esc(titulo)}</div>
        <div style="font:13px Arial,sans-serif;color:#555;margin:3px 0 6px">Desde ${esc(fmt(c.desde))}${c.confianza === "baja" ? " · tendencia, se confirma con las próximas actualizaciones" : ""}</div>
        <div style="font:14px/1.5 Arial,sans-serif;color:#222">${esc(reco)}</div></td></tr><tr><td style="height:10px"></td></tr>`);
      lineas.push(`${titulo}: ${c.tipo === "sube" ? nombreNivel(c.variable, c.ahora) : "bajo umbral"} desde ${fmt(c.desde)}. ${reco}`);
      if (c.tipo === "sube" && c.fase === "carrera") { const t = textoCorredores(c.variable, c.ahora); if (t) corredores.add(t); }
    } else if (c.tipo === "smn_nueva" || c.tipo === "smn_levantada") {
      const a = c.alerta;
      const fondo = COLOR_SMN[a.color] ?? "#F5C400";
      const titulo = c.tipo === "smn_nueva" ? tituloAlerta(a) : `${tituloAlerta(a)} · levantada`;
      const vig = `${a.desde ? fmt(a.desde) : "desde ahora"} a ${a.hasta ? fmt(a.hasta) : "sin fin informado"}`;
      partes.push(`<tr><td style="padding:14px 18px;background:${c.tipo === "smn_nueva" ? fondo : "#f7f6f4"};border-left:5px solid #111">
        <div style="font:800 17px Arial,sans-serif;color:#111;text-transform:uppercase">${esc(titulo)}</div>
        <div style="font:13px Arial,sans-serif;color:#111;margin-top:4px">${c.tipo === "smn_nueva" ? `Vigencia: ${esc(vig)}. Tiene prioridad sobre el pronóstico.` : "El SMN dejó de incluir esta alerta para la zona del evento."}</div></td></tr><tr><td style="height:10px"></td></tr>`);
      lineas.push(`${titulo}. ${c.tipo === "smn_nueva" ? `Vigencia: ${vig}.` : ""}`);
    } else if (c.tipo === "rayos") {
      const accion = c.nivel >= 4 ? "Suspender la actividad al aire libre y evacuar a refugio" : c.nivel === 3 ? "Preparar la evacuación o demorar la largada" : "Alerta por tormenta eléctrica";
      partes.push(`<tr><td style="padding:14px 18px;background:${COLOR[c.nivel]};border-left:5px solid #111">
        <div style="font:800 17px Arial,sans-serif;color:${c.nivel === 4 ? "#fff" : "#111"};text-transform:uppercase">Rayos a ${Math.round(c.km)} km · ${esc(accion)}</div>
        <div style="font:13px Arial,sans-serif;color:${c.nivel === 4 ? "#fff" : "#111"};margin-top:4px">Satélite GOES-19 (GLM), últimos 30 minutos. Reanudar con 30 min sin actividad a menos de 13 km. Confirmar con detector y trueno en terreno.</div></td></tr><tr><td style="height:10px"></td></tr>`);
      lineas.push(`Rayos a ${Math.round(c.km)} km: ${accion}.`);
    }
  }
  const primero = cambios[0];
  const resumen = cambios.length > 1 ? `${cambios.length} novedades`
    : primero.tipo === "sube" ? `${nombreNivel(primero.variable, primero.ahora)} · ${VARIABLE[primero.variable]} (${FASE[primero.fase]})`
    : primero.tipo === "normaliza" ? `${VARIABLE[primero.variable]} vuelve a quedar bajo el umbral`
    : primero.tipo === "rayos" ? `Rayos a ${Math.round(primero.km)} km`
    : `${tituloAlerta(primero.alerta)}${primero.tipo === "smn_levantada" ? " · levantada" : ""}`;
  const asunto = `${ev.nombre} · ${resumen}`;
  const bloqueCorredores = corredores.size ? `<tr><td style="padding:14px 18px;border:1px dashed #7C7C7C">
      <div style="font:800 13px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#7C7C7C;margin-bottom:6px">Texto sugerido para comunicar a los corredores</div>
      ${[...corredores].map((t) => `<p style="font:14px/1.5 Arial,sans-serif;color:#222;margin:6px 0">${esc(t)}</p>`).join("")}</td></tr><tr><td style="height:10px"></td></tr>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f2f1ef">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f1ef"><tr><td align="center" style="padding:20px 10px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
    <tr><td style="background:#111111;padding:18px 22px;border-bottom:4px solid #FF6A1A">
      <div style="font:800 13px Arial,sans-serif;letter-spacing:.12em;color:#FF6A1A;text-transform:uppercase">EMERTEAM · Monitoreo ambiental</div>
      <div style="font:800 22px Arial,sans-serif;color:#ffffff;text-transform:uppercase;margin-top:4px">${esc(ev.nombre)}</div>
      <div style="font:13px Arial,sans-serif;color:#cfcfcf;margin-top:2px">Largada ${esc(fmt(ev.largada))}</div></td></tr>
    <tr><td style="padding:18px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${partes.join("")}${bloqueCorredores}</table>
      <a href="${WEB}" style="display:inline-block;background:#FF6A1A;color:#111;font:700 15px Arial,sans-serif;text-decoration:none;padding:11px 18px;border-radius:6px;margin-top:6px">Ver el monitoreo del evento</a>
      <p style="font:12px/1.5 Arial,sans-serif;color:#666;margin:16px 0 0">EMERTEAM recomienda; la decisión final corresponde al organizador. Recibís este aviso porque tu correo está habilitado para el evento.</p></td></tr>
    <tr><td style="background:#111111;color:#cfcfcf;font:12px Arial,sans-serif;padding:10px 22px;border-top:3px solid #FF6A1A">EMERTEAM | Sports Risks &amp; Emergency Management</td></tr>
  </table></td></tr></table></body></html>`;
  const texto = `${ev.nombre}\nLargada ${fmt(ev.largada)}\n\n${lineas.join("\n\n")}${corredores.size ? `\n\nTexto sugerido para los corredores:\n${[...corredores].join("\n")}` : ""}\n\nVer el monitoreo: ${WEB}\n\nEMERTEAM | Sports Risks & Emergency Management`;
  return { asunto, html, texto };
}

Deno.serve(async (req) => {
  const clave = req.headers.get("x-mon-cron") ?? "";
  const { data: ok } = clave ? await supabase.rpc("mon_validar_cron", { clave }) : { data: false };
  if (!ok) return json({ error: "no autorizado" }, 401);
  const ahora = Date.now();
  const prueba = new URL(req.url).searchParams.get("prueba") === "1"; // calcula sin enviar ni guardar estado

  const { data: evs } = await supabase.from("mon_eventos").select("id,nombre,largada,organizador_email")
    .eq("estado", "activo")
    .gte("largada", new Date(ahora - 2 * 86400_000).toISOString())
    .lte("largada", new Date(ahora + 16 * 86400_000).toISOString());
  const eventos = (evs ?? []) as Evento[];
  if (!eventos.length) return json({ ok: true, eventos: 0 });
  const ids = eventos.map((e) => e.id);

  const [{ data: nivs }, { data: alts }, { data: rays }, { data: estados }, { data: accesos }, { data: equipo }, { data: cred }] = await Promise.all([
    supabase.from("mon_niveles").select("evento_id,fase,variable,desde,hasta,nivel,confianza").in("evento_id", ids)
      .gt("hasta", new Date(ahora).toISOString()).lte("desde", new Date(ahora + HORIZONTE_MS).toISOString()).limit(20000),
    supabase.from("mon_alertas_smn").select("id,evento_id,fenomeno,color,desde,hasta,estado,tipo").in("evento_id", ids),
    supabase.from("mon_rayos").select("evento_id,distancia_km,ocurrido_en").in("evento_id", ids).gte("ocurrido_en", new Date(ahora - 30 * 60_000).toISOString()).limit(5000),
    supabase.from("mon_estado").select("clave,valor").in("clave", ids.map((i) => `avisos:${i}`)),
    supabase.from("mon_accesos").select("evento_id,email").in("evento_id", ids).eq("recibe_alertas", true),
    supabase.from("mon_admins").select("email").eq("rol", "editor"),
    supabase.rpc("mon_credencial_smtp"),
  ]);
  const estadoDe = new Map((estados ?? []).map((e) => [e.clave as string, JSON.parse(String(e.valor)) as Estado]));
  const smtp = cred as { usuario: string | null; clave: string | null; remitente: string } | null;
  const puedeEnviar = !!(smtp?.usuario && smtp?.clave);

  const resultado: Record<string, unknown>[] = [];
  for (const ev of eventos) {
    // Estado actual
    const niveles: Record<string, number> = {};
    const inicio: Record<string, Nivel> = {};
    for (const n of ((nivs ?? []) as Nivel[]).filter((x) => x.evento_id === ev.id)) {
      const k = `${n.fase}|${n.variable}`;
      if ((niveles[k] ?? -1) < n.nivel) { niveles[k] = n.nivel; inicio[k] = n; }
    }
    const vigentes = ((alts ?? []) as Alerta[]).filter((a) => a.evento_id === ev.id && a.estado !== "levantada" && (!a.hasta || new Date(a.hasta).getTime() > ahora));
    const rayosEv = ((rays ?? []) as { evento_id: string; distancia_km: number }[]).filter((r) => r.evento_id === ev.id);
    const km = rayosEv.length ? Math.min(...rayosEv.map((r) => Number(r.distancia_km))) : null;
    const glm = km == null ? 0 : km < 13 ? 4 : km < 19 ? 3 : km < 24 ? 2 : 1;
    const actual: Estado = { niveles: {}, smn: vigentes.map((a) => a.id), glm };

    const previo = estadoDe.get(`avisos:${ev.id}`);
    const cambios: Cambio[] = [];
    if (!previo) {
      // Primera corrida para este evento: se registra el estado sin avisar (evita una ráfaga de correos al activar)
      for (const [k, v] of Object.entries(niveles)) actual.niveles[k] = v;
    } else {
      for (const k of new Set([...Object.keys(niveles), ...Object.keys(previo.niveles)])) {
        const antes = previo.niveles[k] ?? 0;
        const ahoraN = niveles[k] ?? 0;
        const [fase, variable] = k.split("|");
        if (ahoraN > antes) {
          const n = inicio[k];
          cambios.push({ tipo: "sube", fase, variable, antes, ahora: ahoraN, desde: n.desde, confianza: n.confianza });
          actual.niveles[k] = ahoraN;
        } else if (ahoraN === 0 && antes > 0) {
          cambios.push({ tipo: "normaliza", fase, variable, antes, ahora: 0, desde: new Date(ahora).toISOString(), confianza: null });
        } else if (antes > 0) {
          actual.niveles[k] = antes; // histéresis: la bajada parcial no avisa y conserva el nivel avisado
        }
      }
      for (const a of vigentes) if (!previo.smn.includes(a.id)) cambios.push({ tipo: "smn_nueva", alerta: a });
      for (const idPrev of previo.smn) {
        if (!actual.smn.includes(idPrev)) {
          const a = ((alts ?? []) as Alerta[]).find((x) => x.id === idPrev);
          if (a) cambios.push({ tipo: "smn_levantada", alerta: a });
        }
      }
      if (glm >= 2 && glm > (previo.glm ?? 0) && km != null) cambios.push({ tipo: "rayos", nivel: glm, km });
    }
    // Orden: rayos y SMN primero, después subas de mayor nivel, al final normalizaciones
    const peso = (c: Cambio) => c.tipo === "rayos" ? 100 : c.tipo === "smn_nueva" ? 90 : c.tipo === "sube" ? 10 * c.ahora : c.tipo === "smn_levantada" ? 5 : 1;
    cambios.sort((a, b) => peso(b) - peso(a));

    let enviados = 0;
    if (cambios.length && !prueba) {
      const destinatarios = [...new Set([ev.organizador_email, ...((accesos ?? []).filter((a) => a.evento_id === ev.id).map((a) => a.email as string)),
        ...((equipo ?? []).map((e) => e.email as string))].map((e) => e.trim().toLowerCase()).filter(Boolean))];
      const correo = armarCorreo(ev, cambios);
      const registros: Record<string, unknown>[] = [];
      let cliente: SMTPClient | null = null;
      if (puedeEnviar) {
        cliente = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: smtp!.usuario!, password: smtp!.clave! } } });
      }
      for (const d of destinatarios) {
        let estado = "sin_credencial";
        let error: string | null = null;
        if (cliente) {
          try {
            await cliente.send({ from: `EMERTEAM Monitoreo <${smtp!.remitente}>`, to: d, subject: correo.asunto, content: correo.texto, html: correo.html });
            estado = "enviado";
            enviados++;
          } catch (e) {
            estado = "error";
            error = String(e).slice(0, 500);
          }
        }
        registros.push({ evento_id: ev.id, tipo: cambios.map((c) => c.tipo).join(","), destinatario: d, asunto: correo.asunto, estado, error, detalle: { cambios } });
      }
      if (cliente) await cliente.close().catch(() => undefined);
      if (registros.length) await supabase.from("mon_envios").insert(registros);
    }
    if (!prueba) {
      await supabase.from("mon_estado").upsert({ clave: `avisos:${ev.id}`, valor: JSON.stringify(actual), actualizado_en: new Date().toISOString() });
    }
    resultado.push({ evento: ev.nombre, cambios: cambios.length, enviados, primera_vez: !previo, ...(prueba && cambios.length ? { asunto: armarCorreo(ev, cambios).asunto } : {}) });
  }
  return json({ ok: true, credencial: puedeEnviar, resultado });
});
