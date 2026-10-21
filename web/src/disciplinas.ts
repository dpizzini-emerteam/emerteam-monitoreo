// Disciplinas y escalas de calor por federación. Fuente única: config/umbrales.json
import U from "../../config/umbrales.json";

export type Disciplina = "running" | "triatlon" | "aguas_abiertas" | "ciclismo" | "montana";
export type VariableCalor = "wbgt" | "wbgt_wt" | "wbgt_uci";

type Conf = { nombre: string; participantes: string; calor: VariableCalor; agua: boolean; wct: boolean };
const D = U.disciplinas as unknown as Record<Disciplina, Conf>;

export const DISCIPLINAS: Disciplina[] = ["running", "triatlon", "aguas_abiertas", "ciclismo", "montana"];
export const confDisciplina = (d?: string | null): Conf => D[(d as Disciplina) in D ? (d as Disciplina) : "running"];
export const nombreDisciplina = (d?: string | null) => confDisciplina(d).nombre;
/** «corredores», «triatletas», «nadadores», «ciclistas» */
export const participantes = (d?: string | null) => confDisciplina(d).participantes;

export type EscalaCalor = {
  variable: VariableCalor;
  autor: string;               // rótulo de la fuente: World Athletics (2020), World Triathlon, UCI
  niveles: string[];
  rangos: string[];
  fondo: string[];
  texto: string[];
  nivel: (w: number | null | undefined) => number | null;
};

const WA = U.wbgt_wa.cortes;
const WT = U.wbgt_wt;
const UCI = U.wbgt_uci.cortes;

export const ESCALAS: Record<VariableCalor, EscalaCalor> = {
  // World Athletics (2020), Competition Medical Guidelines, tabla 1
  wbgt: {
    variable: "wbgt", autor: "World Athletics (2020)",
    niveles: ["Riesgo bajo", "Precaución", "Advertencia", "Advertencia severa", "Peligro"],
    rangos: [`< ${WA[0]} °C`, `${WA[0]}–${WA[1]} °C`, `${WA[1]}–${WA[2]} °C`, `${WA[2]}–${WA[3]} °C`, `> ${WA[3]} °C`],
    fondo: ["#FFFFFF", "#B8D484", "#FBBC43", "#E83F43", "#1D1D1B"],
    texto: ["#111111", "#111111", "#111111", "#111111", "#FFFFFF"],
    nivel: (w) => (w == null ? null : w >= WA[3] ? 4 : w >= WA[2] ? 3 : w >= WA[1] ? 2 : w >= WA[0] ? 1 : 0),
  },
  // World Triathlon, regla 10.3: banderas WBGT
  wbgt_wt: {
    variable: "wbgt_wt", autor: "World Triathlon",
    niveles: ["Bandera verde", "Bandera azul", "Bandera naranja", "Bandera roja", "Bandera negra"],
    rangos: [`< ${fmt(WT.cortes[0])} °C`, `${fmt(WT.cortes[0])}–${fmt(WT.cortes[1] - 0.1)} °C`, `${fmt(WT.cortes[1])}–${fmt(WT.cortes[2] - 0.1)} °C`,
      `${fmt(WT.cortes[2])}–${fmt(WT.negra_mayor_que)} °C`, `> ${fmt(WT.negra_mayor_que)} °C`],
    fondo: ["#2FA34C", "#2F6FD6", "#FF6A1A", "#FF3B30", "#111111"],
    texto: ["#111111", "#FFFFFF", "#111111", "#111111", "#FFFFFF"],
    nivel: (w) => (w == null ? null : w > WT.negra_mayor_que ? 4 : w >= WT.cortes[2] ? 3 : w >= WT.cortes[1] ? 2 : w >= WT.cortes[0] ? 1 : 0),
  },
  // UCI, Parte 2, Anexo C: Protocolo de Alta Temperatura
  wbgt_uci: {
    variable: "wbgt_uci", autor: "UCI",
    niveles: ["Zona blanca", "Zona verde", "Zona amarilla", "Zona naranja", "Zona roja"],
    rangos: [`< ${UCI[0]} °C`, `${UCI[0]}–${fmt(UCI[1] - 0.1)} °C`, `${UCI[1]}–${fmt(UCI[2] - 0.1)} °C`, `${UCI[2]}–${fmt(UCI[3] - 0.1)} °C`, `≥ ${UCI[3]} °C`],
    fondo: ["#FFFFFF", "#2FA34C", "#F5C400", "#FF6A1A", "#FF3B30"],
    texto: ["#111111", "#111111", "#111111", "#111111", "#111111"],
    nivel: (w) => (w == null ? null : w >= UCI[3] ? 4 : w >= UCI[2] ? 3 : w >= UCI[1] ? 2 : w >= UCI[0] ? 1 : 0),
  },
};

function fmt(x: number) { return (Math.round(x * 10) / 10).toFixed(1).replace(".", ","); }

export const escalaCalor = (d?: string | null): EscalaCalor => ESCALAS[confDisciplina(d).calor];
export const esVariableCalor = (v: string): v is VariableCalor => v === "wbgt" || v === "wbgt_wt" || v === "wbgt_uci";

/** Estilo de una etiqueta de nivel de calor con los colores de su escala (con contorno si el fondo es blanco) */
export function estiloCalor(variable: VariableCalor, n: number) {
  const e = ESCALAS[variable];
  return { background: e.fondo[n] ?? e.fondo[0], color: e.texto[n] ?? "#111111", boxShadow: (e.fondo[n] ?? "") === "#FFFFFF" ? "inset 0 0 0 1px #1D1D1B" : undefined };
}

// ---------- Agua ----------

export type ResultadoAgua = { estado: "ok" | "reducir" | "cancelar" | "fuera" | "sin_dato"; titulo: string; detalle: string[]; nivel: number };

const AWT = U.agua_wt;
const AWA = U.agua_wa;

/** Temperatura ajustada por aire frío, World Triathlon 4.4(b). null = se cancela; undefined = no aplica */
export function ajusteAireWT(agua: number, aire: number | null): number | null | undefined {
  const a = AWT.ajuste_aire;
  if (aire == null || agua > a.aplica_agua_hasta || aire > a.aplica_aire_hasta) return undefined;
  if (agua < a.agua_c[a.agua_c.length - 1]) return undefined; // fuera de la tabla: rige la temperatura medida
  // Por prudencia se redondea hacia abajo (fila y columna más frías)
  const fila = a.agua_c.indexOf(Math.floor(agua));
  const aireR = Math.floor(aire);
  if (aireR < a.aire_c[a.aire_c.length - 1]) return null;
  const col = a.aire_c.indexOf(aireR);
  if (fila < 0 || col < 0) return undefined;
  return (a.valores[fila][col] as number | null);
}

/** Natación de triatlón: distancia según temperatura (4.4(a)), ajuste por aire (4.4(b)) y neopreno (4.2, grupos de edad) */
export function evaluarAguaTriatlon(agua: number, aire: number | null, distanciaM: number | null): ResultadoAgua {
  const det: string[] = [];
  const aj = ajusteAireWT(agua, aire);
  if (aj === null) return { estado: "cancelar", nivel: 4, titulo: "Se cancela la natación", detalle: [`Agua ${fmt(agua)} °C con aire ${fmt(aire!)} °C: la tabla de ajuste por aire frío (regla 4.4(b)) indica cancelar.`] };
  const t = aj === undefined ? agua : aj;
  if (aj !== undefined) det.push(`Temperatura ajustada por aire frío (regla 4.4(b)): ${fmt(t)} °C.`);
  const franja = AWT.franjas.find((f) => t >= f.desde)!;
  let col = -1;
  if (distanciaM != null && distanciaM > 300) {
    col = distanciaM <= 750 ? 0 : distanciaM <= 1000 ? 1 : distanciaM <= 1500 ? 2 : distanciaM <= 3000 ? 3 : 4;
  }
  const valores = franja.valores as (number | string | null)[];
  const v = col >= 0 ? valores[col] : valores.every((x) => x === null) ? null : "consultar";
  let r: ResultadoAgua;
  if (v === null) r = { estado: "cancelar", nivel: 4, titulo: "Se cancela la natación", detalle: det };
  else if (v === "orig") r = { estado: "ok", nivel: 0, titulo: "Natación con la distancia original", detalle: det };
  else if (v === "consultar") r = { estado: "reducir", nivel: 2, titulo: "Revisar la distancia de natación", detalle: [...det, "Cargá la distancia de natación del evento para aplicar la regla 4.4(a)."] };
  else r = { estado: distanciaM != null && Number(v) >= distanciaM ? "ok" : "reducir", nivel: distanciaM != null && Number(v) >= distanciaM ? 0 : 3, titulo: distanciaM != null && Number(v) >= distanciaM ? "Natación con la distancia original" : `Natación reducida a ${v} m`, detalle: det };
  // Neopreno, grupos de edad (regla 4.2)
  const g = AWT.neopreno_prohibido_grupos_edad;
  const limite = distanciaM != null && distanciaM > 1500 ? g.mas_de_1500 : g.hasta_1500;
  if (r.estado !== "cancelar") {
    r.detalle.push(t <= AWT.neopreno_obligatorio_hasta ? "Neopreno obligatorio (regla 4.2)."
      : t >= limite ? `Neopreno prohibido para grupos de edad (desde ${fmt(limite)} °C; 60 años o más desde ${fmt(g["60_o_mas"])} °C).`
      : `Neopreno permitido para grupos de edad (prohibido desde ${fmt(limite)} °C).`);
  }
  return r;
}

/** Aguas abiertas, World Aquatics OWS 9.1.6.3 y 7.2 */
export function evaluarAguaAbierta(agua: number): ResultadoAgua {
  if (agua < AWA.minima || agua > AWA.maxima) {
    return { estado: "fuera", nivel: 4, titulo: agua < AWA.minima ? "Agua por debajo de 16 °C" : "Agua por encima de 31 °C",
      detalle: ["Fuera del rango de World Aquatics (16 a 31 °C): no largar; en carrera, repetir la medición a los 30 min y detener si persiste (OWS 11.4.7)."] };
  }
  return { estado: "ok", nivel: 0, titulo: "Dentro del rango de World Aquatics (16 a 31 °C)",
    detalle: [agua < AWA.neopreno_obligatorio_bajo ? "Neopreno obligatorio (OWS 7.2, menos de 18 °C)." : `Neopreno no permitido en competencia World Aquatics (desde 18 °C; hasta ${AWA.neopreno_peligrosas_hasta} °C solo ante condiciones peligrosas).`] };
}

/** Calidad microbiológica, World Aquatics OWS 10.1 */
export function evaluarCalidad(tipo: string | null | undefined, ent: number | null, ecoli: number | null, ciano: number | null): ResultadoAgua | null {
  if (ent == null && ecoli == null && ciano == null) return null;
  const c = U.calidad_agua;
  const lim = tipo === "mar" ? c.mar : c.continental;
  const malo = (ent != null && ent > lim.buena.enterococos) || (ecoli != null && ecoli > lim.buena.ecoli) || (ciano != null && ciano > c.cianobacterias_max);
  const exc = (ent == null || ent < lim.excelente.enterococos) && (ecoli == null || ecoli < lim.excelente.ecoli) && !malo;
  const det = [`Límites para agua ${tipo === "mar" ? "de mar" : "continental"}: buena hasta ${lim.buena.enterococos} enterococos y ${lim.buena.ecoli} E. coli por 100 ml.`];
  if (malo) return { estado: "cancelar", nivel: 4, titulo: "Calidad inaceptable", detalle: [...det, "No apta para competir (World Aquatics OWS 10.1; World Triathlon exige al menos «buena»)."] };
  return { estado: "ok", nivel: 0, titulo: exc ? "Calidad excelente" : "Calidad buena", detalle: det };
}

// ---------- Sensación térmica por viento ----------

/** WCT (NWS 2001, métrica). null si no aplica (T > 10 °C o viento < 4,8 km/h) */
export function wct(t: number | null | undefined, v: number | null | undefined): number | null {
  if (t == null || v == null || t > U.wct.aplica_temp_hasta || v < U.wct.aplica_viento_desde) return null;
  const p = Math.pow(v, 0.16);
  return 13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p;
}
export function riesgoWct(w: number): string {
  let r = U.wct.riesgo[0][1] as string;
  for (const [desde, nombre] of U.wct.riesgo as [number, string][]) if (w <= desde) r = nombre;
  return r;
}
