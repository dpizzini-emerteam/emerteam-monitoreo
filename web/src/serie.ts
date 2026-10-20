// Serie horaria de consenso entre modelos (misma regla que el procesamiento)
import type { Pronostico } from "./datos";

export const PRIORIDAD = ["ecmwf", "gfs", "icon"];
const VARS = ["t2m", "td2m", "hr", "viento10", "rafaga10", "dir_viento", "precip", "cape", "radiacion", "nubosidad", "presion", "wbgt_est"] as const;

/** Valores corregidos con observaciones del SMN, cuando el procesamiento los calculó */
export function corregido(p: Pronostico): Pronostico {
  if (p.t2m_corr == null) return p;
  return {
    ...p,
    t2m: p.t2m_corr ?? p.t2m, td2m: p.td2m_corr ?? p.td2m, hr: p.hr_corr ?? p.hr,
    viento10: p.viento10_corr ?? p.viento10, rafaga10: p.rafaga10_corr ?? p.rafaga10, wbgt_est: p.wbgt_corr ?? p.wbgt_est,
  };
}

/** Serie horaria de consenso: fuente prioritaria por hora (con valores corregidos si los hay) */
export function consenso(pron: Pronostico[]): Map<number, Pronostico & { n: number }> {
  const porHora = new Map<number, Pronostico[]>();
  for (const p0 of pron) {
    const p = corregido(p0);
    const t = new Date(p.valido).getTime();
    porHora.set(t, [...(porHora.get(t) ?? []), p]);
  }
  const out = new Map<number, Pronostico & { n: number }>();
  for (const [t, ps] of [...porHora.entries()].sort((a, b) => a[0] - b[0])) {
    const orden = [...PRIORIDAD.map((f) => ps.find((p) => p.fuente === f)).filter((p): p is Pronostico => !!p), ...ps.filter((p) => !PRIORIDAD.includes(p.fuente))];
    const fila = { ...orden[0], n: ps.length } as Pronostico & { n: number };
    // Ráfaga faltante en la fuente principal: viento medio propio × factor de ráfaga de la otra fuente
    if (fila.rafaga10 == null && fila.viento10 != null) {
      const o = orden.find((p) => p.rafaga10 != null && (p.viento10 ?? 0) >= 5);
      if (o) fila.rafaga10 = Math.round(fila.viento10 * Math.min(2.5, Math.max(1.2, o.rafaga10! / o.viento10!)) * 10) / 10;
    }
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
