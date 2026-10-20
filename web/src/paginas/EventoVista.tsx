import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useOutletContext, useParams, useLocation } from "react-router-dom";
import type { Ctx } from "../main";
import { Barra } from "../componentes/Barra";
import { Icono, iconoTiempo, type TipoIcono } from "../componentes/Icono";
import { Accesos } from "../componentes/Accesos";
import { Comunicacion } from "../componentes/Comunicacion";
import { TiraDias } from "../componentes/TiraDias";
import { Guia } from "../componentes/Guia";
import { armarComunicado } from "../comunicacion";
import { Introduccion } from "../componentes/Introduccion";
import { Resumen } from "../componentes/Resumen";
import { Mediciones } from "../componentes/Mediciones";
import { consenso, FUENTE_UV, PRIORIDAD, uvMaxPorDia } from "../serie";
import { Humedad, UvChip } from "../componentes/Uv";
import {
  COLOR_SMN, estadoRayosGLM, ordenarAlertas, tituloAlerta, diaLocal, fmtDia, fmtFechaHora, fmtHora, num, supabase,
  type AlertaSMN, type Evento, type Rayo, type Nivel, type Pronostico, type Sesgo, type Uv,
} from "../datos";
import { estiloNivel, estiloVariable, estiloWA, NOMBRE_CORTO, NOMBRE_FASE, NOMBRE_VARIABLE, NOMBRE_WA, REGLAS, TIPO_FUENTE, nombreNivel, recomendacion } from "../reglas";
import { calcular } from "../ventanas";


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
  const { id, pestana } = useParams();
  const { admin, editor, session } = useOutletContext<Ctx>();
  const miEmail = (session.user.email ?? "").toLowerCase();
  const [ev, setEv] = useState<Evento | null>(null);
  const [pron, setPron] = useState<Pronostico[]>([]);
  const [niveles, setNiveles] = useState<Nivel[]>([]);
  const [alertas, setAlertas] = useState<AlertaSMN[]>([]);
  const [rayos, setRayos] = useState<Rayo[]>([]);
  const [informeAprobado, setInformeAprobado] = useState(false);
  const [sesgos, setSesgos] = useState<Sesgo[]>([]);
  const [uv, setUv] = useState<Uv[]>([]);
  const [error, setError] = useState("");
  const [descarteSonido, setDescarteSonido] = useState(false);
  const sonido = useSonido();

  const cargar = useCallback(async () => {
    if (!id) return;
    const [e, p, n, a, r, inf, sg, u] = await Promise.all([
      supabase.from("mon_eventos").select("*, mon_modalidades(*)").eq("id", id).single(),
      supabase.from("mon_pronosticos").select("*").eq("evento_id", id).order("valido").limit(5000),
      supabase.from("mon_niveles").select("*").eq("evento_id", id).order("desde").limit(5000),
      supabase.from("mon_alertas_smn").select("*").eq("evento_id", id).neq("estado", "levantada"),
      supabase.from("mon_rayos").select("*").eq("evento_id", id).gte("ocurrido_en", new Date(Date.now() - 60 * 60_000).toISOString()).limit(2000),
      supabase.from("mon_informes").select("estado").eq("evento_id", id).maybeSingle(),
      supabase.from("mon_sesgos").select("*").eq("evento_id", id),
      supabase.from("mon_uv").select("evento_id,valido,uv,interpolado").eq("evento_id", id).order("valido").limit(1000),
    ]);
    if (e.error) return setError("No tenés acceso a este evento o no existe.");
    setEv(e.data as Evento);
    setPron((p.data as Pronostico[]) ?? []);
    setNiveles((n.data as Nivel[]) ?? []);
    setRayos((r.data as Rayo[]) ?? []);
    setInformeAprobado(inf.data?.estado === "aprobado");
    setSesgos((sg.data as Sesgo[]) ?? []);
    setUv((u.data as Uv[]) ?? []);
    setAlertas(ordenarAlertas(((a.data as AlertaSMN[]) ?? []).filter((x) => !x.hasta || new Date(x.hasta) > new Date())));
  }, [id]);

  useEffect(() => {
    void cargar();
    if (id && miEmail) void supabase.from("mon_consultas").insert({ evento_id: id, email: miEmail }).then(() => undefined);
    const canal = supabase
      .channel(`evento-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "mon_niveles", filter: `evento_id=eq.${id}` }, () => void cargar())
      .on("postgres_changes", { event: "*", schema: "public", table: "mon_alertas_smn", filter: `evento_id=eq.${id}` }, () => void cargar())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mon_rayos", filter: `evento_id=eq.${id}` }, () => void cargar())
      .subscribe();
    const t = setInterval(() => void cargar(), 5 * 60_000);
    return () => { clearInterval(t); void supabase.removeChannel(canal); };
  }, [cargar, id, miEmail]);

  // Enlace directo a una sección (por ejemplo, los textos para corredores)
  const ancla = useLocation().hash.replace("#", "");
  useEffect(() => {
    if (!ancla || !ev) return;
    const t = setTimeout(() => document.getElementById(ancla)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => clearTimeout(t);
  }, [ancla, ev, pestana]);

  // En celular, la pestaña activa queda a la vista
  useEffect(() => {
    document.querySelector(".pestana[aria-current='page']")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pestana, ev]);

  // Aviso sonoro mientras haya alertas SMN vigentes
  const glm = estadoRayosGLM(rayos);
  const hayAviso = alertas.length > 0 || glm.nivel >= 2;
  useEffect(() => {
    if (!hayAviso) return;
    sonido.sonar();
    const t = setInterval(sonido.sonar, 30_000);
    return () => clearInterval(t);
  }, [hayAviso, sonido.sonar]);

  const v = useMemo(() => (ev ? calcular(ev) : null), [ev]);
  const serie = useMemo(() => consenso(pron, uv), [pron, uv]);
  const uvDia = useMemo(() => uvMaxPorDia(uv), [uv]);
  const ahora = Date.now();
  // Solo cuentan los niveles que caen dentro de las fases del evento (si se cambió la fecha o el lugar,
  // lo calculado para la fecha anterior no se muestra mientras se recalcula)
  const nivelesEv = v
    ? niveles.filter((n) => new Date(n.hasta).getTime() > v.armado[0].getTime() && new Date(n.desde).getTime() < v.desarme[1].getTime())
    : [];
  const vigentes = nivelesEv.filter((n) => new Date(n.hasta).getTime() > ahora);

  if (error) return (<><Barra titulo="Evento" /><p className="contenedor">{error}</p></>);
  if (!ev || !v) return (<><Barra titulo="Cargando…" /></>);

  const faltan = v.largada.getTime() - ahora;
  const cuenta = faltan > 0 ? `faltan ${Math.floor(faltan / 86400_000)} d ${Math.floor((faltan % 86400_000) / 3600_000)} h` : "en curso o finalizado";
  const ultimaCorrida = PRIORIDAD.map((f) => pron.filter((p) => p.fuente === f).map((p) => p.corrida).sort().at(-1)).filter(Boolean) as string[];
  const procesado = pron.map((p) => p.procesado_en).sort().at(-1);

  // Fase que corresponde por fecha: armado hasta el día previo, carrera ese día, desarme después
  const hoy = diaLocal(new Date().toISOString());
  const diaCarrera = diaLocal(v.largada.toISOString());
  const porFecha: Pestana = hoy < diaCarrera ? "armado" : hoy === diaCarrera ? "carrera" : "desarme";
  if (!pestana || !PESTANAS.some((x) => x.clave === pestana)) return <Navigate to={`/evento/${ev.id}/${porFecha}`} replace />;
  const actual = pestana as Pestana;

  const nivelFase = (fases: string[]) => Math.max(0, ...vigentes.filter((n) => fases.includes(n.fase)).map((n) => n.nivel));
  const delaFase = (p: Pestana) => vigentes.filter((n) => FASES_DE[p].includes(n.fase));
  const nivelesFase = (p: Pestana) => nivelesEv.filter((n) => FASES_DE[p].includes(n.fase));
  const comunicado = armarComunicado(ev, vigentes.filter((n) => n.fase === "carrera"), alertas, v.exposicion);

  const pestanas = (
    <nav className="pestanas" aria-label="Secciones del evento">
      <div className="contenedor">
        {PESTANAS.map((x) => (
          <Link key={x.clave} to={`/evento/${ev.id}/${x.clave}`} className="pestana" aria-current={x.clave === actual ? "page" : undefined}>
            {FASES_DE[x.clave].length > 0 && <span className="punto" style={{ background: delaFase(x.clave).length ? estiloNivel(nivelFase(FASES_DE[x.clave])).background : "var(--borde-input)" }} aria-hidden />}
            {x.titulo}
          </Link>
        ))}
      </div>
    </nav>
  );

  return (
    <>
      <Barra titulo={ev.nombre} subtitulo={`${fmtFechaHora(ev.largada)} · ${cuenta}`} abajo={pestanas}>
        {alertas.length > 0 && <a href="#alerta-smn" className="boton-osc alerta" style={{ background: COLOR_SMN[alertas[0].color], color: "#111", borderColor: "#fff", fontWeight: 800 }}>Alerta SMN</a>}
        {admin && <Link className="boton-osc" to={`/evento/${ev.id}/dashboard`}>Dashboard</Link>}
        {(admin || informeAprobado) && <Link className="boton-osc" to={`/evento/${ev.id}/informe`}>Informe</Link>}
        {editor && <Link className="boton-osc" to={`/evento/${ev.id}/editar`}>Editar</Link>}
        <Link className="boton-osc" to="/">Eventos</Link>
      </Barra>

      {!sonido.habilitado && !descarteSonido && (
        <div style={{ background: "var(--superficie)", borderBottom: "1px solid var(--borde)" }}>
          <div className="contenedor" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", padding: "12px 24px" }}>
            <span><b>Activá el sonido de alertas</b> para escuchar un aviso cuando llegue una alerta del SMN.</span>
            <span style={{ display: "flex", gap: 8 }}>
              <button className="boton" onClick={() => setDescarteSonido(true)}>Ahora no</button>
              <button className="boton primario" onClick={() => { sonido.setHabilitado(true); sonido.setActivo(true); }}>Activar sonido</button>
            </span>
          </div>
        </div>
      )}

      {alertas.map((a, i) => (
        <section key={a.id} id={i === 0 ? "alerta-smn" : undefined} role="alert" className="alerta" style={{ background: COLOR_SMN[a.color], scrollMarginTop: 130 }}>
          <div className="contenedor" style={{ display: "flex", flexWrap: "wrap", gap: "14px 24px", alignItems: "center", padding: "16px 24px" }}>
            <div className="icono-pulso"><Icono tipo={iconoAlerta(a.fenomeno)} size={52} /></div>
            <div style={{ flex: "1 1 300px" }}>
              <div className="condensada" style={{ fontSize: 24, fontWeight: 800, textTransform: "uppercase" }}>{tituloAlerta(a)}</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                Vigencia {a.desde ? fmtFechaHora(a.desde) : "desde ahora"} → {a.hasta ? fmtFechaHora(a.hasta) : "sin fin informado"}
                {" · "}<a href="https://www.smn.gob.ar/alertas" target="_blank" rel="noreferrer" style={{ color: "#111" }}>Ver en el SMN</a>
              </div>
              {a.zona && <div style={{ fontSize: 13, opacity: 0.85 }} title={a.zona}>{a.zona.length > 140 ? a.zona.slice(0, 140) + "…" : a.zona}</div>}
            </div>
            <button className="boton negro" onClick={() => (sonido.habilitado ? sonido.setActivo(!sonido.activo) : sonido.setHabilitado(true))}>
              {sonido.habilitado && sonido.activo ? "Silenciar alerta" : "Activar sonido"}
            </button>
          </div>
        </section>
      ))}

      {glm.nivel >= 2 && (
        <section role="alert" className="alerta" style={{ background: glm.nivel >= 4 ? "#FF3B30" : glm.nivel === 3 ? "#FF6A1A" : "#F5C400" }}>
          <div className="contenedor" style={{ display: "flex", flexWrap: "wrap", gap: "14px 24px", alignItems: "center", padding: "16px 24px" }}>
            <div className="icono-pulso"><Icono tipo="rayo" size={52} /></div>
            <div style={{ flex: "1 1 300px" }}>
              <div className="condensada" style={{ fontSize: 24, fontWeight: 800, textTransform: "uppercase" }}>
                Rayos a {num(glm.km, 0)} km · {glm.nivel >= 4 ? "suspender actividad al aire libre" : glm.nivel === 3 ? "preparar evacuación o demorar largada" : "alerta por tormenta eléctrica"}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                Satélite GOES-19 (GLM): {glm.cantidad} rayos en los últimos 30 min. Reanudar con 30 min sin actividad a menos de 13 km. Precisión del satélite ≈ 10 km: confirmar con detector y trueno.
              </div>
            </div>
          </div>
        </section>
      )}

      <main className="contenedor" style={{ paddingTop: 24 }}>
        {pron.length === 0 && v.desarme[1].getTime() > ahora && (() => {
          // Recién creado o con fecha/lugar cambiados: el procesamiento se dispara solo y tarda unos minutos
          const cambio = new Date(ev.actualizado_en ?? ev.creado_en ?? 0).getTime();
          const reciente = ahora - cambio < 45 * 60_000;
          const llega = new Date(v.armado[0].getTime() - 6 * 86400_000);
          return (
            <div className="tarjeta" style={{ borderLeft: "4px solid var(--naranja)", marginBottom: 18 }}>
              {reciente
                ? <><b>Procesando el primer pronóstico.</b> El monitoreo ya está activo; los datos aparecen solos en unos minutos, sin recargar la página.</>
                : llega.getTime() > ahora
                ? <><b>Monitoreo activo.</b> El evento todavía está fuera del alcance de los modelos: el pronóstico empieza a llegar alrededor del {fmtDia(llega.toISOString())}.</>
                : <><b>Monitoreo activo.</b> El pronóstico se incorpora en la próxima actualización de los modelos.</>}
            </div>
          );
        })()}
        {actual === "general" && (
          <>
            <TiraDias serie={serie} uvDia={uvDia} desde={v.armado[0]} hasta={v.desarme[1]} largada={v.largada} eventoId={ev.id} />
            <Introduccion />
            <Resumen vigentes={vigentes} alertas={alertas} eventoId={ev.id} />
            {comunicado && (
              <section className="seccion tarjeta" style={{ borderLeft: "4px solid var(--naranja)", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
                <span><b>Aviso preventivo para corredores</b> por {comunicado.motivos.join(", ").toLowerCase()}. Hay un texto sugerido para redes sociales, WhatsApp y mail.</span>
                <Link className="boton primario" to={`/evento/${ev.id}/carrera#comunicacion`}>Ver textos</Link>
              </section>
            )}
            <DatosVigentes ultimaCorrida={ultimaCorrida} procesado={procesado} ajuste={sesgos.find((x) => x.aplicado)} />
          </>
        )}
        {actual === "armado" && (
          <>
            <Dias titulo="Armado" serie={serie} uvDia={uvDia} niveles={nivelesFase("armado")} desde={v.armado[0]} hasta={v.armado[1]} franjaSegura
              nota={`${ev.ubicacion} · armado desde ${fmtFechaHora(v.armado[0].toISOString())} hasta ${fmtFechaHora(v.armado[1].toISOString())}`} />
            <Recomendaciones lista={delaFase("armado")} vacio="Con el pronóstico actual no hay recomendaciones para el armado." />
          </>
        )}
        {actual === "carrera" && (
          <>
            <DiaCarrera serie={serie} v={v} />
            <Recomendaciones lista={delaFase("carrera")} vacio="Con el pronóstico actual no hay recomendaciones para el día de carrera." />
            {comunicado && <Comunicacion c={comunicado} />}
          </>
        )}
        {actual === "desarme" && (
          <>
            <Dias titulo="Desarme" serie={serie} uvDia={uvDia} niveles={nivelesFase("desarme")} desde={v.desarme[0]} hasta={v.desarme[1]} franjaSegura
              nota={`${ev.ubicacion} · desarme desde ${fmtFechaHora(v.desarme[0].toISOString())} hasta ${fmtFechaHora(v.desarme[1].toISOString())}`} />
            <Recomendaciones lista={delaFase("desarme")} vacio="Con el pronóstico actual no hay recomendaciones para el desarme." />
          </>
        )}
        {actual === "guia" && <Guia ctx={{ niveles: vigentes, alertas }} />}
        {actual === "mediciones" && <Mediciones eventoId={ev.id} puedeCargar={admin} miEmail={miEmail} />}
        {actual === "equipo" && (
          <>
            <Accesos eventoId={ev.id} eventoNombre={ev.nombre} cupo={ev.cupo_equipo ?? 3} puedeGestionar={editor || ev.organizador_email.toLowerCase() === miEmail} esEditor={editor} miEmail={miEmail} />
            <DatosVigentes ultimaCorrida={ultimaCorrida} procesado={procesado} ajuste={sesgos.find((x) => x.aplicado)} />
            <AjusteLocal ev={ev} sesgos={sesgos} pron={pron} />
            <section className="seccion tarjeta" id="fuentes">
              <div className="rotulo">Fuentes y metodología</div>
              <p className="chico" style={{ marginBottom: 0 }}>
                Modelos ECMWF IFS (CC BY 4.0) y NOAA GFS, comparados por separado; avisos oficiales del SMN. WBGT estimado hora por hora por el método de Liljegren et al. (2008). Índice UV con cielo despejado: MET Norway, Locationforecast 2.0 (CC BY 4.0), categorías OMS (2002).
                Escala de estrés térmico: World Athletics (2020). Cada recomendación indica su fuente y su tipo.
                Se usa el punto de grilla de tierra más cercano al evento y, cuando hay una estación del SMN a menos de 40 km con al menos 12 horas comparables,
                se corrige el sesgo de temperatura (por separado de día y de noche), punto de rocío y viento con las observaciones de las últimas 72 h, y se recalcula el WBGT.
              </p>
            </section>
          </>
        )}
      </main>
    </>
  );
}

type Pestana = "general" | "armado" | "carrera" | "desarme" | "mediciones" | "equipo" | "guia";
const PESTANAS: { clave: Pestana; titulo: string }[] = [
  { clave: "general", titulo: "General" },
  { clave: "armado", titulo: "Armado" },
  { clave: "carrera", titulo: "Día de carrera" },
  { clave: "desarme", titulo: "Desarme" },
  { clave: "mediciones", titulo: "Mediciones" },
  { clave: "equipo", titulo: "Equipo y fuentes" },
  { clave: "guia", titulo: "Guía" },
];
const FASES_DE: Record<Pestana, string[]> = {
  general: ["armado", "carrera", "personal", "desarme"], armado: ["armado"], carrera: ["carrera", "personal"], desarme: ["desarme"], mediciones: [], equipo: [], guia: [],
};

function DatosVigentes({ ultimaCorrida, procesado, ajuste }: { ultimaCorrida: string[]; procesado?: string; ajuste?: Sesgo }) {
  return (
    <p className="chico" style={{ marginTop: 18 }}>
      <span style={{ color: "var(--ok-texto)", fontWeight: 600 }}>● Se actualiza sola</span>
      {" · "}
      {ultimaCorrida.length ? `Modelos de ${ultimaCorrida.map((c) => fmtFechaHora(c)).join(" y ")}` : "Esperando la primera corrida de los modelos"}
      {procesado && ` · procesado ${fmtFechaHora(procesado)}`}
      {ajuste?.estacion && ` · ajustado con observaciones de ${ajuste.estacion} (SMN, ${num(ajuste.distancia_km, 0)} km)`}
    </p>
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

function Dias({ titulo, serie, uvDia, niveles, desde, hasta, nota, franjaSegura }: {
  titulo: string; serie: Map<number, Pronostico & { n: number }>; uvDia: Map<string, number>; niveles: Nivel[];
  desde: Date; hasta: Date; nota: string; franjaSegura?: boolean;
}) {
  const dias = new Map<string, (Pronostico & { n: number })[]>();
  // Horas que representa cada paso (1 h o 3 h según modelo y plazo), para acumular lluvia
  const horasPaso = new Map<number, number>();
  let previo: number | null = null;
  for (const [t, p] of serie) {
    horasPaso.set(t, previo == null ? (p.fuente === "ecmwf" ? 3 : 1) : Math.min(6, (t - previo) / 3600_000));
    previo = t;
    if (t < desde.getTime() || t > hasta.getTime()) continue;
    const d = diaLocal(new Date(t).toISOString());
    dias.set(d, [...(dias.get(d) ?? []), p]);
  }
  const lejano = (iso: string) => new Date(iso).getTime() - Date.now() > 6 * 86400_000;
  return (
    <section className="seccion" aria-labelledby="dias-t">
      <h2 id="dias-t">{titulo} · pronóstico por día</h2>
      {dias.size === 0 && <div className="tarjeta">Todavía no hay pronóstico para estos días. El sistema lo completa cuando entran en el horizonte de los modelos.</div>}
      <div className="grilla">
        {[...dias.entries()].map(([d, ps]) => {
          const t = ps.map((p) => p.t2m).filter((x): x is number => x != null);
          const raf = Math.max(...ps.map((p) => p.rafaga10 ?? 0));
          const hrs = ps.map((p) => p.hr).filter((x): x is number => x != null);
          const uvMax = uvDia.get(d);
          const lluvia = ps.reduce((a, p) => a + (p.precip ?? 0) * (horasPaso.get(new Date(p.valido).getTime()) ?? 1), 0);
          const delDia = niveles.filter((n) => diaLocal(n.desde) <= d && diaLocal(n.hasta) >= d);
          const peorDia = delDia.reduce<Nivel | null>((m, n) => (!m || n.nivel > m.nivel ? n : m), null);
          const nivelDia = peorDia?.nivel ?? 0;
          const media = ps[Math.floor(ps.length / 2)];
          const peor = ps.reduce((a, p) => ((p.precip ?? 0) > (a.precip ?? 0) ? p : a), media);
          const franja = franjaSegura ? franjaFavorable(d, delDia, desde, hasta) : null;
          if (franjaSegura && !franja) return null; // la fase no ocupa horario diurno ese día
          return (
            <article key={d} className="tarjeta" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="condensada" style={{ fontSize: 20, fontWeight: 800, textTransform: "uppercase" }}>{fmtDia(ps[0].valido)}</span>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Icono tipo={iconoTiempo(peor)} size={60} />
                <div style={{ textAlign: "right", lineHeight: 1 }}>
                  <div className="condensada" style={{ fontSize: 32, fontWeight: 800 }}>{num(Math.max(...t))}<small className="unidad">°C</small></div>
                  <div className="condensada" style={{ fontSize: 22, color: "var(--texto3)" }}>{num(Math.min(...t))}<small className="unidad">°C</small></div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}><Icono tipo="viento" size={20} />ráf. {num(raf)} km/h</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}><Icono tipo="gota" size={20} />{num(lluvia, 1)} mm</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontWeight: 600 }}>
                <Humedad texto={hrs.length ? `${num(Math.min(...hrs))}–${num(Math.max(...hrs))} %` : "—"} />
                <UvChip uv={uvMax} />
              </div>
              <span className="badge" style={{ ...(peorDia && nivelDia > 0 ? estiloVariable(peorDia.variable, nivelDia) : estiloNivel(0)), alignSelf: "flex-start", fontSize: 13 }}>{peorDia && nivelDia > 0 ? nombreNivel(peorDia.variable, nivelDia) : "Bajo umbral"}</span>
              {peorDia && nivelDia > 0 && <span className="chico" style={{ marginTop: -4 }}>{NOMBRE_CORTO[peorDia.variable]}</span>}
              {franja && (
                <div className="franja-segura" title="Tramo continuo entre las 6 y las 21 h con el nivel más bajo del día">
                  <span className="punto" style={{ background: estiloNivel(franja.nivel).background, marginTop: 0 }} aria-hidden />
                  Mejor franja: {franja.texto}
                </div>
              )}
              {lejano(ps[0].valido) && <span className="chico">Tendencia · confianza baja</span>}
            </article>
          );
        })}
      </div>
      <p className="chico">{nota} · Gota con %: humedad relativa mínima y máxima del día · UV: máximo del día. {FUENTE_UV}</p>
    </section>
  );
}

/** Tramo continuo más largo, entre las 6 y las 21 h, con el nivel más bajo del día en la fase */
function franjaFavorable(dia: string, niveles: Nivel[], desde: Date, hasta: Date): { texto: string; nivel: number } | null {
  const base = new Date(`${dia}T00:00:00-03:00`).getTime();
  const horas: { h: number; nivel: number }[] = [];
  for (let h = 6; h < 21; h++) {
    const t = base + h * 3600_000;
    if (t < desde.getTime() || t + 3600_000 > hasta.getTime()) continue;
    const n = Math.max(0, ...niveles.filter((x) => new Date(x.desde).getTime() <= t && new Date(x.hasta).getTime() > t).map((x) => x.nivel));
    horas.push({ h, nivel: n });
  }
  if (!horas.length) return null;
  const minimo = Math.min(...horas.map((x) => x.nivel));
  let mejor: [number, number] | null = null;
  let ini: number | null = null;
  let anterior: number | null = null;
  for (const x of horas) {
    if (x.nivel !== minimo) { ini = null; anterior = x.h; continue; }
    if (ini === null || anterior !== x.h - 1) ini = x.h;
    anterior = x.h;
    if (!mejor || x.h + 1 - ini > mejor[1] - mejor[0]) mejor = [ini, x.h + 1];
  }
  if (!mejor) return null;
  const hh = (n: number) => `${String(n).padStart(2, "0")}:00`;
  return { texto: `${hh(mejor[0])} a ${hh(mejor[1])} h`, nivel: minimo };
}

function DiaCarrera({ serie, v }: { serie: Map<number, Pronostico & { n: number }>; v: ReturnType<typeof calcular> }) {
  const [ini, fin] = v.exposicion;
  const horas = [...serie.entries()].filter(([t]) => t >= ini.getTime() - 3600_000 && t <= fin.getTime() + 3600_000);
  const uc = (t: number) => t >= v.inicioUltimoCuarto.getTime() && t <= v.finCarrera.getTime() + 3600_000;
  const fase = (t: number) =>
    t < v.largada.getTime() ? "Convocatoria" : t <= v.inicioUltimoCuarto.getTime() ? "Carrera" : t <= v.finCarrera.getTime() + 3600_000 ? "Último cuarto" : "Desconcentración";
  const nivelWA = (w: number | null) => (w == null ? 0 : w >= 30 ? 4 : w >= 28 ? 3 : w >= 25 ? 2 : w >= 21 ? 1 : 0);
  return (
    <section className="seccion" style={{ background: "var(--superficie)", border: "1px solid var(--borde)", borderRadius: 10 }}>
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
                  <div key={t} style={{ borderRadius: 10, padding: "12px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center", background: uc(t) ? "var(--uc-fondo)" : "var(--superficie2)", border: `2px solid ${uc(t) ? "#FF6A1A" : "transparent"}` }}>
                    <b className="condensada" style={{ fontSize: 22 }}>{fmtHora(p.valido)}</b>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--texto2)" }}>{fase(t)}</span>
                    <Icono tipo={iconoTiempo(p, noche)} size={48} />
                    <b className="condensada" style={{ fontSize: 24 }}>{num(p.t2m)}<small className="unidad">°C</small></b>
                    <span style={{ alignSelf: "stretch", ...estiloWA(n), fontWeight: 700, fontSize: 14, padding: "4px 6px", borderRadius: 4 }}>WBGT {num(p.wbgt_est, 1)} °C</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                      <span style={{ display: "inline-block", transform: `rotate(${(p.dir_viento ?? 0) + 180}deg)` }}>↑</span> {num(p.viento10)}/{num(p.rafaga10)}
                    </span>
                    <span className="chico"><Humedad texto={`${num(p.hr)} %`} size={16} /></span>
                    {(p.uv ?? 0) >= 0.5 ? <UvChip uv={p.uv} compacto /> : <span className="chico">UV {p.uv == null ? "—" : "0"}</span>}
                    <span className="chico">{num(p.precip, 1)} mm/h</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="leyenda-wbgt">
          {["< 21 °C", "21–25 °C", "25–28 °C", "28–30 °C", "> 30 °C"].map((r, i) => (
            <div key={r} style={estiloWA(i)}>
              <b>{NOMBRE_WA[i]}</b> <span>{r}</span>
            </div>
          ))}
        </div>
        <span className="chico">Escala y colores WBGT: World Athletics (2020), Tabla 1; «Riesgo bajo» corresponde a «Almost Safe» · viento medio / ráfaga en km/h a 10 m · gota con %: humedad relativa · {FUENTE_UV}</span>
      </div>
    </section>
  );
}

function Recomendaciones({ lista: vig, vacio }: { lista: Nivel[]; vacio: string }) {
  const grupos = new Map<string, Nivel>();
  for (const n of vig.filter((x) => x.nivel > 0)) {
    const k = `${n.fase}|${n.variable}|${n.nivel}`;
    const prev = grupos.get(k);
    if (!prev || n.desde < prev.desde) grupos.set(k, n);
  }
  const lista = [...grupos.values()].sort((a, b) => b.nivel - a.nivel || a.desde.localeCompare(b.desde));
  const accion = lista.filter((n) => n.nivel >= 2);
  const vigilar = lista.filter((n) => n.nivel === 1);
  return (
    <section className="seccion" id="recomendaciones" style={{ scrollMarginTop: 130 }}>
      <h2>Recomendaciones EMERTEAM</h2>
      {lista.length === 0 && <div className="tarjeta">{vacio}</div>}
      {lista.length > 0 && accion.length === 0 && <div className="tarjeta">No hay acciones previstas: solo situaciones para vigilar.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,460px),1fr))", gap: 12 }}>
        {accion.map((n) => <TarjetaReco key={`${n.fase}${n.variable}${n.nivel}`} n={n} />)}
      </div>
      {vigilar.length > 0 && (
        <details className="ver-tambien" open={accion.length === 0}>
          <summary>Ver también: {vigilar.length} {vigilar.length === 1 ? "situación para vigilar" : "situaciones para vigilar"}</summary>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,460px),1fr))", gap: 12 }}>
            {vigilar.map((n) => <TarjetaReco key={`${n.fase}${n.variable}${n.nivel}`} n={n} />)}
          </div>
        </details>
      )}
    </section>
  );
}

function TarjetaReco({ n }: { n: Nivel }) {
  const r = REGLAS[n.regla];
  const texto = recomendacion(n.variable, n.nivel, n.fase);
  return (
    <article className="tarjeta" style={{ display: "flex", flexDirection: "column", gap: 8, borderLeft: `5px solid ${estiloVariable(n.variable, n.nivel).background}` }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span className="badge" style={{ ...estiloVariable(n.variable, n.nivel) }}>{nombreNivel(n.variable, n.nivel)}</span>
        {n.fase === "personal" && <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", border: "1px solid var(--texto)", padding: "2px 7px", borderRadius: 4 }}>{NOMBRE_FASE[n.fase]}</span>}
        {n.confianza === "baja" && <span className="chico">tendencia</span>}
      </div>
      <h3 style={{ margin: 0, fontFamily: "inherit", fontSize: 18 }}>{NOMBRE_VARIABLE[n.variable] ?? n.variable}</h3>
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
}

const NOMBRE_MODELO: Record<string, string> = { ecmwf: "ECMWF", gfs: "GFS" };

function kmEntre(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Punto del modelo, estación del SMN usada y error medido: lo que respalda la confianza del pronóstico */
function AjusteLocal({ ev, sesgos, pron }: { ev: Evento; sesgos: Sesgo[]; pron: Pronostico[] }) {
  const fuentes = [...new Set(pron.map((p) => p.fuente))].sort();
  if (!fuentes.length) return null;
  const firma = (x: number | null) => (x == null ? "—" : `${x > 0 ? "+" : ""}${num(x, 1)} °C`);
  return (
    <section className="seccion tarjeta" id="ajuste-local">
      <div className="rotulo">Ajuste local y error medido</div>
      <p className="chico" style={{ marginTop: 4 }}>
        Cuánto se equivocó cada modelo en la zona del evento en las últimas 72 h, comparado con la estación del SMN más cercana, y la corrección que se aplica al pronóstico.
        Un sesgo positivo indica que el modelo pronosticaba más temperatura que la observada.
      </p>
      <div className="desplaza">
        <table className="tabla">
          <thead>
            <tr><th>Modelo</th><th>Punto de grilla</th><th>Estación SMN</th><th>Horas comparadas</th><th>Sesgo T día / noche</th><th>Factor viento</th><th>Error T sin / con ajuste</th><th>Error viento sin / con ajuste</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {fuentes.map((f) => {
              const s = sesgos.find((x) => x.fuente === f);
              const ult = pron.filter((p) => p.fuente === f && p.punto_lat != null).at(-1);
              const punto = ult?.punto_lat != null && ult.punto_lon != null
                ? `${num(kmEntre({ lat: Number(ev.lat), lon: Number(ev.lon) }, { lat: Number(ult.punto_lat), lon: Number(ult.punto_lon) }), 0)} km · ${ult.punto_tierra ? "tierra" : ult.punto_tierra === false ? "agua (sin tierra cerca)" : "sin máscara"}`
                : "—";
              return (
                <tr key={f}>
                  <td><b>{NOMBRE_MODELO[f] ?? f}</b></td>
                  <td>{punto}</td>
                  <td>{s?.estacion ? `${s.estacion} · ${num(s.distancia_km, 0)} km` : "Sin estación a menos de 60 km"}</td>
                  <td>{s?.pares ?? 0}</td>
                  <td>{s ? `${firma(s.sesgo_t_dia)} / ${firma(s.sesgo_t_noche)}` : "—"}</td>
                  <td>{s?.factor_viento != null ? `× ${num(s.factor_viento, 2)}` : "—"}</td>
                  <td>{s?.error_t != null ? `${num(s.error_t, 1)} / ${num(s.error_t_corr, 1)} °C` : "—"}</td>
                  <td>{s?.error_viento != null ? `${num(s.error_viento, 0)} / ${num(s.error_viento_corr, 0)} km/h` : "—"}</td>
                  <td>{s?.aplicado ? "Corrección aplicada" : s?.pares ? "Midiendo (faltan horas comparables)" : "Sin datos todavía"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="chico" style={{ marginBottom: 0 }}>
        El error "con ajuste" se mide sobre las mismas horas usadas para calcular la corrección: es una referencia de cuánto mejora, no una garantía para el día de la carrera.
        La corrección no reemplaza las mediciones en terreno ni las alertas del SMN.
      </p>
    </section>
  );
}
