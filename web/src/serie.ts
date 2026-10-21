// Serie horaria de consenso entre modelos (misma regla que el procesamiento, pipeline/mon/motor.py)
import type { Pronostico, Sesgo, Uv } from "./datos";

export const PRIORIDAD = ["ecmwf", "gfs", "wrf_smn", "icon"];
export const NOMBRE_FUENTE: Record<string, string> = { ecmwf: "ECMWF", gfs: "GFS", wrf_smn: "WRF SMN 4 km", icon: "ICON" };
const VARS = ["t2m", "td2m", "hr", "viento10", "rafaga10", "dir_viento", "precip", "cape", "radiacion", "nubosidad", "presion", "wbgt_est"] as const;
const INTERP = ["t2m", "td2m", "hr", "viento10", "rafaga10", "cape", "radiacion", "presion", "wbgt_est"] as const;
// Promedio ponderado por la inversa del error cuadrático medido contra el SMN; tormenta y dirección: fuente prioritaria
const MEZCLA_T = ["t2m", "td2m", "hr", "wbgt_est", "presion", "radiacion"] as const;
const TAU = { t: 0.25, v: 4 };

/** Valores corregidos con observaciones del SMN, cuando el procesamiento los calculó */
export function corregido(p: Pronostico): Pronostico {
  if (p.t2m_corr == null) return p;
  return {
    ...p,
    t2m: p.t2m_corr ?? p.t2m, td2m: p.td2m_corr ?? p.td2m, hr: p.hr_corr ?? p.hr,
    viento10: p.viento10_corr ?? p.viento10, rafaga10: p.rafaga10_corr ?? p.rafaga10, wbgt_est: p.wbgt_corr ?? p.wbgt_est,
  };
}

type Fila = Pronostico & { n: number; pesos?: Record<string, number> };

/** Pesos de cada fuente para temperatura (t) y viento (v); iguales si falta el error de alguna */
export function pesosFuentes(fuentes: string[], sesgos: Sesgo[], fam: "t" | "v"): Record<string, number> {
  const ecm = (f: string) => {
    const s = sesgos.find((x) => x.fuente === f && x.aplicado);
    const r = fam === "t" ? s?.rmse_t_corr : s?.rmse_viento_corr;
    return r == null ? null : Number(r) ** 2;
  };
  const e = fuentes.map(ecm);
  if (fuentes.length && e.every((x) => x != null)) return Object.fromEntries(fuentes.map((f, i) => [f, 1 / (e[i]! + TAU[fam])]));
  return Object.fromEntries(fuentes.map((f) => [f, 1]));
}

const media = (v: [number, number][]) => {
  const w = v.reduce((a, [, p]) => a + p, 0);
  return w > 0 ? v.reduce((a, [x, p]) => a + x * p, 0) / w : null;
};

/** Serie horaria de consenso (con valores corregidos si los hay) */
export function consenso(pron: Pronostico[], uv: Uv[] = [], sesgos: Sesgo[] = []): Map<number, Fila> {
  const uvHora = new Map(uv.map((u) => [new Date(u.valido).getTime(), Number(u.uv)]));
  // Serie por fuente; las trihorarias se interpolan a horario
  const porFuente = new Map<string, Map<number, Pronostico>>();
  for (const p0 of pron) {
    const p = corregido(p0);
    const t = new Date(p.valido).getTime();
    if (!porFuente.has(p.fuente)) porFuente.set(p.fuente, new Map());
    porFuente.get(p.fuente)!.set(t, p);
  }
  for (const serie of porFuente.values()) {
    const horas = [...serie.keys()].sort((a, b) => a - b);
    for (let i = 0; i + 1 < horas.length; i++) {
      const a = horas[i], b = horas[i + 1], paso = Math.round((b - a) / 3600_000);
      for (let k = 1; k < paso; k++) {
        const pa = serie.get(a)!, pb = serie.get(b)!, w = k / paso;
        const f: Pronostico = { ...pa, valido: new Date(a + k * 3600_000).toISOString(), precip: pb.precip };
        for (const c of INTERP) {
          const va = pa[c], vb = pb[c];
          (f as Record<string, unknown>)[c] = va == null || vb == null ? null : Number(va) + (Number(vb) - Number(va)) * w;
        }
        serie.set(a + k * 3600_000, f);
      }
    }
  }
  const horas = [...new Set([...porFuente.values()].flatMap((s) => [...s.keys()]))].sort((a, b) => a - b);
  const otras = [...porFuente.keys()].filter((f) => !PRIORIDAD.includes(f));
  const out = new Map<number, Fila>();
  for (const t of horas) {
    const disp = [...PRIORIDAD, ...otras].filter((f) => porFuente.get(f)?.has(t));
    const ps = disp.map((f) => porFuente.get(f)!.get(t)!);
    const fila = { ...ps[0], n: ps.length } as Fila;
    // Variable ausente en la fuente principal: se toma de la siguiente
    for (const c of VARS) {
      if (fila[c] == null) {
        const alt = ps.find((p) => p[c] != null);
        if (alt) (fila as Record<string, unknown>)[c] = alt[c];
      }
    }
    if (ps.length > 1) {
      const pt = pesosFuentes(disp, sesgos, "t"), pv = pesosFuentes(disp, sesgos, "v");
      for (const c of [...MEZCLA_T, "viento10"] as const) {
        const pp = c === "viento10" ? pv : pt;
        const v = ps.filter((p) => p[c] != null).map((p) => [Number(p[c]), pp[p.fuente]] as [number, number]);
        if (v.length > 1) (fila as Record<string, unknown>)[c] = media(v);
      }
      // Ráfaga: fuentes que la publican, llevada al viento combinado con su factor de ráfaga
      const con = ps.filter((p) => p.rafaga10 != null && p.viento10 != null);
      if (con.length) {
        let r = media(con.map((p) => [Number(p.rafaga10), pv[p.fuente]]))!;
        const vm = media(con.map((p) => [Number(p.viento10), pv[p.fuente]]));
        if (fila.viento10 != null && vm != null && vm >= 5) r = Number(fila.viento10) * Math.min(2.5, Math.max(1.2, r / vm));
        fila.rafaga10 = Math.round(r * 10) / 10;
      }
      const tot = Object.values(pt).reduce((a, b) => a + b, 0);
      fila.pesos = Object.fromEntries(disp.map((f) => [f, pt[f] / tot]));
    }
    fila.uv = uvHora.get(t) ?? null;
    out.set(t, fila);
  }
  return out;
}

/** Categorías del índice UV: OMS (2002), Global Solar UV Index: A Practical Guide */
export const UV_CATEGORIAS = [
  { desde: 0, nombre: "Bajo", fondo: "#2FA34C", texto: "#111111", oms: "#4EB400" },
  { desde: 3, nombre: "Moderado", fondo: "#C79000", texto: "#111111", oms: "#F7E400" },
  { desde: 6, nombre: "Alto", fondo: "#FF6A1A", texto: "#111111", oms: "#F85900" },
  { desde: 8, nombre: "Muy alto", fondo: "#FF3B30", texto: "#111111", oms: "#D8001D" },
  { desde: 11, nombre: "Extremo", fondo: "#6B3FA0", texto: "#FFFFFF", oms: "#6B49C8" },
];
export function categoriaUv(uv: number) {
  const r = Math.round(uv);
  return [...UV_CATEGORIAS].reverse().find((c) => r >= c.desde) ?? UV_CATEGORIAS[0];
}
/** Máximo de UV por día local (AAAA-MM-DD) a partir de la serie horaria */
export function uvMaxPorDia(uv: Uv[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const u of uv) {
    const d = new Date(new Date(u.valido).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
    out.set(d, Math.max(out.get(d) ?? 0, Number(u.uv)));
  }
  return out;
}
export const FUENTE_UV = "Índice UV con cielo despejado: MET Norway, Locationforecast 2.0 (CC BY 4.0); más allá de 2,5 días, estimado por altura solar. Categorías: OMS (2002).";
