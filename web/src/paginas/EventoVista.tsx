import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import type { Ctx } from "../main";
import { Barra } from "../componentes/Barra";
import { Icono, iconoTiempo, type TipoIcono } from "../componentes/Icono";
import { Accesos } from "../componentes/Accesos";
import { Introduccion } from "../componentes/Introduccion";
import { Resumen } from "../componentes/Resumen";
import {
  diaLocal, fmtDia, fmtFechaHora, fmtHora, num, supabase,
  type AlertaSMN, type Evento, type Nivel, type Pronostico,
} from "../datos";
import { estiloNivel, NOMBRE_CORTO, NOMBRE_FASE, NOMBRE_VARIABLE, NOMBRE_WA, REGLAS, TIPO_FUENTE, nombreNivel, recomendacion } from "../reglas";
import { calcular } from "../ventanas";

const PRIORIDAD = ["ecmwf", "gfs", "icon"];
const VARS = ["t2m", "td2m", "hr", "viento10", "rafaga10", "dir_viento", "precip", "cape", "radiacion", "nubosidad", "presion", "wbgt_est"] as const;
const COLOR_SMN: Record<string, string> = { amarillo: "#C79000", naranja: "#FF6A1A", rojo: "#FF3B30", violeta: "#8E5BD9" };

/** Serie horaria de consenso: fuente prioritaria por hora */
function consenso(pron: Pronostico[]): Map<number, Pronostico & { n: number }> {
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

function useSonido() {
  const ctx = useRef<AudioContext | null>(null);
  const [habilitado, setHabilitado] = useState(false);
  const [activo, setActivo] = useState(true);
  const sonar = useCallback(() => {
    if (!habilitado || !activo) return;
    try {
      ctx.current ??= new AudioContext();
      const ac = ctx.current;
      if (ac.state === "suspended") void ac.resume();
      [0, 0.28, 0.56].forEach((d) => {
        const o = ac.createOscillator(), g = ac.createGain(), s = ac.currentTime + d;
        o.type = "square"; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.12, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
        o.connect(g); g.connect(ac.destination); o.start(s); o.stop(s + 0.2);
      });
    } catch { /* sin audio */ }
  }, [habilitado, activo]);
  return { habilitado, setHabilitado, activo, setActivo, sonar };
}

export function EventoVista() {
  const { id } = useParams();
  const { editor, session } = useOutletContext<Ctx>();
  const miEmail = (session.user.email ?? "").toLowerCase();
  const [ev, setEv] = useState<Evento | null>(null);
  const [pron, setPron] = useState<Pronostico[]>([]);
  const [niveles, setNiveles] = useState<Nivel[]>([]);
  const [alertas, setAlertas] = useState<AlertaSMN[]>([]);
  const [error, setError] = useState("");
  const [descarteSonido, setDescarteSonido] = useState(false);
  const sonido = useSonido();

  const cargar = useCallback(async () => {
    if (!id) return;
    const [e, p, n, a] = await Promise.all([
      supabase.from("mon_eventos").select("*, mon_modalidades(*)").eq("id", id).single(),
      supabase.from("mon_pronosticos").select("*").eq("evento_id", id).order("valido").limit(5000),
      supabase.from("mon_niveles").select("*").eq("evento_id", id).order("desde").limit(5000),
      supabase.from("mon_alertas_smn").select("*").eq("evento_id", id).neq("estado", "levantada"),
    ]);
    if (e.error) return setError("No tenés acceso a este evento o no existe.");
    setEv(e.data as Evento);
    setPron((p.data as Pronostico[]) ?? []);
    setNiveles((n.data as Nivel[]) ?? []);
    setAlertas(((a.data as AlertaSMN[]) ?? []).filter((x) => !x.hasta || new Date(x.hasta) > new Date()));
  }, [id]);

  useEffect(() => {
    void cargar();
    if (id && miEmail) void supabase.from("mon_consultas").insert({ evento_id: id, email: miEmail }).then(() => undefined);
    const canal = supabase
      .channel(`evento-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "mon_niveles", filter: `evento_id=eq.${id}` }, () => void cargar())
      .on("postgres_changes", { event: "*", schema: "public", table: "mon_alertas_smn", filter: `evento_id=eq.${id}` }, () => void cargar())
      .subscribe();
    const t = setInterval(() => void cargar(), 5 * 60_000);
    return () => { clearInterval(t); void supabase.removeChannel(canal); };
  }, [cargar, id, miEmail]);

  // Aviso sonoro mientras haya alertas SMN vigentes
  useEffect(() => {
    if (!alertas.length) return;
    sonido.sonar();
    const t = setInterval(sonido.sonar, 30_000);
    return () => clearInterval(t);
  }, [alertas.length, sonido.sonar]);

  const v = useMemo(() => (ev ? calcular(ev) : null), [ev]);
  const serie = useMemo(() => consenso(pron), [pron]);
  const ahora = Date.now();
  const vigentes = niveles.filter((n) => new Date(n.hasta).getTime() > ahora);

  if (error) return (<><Barra titulo="Evento" /><p className="contenedor">{error}</p></>);
  if (!ev || !v) return (<><Barra titulo="Cargando…" /></>);

  const maxCarreraWbgt = Math.max(0, ...vigentes.filter((n) => n.fase === "carrera" && n.variable === "wbgt").map((n) => n.nivel));
  const faltan = v.largada.getTime() - ahora;
  const cuenta = faltan > 0 ? `faltan ${Math.floor(faltan / 86400_000)} d ${Math.floor((faltan % 86400_000) / 3600_000)} h` : "en curso o finalizado";
  const ultimaCorrida = PRIORIDAD.map((f) => pron.filter((p) => p.fuente === f).map((p) => p.corrida).sort().at(-1)).filter(Boolean);
  const procesado = pron.map((p) => p.procesado_en).sort().at(-1);

  return (
    <>
      <Barra titulo={ev.nombre} subtitulo={`${fmtFechaHora(ev.largada)} · ${cuenta}`}>
        <span className="badge" style={{ ...estiloNivel(maxCarreraWbgt) }} title="Escala WBGT World Athletics (2020), máximo previsto para la carrera">WBGT · {NOMBRE_WA[maxCarreraWbgt]}</span>
        {alertas.length > 0 && <a href="#alerta-smn" className="boton-osc alerta" style={{ background: COLOR_SMN[alertas[0].color], color: "#111", borderColor: "#fff", fontWeight: 800 }}>Alerta SMN</a>}
        {editor && <Link className="boton-osc" to={`/evento/${ev.id}/editar`}>Editar</Link>}
        <Link className="boton-osc" to="/">Eventos</Link>
      </Barra>

      {!sonido.habilitado && !descarteSonido && (
        <div style={{ background: "#fff", borderBottom: "1px solid var(--borde)" }}>
          <div className="contenedor" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", padding: "12px 24px" }}>
            <span><b>Activá el sonido de alertas</b> para escuchar un aviso cuando llegue una alerta del SMN.</span>
            <span style={{ display: "flex", gap: 8 }}>
              <button className="boton" onClick={() => setDescarteSonido(true)}>Ahora no</button>
              <button className="boton primario" onClick={() => { sonido.setHabilitado(true); sonido.setActivo(true); }}>Activar sonido</button>
            </span>
          </div>
        </div>
      )}

      {alertas.map((a) => (
        <section key={a.id} id="alerta-smn" role="alert" className="alerta" style={{ background: COLOR_SMN[a.color], scrollMarginTop: 80 }}>
          <div className="contenedor" style={{ display: "flex", flexWrap: "wrap", gap: "14px 24px", alignItems: "center", padding: "16px 24px" }}>
            <div className="icono-pulso"><Icono tipo={iconoAlerta(a.fenomeno)} size={52} /></div>
            <div style={{ flex: "1 1 300px" }}>
              <div className="condensada" style={{ fontSize: 24, fontWeight: 800, textTransform: "uppercase" }}>Alerta {a.color} SMN · {a.fenomeno}</div>
              <div style={{ fontSize: 14 }}>{a.zona ?? ""} {a.desde && `· ${fmtFechaHora(a.desde)}`} {a.hasta && `→ ${fmtFechaHora(a.hasta)}`}</div>
            </div>
            <button className="boton negro" onClick={() => (sonido.habilitado ? sonido.setActivo(!sonido.activo) : sonido.setHabilitado(true))}>
              {sonido.habilitado && sonido.activo ? "Silenciar alerta" : "Activar sonido"}
            </button>
          </div>
        </section>
      ))}

      <main className="contenedor" style={{ paddingTop: 24 }}>
        <Introduccion />
        <Resumen vigentes={vigentes} alertas={alertas} />
        <Indicadores vigentes={vigentes} ultimaCorrida={ultimaCorrida as string[]} procesado={procesado} />
        <Dias ev={ev} serie={serie} niveles={niveles} armado={v.armado} desarme={v.desarme} largada={v.largada} />
        <DiaCarrera serie={serie} v={v} />
        <Recomendaciones vigentes={vigentes} />
        <Accesos eventoId={ev.id} puedeGestionar={editor || ev.organizador_email.toLowerCase() === miEmail} miEmail={miEmail} />
        <section className="seccion tarjeta" id="fuentes">
          <div className="rotulo">Fuentes y metodología</div>
          <p className="chico" style={{ marginBottom: 0 }}>
            Modelos ECMWF IFS (CC BY 4.0) y NOAA GFS, comparados por separado; avisos oficiales del SMN. WBGT estimado hora por hora por el método de Liljegren et al. (2008).
            Escala de estrés térmico: World Athletics (2020). Cada recomendación indica su fuente y su tipo.
          </p>
        </section>
      </main>
    </>
  );
}

function iconoAlerta(f: string): TipoIcono {
  const s = f.toLowerCase();
  if (s.includes("tormenta")) return "tormenta";
  if (s.includes("lluvia")) return "lluvia";
  if (s.includes("viento")) return "viento";
  if (s.includes("calor") || s.includes("temperatura")) return "termometro";
  return "nube";
}

function Indicadores({ vigentes, ultimaCorrida, procesado }: { vigentes: Nivel[]; ultimaCorrida: string[]; procesado?: string }) {
  const max = (filtro: (n: Nivel) => boolean) => vigentes.filter(filtro).reduce<Nivel | null>((a, n) => (!a || n.nivel > a.nivel ? n : a), null);
  const tiles: { label: string; icono: TipoIcono; n: Nivel | null }[] = [
    { label: "Estrés térmico · carrera", icono: "termometro", n: max((n) => n.variable === "wbgt") },
    { label: "Viento · estructuras", icono: "viento", n: max((n) => n.variable.startsWith("viento_")) },
    { label: "Tormenta", icono: "tormenta", n: max((n) => n.variable === "tormenta") },
    { label: "Lluvia y suelo", icono: "lluvia", n: max((n) => n.variable === "lluvia") },
    { label: "Calor del personal", icono: "estructura", n: max((n) => n.variable === "calor_personal") },
  ];
  return (
    <section className="grilla" aria-label="Estado actual" style={{ marginTop: 24 }}>
      {tiles.map((t) => (
        <div key={t.label} className="tarjeta" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="rotulo">{t.label}</span>
            <Icono tipo={t.icono} size={36} />
          </div>
          <span className="badge" style={{ ...estiloNivel(t.n?.nivel ?? 0), alignSelf: "flex-start" }}>
            {t.n ? nombreNivel(t.n.variable, t.n.nivel) : "Sin datos"}
          </span>
          {t.n && t.n.nivel > 0 && <span className="chico">{NOMBRE_FASE[t.n.fase]} · {fmtFechaHora(t.n.desde)}</span>}
        </div>
      ))}
      <div className="tarjeta">
        <div className="rotulo">Datos vigentes</div>
        <div className="chico" style={{ marginTop: 8, lineHeight: 1.6 }}>
          {ultimaCorrida.length ? ultimaCorrida.map((c) => <div key={c}>Corrida {fmtFechaHora(c)}</div>) : "Esperando la primera corrida"}
          {procesado && <div>Procesado {fmtFechaHora(procesado)}</div>}
          <div style={{ color: "#1F6B33" }}>● Se actualiza sola</div>
        </div>
      </div>
    </section>
  );
}

function Dias({ ev, serie, niveles, armado, desarme, largada }: {
  ev: Evento; serie: Map<number, Pronostico & { n: number }>; niveles: Nivel[];
  armado: [Date, Date]; desarme: [Date, Date]; largada: Date;
}) {
  const dias = new Map<string, (Pronostico & { n: number })[]>();
  // Horas que representa cada paso (1 h o 3 h según modelo y plazo), para acumular lluvia
  const horasPaso = new Map<number, number>();
  let previo: number | null = null;
  for (const [t, p] of serie) {
    horasPaso.set(t, previo == null ? (p.fuente === "ecmwf" ? 3 : 1) : Math.min(6, (t - previo) / 3600_000));
    previo = t;
    if (t < armado[0].getTime() || t > desarme[1].getTime()) continue;
    const d = diaLocal(new Date(t).toISOString());
    dias.set(d, [...(dias.get(d) ?? []), p]);
  }
  const diaCarrera = diaLocal(largada.toISOString());
  const lejano = (iso: string) => new Date(iso).getTime() - Date.now() > 6 * 86400_000;
  return (
    <section className="seccion" aria-labelledby="dias-t">
      <h2 id="dias-t">Evolución por día</h2>
      {dias.size === 0 && <div className="tarjeta">Todavía no hay pronóstico procesado para este evento. El sistema lo completa con la próxima corrida de los modelos.</div>}
      <div className="grilla">
        {[...dias.entries()].map(([d, ps]) => {
          const t = ps.map((p) => p.t2m).filter((x): x is number => x != null);
          const raf = Math.max(...ps.map((p) => p.rafaga10 ?? 0));
          const lluvia = ps.reduce((a, p) => a + (p.precip ?? 0) * (horasPaso.get(new Date(p.valido).getTime()) ?? 1), 0);
          const delDia = niveles.filter((n) => diaLocal(n.desde) <= d && diaLocal(n.hasta) >= d);
          const peorDia = delDia.reduce<Nivel | null>((m, n) => (!m || n.nivel > m.nivel ? n : m), null);
          const nivelDia = peorDia?.nivel ?? 0;
          const fase = d === diaCarrera ? "Carrera" : d < diaCarrera ? "Armado" : "Desarme";
          const media = ps[Math.floor(ps.length / 2)];
          const peor = ps.reduce((a, p) => ((p.precip ?? 0) > (a.precip ?? 0) ? p : a), media);
          return (
            <article key={d} className="tarjeta" style={{ display: "flex", flexDirection: "column", gap: 8, ...(d === diaCarrera ? { border: "2px solid #111", boxShadow: "0 0 0 4px #FF6A1A" } : {}) }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="condensada" style={{ fontSize: 20, fontWeight: 800, textTransform: "uppercase" }}>{fmtDia(ps[0].valido)}</span>
                <span className="chico" style={{ fontWeight: 700 }}>{fase}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Icono tipo={iconoTiempo(peor)} size={60} />
                <div style={{ textAlign: "right", lineHeight: 1 }}>
                  <div className="condensada" style={{ fontSize: 32, fontWeight: 800 }}>{num(Math.max(...t))}°</div>
                  <div className="condensada" style={{ fontSize: 22, color: "#6A6A6A" }}>{num(Math.min(...t))}°</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}><Icono tipo="viento" size={20} />ráf. {num(raf)} km/h</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}><Icono tipo="gota" size={20} />{num(lluvia, 1)} mm</div>
              <span className="badge" style={{ ...estiloNivel(nivelDia), alignSelf: "flex-start", fontSize: 13 }}>{peorDia && nivelDia > 0 ? nombreNivel(peorDia.variable, nivelDia) : "Bajo umbral"}</span>
              {peorDia && nivelDia > 0 && <span className="chico" style={{ marginTop: -4 }}>{NOMBRE_CORTO[peorDia.variable]}</span>}
              {lejano(ps[0].valido) && <span className="chico">Tendencia · confianza baja</span>}
            </article>
          );
        })}
      </div>
      <p className="chico">{ev.ubicacion} · armado desde {fmtFechaHora(armado[0].toISOString())}</p>
    </section>
  );
}

function DiaCarrera({ serie, v }: { serie: Map<number, Pronostico & { n: number }>; v: ReturnType<typeof calcular> }) {
  const [ini, fin] = v.exposicion;
  const horas = [...serie.entries()].filter(([t]) => t >= ini.getTime() - 3600_000 && t <= fin.getTime() + 3600_000);
  const uc = (t: number) => t >= v.inicioUltimoCuarto.getTime() && t <= v.finCarrera.getTime() + 3600_000;
  const fase = (t: number) =>
    t < v.largada.getTime() ? "Convocatoria" : t <= v.inicioUltimoCuarto.getTime() ? "Carrera" : t <= v.finCarrera.getTime() + 3600_000 ? "Último cuarto" : "Desconcentración";
  const nivelWA = (w: number | null) => (w == null ? 0 : w >= 30 ? 4 : w >= 28 ? 3 : w >= 25 ? 2 : w >= 21 ? 1 : 0);
  return (
    <section className="seccion" style={{ background: "#fff", border: "1px solid var(--borde)", borderRadius: 10 }}>
      <div className="banda" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
        <h2>Día de carrera · {fmtDia(v.largada.toISOString())}</h2>
        <span className="chico" style={{ color: "#cfcfcf" }}>Duración estimada {Math.floor(v.duracionMin / 60)} h {Math.round(v.duracionMin % 60)} min · demora de largada {Math.round(v.demoraMin)} min</span>
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="grilla" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <div><div className="rotulo">Exposición del corredor</div><b>{fmtHora(ini.toISOString())} → {fmtHora(fin.toISOString())}</b></div>
          <div><div className="rotulo">Carrera</div><b>{fmtHora(v.largada.toISOString())} → {fmtHora(v.finCarrera.toISOString())}</b></div>
          <div><div className="rotulo">Último cuarto · zona crítica</div><b>{fmtHora(v.inicioUltimoCuarto.toISOString())} → {fmtHora(v.finCarrera.toISOString())}</b></div>
          <div><div className="rotulo">Jornada del personal</div><b>{fmtHora(v.personal[0].toISOString())} → {fmtHora(v.personal[1].toISOString())}</b></div>
        </div>
        {horas.length === 0 ? (
          <p className="chico">El pronóstico horario del día de carrera aparece cuando la largada entra en el horizonte de los modelos (6 días).</p>
        ) : (
          <div className="desplaza">
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${horas.length}, minmax(104px, 1fr))`, gap: 8, minWidth: horas.length * 112 }}>
              {horas.map(([t, p]) => {
                const n = nivelWA(p.wbgt_est);
                const noche = (p.radiacion ?? 0) < 5;
                return (
                  <div key={t} style={{ borderRadius: 10, padding: "12px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center", background: uc(t) ? "#FFF4EC" : "#F4F3F1", border: `2px solid ${uc(t) ? "#FF6A1A" : "transparent"}` }}>
                    <b className="condensada" style={{ fontSize: 22 }}>{fmtHora(p.valido)}</b>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#4A4A4A" }}>{fase(t)}</span>
                    <Icono tipo={iconoTiempo(p, noche)} size={48} />
                    <b className="condensada" style={{ fontSize: 24 }}>{num(p.t2m)}°</b>
                    <span style={{ alignSelf: "stretch", ...estiloNivel(n), fontWeight: 700, fontSize: 14, padding: "4px 6px", borderRadius: 4 }}>WBGT {num(p.wbgt_est, 1)}°</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                      <span style={{ display: "inline-block", transform: `rotate(${(p.dir_viento ?? 0) + 180}deg)` }}>↑</span> {num(p.viento10)}/{num(p.rafaga10)}
                    </span>
                    <span className="chico">HR {num(p.hr)} %</span>
                    <span className="chico">{num(p.precip, 1)} mm/h</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 4, fontSize: 13 }}>
          {["< 21 °C", "21–25 °C", "25–28 °C", "28–30 °C", "> 30 °C"].map((r, i) => (
            <div key={r} style={{ ...estiloNivel(i), padding: 8, borderRadius: i === 0 ? "6px 0 0 6px" : i === 4 ? "0 6px 6px 0" : 0 }}>
              <b>{NOMBRE_WA[i]}</b><br />{r}
            </div>
          ))}
        </div>
        <span className="chico">Escala WBGT World Athletics (2020); «Riesgo bajo» corresponde a «Almost Safe» · viento medio / ráfaga en km/h a 10 m</span>
      </div>
    </section>
  );
}

function Recomendaciones({ vigentes }: { vigentes: Nivel[] }) {
  const grupos = new Map<string, Nivel>();
  for (const n of vigentes.filter((x) => x.nivel > 0)) {
    const k = `${n.fase}|${n.variable}|${n.nivel}`;
    const prev = grupos.get(k);
    if (!prev || n.desde < prev.desde) grupos.set(k, n);
  }
  const lista = [...grupos.values()].sort((a, b) => b.nivel - a.nivel || a.desde.localeCompare(b.desde));
  return (
    <section className="seccion" id="recomendaciones" style={{ scrollMarginTop: 90 }}>
      <h2>Recomendaciones EMERTEAM</h2>
      {lista.length === 0 && <div className="tarjeta">Sin recomendaciones activas para el horizonte de pronóstico.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,460px),1fr))", gap: 12 }}>
        {lista.map((n) => {
          const r = REGLAS[n.regla];
          const texto = recomendacion(n.variable, n.nivel, n.fase);
          return (
            <article key={`${n.fase}${n.variable}${n.nivel}`} className="tarjeta" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <span className="badge" style={{ ...estiloNivel(n.nivel) }}>{nombreNivel(n.variable, n.nivel)}</span>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", border: "1px solid #111", padding: "2px 7px", borderRadius: 4 }}>{NOMBRE_FASE[n.fase]}</span>
                {n.confianza && <span className="chico">confianza {n.confianza}</span>}
              </div>
              <h3 style={{ margin: 0, fontFamily: "Barlow", fontSize: 18 }}>{NOMBRE_VARIABLE[n.variable] ?? n.variable}</h3>
              <div className="chico">Desde {fmtFechaHora(n.desde)} · valor {num(n.valor, 1)}{n.umbral != null && ` · umbral ${num(n.umbral, 1)}`}</div>
              {texto && <p style={{ margin: 0, lineHeight: 1.5 }}>{texto}</p>}
              {r && (
                <details style={{ borderTop: "1px solid var(--borde)", paddingTop: 8 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>Fuente · {TIPO_FUENTE[r.tipo]}</summary>
                  <p className="chico" style={{ margin: "8px 0 0" }}>{r.fuente}</p>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
