import { useEffect, useMemo, useState } from "react";
import { diaLocal, fmtHora, num, supabase, type Evento } from "../datos";
import { escalaCalor, estiloCalor } from "../disciplinas";
import { nombreNivel, NOMBRE_VARIABLE } from "../reglas";
import type { Ventanas } from "../ventanas";
import U from "../../../config/umbrales.json";

/** Fila de mon_ens_prob (probabilidad de alcanzar un nivel con el máximo de la ventana) */
type Prob = {
  corrida: string; modelo: string; variable: string; nivel: number; ventana: string;
  ventana_desde: string; ventana_hasta: string; umbral: number | null; prob: number;
  p10: number | null; p50: number | null; p90: number | null; miembros: number; anticipacion_h: number;
  corridas: Record<string, string> | null; aproximacion: string | null;
};
type Hora = { valido: string; variable: string; p10: number | null; p50: number | null; p90: number | null; probs: Record<string, number> | null; miembros: number };

/** Probabilidad en múltiplos de 10 %, sin decimales; los extremos se marcan como cota */
export function fmtProb(p: number): string {
  const r = Math.round(p * 10) * 10;
  if (r <= 0) return "< 10\u00a0%";
  if (r >= 100) return "> 90\u00a0%";
  return `${r}\u00a0%`;
}
/** Categoría de lectura: menos de 10 %, 10–30 %, 30–60 %, más de 60 % */
function categoria(p: number): number {
  return p < 0.1 ? 0 : p < 0.3 ? 1 : p < 0.6 ? 2 : 3;
}
const ALFA = [0, 0.22, 0.5, 0.85];
const OSCUROS = new Set(["#7A1610", "#1D1D1B", "#111111", "#2F6FD6"]);

/** Corrida en hora UTC (como la publican los centros): "mié 21-10 00 UTC" */
const corridaTxt = (iso: string) => {
  const d = new Date(iso);
  const dia = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" }).format(d);
  return `${dia} ${String(d.getUTCHours()).padStart(2, "0")} UTC`;
};
function etiquetaD(corrida: string, largada: string): string {
  // Día de la corrida en UTC (como se rotula la corrida) contra el día local de la largada
  const d = Math.round((Date.parse(diaLocal(largada)) - Date.parse(new Date(corrida).toISOString().slice(0, 10))) / 86400_000);
  return d > 0 ? `D-${d}` : d === 0 ? "Día D" : `D+${-d}`;
}
const nombreVentana = (v: string, quien: string) =>
  v === "carrera" ? `Exposición de los ${quien}` : v.startsWith("ultimo_cuarto") ? `Último cuarto${v.includes(":") ? ` · ${v.split(":")[1]}` : ""}` : v === "armado" ? "Armado" : v === "desarme" ? "Desarme" : v;

type Disparo = { accion: "preparar" | "activar"; ventana: string; variable: string; nivel: number; prob: number; dias: number; fila: Prob };
type ReglaDisparo = { hasta_dias: number; prob: number };
const DISP = U.ens_disparadores as { preparar: ReglaDisparo; activar: ReglaDisparo; histeresis: { margen: number }; por_variable: Record<string, { preparar?: ReglaDisparo; activar?: ReglaDisparo }> };

/** Días entre la corrida (fecha UTC) y el día local de la largada */
function diasA(corrida: string, largada: string): number {
  return Math.round((Date.parse(diaLocal(largada)) - Date.parse(new Date(corrida).toISOString().slice(0, 10))) / 86400_000);
}

/**
 * Disparadores de acción (criterio interno EMERTEAM): «Preparar» desde D-3 con 30 % o más y «Activar» desde D-1 con 60 % o más.
 * Histéresis: supera el valor por 10 puntos o lo sostiene en la emisión anterior. El día de la carrera no dispara.
 */
export function disparos(filas: Prob[], largada: string): Disparo[] {
  const corridas = [...new Set(filas.map((f) => f.corrida))].sort().reverse();
  const [c0, c1] = corridas;
  if (!c0) return [];
  const dias = diasA(c0, largada);
  if (dias < 1) return [];
  const previa = (f: Prob) => filas.find((x) => x.corrida === c1 && x.ventana === f.ventana && x.variable === f.variable && x.nivel === f.nivel)?.prob;
  const grupos = new Map<string, Prob[]>();
  for (const f of filas.filter((x) => x.corrida === c0 && Date.parse(x.ventana_hasta) > Date.now())) {
    const k = `${f.ventana}|${f.variable}`;
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  const salida: Disparo[] = [];
  for (const [k, fs] of grupos) {
    const [ventana, variable] = k.split("|");
    const propio = DISP.por_variable[`${variable}|${ventana.split(":")[0]}`] ?? DISP.por_variable[variable] ?? {};
    for (const accion of ["activar", "preparar"] as const) {
      const r = propio[accion] ?? DISP[accion];
      if (dias > r.hasta_dias) continue;
      const cumple = fs.filter((f) => f.prob >= r.prob + DISP.histeresis.margen || (f.prob >= r.prob && (previa(f) ?? -1) >= r.prob))
        .sort((a, b) => b.nivel - a.nivel)[0];
      if (cumple) { salida.push({ accion, ventana, variable, nivel: cumple.nivel, prob: cumple.prob, dias, fila: cumple }); break; }
    }
  }
  return salida.sort((a, b) => (a.accion === b.accion ? b.nivel - a.nivel : a.accion === "activar" ? -1 : 1));
}

function umbralTxt(variable: string, u: number): string {
  if (variable.startsWith("viento_")) return `${num(u)} km/h de ráfaga`;
  if (variable === "tormenta") return `CAPE ${num(u)} J/kg con precipitación`;
  if (variable === "lluvia") return `${num(u)} mm en 3 h`;
  return `${num(u, 1)} °C de WBGT`;
}

function Celda({ p, color }: { p: number; color: string }) {
  const c = categoria(p);
  return (
    <td className="pr-celda" style={{ background: c ? `color-mix(in srgb, ${color} ${Math.round(ALFA[c] * 100)}%, transparent)` : undefined,
      color: c >= 2 ? (OSCUROS.has(color) ? "#FFFFFF" : "#111111") : undefined }}
      title={`${Math.round(p * 100)} % de los escenarios (cada modelo pesa la mitad)`}>
      {fmtProb(p)}
    </td>
  );
}

/**
 * Pronóstico probabilístico por umbral (ensambles ECMWF ENS y NOAA GEFS).
 * fase = carrera: curva de calor con banda P10–P90 y tablas de calor, viento, tormenta y lluvia.
 * fase = armado | desarme: tabla de viento por categoría, tormenta y lluvia de esa ventana.
 */
export function Probabilistico({ ev, v, fase, quien }: { ev: Evento; v: Ventanas; fase: "carrera" | "armado" | "desarme"; quien: string }) {
  const [filas, setFilas] = useState<Prob[] | null>(null);
  const [horas, setHoras] = useState<Hora[]>([]);
  const escala = escalaCalor(ev.disciplina);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const { data } = await supabase.from("mon_ens_prob").select("*").eq("evento_id", ev.id).eq("modelo", "mezcla")
        .order("corrida", { ascending: false }).limit(3000);
      const lista = (data as Prob[]) ?? [];
      if (!vivo) return;
      setFilas(lista);
      const ultima = lista[0]?.corrida;
      if (ultima && fase === "carrera") {
        const { data: hs } = await supabase.from("mon_ens_horas").select("valido,variable,p10,p50,p90,probs,miembros")
          .eq("evento_id", ev.id).eq("modelo", "mezcla").eq("corrida", ultima).eq("variable", escala.variable).order("valido").limit(500);
        if (vivo) setHoras((hs as Hora[]) ?? []);
      }
    })();
    return () => { vivo = false; };
  }, [ev.id, fase, escala.variable]);

  const ultima = filas?.[0]?.corrida;
  const actuales = useMemo(() => (filas ?? []).filter((f) => f.corrida === ultima), [filas, ultima]);
  if (!filas) return null;
  if (!ultima) {
    return (
      <section className="seccion pr">
        <h2>Probabilidad por umbral</h2>
        <div className="tarjeta chico">Todavía no hay emisiones del ensamble para este evento. Aparecen cuando la ventana entra en el horizonte de 6 días.</div>
      </section>
    );
  }
  const muestra = actuales[0];
  const corridas = muestra?.corridas ?? {};
  const ventanasFase = fase === "carrera"
    ? [...new Set(actuales.filter((f) => f.ventana === "carrera" || f.ventana.startsWith("ultimo_cuarto")).map((f) => f.ventana))]
        .sort((a, b) => (a === "carrera" ? -1 : b === "carrera" ? 1 : a.localeCompare(b)))
    : [fase];
  const de = (ventana: string, variable: string, nivel: number) => actuales.find((f) => f.ventana === ventana && f.variable === variable && f.nivel === nivel);
  const aprox = [...new Set(actuales.filter((f) => ventanasFase.includes(f.ventana) && f.aproximacion).map((f) => f.aproximacion!))];
  const tormentaLejos = actuales.some((f) => ventanasFase.includes(f.ventana) && f.variable === "tormenta" && f.anticipacion_h > 48);

  return (
    <section className="seccion pr" aria-labelledby={`pr-${fase}`}>
      <h2 id={`pr-${fase}`}>Probabilidad por umbral</h2>
      <div className="tarjeta pr-cuerpo">
        <p className="chico pr-meta">
          Emisión {etiquetaD(ultima, ev.largada)} · {Object.entries(corridas).map(([m, c]) => `${m === "ecmwf" ? "ECMWF ENS" : "NOAA GEFS"} ${corridaTxt(c)}`).join(" · ")} · calculado sobre {muestra?.miembros} escenarios de ECMWF y NOAA (cada modelo pesa la mitad).
          Es la probabilidad de alcanzar cada nivel con el valor máximo de la ventana: la proporción de escenarios que lo alcanzan. No reemplaza al pronóstico de las tarjetas ni a las mediciones.
        </p>

        {(() => {
          const ds = disparos(filas, ev.largada).filter((d) => fase === "carrera" ? (d.ventana === "carrera" || d.ventana.startsWith("ultimo_cuarto")) : d.ventana === fase);
          const dias = diasA(ultima, ev.largada);
          return (
            <div className="pr-disparos">
              <div className="rotulo">Disparadores · criterio interno EMERTEAM</div>
              {ds.length ? ds.map((d) => (
                <div key={`${d.ventana}${d.variable}`} className={`pr-disparo ${d.accion}`}>
                  <b>{d.accion === "activar" ? "Activar" : "Preparar"}</b>
                  <span>{NOMBRE_VARIABLE[d.variable] ?? d.variable} · {nombreNivel(d.variable, d.nivel)} · {nombreVentana(d.ventana, quien)}: probabilidad {fmtProb(d.prob)}{d.fila.umbral != null ? ` de alcanzar ${umbralTxt(d.variable, d.fila.umbral)}` : ""} (emisión {etiquetaD(d.fila.corrida, ev.largada)}, {d.fila.miembros} escenarios).</span>
                </div>
              )) : <p className="chico" style={{ margin: 0 }}>{dias > DISP.preparar.hasta_dias ? `Sin disparadores: se evalúan desde D-${DISP.preparar.hasta_dias}.` : dias < 1 ? "El día de la carrera mandan el pronóstico corregido y las mediciones." : "Ninguna probabilidad alcanza los disparadores."}</p>}
              <p className="chico" style={{ margin: 0 }}>«Preparar» desde D-{DISP.preparar.hasta_dias} con {Math.round(DISP.preparar.prob * 100)} % o más; «Activar» desde D-{DISP.activar.hasta_dias} con {Math.round(DISP.activar.prob * 100)} % o más. Cuenta si supera el valor por {Math.round(DISP.histeresis.margen * 100)} puntos o si lo sostiene en dos emisiones seguidas. Las alertas del SMN tienen prioridad.</p>
            </div>
          );
        })()}

        {fase === "carrera" && horas.length > 1 && <Curva horas={horas} escala={escala} v={v} />}

        {fase === "carrera" && (
          <div className="desplaza">
            <table className="tabla pr-tabla">
              <caption className="rotulo">Calor · {escala.autor}: probabilidad de alcanzar el nivel</caption>
              <thead><tr><th>Nivel</th>{ventanasFase.map((w) => <th key={w}>{nombreVentana(w, quien)}</th>)}</tr></thead>
              <tbody>
                {escala.niveles.slice(1).map((nombre, i) => {
                  const n = i + 1;
                  const fila0 = de("carrera", escala.variable, n);
                  return (
                    <tr key={nombre}>
                      <th><span className="badge" style={estiloCalor(escala.variable, n)}>{nombre}</span>{fila0?.umbral != null && <span className="chico"> desde {num(fila0.umbral, 1)} °C</span>}</th>
                      {ventanasFase.map((w) => { const f = de(w, escala.variable, n); return f ? <Celda key={w} p={f.prob} color={escala.fondo[n] === "#FFFFFF" ? "#7C7C7C" : escala.fondo[n]} /> : <td key={w}>—</td>; })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="chico" style={{ margin: "6px 0 0" }}>
              WBGT máximo en la exposición: P10 {num(de("carrera", escala.variable, 1)?.p10, 1)} · mediana {num(de("carrera", escala.variable, 1)?.p50, 1)} · P90 {num(de("carrera", escala.variable, 1)?.p90, 1)} °C.
            </p>
          </div>
        )}

        <TablaViento actuales={actuales} ventana={fase === "carrera" ? "carrera" : fase} tormentaLejos={tormentaLejos} />

        <Evolucion filas={filas} ventana={fase === "carrera" ? "carrera" : fase} variable={fase === "carrera" ? escala.variable : "viento_B"}
          niveles={fase === "carrera" ? escala.niveles.slice(1).map((nm, i) => [i + 1, nm] as [number, string]) : [1, 2, 3, 4].map((n) => [n, nombreNivel("viento_B", n)] as [number, string])}
          titulo={fase === "carrera" ? `Evolución entre emisiones · calor en la exposición` : `Evolución entre emisiones · ${NOMBRE_VARIABLE.viento_B}`} largada={ev.largada} />

        <div className="chico pr-notas">
          <p>Lectura: menos de 10 %, 10–30 %, 30–60 % y más de 60 %. Con 50 escenarios de ECMWF y 31 de NOAA la resolución real es de pocos puntos: se muestran múltiplos de 10 %. La corrección de sesgo desplaza la distribución pero no calibra su dispersión; los valores cercanos a 0 % y 100 % se leen con cautela.</p>
          {aprox.map((a) => <p key={a}>{a}</p>)}
          <p>Fuentes: ECMWF Ensemble open data (CC BY 4.0) y NOAA GEFS 0,25° (dominio público). Probabilidades calculadas por EMERTEAM; NOAA y ECMWF no avalan este servicio.</p>
        </div>
      </div>
    </section>
  );
}

function TablaViento({ actuales, ventana, tormentaLejos }: { actuales: Prob[]; ventana: string; tormentaLejos: boolean }) {
  const de = (variable: string, nivel: number) => actuales.find((f) => f.ventana === ventana && f.variable === variable && f.nivel === nivel);
  if (!actuales.some((f) => f.ventana === ventana && (f.variable.startsWith("viento_") || f.variable === "tormenta"))) return null;
  const color = ["", "#C79000", "#FF6A1A", "#FF3B30", "#7A1610"];
  return (
    <div className="desplaza">
      <table className="tabla pr-tabla">
        <caption className="rotulo">Viento, tormenta y lluvia: probabilidad de alcanzar el nivel</caption>
        <thead><tr><th>Variable</th>{[1, 2, 3, 4].map((n) => <th key={n}>Nivel {n}</th>)}<th>Máximo (P10 · P50 · P90)</th></tr></thead>
        <tbody>
          {(["A", "B", "C"] as const).map((cat) => {
            const variable = `viento_${cat}`;
            const f1 = de(variable, 1);
            return (
              <tr key={cat}>
                <th>{NOMBRE_VARIABLE[variable]}</th>
                {[1, 2, 3, 4].map((n) => { const f = de(variable, n); return f ? <Celda key={n} p={f.prob} color={color[n]} /> : <td key={n}>—</td>; })}
                <td className="chico">{f1 ? `${num(f1.p10)} · ${num(f1.p50)} · ${num(f1.p90)} km/h` : "—"}</td>
              </tr>
            );
          })}
          <tr>
            <th>{NOMBRE_VARIABLE.tormenta}{tormentaLejos && <span className="chico"> · tendencia</span>}</th>
            {[1, 2].map((n) => { const f = de("tormenta", n); return f ? <Celda key={n} p={f.prob} color={color[n + 1]} /> : <td key={n}>—</td>; })}
            <td>—</td><td>—</td>
            <td className="chico">{de("tormenta", 1) ? `CAPE ${num(de("tormenta", 1)!.p10)} · ${num(de("tormenta", 1)!.p50)} · ${num(de("tormenta", 1)!.p90)} J/kg` : "—"}</td>
          </tr>
          <tr>
            <th>{NOMBRE_VARIABLE.lluvia} · intensa (proxy)</th>
            <td>—</td>
            {(() => { const f = de("lluvia", 2); return f ? <Celda p={f.prob} color={color[2]} /> : <td>—</td>; })()}
            <td>—</td><td>—</td>
            <td className="chico">{de("lluvia", 2) ? `${num(de("lluvia", 2)!.p10, 1)} · ${num(de("lluvia", 2)!.p50, 1)} · ${num(de("lluvia", 2)!.p90, 1)} mm en 3 h` : "—"}</td>
          </tr>
        </tbody>
      </table>
      <p className="chico" style={{ margin: "6px 0 0" }}>
        Niveles de viento por ráfaga: {(["A", "B", "C"] as const).map((c) => `${c} ${[1, 2, 3, 4].map((n) => num(de(`viento_${c}`, n)?.umbral)).join("/")}`).join(" · ")} km/h ({[1, 2, 3, 4].map((n) => nombreNivel("viento_B", n)).join(", ")}).
        Tormenta: nivel 1 posible, nivel 2 probable.
      </p>
    </div>
  );
}

function Evolucion({ filas, ventana, variable, niveles, titulo, largada }: {
  filas: Prob[]; ventana: string; variable: string; niveles: [number, string][]; titulo: string; largada: string;
}) {
  const emisiones = [...new Set(filas.filter((f) => f.ventana === ventana && f.variable === variable).map((f) => f.corrida))].sort().slice(-6);
  if (emisiones.length < 2) return null;
  const de = (c: string, n: number) => filas.find((f) => f.corrida === c && f.ventana === ventana && f.variable === variable && f.nivel === n);
  return (
    <div className="desplaza">
      <table className="tabla pr-tabla">
        <caption className="rotulo">{titulo}</caption>
        <thead><tr><th>Nivel</th>{emisiones.map((c) => <th key={c}>{etiquetaD(c, largada)}<span className="chico" style={{ display: "block", fontWeight: 400 }}>{corridaTxt(c)}</span></th>)}</tr></thead>
        <tbody>
          {niveles.map(([n, nombre]) => (
            <tr key={n}>
              <th>{nombre}</th>
              {emisiones.map((c) => { const f = de(c, n); return f ? <Celda key={c} p={f.prob} color="#FF6A1A" /> : <td key={c}>—</td>; })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Curva horaria de la variable de calor: banda P10–P90, mediana y umbrales de la escala */
function Curva({ horas, escala, v }: { horas: Hora[]; escala: ReturnType<typeof escalaCalor>; v: Ventanas }) {
  const W = 760, H = 240, ml = 44, mr = 170, mt = 14, mb = 30;
  const xs = horas.map((h) => Date.parse(h.valido));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const vals = horas.flatMap((h) => [h.p10, h.p90].filter((x): x is number => x != null));
  const cortes = escala.cortes;
  const sup = cortes.find((c) => c > Math.max(...vals)) ?? Math.max(...vals);
  const y0 = Math.floor(Math.min(...vals) - 1), y1 = Math.ceil(Math.max(sup, ...vals) + 1);
  const X = (t: number) => ml + ((t - x0) / Math.max(1, x1 - x0)) * (W - ml - mr);
  const Y = (y: number) => mt + (1 - (y - y0) / (y1 - y0)) * (H - mt - mb);
  const banda = horas.filter((h) => h.p10 != null && h.p90 != null);
  const d = banda.map((h, i) => `${i ? "L" : "M"}${X(Date.parse(h.valido)).toFixed(1)},${Y(h.p90!).toFixed(1)}`).join(" ")
    + " " + [...banda].reverse().map((h) => `L${X(Date.parse(h.valido)).toFixed(1)},${Y(h.p10!).toFixed(1)}`).join(" ") + " Z";
  const med = horas.filter((h) => h.p50 != null).map((h, i) => `${i ? "L" : "M"}${X(Date.parse(h.valido)).toFixed(1)},${Y(h.p50!).toFixed(1)}`).join(" ");
  const sombra = (a: Date, b: Date, color: string) => {
    const xa = Math.max(ml, X(a.getTime())), xb = Math.min(W - mr, X(b.getTime()));
    return xb > xa ? <rect x={xa} y={mt} width={xb - xa} height={H - mt - mb} fill={color} /> : null;
  };
  const marcas = horas.filter((h) => new Date(h.valido).getUTCHours() % 2 === 0);
  return (
    <figure className="pr-curva">
      <figcaption className="rotulo">WBGT hora por hora · mediana y banda P10–P90 del ensamble</figcaption>
      <div className="desplaza"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="WBGT del ensamble: mediana y banda del 10 al 90 por ciento, con los umbrales de la escala">
        {sombra(v.exposicion[0], v.exposicion[1], "var(--superficie2)")}
        {sombra(v.inicioUltimoCuarto, v.finUltimoCuarto, "color-mix(in srgb, #FF6A1A 18%, transparent)")}
        {cortes.map((c, i) => c >= y0 && c <= y1 && (
          <g key={c}>
            <line x1={ml} x2={W - mr} y1={Y(c)} y2={Y(c)} stroke={escala.fondo[i + 1] === "#FFFFFF" ? "#7C7C7C" : escala.fondo[i + 1]} strokeWidth={2} strokeDasharray="6 4" />
            <text x={W - mr + 6} y={Y(c) + 4} fontSize={12} fill="var(--texto2)">{num(c, 1)} °C · {escala.niveles[i + 1]}</text>
          </g>
        ))}
        <path d={d} fill="color-mix(in srgb, #FF6A1A 28%, transparent)" stroke="none" />
        <path d={med} fill="none" stroke="var(--texto)" strokeWidth={2.5} />
        {[y0, Math.round((y0 + y1) / 2), y1].map((y) => <text key={y} x={ml - 6} y={Y(y) + 4} fontSize={12} textAnchor="end" fill="var(--texto2)">{y}</text>)}
        {marcas.map((h) => <text key={h.valido} x={X(Date.parse(h.valido))} y={H - 10} fontSize={12} textAnchor="middle" fill="var(--texto2)">{fmtHora(h.valido)}</text>)}
        <line x1={X(v.largada.getTime())} x2={X(v.largada.getTime())} y1={mt} y2={H - mb} stroke="var(--texto)" strokeDasharray="3 3" />
      </svg></div>
      <span className="chico">Gris: exposición. Naranja claro: último cuarto. Línea punteada vertical: largada. °C.</span>
    </figure>
  );
}
