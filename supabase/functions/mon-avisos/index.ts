// EMERTEAM Monitoreo Ambiental · correos de aviso
// Desde el 28/10/2026 EMERTEAM enciende otros avisos por productora o por evento (mon_avisos_config): rayos
// detectados (por defecto encendido), viento, tormenta, calor, lluvia y disparadores probabilísticos, con nivel
// mínimo. Los de pronóstico salen solo con confianza media o alta, dentro de las 48 h previas y con un máximo de
// dos correos por evento por día; lo que excede el tope se acumula y sale en el correo siguiente.
// Cada 5 minutos compara el estado de cada evento con el último avisado. Por decisión de EMERTEAM (21/10/2026)
// solo se envía correo cuando el SMN emite, modifica o levanta una alerta o un aviso a corto plazo que toca alguna
// fase del evento. Los demás cambios (subas de nivel del pronóstico, normalizaciones, rayos satelitales y
// disparadores del ensamble) se siguen registrando en el estado para no acumularse, pero no generan correo:
// se consultan en la web.
// Histéresis: las bajadas parciales no generan correo. Sin credencial de envío (o si fallan todos los envíos)
// el estado no avanza y los cambios quedan pendientes para la próxima corrida.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
// nodemailer codifica bien asuntos largos con acentos (denomailer los partía y el correo llegaba como texto crudo)
import nodemailer from "npm:nodemailer@6.9.16";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const WEB = Deno.env.get("MON_URL_WEB") ?? "https://riesgoambiental.emerteam.com.ar";
const HORIZONTE_MS = 5 * 86400_000;

const COLOR = ["#2FA34C", "#C79000", "#FF6A1A", "#FF3B30", "#7A1610"];
const COLOR_WA = ["#FFFFFF", "#B8D484", "#FBBC43", "#E83F43", "#1D1D1B"];
const COLOR_WT = ["#2FA34C", "#2F6FD6", "#FF6A1A", "#FF3B30", "#111111"]; // banderas World Triathlon
const COLOR_UCI = ["#FFFFFF", "#2FA34C", "#F5C400", "#FF6A1A", "#FF3B30"]; // zonas UCI, Anexo C
const COLOR_SMN: Record<string, string> = { amarillo: "#F5C400", naranja: "#FF6A1A", rojo: "#FF3B30" };
const FASE: Record<string, string> = { armado: "Armado", carrera: "Carrera", personal: "Jornada del personal", desarme: "Desarme" };
const VARIABLE: Record<string, string> = {
  wbgt: "Estrés térmico de corredores", calor_personal: "Estrés térmico del personal",
  wbgt_wt: "Estrés térmico de atletas (World Triathlon)", wbgt_uci: "Estrés térmico de ciclistas (UCI)",
  viento_A: "Viento · estructuras ultralivianas", viento_B: "Viento · superficies de vela", viento_C: "Viento · estructuras ingenieriles",
  tormenta: "Tormenta", lluvia: "Lluvia y suelo",
};
const WA = ["Riesgo bajo", "Precaución", "Advertencia", "Advertencia severa", "Peligro"];
const WT = ["Bandera verde", "Bandera azul", "Bandera naranja", "Bandera roja", "Bandera negra"];
const UCI = ["Zona blanca", "Zona verde", "Zona amarilla", "Zona naranja", "Zona roja"];
const VIENTO = ["Bajo umbral", "Vigilancia", "Reforzar", "Retirar", "Despejar área"];
const ELEMENTOS: Record<string, string> = {
  A: "gazebos plegables, fly banners y arco inflable",
  B: "lonas en vallas, banners en truss, cartelería y columnas de sonido",
  C: "pórtico de truss, carpas estructurales y pantalla LED",
};

function nombreNivel(variable: string, n: number): string {
  if (variable === "wbgt") return WA[n];
  if (variable === "wbgt_wt") return WT[n] ?? "—";
  if (variable === "wbgt_uci") return UCI[n] ?? "—";
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
  if (variable === "wbgt_wt") return [
    "",
    "Vigilar el calor: hidratación y enfriamiento en transiciones y puestos; aviso a los atletas antes de la largada.",
    "Reforzar enfriamiento e hidratación en la carrera a pie, vigilancia del último cuarto y del grupo de mayor riesgo; evaluar adelantar la largada.",
    "Pasar la distancia estándar a sprint o reprogramar la prueba (World Triathlon). Evaluar adelantar la largada.",
    "Reprogramar o cancelar la prueba (World Triathlon).",
  ][n];
  if (variable === "wbgt_uci") return [
    "",
    "Entrada en calor a la sombra con ventiladores, protector solar, ropa clara e hidratación normal.",
    "Chalecos de hielo y toallas frías, plan de hidratación individual y hielo para los equipos.",
    "Salida a la sombra, protección de oficiales y voluntarios, más motos de abastecimiento con bebida y hielo, y reglas de hidratación flexibles.",
    "Cambiar los horarios de salida y llegada, neutralizar un tramo o cancelar.",
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

// Aguas abiertas: el WBGT del aire gobierna las fases en tierra y el dispositivo; en el agua manda la temperatura del agua
const CALOR_AGUAS_ABIERTAS = [
  "",
  "Sombra e hidratación en el corral de largada; acortar la espera al sol con neopreno. Protección solar e hidratación del personal en botes y pontones. Medir el agua según el protocolo de World Aquatics.",
  "Tina de inmersión en agua fría operativa en la salida del agua. Sillas, bebida y evaluación médica a la salida. Vigilar a los nadadores que se detienen o cambian de técnica.",
  "Adelantar y escalonar la largada; balsas de descanso y más embarcaciones. En 10 km o más, abastecimiento cada 2,5 km o menos. En 5 km o más, no largar con agua por encima de 29,45 °C (referencia US Masters Swimming).",
  "Evaluar acortar o postergar la prueba. Ante sospecha de golpe de calor, enfriar por inmersión en el lugar antes de trasladar y decidir con temperatura rectal. Rotar al personal embarcado.",
];

type Evento = {
  id: string; nombre: string; largada: string; organizador_email: string; disciplina?: string | null; productora_id?: string | null;
  armado_dias: number; participantes: number | null; duracion_propia_min: number | null; demora_largada_min: number | null;
  mon_modalidades: { distancia_km: number; largada: string | null }[] | null;
};

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
function finCarrera(ev: Evento): number {
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
  return fin;
}
/** Fases operativas (réplica de config/umbrales.json → ventanas): armado hasta 4 h antes de la largada,
 *  día de carrera = jornada del personal (4 h antes de la largada a 5 h después del fin), desarme 24 h */
function fases(ev: Evento): Record<"armado" | "carrera" | "desarme", [number, number]> {
  const largada = new Date(ev.largada).getTime();
  const fin = finCarrera(ev);
  const local = new Date(largada - 3 * 3600_000);
  const dia0 = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 3);
  return {
    armado: [dia0 - (ev.armado_dias || 3) * 86400_000, largada - 240 * 60_000],
    carrera: [largada - 240 * 60_000, fin + 300 * 60_000],
    desarme: [fin, fin + 1440 * 60_000],
  };
}
function ventana(ev: Evento): [number, number] {
  const f = fases(ev);
  return [f.armado[0], Math.max(f.carrera[1], f.desarme[1])];
}
/** Fases que toca una alerta, en orden */
function fasesAfectadas(a: { desde: string | null; hasta: string | null }, ev: Evento, ahora: number): ("armado" | "carrera" | "desarme")[] {
  const t0 = a.desde ? new Date(a.desde).getTime() : ahora;
  const t1 = a.hasta ? new Date(a.hasta).getTime() : Infinity;
  return (Object.entries(fases(ev)) as ["armado" | "carrera" | "desarme", [number, number]][])
    .filter(([, [v0, v1]]) => t1 >= v0 && t0 <= v1).map(([k]) => k);
}
const NOMBRE_FASE = { armado: "armado", carrera: "día de carrera", desarme: "desarme" } as const;
const FASE_ART = { armado: "el armado", carrera: "el día de carrera", desarme: "el desarme" } as const;
const listaY = (xs: string[]) => xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`;

/** La alerta se superpone con el armado, la carrera o el desarme */
function enFases(a: { desde: string | null; hasta: string | null }, ev: Evento, ahora: number): boolean {
  const [v0, v1] = ventana(ev);
  const t0 = a.desde ? new Date(a.desde).getTime() : ahora;
  const t1 = a.hasta ? new Date(a.hasta).getTime() : Infinity;
  return t1 >= v0 && t0 <= v1;
}

// Disparadores del pronóstico probabilístico (réplica de config/umbrales.json → ens_disparadores; criterio interno EMERTEAM)
const DISP = { preparar: { dias: 3, prob: 0.3 }, activar: { dias: 1, prob: 0.6 }, margen: 0.1 };
const diaAR = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));
function disparosEns(filas: EnsProb[], largada: string, ahora: number) {
  const corridas = [...new Set(filas.map((f) => f.corrida))].sort().reverse();
  const [c0, c1] = corridas;
  if (!c0) return [];
  const dias = Math.round((Date.parse(diaAR(largada)) - Date.parse(new Date(c0).toISOString().slice(0, 10))) / 86400_000);
  if (dias < 1) return []; // el día de la carrera mandan el determinístico corregido y las mediciones
  const previa = (f: EnsProb) => filas.find((x) => x.corrida === c1 && x.ventana === f.ventana && x.variable === f.variable && x.nivel === f.nivel)?.prob;
  const grupos = new Map<string, EnsProb[]>();
  for (const f of filas.filter((x) => x.corrida === c0 && Date.parse(x.ventana_hasta) > ahora)) {
    const k = `${f.ventana}|${f.variable}`;
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  const salida: Extract<Cambio, { tipo: "ens" }>[] = [];
  for (const [k, fs] of grupos) {
    const [ventana, variable] = k.split("|");
    for (const accion of ["activar", "preparar"] as const) {
      const r = DISP[accion];
      if (dias > r.dias) continue;
      const f = fs.filter((x) => x.prob >= r.prob + DISP.margen || (x.prob >= r.prob && (previa(x) ?? -1) >= r.prob)).sort((a, b) => b.nivel - a.nivel)[0];
      if (f) { salida.push({ tipo: "ens", accion, ventana, variable, nivel: f.nivel, prob: f.prob, umbral: f.umbral, miembros: f.miembros, corrida: f.corrida, dias }); break; }
    }
  }
  return salida;
}
const rangoEns = (c: { accion: string; nivel: number }) => (c.accion === "activar" ? 10 : 0) + c.nivel;
const probTxt = (p: number) => { const r = Math.round(p * 10) * 10; return r <= 0 ? "menos de 10\u00a0%" : r >= 100 ? "más de 90\u00a0%" : `${r}\u00a0%`; };
const ventanaTxt = (v: string, d?: string | null) => v === "carrera" ? `exposición de los ${(PARTICIPANTES[d ?? "running"] ?? PARTICIPANTES.running)[0]}` : v.startsWith("ultimo_cuarto") ? `último cuarto${v.includes(":") ? ` (${v.split(":")[1]})` : ""}` : v;
const faseDeVentana = (v: string) => (v === "armado" || v === "desarme" ? v : "carrera");
function umbralTxt(variable: string, u: number | null): string {
  if (u == null) return "";
  if (variable.startsWith("viento_")) return ` (ráfaga de ${u} km/h)`;
  if (variable === "tormenta") return ` (CAPE ${u} J/kg con precipitación)`;
  if (variable === "lluvia") return ` (${u} mm en 3 h)`;
  return ` (WBGT ${String(u).replace(".", ",")} °C)`;
}

// Vocabulario por disciplina: los textos se escriben para running y se adaptan (corredores → atletas, nadadores, ciclistas)
const PARTICIPANTES: Record<string, [string, string]> = {
  running: ["corredores", "corredor"], montana: ["corredores", "corredor"], triatlon: ["atletas", "atleta"],
  aguas_abiertas: ["nadadores", "nadador"], ciclismo: ["ciclistas", "ciclista"],
};
function adaptar(texto: string, d?: string | null): string {
  const [pl, sg] = PARTICIPANTES[d ?? "running"] ?? PARTICIPANTES.running;
  if (pl === "corredores") return texto;
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  return texto.replace(/\bcorredores\b/g, pl).replace(/\bCorredores\b/g, cap(pl)).replace(/\bcorredor\b/g, sg).replace(/\bCorredor\b/g, cap(sg));
}
type Nivel = { evento_id: string; fase: string; variable: string; desde: string; hasta: string; nivel: number; confianza: string | null };
type Alerta = { id: string; evento_id: string; fenomeno: string; color: string; desde: string | null; hasta: string | null; estado: string; tipo: string; descripcion?: string | null; instruccion?: string | null };
type Estado = { niveles: Record<string, number>; smn: string[]; glm: number; ens?: Record<string, string>; dia?: string; n_pron?: number; pend?: Cambio[] };
type Config = { rayos: boolean; viento: boolean; viento_nivel: number; tormenta: boolean; calor: boolean; calor_nivel: number; lluvia: boolean; probabilistico: boolean };
const CONFIG_BASE: Config = { rayos: true, viento: false, viento_nivel: 2, tormenta: false, calor: false, calor_nivel: 2, lluvia: false, probabilistico: false };
const TEXTO_RAYOS = "Detección satelital de rayos (GOES-19 GLM) en los últimos 30 minutos. Sirve para anticipar, no para decidir. El satélite ubica cada descarga con un margen de 8 a 10 km y no registra todas, así que no recibir este aviso no significa que no haya actividad. Se recomienda decidir la suspensión y la reanudación con detectores de rayos en terreno y con el trueno audible. Se suspende ante actividad a 13 km o menos o apenas se escucha un trueno, y se reanuda después de 30 minutos sin actividad a esa distancia.";
const TOPE_PRONOSTICO = 2; // correos de pronóstico por evento por día
const HORIZONTE_AVISO_MS = 48 * 3600_000;
const PRONOSTICO = new Set(["sube", "normaliza", "ens"]);

/** La configuración pide correo para esta variable y este nivel */
function avisaVariable(cfg: Config, variable: string, nivel: number): boolean {
  if (variable.startsWith("viento_")) return cfg.viento && nivel >= cfg.viento_nivel;
  if (variable === "calor_personal") return cfg.calor && nivel >= 2;
  if (variable === "wbgt" || variable === "wbgt_wt" || variable === "wbgt_uci") return cfg.calor && nivel >= cfg.calor_nivel;
  if (variable === "tormenta") return cfg.tormenta && nivel >= 1;
  if (variable === "lluvia") return cfg.lluvia && nivel >= 1;
  return false;
}
function correoPorCambio(c: Cambio, cfg: Config, ahora: number): boolean {
  if (c.tipo === "smn_nueva" || c.tipo === "smn_levantada") return true;
  if (c.tipo === "rayos") return cfg.rayos;
  if (c.tipo === "ens") return cfg.probabilistico;
  if (c.tipo === "sube") {
    if (c.confianza === "baja") return false;
    if (Date.parse(c.desde) - ahora > HORIZONTE_AVISO_MS) return false;
    return avisaVariable(cfg, c.variable, c.ahora);
  }
  // Vuelve bajo el umbral: solo si antes se había avisado
  if (c.tipo === "normaliza") return avisaVariable(cfg, c.variable, c.antes);
  return false;
}
type EnsProb = { evento_id: string; corrida: string; variable: string; nivel: number; ventana: string; ventana_hasta: string; umbral: number | null; prob: number; miembros: number };
type Cambio =
  | { tipo: "sube" | "normaliza"; fase: string; variable: string; antes: number; ahora: number; desde: string; confianza: string | null }
  | { tipo: "smn_nueva" | "smn_levantada"; alerta: Alerta }
  | { tipo: "rayos"; nivel: number; km: number }
  | { tipo: "ens"; accion: "preparar" | "activar"; ventana: string; variable: string; nivel: number; prob: number; umbral: number | null; miembros: number; corrida: string; dias: number };

const fmt = (iso: string) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const COLOR_FEM: Record<string, string> = { amarillo: "amarilla", naranja: "naranja", rojo: "roja" };
const fenomenoDe = (a: Alerta) => a.fenomeno.replace(/\s*\(aviso a corto plazo\)$/, "").toLowerCase();
const tituloAlerta = (a: Alerta) => a.tipo === "aviso_corto_plazo"
  ? `Aviso a corto plazo por ${fenomenoDe(a)}`
  : `Alerta ${COLOR_FEM[a.color] ?? a.color} por ${fenomenoDe(a)}`;
/** «jueves 22/10, 15:00 h»; un fin de vigencia a :59:59 se muestra en la hora siguiente */
function fmtLargo(iso: string, fin = false): string {
  let t = new Date(iso).getTime();
  if (fin && new Date(iso).getUTCSeconds() === 59) t += 1000;
  const p = Object.fromEntries(new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day}/${p.month}, ${p.hour}:${p.minute} h`;
}
const UMBRAL_VIENTO: Record<string, number[]> = { A: [25, 30, 38, 45], B: [35, 40, 45, 55], C: [35, 45, 55, 65] }; // config/umbrales.json → viento
/** Recomendación EMERTEAM para una alerta del SMN según el fenómeno, su texto oficial y las fases que toca */
function recomendacionSMN(a: Alerta & { descripcion?: string | null }, fs: string[], ev: Evento): { titulo: string; texto: string }[] {
  const fen = fenomenoDe(a);
  const desc = (a.descripcion ?? "").toLowerCase();
  const out: { titulo: string; texto: string }[] = [];
  const conCarrera = fs.includes("carrera");
  const conMontaje = fs.includes("armado") || fs.includes("desarme");
  if (/tormenta|el[ée]ctric/.test(fen) || /actividad el[ée]ctrica/.test(desc)) {
    const montaje = fs.filter((f) => f !== "carrera").map((f) => NOMBRE_FASE[f as "armado" | "desarme"]);
    if (conMontaje) out.push({ titulo: `Tormenta eléctrica (${listaY(montaje)})`, texto: recomendacion("tormenta", 1, "armado") });
    if (conCarrera) out.push({ titulo: "Tormenta eléctrica (día de carrera)", texto: adaptar(recomendacion("tormenta", 1, "carrera"), ev.disciplina) });
  }
  const rafagas = [...desc.matchAll(/r[áa]fagas?[^.]*?(\d{2,3})\s*km\/h/g)].map((m) => Number(m[1]));
  const raf = rafagas.length ? Math.max(...rafagas) : null;
  if (raf != null) {
    // Categorías de estructuras agrupadas por el nivel que alcanzan con la ráfaga máxima anunciada
    const porNivel = new Map<number, string[]>();
    for (const c of ["A", "B", "C"]) {
      const n = UMBRAL_VIENTO[c].filter((u) => raf >= u).length;
      if (n > 0) porNivel.set(n, [...(porNivel.get(n) ?? []), c]);
    }
    const frases = [...porNivel.entries()].sort((x, y) => y[0] - x[0]).map(([n, cs]) => {
      const el = cs.map((c) => ELEMENTOS[c]).join("; ");
      return [``, `Vigilar ${el}: verificar lastre y anclajes.`, `Reforzar ${el}: lastre adicional, retirar laterales y lonas no esenciales.`,
        `Retirar ${el}${cs.includes("A") ? " (desinflar el arco)" : ""}; no montar mientras dure la alerta.`,
        `Despejar el área alrededor de ${el} (radio de 1,5 veces su altura)${cs.includes("C") ? "; evaluar la suspensión de tareas" : ""}.`][n];
    });
    if (frases.length) out.push({ titulo: `Ráfagas de hasta ${raf} km/h`, texto: frases.join(" ") });
  } else if (/viento/.test(fen)) {
    out.push({ titulo: "Viento", texto: "Verificar lastre y anclajes de todas las estructuras y retirar las ultralivianas (gazebos, fly banners, arco inflable) mientras dure la alerta." });
  }
  if (/lluvia|tormenta|precipitaci/.test(fen) || /precipitaci|lluvia/.test(desc)) {
    const intensa = /abundantes|intensa|cortos? per[ií]odos?/.test(desc);
    const [tit, ...resto] = recomendacion("lluvia", intensa ? 2 : 1, "armado").split(": ");
    out.push({ titulo: tit, texto: resto.join(": ").replace(/^./, (x) => x.toUpperCase()) });
  }
  if (/calor|temperatura/.test(fen) && conCarrera) {
    out.push({ titulo: "Calor", texto: "Consultar el nivel de estrés térmico del evento en la web y aplicar las medidas de ese nivel." });
  }
  return out;
}

// Réplica de web/src/alertasSmn.ts (frases del SMN sobre salir o estar al aire libre y decisión sugerida por fase,
// criterio interno EMERTEAM según el color del SMN): cambiar los dos juntos.
type FaseEvento = "armado" | "carrera" | "desarme";

const AIRE_LIBRE = /sal[íi]r?(?=[\s.,;]|$)|salgas|aire libre|refugio|construcciones cerradas|actividad f[ií]sica|expongas al sol|autoridades/i;
const POR_COLOR: Record<string, string[]> = {
  amarillo: ["Evitá salir."],
  naranja: ["Salí solo si es necesario."],
  rojo: ["Salí solo si es imprescindible.", "Seguí las instrucciones de las autoridades locales."],
};
const CALOR_SMN = ["Reducí la actividad física.", "No te expongas al sol en exceso, ni en horas centrales del día (entre las 10 y las 16 horas)."];

const esCalor = (f: string) => /calor|temperatura/i.test(f) && !/fr[ií]o/i.test(f);
const esFrio = (f: string) => /fr[ií]o/i.test(f);

/** Frases oficiales del SMN que se refieren a salir o a estar al aire libre */
function recomendacionSmnAireLibre(a: { color: string; fenomeno: string; instruccion?: string | null }): string[] {
  const items = (a.instruccion ?? "").split(/\s*\d+\s*-\s*/).map((x) => x.trim()).filter(Boolean)
    .map((x) => (/[.!]$/.test(x) ? x : `${x}.`));
  const sel = items.filter((x) => AIRE_LIBRE.test(x));
  if (sel.length) return sel;
  if (esCalor(a.fenomeno)) return CALOR_SMN;
  if (esFrio(a.fenomeno)) return [];
  return POR_COLOR[a.color] ?? [];
}

/** Decisión sugerida por fase (criterio interno EMERTEAM) */
function decisionEvento(a: { color: string; fenomeno: string }, fases: FaseEvento[]): { fase: string; texto: string }[] {
  const out: { fase: string; texto: string }[] = [];
  const montaje = fases.filter((f) => f !== "carrera");
  const nombreMontaje = montaje.map((f) => (f === "armado" ? "Armado" : "Desarme")).join(" y ");
  if (esFrio(a.fenomeno)) return out;
  if (esCalor(a.fenomeno)) {
    if (fases.includes("carrera")) out.push({ fase: "Día de carrera", texto: "Si la carrera transcurre entre las 10 y las 16 h, evaluar adelantar la largada para terminar antes de las 10 h. Aplicar las medidas del nivel de estrés térmico que indica la web." });
    if (montaje.length) out.push({ fase: nombreMontaje, texto: "Programar el trabajo físico fuera de la franja de 10 a 16 h, con pausas, sombra e hidratación." });
    return out;
  }
  if (fases.includes("carrera")) {
    out.push({
      fase: "Día de carrera",
      texto: a.color === "rojo" ? "Suspender la carrera y seguir las instrucciones de las autoridades locales."
        : a.color === "naranja" ? "No realizar la carrera dentro de la vigencia de la alerta: postergar o suspender."
        : "Evaluar reprogramar la largada fuera de la vigencia de la alerta. Si se mantiene: protocolo activo, refugios identificados y plan de evacuación de corrales y llegada.",
    });
  }
  if (montaje.length) {
    out.push({
      fase: nombreMontaje,
      texto: a.color === "rojo" ? "Suspender las tareas al aire libre durante la vigencia de la alerta y seguir las instrucciones de las autoridades locales."
        : a.color === "naranja" ? "Suspender las tareas al aire libre durante la vigencia de la alerta."
        : "No trabajar al aire libre mientras dure el fenómeno.",
    });
  }
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function etiqueta(texto: string, fondo: string, color: string) {
  return `<span style="display:inline-block;background:${fondo};color:${color};font:800 13px Arial,sans-serif;text-transform:uppercase;letter-spacing:.03em;padding:3px 9px;border-radius:3px;${fondo === "#FFFFFF" ? "border:1px solid #1D1D1B;" : ""}">${esc(texto)}</span>`;
}

function armarCorreo(ev: Evento, cambios: Cambio[]): { asunto: string; html: string; texto: string } {
  const nombreVar = (v: string) => adaptar(VARIABLE[v] ?? v, ev.disciplina);
  const running = (ev.disciplina ?? "running") === "running";
  const enlace = `${WEB}/#/evento/${ev.id}`;
  const partes: string[] = [];
  const lineas: string[] = [];
  const corredores = new Set<string>();
  for (const c of cambios) {
    if (c.tipo === "sube" || c.tipo === "normaliza") {
      const paleta = c.variable === "wbgt" ? COLOR_WA : c.variable === "wbgt_wt" ? COLOR_WT : c.variable === "wbgt_uci" ? COLOR_UCI : COLOR;
      const fondo = paleta[c.ahora];
      const color = ["#1D1D1B", "#111111", "#7A1610", "#2F6FD6"].includes(fondo) ? "#FFFFFF" : "#111111";
      const titulo = c.tipo === "sube"
        ? `${nombreVar(c.variable)} · ${FASE[c.fase] ?? c.fase}`
        : `${nombreVar(c.variable)} · ${FASE[c.fase] ?? c.fase} · vuelve a quedar bajo el umbral`;
      const reco = c.tipo !== "sube" ? "Se levantan las medidas indicadas para esta variable. El monitoreo continúa."
        : c.variable === "wbgt" && ev.disciplina === "aguas_abiertas" ? CALOR_AGUAS_ABIERTAS[c.ahora]
        : adaptar(recomendacion(c.variable, c.ahora, c.fase), ev.disciplina);
      partes.push(`<tr><td style="padding:14px 18px;border-left:5px solid ${c.tipo === "sube" ? (fondo === "#FFFFFF" ? "#1D1D1B" : fondo) : "#2FA34C"};background:#f7f6f4">
        <div style="margin-bottom:6px">${etiqueta(c.tipo === "sube" ? nombreNivel(c.variable, c.ahora) : "Bajo umbral", c.tipo === "sube" ? fondo : "#2FA34C", c.tipo === "sube" ? color : "#111111")}</div>
        <div style="font:700 16px Arial,sans-serif;color:#111">${esc(titulo)}</div>
        <div style="font:13px Arial,sans-serif;color:#555;margin:3px 0 6px">Desde ${esc(fmt(c.desde))}${c.confianza === "baja" ? " · tendencia, se confirma con las próximas actualizaciones" : ""}</div>
        <div style="font:14px/1.5 Arial,sans-serif;color:#222">${esc(reco)}</div></td></tr><tr><td style="height:10px"></td></tr>`);
      lineas.push(`${titulo}: ${c.tipo === "sube" ? nombreNivel(c.variable, c.ahora) : "bajo umbral"} desde ${fmt(c.desde)}. ${reco}`);
      // Textos para los participantes escritos para running: en las otras disciplinas están en la web, adaptados
      if (running && c.tipo === "sube" && c.fase === "carrera") { const t = textoCorredores(c.variable, c.ahora); if (t) corredores.add(t); }
    } else if (c.tipo === "smn_nueva" || c.tipo === "smn_levantada") {
      const a = c.alerta;
      const fondo = COLOR_SMN[a.color] ?? "#F5C400";
      const fs = fasesAfectadas(a, ev, Date.now());
      const titulo = `${tituloAlerta(a)} · SMN${c.tipo === "smn_levantada" ? " · levantada" : ""}`;
      const vig = `${a.desde ? fmtLargo(a.desde) : "desde ahora"} a ${a.hasta ? fmtLargo(a.hasta, true) : "sin fin informado"}`.replace(/^./, (x) => x.toUpperCase());
      const afecta = fs.length ? `Afecta: ${listaY(fs.map((f) => NOMBRE_FASE[f]))}.${fs.includes("carrera") ? "" : " No afecta el día de carrera."}` : "";
      if (c.tipo === "smn_nueva") {
        const recos = recomendacionSMN(a, fs, ev);
        const smnPob = recomendacionSmnAireLibre(a);
        const decision = decisionEvento(a, fs);
        partes.push(`<tr><td style="padding:14px 18px;background:${fondo};border-left:5px solid #111">
        <div style="font:800 17px Arial,sans-serif;color:#111;text-transform:uppercase">${esc(titulo)}</div>
        <div style="font:14px Arial,sans-serif;color:#111;margin-top:6px">${esc(vig)}</div>
        ${afecta ? `<div style="font:700 14px Arial,sans-serif;color:#111;margin-top:4px">${esc(afecta)}</div>` : ""}</td></tr>
        ${smnPob.length ? `<tr><td style="padding:12px 18px 4px"><div style="font:800 12px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#7C7C7C">El SMN recomienda a la población</div>
        <div style="font:700 15px/1.5 Arial,sans-serif;color:#111;margin-top:4px">${esc(smnPob.join(" "))}</div></td></tr>` : ""}
        ${decision.length ? `<tr><td style="padding:12px 18px 4px"><div style="border-left:5px solid #FF6A1A;background:#fff4ec;padding:10px 14px">
        <div style="font:800 12px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#111">Decisión sugerida para el evento · criterio EMERTEAM</div>
        ${decision.map((d) => `<div style="font:14px/1.5 Arial,sans-serif;color:#222;margin-top:6px"><b>${esc(d.fase)}:</b> ${esc(d.texto)}</div>`).join("")}</div></td></tr>` : ""}
        ${a.descripcion ? `<tr><td style="padding:12px 18px 4px"><div style="font:800 12px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#7C7C7C">Qué anuncia el SMN</div>
        <div style="font:14px/1.5 Arial,sans-serif;color:#222;margin-top:4px;font-style:italic">«${esc(a.descripcion)}»</div></td></tr>` : ""}
        ${recos.length ? `<tr><td style="padding:12px 18px 4px"><div style="font:800 12px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#7C7C7C">Medidas operativas EMERTEAM</div>
        ${recos.map((r) => `<div style="font:14px/1.5 Arial,sans-serif;color:#222;margin-top:6px"><b>${esc(r.titulo)}:</b> ${esc(r.texto)}</div>`).join("")}</td></tr>` : ""}
        <tr><td style="padding:8px 18px 0"><div style="font:12px Arial,sans-serif;color:#666">La alerta oficial del SMN tiene prioridad sobre el pronóstico.</div></td></tr><tr><td style="height:14px"></td></tr>`);
        lineas.push([titulo, vig, afecta, smnPob.length ? `El SMN recomienda a la población: ${smnPob.join(" ")}` : "",
          decision.length ? `Decisión sugerida para el evento (criterio EMERTEAM):\n${decision.map((d) => `- ${d.fase}: ${d.texto}`).join("\n")}` : "",
          a.descripcion ? `Qué anuncia el SMN: «${a.descripcion}»` : "",
          recos.length ? `Medidas operativas EMERTEAM:\n${recos.map((r) => `- ${r.titulo}: ${r.texto}`).join("\n")}` : "",
          "La alerta oficial del SMN tiene prioridad sobre el pronóstico."].filter(Boolean).join("\n"));
      } else {
        partes.push(`<tr><td style="padding:14px 18px;background:#f7f6f4;border-left:5px solid #111">
        <div style="font:800 17px Arial,sans-serif;color:#111;text-transform:uppercase">${esc(titulo)}</div>
        <div style="font:13px Arial,sans-serif;color:#111;margin-top:4px">El SMN dejó de incluir esta alerta para la zona del evento (vigencia original: ${esc(vig)}).</div></td></tr><tr><td style="height:10px"></td></tr>`);
        lineas.push(`${titulo}. El SMN dejó de incluir esta alerta para la zona del evento.`);
      }
    } else if (c.tipo === "ens") {
      const accion = c.accion === "activar" ? "Activar" : "Preparar";
      const color = c.accion === "activar" ? "#FF3B30" : "#C79000";
      const titulo = `${accion} · ${nombreVar(c.variable)} · ${nombreNivel(c.variable, c.nivel)}`;
      const reco = c.variable === "wbgt" && ev.disciplina === "aguas_abiertas" ? CALOR_AGUAS_ABIERTAS[c.nivel] : adaptar(recomendacion(c.variable, c.nivel, faseDeVentana(c.ventana)), ev.disciplina);
      const detalle = `Probabilidad de alcanzar ${nombreNivel(c.variable, c.nivel).toLowerCase()}${umbralTxt(c.variable, c.umbral)} en ${ventanaTxt(c.ventana, ev.disciplina)}: ${probTxt(c.prob)}. Calculado ${c.dias === 1 ? "1 día" : `${c.dias} días`} antes de la carrera sobre ${c.miembros} escenarios de ECMWF y NOAA (corrida del ${new Date(c.corrida).toISOString().slice(8, 10)}/${new Date(c.corrida).toISOString().slice(5, 7)} a las ${new Date(c.corrida).toISOString().slice(11, 13)} UTC).`;
      const accionTxt = c.accion === "activar" ? `Ejecutar las medidas de este nivel: ${reco}` : `Dejar listas las medidas de este nivel, sin ejecutarlas todavía: ${reco}`;
      partes.push(`<tr><td style="padding:14px 18px;border-left:5px solid ${color};background:#f7f6f4">
        <div style="margin-bottom:6px">${etiqueta(accion, color, "#111111")}</div>
        <div style="font:700 16px Arial,sans-serif;color:#111">${esc(`${nombreVar(c.variable)} · ${nombreNivel(c.variable, c.nivel)}`)}</div>
        <div style="font:13px Arial,sans-serif;color:#555;margin:3px 0 6px">${esc(detalle)}</div>
        <div style="font:14px/1.5 Arial,sans-serif;color:#222">${esc(accionTxt)}</div>
        <div style="font:12px Arial,sans-serif;color:#666;margin-top:6px">Disparador por probabilidad (criterio interno EMERTEAM). Las alertas del SMN tienen prioridad sobre este aviso.</div></td></tr><tr><td style="height:10px"></td></tr>`);
      lineas.push(`${titulo}. ${detalle} ${accionTxt}`);
    } else if (c.tipo === "rayos") {
      const accion = c.nivel >= 4 ? "Suspender la actividad al aire libre salvo que la detección en terreno descarte actividad cercana" : c.nivel === 3 ? "Preparar la evacuación o demorar la largada" : "Alerta por tormenta eléctrica";
      partes.push(`<tr><td style="padding:14px 18px;background:${COLOR[c.nivel]};border-left:5px solid #111">
        <div style="font:800 17px Arial,sans-serif;color:${c.nivel === 4 ? "#fff" : "#111"};text-transform:uppercase">Rayos a ${Math.round(c.km)} km · ${esc(accion)}</div>
        <div style="font:13px Arial,sans-serif;color:${c.nivel === 4 ? "#fff" : "#111"};margin-top:4px">${esc(TEXTO_RAYOS)}</div></td></tr><tr><td style="height:10px"></td></tr>`);
      lineas.push(`Rayos a ${Math.round(c.km)} km. ${accion}. ${TEXTO_RAYOS}`);
    }
  }
  const primero = cambios[0];
  const resumen = cambios.length > 1 ? `${cambios.length} novedades`
    : primero.tipo === "sube" ? `${nombreNivel(primero.variable, primero.ahora)} · ${nombreVar(primero.variable)} (${FASE[primero.fase]})`
    : primero.tipo === "normaliza" ? `${nombreVar(primero.variable)} vuelve a quedar bajo el umbral`
    : primero.tipo === "rayos" ? `Rayos a ${Math.round(primero.km)} km`
    : primero.tipo === "ens" ? `${primero.accion === "activar" ? "Activar" : "Preparar"} · ${nombreVar(primero.variable)} · ${nombreNivel(primero.variable, primero.nivel)}`
    : primero.tipo === "smn_levantada" ? `${tituloAlerta(primero.alerta)} (SMN) · levantada`
    : (() => { const fs = fasesAfectadas(primero.alerta, ev, Date.now()); return `${tituloAlerta(primero.alerta)} (SMN)${fs.length ? ` · afecta ${listaY(fs.map((f) => FASE_ART[f]))}` : ""}`; })();
  const asunto = `${ev.nombre} · ${resumen}`;
  const bloqueCorredores = corredores.size ? `<tr><td style="padding:14px 18px;border:1px dashed #7C7C7C">
      <div style="font:800 13px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#7C7C7C;margin-bottom:6px">Texto sugerido para comunicar a los corredores</div>
      ${[...corredores].map((t) => `<p style="font:14px/1.5 Arial,sans-serif;color:#222;margin:6px 0">${esc(t)}</p>`).join("")}</td></tr><tr><td style="height:10px"></td></tr>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f2f1ef">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f1ef"><tr><td align="center" style="padding:20px 10px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
    <tr><td style="background:#111111;padding:16px 22px;border-bottom:4px solid #FF6A1A">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="width:160px;padding-right:16px;border-right:1px solid #3a3a3a;vertical-align:middle">
          <img src="${WEB}/logo-correo.png" width="160" height="56" alt="EMERTEAM" style="display:block;width:160px;max-width:160px;height:auto;border:0;color:#FF6A1A;font:800 16px Arial,sans-serif"></td>
        <td style="padding-left:16px;vertical-align:middle">
          <div style="font:800 12px Arial,sans-serif;letter-spacing:.12em;color:#FF6A1A;text-transform:uppercase">Monitoreo ambiental</div>
          <div style="font:800 21px Arial,sans-serif;color:#ffffff;text-transform:uppercase;margin-top:3px">${esc(ev.nombre)}</div>
          <div style="font:13px Arial,sans-serif;color:#cfcfcf;margin-top:2px">Largada ${esc(fmtLargo(ev.largada))}</div></td>
      </tr></table></td></tr>
    <tr><td style="padding:18px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${partes.join("")}${bloqueCorredores}</table>
      <a href="${enlace}" style="display:inline-block;background:#FF6A1A;color:#111;font:700 15px Arial,sans-serif;text-decoration:none;padding:11px 18px;border-radius:6px;margin-top:6px">Ver el monitoreo del evento</a>
      <p style="font:12px/1.5 Arial,sans-serif;color:#666;margin:16px 0 0">EMERTEAM recomienda; la decisión final corresponde al organizador. Recibís este aviso porque tu correo está habilitado para el evento.</p></td></tr>
    <tr><td style="background:#111111;color:#cfcfcf;font:12px Arial,sans-serif;padding:10px 22px;border-top:3px solid #FF6A1A">EMERTEAM | Sports Risks &amp; Emergency Management</td></tr>
  </table></td></tr></table></body></html>`;
  const texto = `${ev.nombre}\nLargada ${fmtLargo(ev.largada)}\n\n${lineas.join("\n\n")}${corredores.size ? `\n\nTexto sugerido para los corredores:\n${[...corredores].join("\n")}` : ""}\n\nVer el monitoreo: ${enlace}\n\nEMERTEAM | Sports Risks & Emergency Management`;
  return { asunto, html, texto };
}

// Correo de acceso para cada alta en un grupo de productora o en un evento puntual. Se envía una sola vez
// (aviso_alta_en); sin credencial queda pendiente. Solo altas de los últimos 7 días, para no avisar tarde.
type AltaGrupo = { id: string; email: string; nombre: string; recibe_alertas: boolean; responsable: boolean; mon_productoras: { id: string; nombre: string } | null };
type AltaEvento = { id: string; email: string; nombre: string; recibe_alertas: boolean; mon_eventos: { id: string; nombre: string; largada: string } | null };

function correoAcceso(titulo: string, nombre: string, cuerpo: string[], recibeAlertas: boolean): { html: string; texto: string } {
  const pasos = `Para entrar, abrí ${WEB}, escribí este correo y tocá el enlace que te llega. No hace falta contraseña.`;
  const alertas = recibeAlertas
    ? "Vas a recibir por correo las alertas y los avisos a corto plazo del SMN que toquen el armado, la carrera o el desarme, y los avisos que EMERTEAM active para cada evento, como rayos detectados o viento. El resto del pronóstico se consulta en la web."
    : "No vas a recibir correos de alertas; podés activarlos desde la web.";
  const html = `<!doctype html><html><body style="margin:0;background:#f2f1ef">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f1ef"><tr><td align="center" style="padding:20px 10px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">
    <tr><td style="background:#111111;padding:16px 22px;border-bottom:4px solid #FF6A1A">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="width:160px;padding-right:16px;border-right:1px solid #3a3a3a;vertical-align:middle">
          <img src="${WEB}/logo-correo.png" width="160" height="56" alt="EMERTEAM" style="display:block;width:160px;max-width:160px;height:auto;border:0;color:#FF6A1A;font:800 16px Arial,sans-serif"></td>
        <td style="padding-left:16px;vertical-align:middle">
          <div style="font:800 12px Arial,sans-serif;letter-spacing:.12em;color:#FF6A1A;text-transform:uppercase">Monitoreo ambiental · acceso habilitado</div>
          <div style="font:800 21px Arial,sans-serif;color:#ffffff;text-transform:uppercase;margin-top:3px">${esc(titulo)}</div></td>
      </tr></table></td></tr>
    <tr><td style="padding:18px 22px;font:15px/1.55 Arial,sans-serif;color:#222">
      <p style="margin:0 0 10px">Hola${nombre ? ` ${esc(nombre)}` : ""}:</p>
      ${cuerpo.map((t) => `<p style="margin:0 0 10px">${esc(t)}</p>`).join("")}
      <p style="margin:0 0 10px">${esc(alertas)}</p>
      <p style="margin:0 0 14px">${esc(pasos)}</p>
      <a href="${WEB}" style="display:inline-block;background:#FF6A1A;color:#111;font:700 15px Arial,sans-serif;text-decoration:none;padding:11px 18px;border-radius:6px">Entrar al monitoreo</a>
      <p style="font:12px/1.5 Arial,sans-serif;color:#666;margin:16px 0 0">Si no esperabas este acceso, respondé a este correo o escribí a info@emerteam.com.ar.</p></td></tr>
    <tr><td style="background:#111111;color:#cfcfcf;font:12px Arial,sans-serif;padding:10px 22px;border-top:3px solid #FF6A1A">EMERTEAM | Sports Risks &amp; Emergency Management</td></tr>
  </table></td></tr></table></body></html>`;
  const texto = `${titulo}\n\nHola${nombre ? ` ${nombre}` : ""}:\n\n${cuerpo.join("\n\n")}\n\n${alertas}\n\n${pasos}\n\nEMERTEAM | Sports Risks & Emergency Management`;
  return { html, texto };
}

async function avisarAccesos(ahora: number): Promise<Record<string, unknown>> {
  const desde = new Date(ahora - 7 * 86400_000).toISOString();
  const [{ data: grupo, error: eG }, { data: puntuales, error: eE }] = await Promise.all([
    supabase.from("mon_productora_miembros").select("id,email,nombre,recibe_alertas,responsable,mon_productoras(id,nombre)")
      .is("aviso_alta_en", null).gte("creado_en", desde).limit(200),
    supabase.from("mon_accesos").select("id,email,nombre,recibe_alertas,mon_eventos(id,nombre,largada)")
      .is("aviso_alta_en", null).gte("creado_en", desde).limit(200),
  ]);
  if (eG || eE) return { error: (eG ?? eE)!.message };
  const altasG = (grupo ?? []) as unknown as AltaGrupo[];
  const altasE = (puntuales ?? []) as unknown as AltaEvento[];
  if (!altasG.length && !altasE.length) return { pendientes: 0 };
  const { data: cred } = await supabase.rpc("mon_credencial_smtp");
  const smtp = cred as { usuario: string | null; clave: string | null; remitente: string } | null;
  if (!smtp?.usuario || !smtp?.clave) return { pendientes: altasG.length + altasE.length, credencial: false };

  // Próximos eventos de cada productora, para nombrarlos en el correo
  const prods = [...new Set(altasG.map((a) => a.mon_productoras?.id).filter(Boolean))] as string[];
  const { data: evs } = prods.length
    ? await supabase.from("mon_eventos").select("productora_id,nombre,largada").in("productora_id", prods).eq("estado", "activo")
        .gte("largada", new Date(ahora - 86400_000).toISOString()).order("largada")
    : { data: [] as { productora_id: string; nombre: string; largada: string }[] };

  const cliente = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, pool: true, maxConnections: 1, auth: { user: smtp.usuario, pass: smtp.clave } });
  const registros: Record<string, unknown>[] = [];
  let enviados = 0;
  const enviar = async (tabla: string, id: string, to: string, asunto: string, c: { html: string; texto: string }, eventoId: string | null) => {
    let estado = "enviado";
    let error: string | null = null;
    try {
      await cliente.sendMail({ from: { name: "EMERTEAM Monitoreo", address: smtp.remitente }, to, subject: asunto, text: c.texto, html: c.html });
      enviados++;
      await supabase.from(tabla).update({ aviso_alta_en: new Date().toISOString() }).eq("id", id);
    } catch (e) {
      estado = "error";
      error = String(e).slice(0, 500);
    }
    registros.push({ evento_id: eventoId, tipo: "acceso", destinatario: to, asunto, estado, error, detalle: { tabla, id } });
  };

  for (const a of altasG) {
    const prod = a.mon_productoras;
    if (!prod) continue;
    const proximos = ((evs ?? []) as { productora_id: string; nombre: string; largada: string }[]).filter((e) => e.productora_id === prod.id);
    const cuerpo = [
      `Se habilitó tu acceso al monitoreo ambiental de EMERTEAM como integrante del equipo de ${prod.nombre}. Vas a ver todos los eventos de ${prod.nombre}, incluidos los que se carguen más adelante.`,
      proximos.length ? `Eventos activos: ${proximos.map((e) => `${e.nombre} (${fmtLargo(e.largada)})`).join("; ")}.` : "Todavía no hay eventos activos cargados; aparecen solos cuando EMERTEAM los carga.",
    ];
    if (a.responsable) cuerpo.push(`Sos responsable del equipo de ${prod.nombre}: desde la web podés sumar y quitar integrantes dentro del cupo.`);
    await enviar("mon_productora_miembros", a.id, a.email, `${prod.nombre} · Acceso al monitoreo ambiental`, correoAcceso(prod.nombre, a.nombre, cuerpo, a.recibe_alertas), null);
  }
  for (const a of altasE) {
    const ev = a.mon_eventos;
    if (!ev) continue;
    const cuerpo = [`EMERTEAM habilitó tu acceso al monitoreo ambiental de ${ev.nombre}, con largada el ${fmtLargo(ev.largada)}.`];
    await enviar("mon_accesos", a.id, a.email, `${ev.nombre} · Acceso al monitoreo ambiental`, correoAcceso(ev.nombre, a.nombre, cuerpo, a.recibe_alertas), ev.id);
  }
  try { cliente.close(); } catch { /* conexión ya cerrada */ }
  if (registros.length) {
    const { error } = await supabase.from("mon_envios").insert(registros);
    if (error) console.error("mon_envios acceso", error.message);
  }
  return { enviados, intentos: registros.length };
}

Deno.serve(async (req) => {
  const clave = req.headers.get("x-mon-cron") ?? "";
  const { data: ok } = clave ? await supabase.rpc("mon_validar_cron", { clave }) : { data: false };
  if (!ok) return json({ error: "no autorizado" }, 401);
  const ahora = Date.now();
  const prueba = new URL(req.url).searchParams.get("prueba") === "1"; // calcula sin enviar ni guardar estado
  const accesosNuevos = prueba ? null : await avisarAccesos(ahora);

  const { data: evs } = await supabase.from("mon_eventos").select("id,nombre,largada,organizador_email,disciplina,productora_id,armado_dias,participantes,duracion_propia_min,demora_largada_min,mon_modalidades(distancia_km,largada)")
    .eq("estado", "activo")
    .gte("largada", new Date(ahora - 2 * 86400_000).toISOString())
    .lte("largada", new Date(ahora + 16 * 86400_000).toISOString());
  const eventos = (evs ?? []) as Evento[];
  if (!eventos.length) return json({ ok: true, eventos: 0, accesos: accesosNuevos });
  const ids = eventos.map((e) => e.id);

  const prods = [...new Set(eventos.map((e) => e.productora_id).filter(Boolean))] as string[];
  const [{ data: nivs }, { data: alts }, { data: rays }, { data: estados }, { data: accesos }, { data: equipo }, { data: cred }, { data: grupo }, { data: cfgs }] = await Promise.all([
    supabase.from("mon_niveles").select("evento_id,fase,variable,desde,hasta,nivel,confianza").in("evento_id", ids)
      .gt("hasta", new Date(ahora).toISOString()).lte("desde", new Date(ahora + HORIZONTE_MS).toISOString()).limit(20000),
    supabase.from("mon_alertas_smn").select("id,evento_id,fenomeno,color,desde,hasta,estado,tipo,descripcion,instruccion").in("evento_id", ids),
    supabase.from("mon_rayos").select("evento_id,distancia_km,ocurrido_en").in("evento_id", ids).gte("ocurrido_en", new Date(ahora - 30 * 60_000).toISOString()).limit(5000),
    supabase.from("mon_estado").select("clave,valor").in("clave", ids.map((i) => `avisos:${i}`)),
    supabase.from("mon_accesos").select("evento_id,email").in("evento_id", ids).eq("recibe_alertas", true),
    supabase.from("mon_admins").select("email").eq("rol", "editor"),
    supabase.rpc("mon_credencial_smtp"),
    prods.length
      ? supabase.from("mon_productora_miembros").select("productora_id,email").in("productora_id", prods).eq("recibe_alertas", true)
      : Promise.resolve({ data: [] as { productora_id: string; email: string }[] }),
    supabase.from("mon_avisos_config").select("*"),
  ]);
  const cfgEvento = new Map(((cfgs ?? []) as (Config & { evento_id: string | null; productora_id: string | null })[]).filter((c) => c.evento_id).map((c) => [c.evento_id!, c]));
  const cfgProd = new Map(((cfgs ?? []) as (Config & { evento_id: string | null; productora_id: string | null })[]).filter((c) => c.productora_id).map((c) => [c.productora_id!, c]));
  const { data: ens } = await supabase.from("mon_ens_prob").select("evento_id,corrida,variable,nivel,ventana,ventana_hasta,umbral,prob,miembros")
    .in("evento_id", ids).eq("modelo", "mezcla").gte("corrida", new Date(ahora - 3 * 86400_000).toISOString()).limit(20000);
  const smtp = cred as { usuario: string | null; clave: string | null; remitente: string } | null;
  // Envío de prueba: un correo de muestra (con acentos y asunto largo) solo a los editores de EMERTEAM, sin tocar el estado
  if (new URL(req.url).searchParams.get("envio_prueba") === "1") {
    if (!smtp?.usuario || !smtp?.clave) return json({ ok: false, error: "sin credencial" });
    const tipoMuestra = new URL(req.url).searchParams.get("muestra");
    const alertaMuestra = ((alts ?? []) as Alerta[]).find((a) => a.estado !== "levantada");
    const ev = tipoMuestra === "smn" && alertaMuestra ? eventos.find((e) => e.id === alertaMuestra.evento_id) ?? eventos[0] : eventos[0];
    const muestra: Cambio[] = tipoMuestra === "smn" && alertaMuestra ? [{ tipo: "smn_nueva", alerta: alertaMuestra }]
      : tipoMuestra === "ens"
      ? [{ tipo: "ens", accion: "preparar", ventana: "carrera", variable: "wbgt", nivel: 1, prob: 0.42, umbral: 21, miembros: 81, corrida: new Date(ahora - 6 * 3600_000).toISOString(), dias: 3 }]
      : [{ tipo: "sube", fase: "desarme", variable: "calor_personal", antes: 0, ahora: 2, desde: new Date(ahora + 86400_000).toISOString(), confianza: "media" }];
    const correo = armarCorreo(ev, muestra);
    const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: smtp.usuario, pass: smtp.clave } });
    const envios: Record<string, string> = {};
    for (const d of (equipo ?? []).map((e) => String(e.email).trim().toLowerCase())) {
      try { await t.sendMail({ from: { name: "EMERTEAM Monitoreo", address: smtp.remitente }, to: d, subject: `PRUEBA · ${correo.asunto}`, text: correo.texto, html: correo.html }); envios[d] = "enviado"; }
      catch (e) { envios[d] = String(e).slice(0, 300); }
    }
    t.close();
    return json({ ok: true, envio_prueba: envios });
  }
  const estadoDe = new Map((estados ?? []).map((e) => [e.clave as string, JSON.parse(String(e.valor)) as Estado]));
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
    // Solo las alertas que tocan alguna fase del evento (armado, carrera o desarme)
    const vigentes = ((alts ?? []) as Alerta[]).filter((a) => a.evento_id === ev.id && a.estado !== "levantada" && (!a.hasta || new Date(a.hasta).getTime() > ahora) && enFases(a, ev, ahora));
    const rayosEv = ((rays ?? []) as { evento_id: string; distancia_km: number }[]).filter((r) => r.evento_id === ev.id);
    const km = rayosEv.length ? Math.min(...rayosEv.map((r) => Number(r.distancia_km))) : null;
    const glm = km == null ? 0 : km < 13 ? 4 : km < 19 ? 3 : km < 24 ? 2 : 1;
    const actual: Estado = { niveles: {}, smn: vigentes.map((a) => a.id), glm, ens: {} };
    const disparos = disparosEns(((ens ?? []) as EnsProb[]).filter((f) => f.evento_id === ev.id), ev.largada, ahora);

    const previo = estadoDe.get(`avisos:${ev.id}`);
    const cambios: Cambio[] = [];
    if (!previo) {
      // Primera corrida para este evento: se registra el estado sin avisar (evita una ráfaga de correos al activar)
      for (const [k, v] of Object.entries(niveles)) actual.niveles[k] = v;
      for (const d of disparos) actual.ens![`${d.ventana}|${d.variable}`] = `${d.accion}:${d.nivel}`;
    } else {
      // Disparadores del ensamble: se avisa cuando aparece uno nuevo o sube (Preparar → Activar, o nivel mayor);
      // lo ya avisado se conserva mientras la ventana siga abierta, para no repetir correos entre emisiones
      const previoEns = previo.ens ?? {};
      const rango = (v?: string) => (v ? rangoEns({ accion: v.split(":")[0], nivel: Number(v.split(":")[1]) }) : -1);
      for (const d of disparos) {
        const k = `${d.ventana}|${d.variable}`;
        if (rangoEns(d) > rango(previoEns[k])) { cambios.push(d); actual.ens![k] = `${d.accion}:${d.nivel}`; }
        else actual.ens![k] = previoEns[k];
      }
      const abiertas = new Set(((ens ?? []) as EnsProb[]).filter((f) => f.evento_id === ev.id && Date.parse(f.ventana_hasta) > ahora).map((f) => `${f.ventana}|${f.variable}`));
      for (const [k, v] of Object.entries(previoEns)) if (!(k in actual.ens!) && abiertas.has(k)) actual.ens![k] = v;
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
          // Una alerta que deja de contar por quedar fuera de las fases no se informa como levantada
          if (a && enFases(a, ev, ahora)) cambios.push({ tipo: "smn_levantada", alerta: a });
        }
      }
      const enVentana = enFases({ desde: new Date(ahora).toISOString(), hasta: new Date(ahora).toISOString() }, ev, ahora);
      if (enVentana && glm >= 2 && glm > (previo.glm ?? 0) && km != null) cambios.push({ tipo: "rayos", nivel: glm, km });
    }
    // Orden: rayos y SMN primero, después subas de mayor nivel, al final normalizaciones
    const peso = (c: Cambio) => c.tipo === "rayos" ? 100 : c.tipo === "smn_nueva" ? 90 : c.tipo === "sube" ? 10 * c.ahora
      : c.tipo === "ens" ? (c.accion === "activar" ? 8 : 4) + c.nivel / 10 : c.tipo === "smn_levantada" ? 5 : 1;
    cambios.sort((a, b) => peso(b) - peso(a));
    // Correo: SMN siempre; el resto según el tablero de EMERTEAM (evento, si no la productora, si no la base)
    const cfg: Config = { ...CONFIG_BASE, ...(cfgEvento.get(ev.id) ?? (ev.productora_id ? cfgProd.get(ev.productora_id) : undefined) ?? {}) };
    const hoy = diaAR(new Date(ahora).toISOString());
    const nPron = previo?.dia === hoy ? previo.n_pron ?? 0 : 0;
    const claveCambio = (c: Cambio) => c.tipo === "sube" || c.tipo === "normaliza" ? `${c.fase}|${c.variable}` : c.tipo === "ens" ? `ens|${c.ventana}|${c.variable}` : c.tipo;
    // Pendientes por tope: se reemplazan por el cambio más reciente de la misma variable y se descartan los que ya
    // no aplican (una suba que volvió a cero)
    const pend = new Map<string, Cambio>();
    for (const c of previo?.pend ?? []) pend.set(claveCambio(c), c);
    const elegidos = cambios.filter((c) => correoPorCambio(c, cfg, ahora));
    for (const c of elegidos.filter((x) => PRONOSTICO.has(x.tipo))) pend.set(claveCambio(c), c);
    for (const [k, c] of pend) {
      if (c.tipo === "sube" && (niveles[k] ?? 0) === 0) pend.delete(k);
      if (c.tipo === "normaliza" && (niveles[k] ?? 0) > 0) pend.delete(k);
    }
    const urgentes = elegidos.filter((c) => !PRONOSTICO.has(c.tipo));
    // pend solo tiene contenido si hubo cambios de pronóstico nuevos o quedaron acumulados por el tope
    const incluyePron = pend.size > 0 && nPron < TOPE_PRONOSTICO;
    const enviar = [...urgentes, ...(incluyePron ? [...pend.values()] : [])].sort((a, b) => peso(b) - peso(a));
    actual.dia = hoy;
    actual.n_pron = nPron + (incluyePron ? 1 : 0);
    actual.pend = incluyePron ? [] : [...pend.values()];

    let enviados = 0;
    let avanzar = true;
    if (enviar.length && !prueba && !puedeEnviar) {
      // Sin credencial no se registra ni se avanza el estado: los cambios salen juntos cuando se cargue la clave
      avanzar = false;
    } else if (enviar.length && !prueba) {
      const destinatarios = [...new Set([ev.organizador_email, ...((accesos ?? []).filter((a) => a.evento_id === ev.id).map((a) => a.email as string)),
        ...((grupo ?? []).filter((m) => ev.productora_id && m.productora_id === ev.productora_id).map((m) => m.email as string)),
        ...((equipo ?? []).map((e) => e.email as string))].map((e) => e.trim().toLowerCase()).filter(Boolean))];
      const correo = armarCorreo(ev, enviar);
      const registros: Record<string, unknown>[] = [];
      let cliente: ReturnType<typeof nodemailer.createTransport> | null = null;
      if (puedeEnviar) {
        cliente = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, pool: true, maxConnections: 1, auth: { user: smtp!.usuario!, pass: smtp!.clave! } });
      }
      for (const d of destinatarios) {
        let estado = "sin_credencial";
        let error: string | null = null;
        if (cliente) {
          try {
            await cliente.sendMail({ from: { name: "EMERTEAM Monitoreo", address: smtp!.remitente }, to: d, subject: correo.asunto, text: correo.texto, html: correo.html });
            estado = "enviado";
            enviados++;
          } catch (e) {
            estado = "error";
            error = String(e).slice(0, 500);
          }
        }
        registros.push({ evento_id: ev.id, tipo: enviar.map((c) => c.tipo).join(","), destinatario: d, asunto: correo.asunto, estado, error, detalle: { cambios: enviar } });
      }
      if (cliente) { try { cliente.close(); } catch { /* conexión ya cerrada */ } }
      if (cliente && destinatarios.length && enviados === 0) avanzar = false; // fallaron todos: se reintenta en la próxima corrida
      if (registros.length) {
        const { error: eReg } = await supabase.from("mon_envios").insert(registros);
        if (eReg) console.error("mon_envios", eReg.message);
      }
    }
    if (!prueba && (avanzar || !previo)) {
      await supabase.from("mon_estado").upsert({ clave: `avisos:${ev.id}`, valor: JSON.stringify(actual), actualizado_en: new Date().toISOString() });
    }
    resultado.push({ evento: ev.nombre, cambios: cambios.length, con_correo: enviar.length, enviados, primera_vez: !previo, pendientes: !avanzar, ...(prueba && enviar.length ? { asunto: armarCorreo(ev, enviar).asunto } : {}) });
  }
  return json({ ok: true, credencial: puedeEnviar, resultado, accesos: accesosNuevos });
});
