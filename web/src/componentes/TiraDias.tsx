import { Link } from "react-router-dom";
import { diaLocal, type Nivel, type Pronostico } from "../datos";
import { Icono, type TipoIcono } from "./Icono";
import { Humedad, UvDato } from "./Uv";
import { estiloNivel, estiloVariable } from "../reglas";

type Fila = Pronostico & { n: number };
const DIA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short" });
const FECHA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit" });
const horaLocal = (t: number) => new Date(t - 3 * 3600_000).getUTCHours();

/** Ícono del día: tormenta si alguna hora la sugiere; lluvia si acumula ≥ 2 mm; si no, nubosidad media diurna */
function iconoDia(ps: { t: number; p: Fila; h: number }[]): TipoIcono {
  if (ps.some(({ p }) => (p.precip ?? 0) >= 1 && (p.cape ?? 0) >= 1000)) return "tormenta";
  const mm = ps.reduce((a, { p, h }) => a + (p.precip ?? 0) * h, 0);
  if (mm >= 2) return "lluvia";
  const diurnas = ps.filter(({ t }) => horaLocal(t) >= 9 && horaLocal(t) <= 18).map(({ p }) => p.nubosidad).filter((x): x is number => x != null);
  const nub = diurnas.length ? diurnas.reduce((a, b) => a + b, 0) / diurnas.length : 0;
  return nub >= 75 ? "nube" : nub >= 30 ? "solnube" : "sol";
}

/** Tira de días del evento (armado → desarme) con ícono, temperaturas máxima y mínima, humedad y UV máximo */
export function TiraDias({ serie, uvDia, niveles, desde, hasta, largada, eventoId }: {
  serie: Map<number, Fila>; uvDia: Map<string, number>; niveles: Nivel[]; desde: Date; hasta: Date; largada: Date; eventoId: string;
}) {
  const claves: string[] = [];
  for (let t = desde.getTime(); t <= hasta.getTime() + 3600_000; t += 3600_000) {
    const d = diaLocal(new Date(t).toISOString());
    if (claves.at(-1) !== d) claves.push(d);
  }
  const entradas = [...serie.entries()];
  const pasos = new Map(entradas.map(([t], i) => [t, i === 0 ? 1 : Math.min(6, (t - entradas[i - 1][0]) / 3600_000)]));
  const diaCarrera = diaLocal(largada.toISOString());

  return (
    <section className="seccion tira-dias" aria-label="Tiempo por día del evento">
      {claves.map((d) => {
        const ps = entradas.filter(([t]) => diaLocal(new Date(t).toISOString()) === d).map(([t, p]) => ({ t, p, h: pasos.get(t) ?? 1 }));
        const temps = ps.map(({ p }) => p.t2m).filter((x): x is number => x != null);
        const hrs = ps.map(({ p }) => p.hr).filter((x): x is number => x != null);
        const mediodia = new Date(`${d}T12:00:00-03:00`);
        const carrera = d === diaCarrera;
        // Nivel operativo más alto del día (cualquier fase y variable): borde superior de la tarjeta
        const peor = niveles.filter((n) => diaLocal(n.desde) <= d && diaLocal(n.hasta) >= d).reduce<Nivel | null>((m, n) => (!m || n.nivel > m.nivel ? n : m), null);
        const colorDia = peor && peor.nivel > 0 ? String(estiloVariable(peor.variable, peor.nivel).background) : String(estiloNivel(0).background);
        const fase = d < diaCarrera ? "armado" : carrera ? "carrera" : "desarme";
        return (
          <Link key={d} to={`/evento/${eventoId}/${fase}`} className={`tira-dia${carrera ? " carrera" : ""}`} title={carrera ? "Día de carrera" : undefined}>
            {ps.length > 0 && <span className="tira-nivel" style={{ background: colorDia }} aria-hidden />}
            <span className="tira-nombre">{DIA.format(mediodia).replace(".", "")}</span>
            <span className="tira-fecha">{FECHA.format(mediodia)}</span>
            {ps.length && temps.length ? (
              <>
                <Icono tipo={iconoDia(ps)} size={46} />
                <span className="tira-temp"><b>{Math.round(Math.max(...temps))} °C</b> {Math.round(Math.min(...temps))} °C</span>
                <span className="tira-hr"><Humedad texto={hrs.length ? `${Math.round(Math.min(...hrs))}–${Math.round(Math.max(...hrs))} %` : "—"} size={15} /></span>
                <UvDato uv={uvDia.get(d)} compacto />
              </>
            ) : (
              <>
                <span className="tira-sin" aria-hidden>—</span>
                <span className="tira-temp chico">sin pronóstico</span>
              </>
            )}
          </Link>
        );
      })}
    </section>
  );
}
