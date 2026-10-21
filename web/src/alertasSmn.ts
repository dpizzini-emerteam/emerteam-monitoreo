// Alertas del SMN: qué recomienda el SMN a la población y qué decisión sugiere EMERTEAM para el evento.
// Réplica en supabase/functions/mon-avisos/index.ts (decisionSMN): cambiar los dos juntos.
//
// Fuente de las frases oficiales: SMN, Sistema de Alerta Temprana, «Recomendaciones para alertas y
// advertencias» (las mismas que el SMN incluye en cada alerta, campo instruction del CAP).
// Decisión para el evento: criterio interno EMERTEAM según el color del SMN y la fase que toca la alerta.

export type FaseEvento = "armado" | "carrera" | "desarme";

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
export function recomendacionSmnAireLibre(a: { color: string; fenomeno: string; instruccion?: string | null }): string[] {
  const items = (a.instruccion ?? "").split(/\s*\d+\s*-\s*/).map((x) => x.trim()).filter(Boolean)
    .map((x) => (/[.!]$/.test(x) ? x : `${x}.`));
  const sel = items.filter((x) => AIRE_LIBRE.test(x));
  if (sel.length) return sel;
  if (esCalor(a.fenomeno)) return CALOR_SMN;
  if (esFrio(a.fenomeno)) return [];
  return POR_COLOR[a.color] ?? [];
}

/** Decisión sugerida por fase (criterio interno EMERTEAM) */
export function decisionEvento(a: { color: string; fenomeno: string }, fases: FaseEvento[]): { fase: string; texto: string }[] {
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
