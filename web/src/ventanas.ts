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

/** Minutos desde la largada de la modalidad en que el grueso ocupa el último 25 % del recorrido:
 *  del 10 % más rápido entrando (0,75 × P10) a la llegada del 90 % (P90). Ver umbrales.json → ultimo_cuarto_tiempos */
export function ultimoCuartoMin(km: number): [number, number] {
  const t = U.ultimo_cuarto_tiempos;
  const ks = t.km;
  const interp = (serie: number[]) => {
    if (km <= ks[0]) return (serie[0] * km) / ks[0];
    if (km >= ks[ks.length - 1]) return (serie[serie.length - 1] * km) / ks[ks.length - 1];
    for (let i = 0; i < ks.length - 1; i++) {
      if (km >= ks[i] && km <= ks[i + 1]) return serie[i] + ((serie[i + 1] - serie[i]) * (km - ks[i])) / (ks[i + 1] - ks[i]);
    }
    return serie[serie.length - 1];
  };
  return [t.entrada * interp(t.p10_min), interp(t.p90_min)];
}

export type Ventanas = {
  largada: Date;
  finCarrera: Date;
  inicioUltimoCuarto: Date;
  /** Fin del último cuarto: llegada del 90 % en running (la cola sigue hasta finCarrera) */
  finUltimoCuarto: Date;
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
  // Último cuarto: en running sin duración propia, por percentiles de llegada de cada modalidad; si no, último 25 % de la duración
  let ucIni = min(largada, demora + W.ultimo_cuarto * duracion);
  let ucFin = fin;
  if (!ev.duracion_propia_min && (ev.disciplina ?? "running") === "running") {
    const mods = ev.mon_modalidades?.length ? ev.mon_modalidades : [{ distancia_km: 10, largada: null }];
    const tramos = mods.map((m) => {
      const ini = m.largada ? new Date(m.largada) : largada;
      const [a, b] = ultimoCuartoMin(Number(m.distancia_km));
      return [min(ini, demora + a), min(ini, demora + b)];
    });
    ucIni = new Date(Math.min(...tramos.map((x) => x[0].getTime())));
    ucFin = new Date(Math.max(...tramos.map((x) => x[1].getTime())));
  }
  // Inicio del día local de largada (UTC−03:00) menos los días de armado
  const local = new Date(largada.getTime() - 3 * 3600_000);
  const dia0 = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 3));
  return {
    largada,
    finCarrera: fin,
    inicioUltimoCuarto: ucIni,
    finUltimoCuarto: ucFin,
    exposicion: [min(largada, -W.exposicion_antes_min), min(fin, W.exposicion_despues_min)],
    personal: [min(largada, -W.personal_antes_min), min(fin, W.personal_despues_min)],
    armado: [new Date(dia0.getTime() - (ev.armado_dias || 3) * 86400_000), min(largada, -W.armado_hasta_antes_largada_min)],
    desarme: [fin, min(fin, W.desarme_min)],
    duracionMin: duracion,
    demoraMin: demora,
    natacion: ev.disciplina === "triatlon" && ev.natacion_min ? [min(largada, demora), min(largada, demora + ev.natacion_min)] : null,
  };
}

/** Fases del evento con las que se superpone una alerta del SMN (vacío: no toca el evento) */
export function fasesDeAlerta(a: { desde: string | null; hasta: string | null }, v: Ventanas): string[] {
  const t0 = a.desde ? new Date(a.desde).getTime() : Date.now();
  const t1 = a.hasta ? new Date(a.hasta).getTime() : Infinity;
  const toca = ([d, h]: [Date, Date]) => t1 >= d.getTime() && t0 <= h.getTime();
  return ([["Armado", v.armado], ["Día de carrera", [v.personal[0], v.personal[1]]], ["Desarme", v.desarme]] as [string, [Date, Date]][])
    .filter(([, r]) => toca(r)).map(([n]) => n);
}
