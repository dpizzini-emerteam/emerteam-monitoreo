// Serie horaria de consenso entre modelos (misma regla que el procesamiento)
import type { Pronostico } from "./datos";

export const PRIORIDAD = ["ecmwf", "gfs", "icon"];
const VARS = ["t2m", "td2m", "hr", "viento10", "rafaga10", "dir_viento", "precip", "cape", "radiacion", "nubosidad", "presion", "wbgt_est"] as const;

/** Serie horaria de consenso: fuente prioritaria por hora */
export function consenso(pron: Pronostico[]): Map<number, Pronostico & { n: number }> {
  const porHora = new Map<number, Pronostico[]>();
  for (const p of pron) {
    const t = new Date(p.valido).getTime();
    porHora.set(t, [...(porHora.get(t) ?? []), p]);
  }
  const out = new Map<number, Pronostico & { n: number }>();
  for (const [t, ps] of [...porHora.entries()].sort((a, b) => a[0] - b[0])) {
    const orden = [...PRIORIDAD.map((f) => ps.find((p) => p.fuente === f)).filter((p): p is Pronostico => !!p), ...ps.filter((p) => !PRIORIDAD.includes(p.fuente))];
    const fila = { ...orden[0], n: ps.length } as Pronostico & { n: number };
    // Variable ausente en la fuente principal: se toma de la siguiente
    for (const c of VARS) {
      if (fila[c] == null) {
        const alt = orden.find((p) => p[c] != null);
        if (alt) (fila as Record<string, unknown>)[c] = alt[c];
      }
    }
    out.set(t, fila);
  }
  return out;
}
