// Réplica del cálculo de ventanas del procesamiento (pipeline/mon/ventanas.py).
import type { Evento } from "./datos";
import U from "../../config/umbrales.json";

const W = U.ventanas;

const ANCLAS: [number, number][] = [[0, 0], [3, 54], [5, 75], [10, 120], [21.0975, 180], [42.195, 360]];

export function duracionEstimadaMin(km: number): number {
  if (km >= 42.195) return (360 * km) / 42.195;
  for (let i = 0; i < ANCLAS.length - 1; i++) {
    const [k0, d0] = ANCLAS[i], [k1, d1] = ANCLAS[i + 1];
    if (km >= k0 && km <= k1) return d0 + ((d1 - d0) * (km - k0)) / (k1 - k0);
  }
  return 0;
}

export type Ventanas = {
  largada: Date;
  finCarrera: Date;
  inicioUltimoCuarto: Date;
  exposicion: [Date, Date];
  personal: [Date, Date];
  armado: [Date, Date];
  desarme: [Date, Date];
  duracionMin: number;
  demoraMin: number;
  /** Triatlón: segmento de natación (zona crítica junto con el último cuarto) */
  natacion: [Date, Date] | null;
};

const min = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

export function calcular(ev: Evento): Ventanas {
  const largada = new Date(ev.largada);
  const demora = ev.demora_largada_min ?? ((ev.participantes ?? 0) / 1000) * W.demora_cada_1000;
  let fin = largada;
  let duracion: number;
  if (ev.duracion_propia_min) {
    duracion = ev.duracion_propia_min;
    fin = min(largada, demora + duracion);
  } else {
    for (const m of ev.mon_modalidades?.length ? ev.mon_modalidades : [{ distancia_km: 10, largada: null }]) {
      const ini = m.largada ? new Date(m.largada) : largada;
      const f = min(ini, demora + duracionEstimadaMin(Number(m.distancia_km)));
      if (f > fin) fin = f;
    }
    duracion = (fin.getTime() - largada.getTime()) / 60_000 - demora;
  }
  // Inicio del día local de largada (UTC−03:00) menos los días de armado
  const local = new Date(largada.getTime() - 3 * 3600_000);
  const dia0 = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 3));
  return {
    largada,
    finCarrera: fin,
    inicioUltimoCuarto: min(largada, demora + W.ultimo_cuarto * duracion),
    exposicion: [min(largada, -W.exposicion_antes_min), min(fin, W.exposicion_despues_min)],
    personal: [min(largada, -W.personal_antes_min), min(fin, W.personal_despues_min)],
    armado: [new Date(dia0.getTime() - (ev.armado_dias || 3) * 86400_000), min(largada, -W.armado_hasta_antes_largada_min)],
    desarme: [fin, min(fin, W.desarme_min)],
    duracionMin: duracion,
    demoraMin: demora,
    natacion: ev.disciplina === "triatlon" && ev.natacion_min ? [min(largada, demora), min(largada, demora + ev.natacion_min)] : null,
  };
}
