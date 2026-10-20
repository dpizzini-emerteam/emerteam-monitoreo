// Réplica del cálculo de ventanas del procesamiento (pipeline/mon/ventanas.py).
import type { Evento } from "./datos";

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
};

const min = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

export function calcular(ev: Evento): Ventanas {
  const largada = new Date(ev.largada);
  const demora = ev.demora_largada_min ?? (ev.participantes ?? 0) / 1000;
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
    inicioUltimoCuarto: min(largada, demora + 0.75 * duracion),
    exposicion: [min(largada, -60), min(fin, 60)],
    personal: [min(largada, -240), min(fin, 300)],
    armado: [new Date(dia0.getTime() - (ev.armado_dias || 3) * 86400_000), min(largada, -240)],
    desarme: [fin, min(fin, 1440)],
    duracionMin: duracion,
    demoraMin: demora,
  };
}
