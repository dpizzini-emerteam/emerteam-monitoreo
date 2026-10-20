// Armado del informe post-evento a partir de los datos registrados.
// El resultado es un objeto serializable: al aprobarse se guarda como copia fija (mon_informes.contenido).
import { kmPorTrueno, nivelRayoMedido, type AlertaSMN, type Evento, type Medicion, type Pronostico, type Rayo, type Uv } from "./datos";
import { consenso } from "./serie";
import { calcular } from "./ventanas";

export type FilaHistorial = {
  evento_id: string; fase: string; variable: string; desde: string; hasta: string; nivel: number;
  valor: number | null; umbral: number | null; regla: string | null; confianza: string | null; emitido_en: string;
};

export type RecoInforme = { fase: string; variable: string; nivel: number; desde: string; hasta: string; primera_emision: string; valor: number | null };
export type Pico = { valor: number; hora: string; sector?: string } | null;
export type FaseInforme = {
  fase: "armado" | "personal" | "desarme"; desde: string; hasta: string;
  rafagaEst: Pico; rafagaMed: Pico; wbgtEst: Pico; lluviaMm: number; recos: RecoInforme[];
  hrMin?: number | null; hrMax?: number | null; uvMax?: Pico;
};
export type Informe = {
  version: 1;
  generado_en: string;
  evento: { nombre: string; largada: string; ubicacion: string; modalidades: string; participantes: number };
  ventanas: { exposicion: [string, string]; carrera: [string, string]; ultimoCuarto: [string, string] };
  corredores: {
    wbgtEst: Pico; wbgtMed: Pico; temperaturaMax: Pico; humedadMedia: number | null; hrMin?: number | null; hrMax?: number | null; uvMax?: Pico; rafagaEst: Pico; rafagaMed: Pico; lluviaMm: number;
    rayos: { cantidad: number; minKm: number | null; hora: string | null };
    rayosTerreno: { nivelMax: number; detalle: string | null };
    recos: RecoInforme[];
  };
  trabajadores: FaseInforme[];
  alertas: { titulo: string; color: string; desde: string | null; hasta: string | null }[];
};

const enVentana = (iso: string, a: Date, b: Date) => {
  const t = new Date(iso).getTime();
  return t >= a.getTime() && t <= b.getTime();
};

function maximo<T>(items: T[], valor: (x: T) => number | null | undefined, hora: (x: T) => string, sector?: (x: T) => string): Pico {
  let mejor: Pico = null;
  for (const x of items) {
    const v = valor(x);
    if (v == null || Number.isNaN(v)) continue;
    if (!mejor || v > mejor.valor) mejor = { valor: v, hora: hora(x), ...(sector ? { sector: sector(x) } : {}) };
  }
  return mejor;
}

function recosDe(hist: FilaHistorial[], fases: string[]): RecoInforme[] {
  const grupos = new Map<string, FilaHistorial[]>();
  for (const h of hist.filter((x) => fases.includes(x.fase) && x.nivel > 0)) {
    const k = `${h.fase}|${h.variable}`;
    grupos.set(k, [...(grupos.get(k) ?? []), h]);
  }
  const out: RecoInforme[] = [];
  for (const hs of grupos.values()) {
    const max = Math.max(...hs.map((h) => h.nivel));
    const top = hs.filter((h) => h.nivel === max).sort((a, b) => a.desde.localeCompare(b.desde));
    out.push({
      fase: hs[0].fase, variable: hs[0].variable, nivel: max, desde: top[0].desde, hasta: top[top.length - 1].hasta,
      primera_emision: hs.map((h) => h.emitido_en).sort()[0], valor: top[0].valor,
    });
  }
  return out.sort((a, b) => b.nivel - a.nivel || a.desde.localeCompare(b.desde));
}

export function armarInforme(ev: Evento, pron: Pronostico[], hist: FilaHistorial[], meds: Medicion[], rayos: Rayo[], alertas: AlertaSMN[], uv: Uv[] = []): Informe {
  const v = calcular(ev);
  const serie = [...consenso(pron, uv).entries()];
  const rangoHr = (ps: Pronostico[]) => { const x = ps.map((p) => p.hr).filter((h): h is number => h != null); return x.length ? { hrMin: Math.round(Math.min(...x)), hrMax: Math.round(Math.max(...x)) } : { hrMin: null, hrMax: null }; };
  const uvEn = (a: Date, b: Date) => maximo(uv.filter((u) => enVentana(u.valido, a, b)).map((u) => ({ ...u, uv: Number(u.uv) })), (u) => u.uv, (u) => u.valido);
  // Horas que representa cada paso, para acumular lluvia
  const pasos = serie.map(([t], i) => ({ t, h: i === 0 ? 1 : Math.min(6, (t - serie[i - 1][0]) / 3600_000) }));
  const horasPaso = new Map(pasos.map((p) => [p.t, p.h]));
  const tramo = (a: Date, b: Date) => serie.filter(([t]) => t >= a.getTime() && t <= b.getTime()).map(([, p]) => p);
  const lluvia = (a: Date, b: Date) =>
    Math.round(serie.filter(([t]) => t >= a.getTime() && t <= b.getTime()).reduce((s, [t, p]) => s + (p.precip ?? 0) * (horasPaso.get(t) ?? 1), 0) * 10) / 10;

  const [e0, e1] = v.exposicion;
  const expo = tramo(e0, e1);
  const medsExpo = meds.filter((m) => enVentana(m.tomada_en, e0, e1));
  const rayosExpo = rayos.filter((r) => enVentana(r.ocurrido_en, e0, e1) && Number(r.distancia_km) < 24);
  const cercano = rayosExpo.reduce<Rayo | null>((m, r) => (!m || Number(r.distancia_km) < Number(m.distancia_km) ? r : m), null);
  const medsRayo = medsExpo.filter((m) => nivelRayoMedido(m) != null);
  const peorRayo = medsRayo.reduce<Medicion | null>((m, x) => (!m || (nivelRayoMedido(x) ?? 0) > (nivelRayoMedido(m) ?? 0) ? x : m), null);
  const hrs = expo.map((p) => p.hr).filter((x): x is number => x != null);

  const fase = (f: "armado" | "personal" | "desarme", a: Date, b: Date): FaseInforme => {
    const ps = tramo(a, b);
    const ms = meds.filter((m) => enVentana(m.tomada_en, a, b));
    return {
      fase: f, desde: a.toISOString(), hasta: b.toISOString(),
      rafagaEst: maximo(ps, (p) => p.rafaga10, (p) => p.valido),
      rafagaMed: maximo(ms, (m) => m.rafaga, (m) => m.tomada_en, (m) => m.sector),
      wbgtEst: maximo(ps, (p) => p.wbgt_est, (p) => p.valido),
      lluviaMm: lluvia(a, b),
      ...rangoHr(ps), uvMax: uvEn(a, b),
      recos: recosDe(hist, [f]),
    };
  };

  return {
    version: 1,
    generado_en: new Date().toISOString(),
    evento: {
      nombre: ev.nombre, largada: ev.largada, ubicacion: ev.ubicacion, participantes: ev.participantes,
      modalidades: (ev.mon_modalidades ?? []).map((m) => m.nombre).join(", "),
    },
    ventanas: {
      exposicion: [e0.toISOString(), e1.toISOString()],
      carrera: [v.largada.toISOString(), v.finCarrera.toISOString()],
      ultimoCuarto: [v.inicioUltimoCuarto.toISOString(), v.finCarrera.toISOString()],
    },
    corredores: {
      wbgtEst: maximo(expo, (p) => p.wbgt_est, (p) => p.valido),
      wbgtMed: maximo(medsExpo, (m) => m.wbgt, (m) => m.tomada_en, (m) => m.sector),
      temperaturaMax: maximo(expo, (p) => p.t2m, (p) => p.valido),
      humedadMedia: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
      ...rangoHr(expo), uvMax: uvEn(e0, e1),
      rafagaEst: maximo(expo, (p) => p.rafaga10, (p) => p.valido),
      rafagaMed: maximo(medsExpo, (m) => m.rafaga, (m) => m.tomada_en, (m) => m.sector),
      lluviaMm: lluvia(e0, e1),
      rayos: { cantidad: rayosExpo.length, minKm: cercano ? Number(cercano.distancia_km) : null, hora: cercano?.ocurrido_en ?? null },
      rayosTerreno: {
        nivelMax: peorRayo ? nivelRayoMedido(peorRayo) ?? 0 : 0,
        detalle: peorRayo
          ? `${peorRayo.trueno ? "trueno audible" : peorRayo.rayo_km != null ? `detector: ${Math.round(Number(peorRayo.rayo_km))} km` : peorRayo.rayo_rango ? `detector: ${peorRayo.rayo_rango} km` : ""}${peorRayo.relampago_trueno_s != null ? ` · relámpago-trueno ≈ ${(kmPorTrueno(peorRayo.relampago_trueno_s) ?? 0).toFixed(1)} km` : ""} (${peorRayo.sector})`
          : null,
      },
      recos: recosDe(hist, ["carrera"]),
    },
    trabajadores: [
      fase("armado", v.armado[0], v.armado[1]),
      fase("personal", v.personal[0], v.personal[1]),
      fase("desarme", v.desarme[0], v.desarme[1]),
    ],
    alertas: alertas
      .filter((a) => {
        const d = a.desde ? new Date(a.desde).getTime() : 0;
        const h = a.hasta ? new Date(a.hasta).getTime() : Infinity;
        return h >= v.armado[0].getTime() && d <= v.desarme[1].getTime();
      })
      .map((a) => ({
        titulo: `${a.tipo === "aviso_corto_plazo" ? "Aviso a corto plazo" : "Alerta"} ${a.color} · ${a.fenomeno.replace(/\s*\(aviso a corto plazo\)$/, "")}`,
        color: a.color, desde: a.desde, hasta: a.hasta,
      })),
  };
}
