import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useOutletContext, useParams, useLocation } from "react-router-dom";
import type { Ctx } from "../main";
import { Barra } from "../componentes/Barra";
import { CONDICION, Icono, iconoTiempo, type TipoIcono } from "../componentes/Icono";
import { Accesos } from "../componentes/Accesos";
import { Comunicacion } from "../componentes/Comunicacion";
import { TiraDias } from "../componentes/TiraDias";
import { Guia } from "../componentes/Guia";
import { armarComunicado } from "../comunicacion";
import { Introduccion } from "../componentes/Introduccion";
import { Resumen } from "../componentes/Resumen";
import { Mediciones } from "../componentes/Mediciones";
import { AguaPanel } from "../componentes/Agua";
import { Probabilistico } from "../componentes/Probabilistico";
import { decisionEvento, recomendacionSmnAireLibre, type FaseEvento } from "../alertasSmn";
import { categoriaUv, consenso, FUENTE_UV, NOMBRE_FUENTE, pesosFuentes, PRIORIDAD, UV_CATEGORIAS, uvMaxPorDia } from "../serie";
import { UvDato } from "../componentes/Uv";
import { confDisciplina, esVariableCalor, escalaCalor, estiloCalor, nombreDisciplina, participantes, riesgoWct, wct } from "../disciplinas";
import {
  COLOR_SMN, estadoRayosGLM, ordenarAlertas, tituloAlerta, diaLocal, fmtDia, fmtFechaHora, fmtHora, num, supabase,
  type AlertaSMN, type Evento, type Rayo, type Nivel, type Pronostico, type Sesgo, type Uv,
} from "../datos";
import { fijarDisciplina, reglaDe, REGLAS, estiloNivel, estiloVariable, NOMBRE_CORTO, NOMBRE_FASE, NOMBRE_VARIABLE, TIPO_FUENTE, nombreNivel, recomendacion } from "../reglas";
import { calcular, fasesDeAlerta } from "../ventanas";


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
  const [refrescoAgua, setRefrescoAgua] = useState(0);
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
  const vAlertas = useMemo(() => (ev ? calcular(ev) : null), [ev]);
  // Solo cuentan las alertas que tocan alguna fase del evento
  const alertasEv = vAlertas ? alertas.filter((a) => fasesDeAlerta(a, vAlertas).length > 0) : [];
  const hayAviso = alertasEv.length > 0 || glm.nivel >= 2;
  useEffect(() => {
    if (!hayAviso) return;
    sonido.sonar();
    const t = setInterval(sonido.sonar, 30_000);
    return () => clearInterval(t);
  }, [hayAviso, sonido.sonar]);

  fijarDisciplina(ev?.disciplina);
  const v = vAlertas;
  const serie = useMemo(() => consenso(pron, uv, sesgos), [pron, uv, sesgos]);
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
  const ultimaCorrida = PRIORIDAD.map((f) => {
    const c = pron.filter((p) => p.fuente === f).map((p) => p.corrida).sort().at(-1);
    return c ? `${NOMBRE_FUENTE[f] ?? f} ${fmtFechaHora(c)}` : null;
  }).filter(Boolean) as string[];
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
  const comunicado = armarComunicado(ev, vigentes.filter((n) => n.fase === "carrera"), alertasEv, v.exposicion);

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
      <Barra titulo={ev.nombre} subtitulo={`${ev.disciplina && ev.disciplina !== "running" ? `${nombreDisciplina(ev.disciplina)} · ` : ""}${fmtFechaHora(ev.largada)} · ${cuenta}`} abajo={pestanas}>
        {alertasEv.length > 0 && <a href="#alerta-smn" className="boton-osc alerta" style={{ background: COLOR_SMN[alertasEv[0].color], color: "#111", borderColor: "#fff", fontWeight: 800 }}>Alerta SMN</a>}
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

      {alertasEv.map((a, i) => (
        <section key={a.id} id={i === 0 ? "alerta-smn" : undefined} role="alert" className="alerta" style={{ background: COLOR_SMN[a.color], scrollMarginTop: 130 }}>
          <div className="contenedor" style={{ display: "flex", flexWrap: "wrap", gap: "14px 24px", alignItems: "center", padding: "16px 24px" }}>
            <div className="icono-pulso"><Icono tipo={iconoAlerta(a.fenomeno)} size={52} /></div>
            <div style={{ flex: "1 1 300px" }}>
              <div className="condensada" style={{ fontSize: 24, fontWeight: 800, textTransform: "uppercase" }}>{tituloAlerta(a)}</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                Vigencia {a.desde ? fmtFechaHora(a.desde) : "desde ahora"} → {a.hasta ? fmtFechaHora(a.hasta) : "sin fin informado"} · Afecta: {fasesDeAlerta(a, v).join(", ")}
                {" · "}<a href="https://www.smn.gob.ar/alertas" target="_blank" rel="noreferrer" style={{ color: "#111" }}>Ver en el SMN</a>
              </div>
              {a.zona && <div style={{ fontSize: 13, opacity: 0.85 }} title={a.zona}>{a.zona.length > 140 ? a.zona.slice(0, 140) + "…" : a.zona}</div>}
              {a.descripcion && <div style={{ fontSize: 14, marginTop: 6, fontStyle: "italic" }}>«{a.descripcion}» <span style={{ fontStyle: "normal", opacity: 0.8 }}>(SMN)</span></div>}
              {(() => {
                const fs = fasesDeAlerta(a, v).map((n) => (n === "Armado" ? "armado" : n === "Desarme" ? "desarme" : "carrera") as FaseEvento);
                const smn = recomendacionSmnAireLibre(a);
                const dec = decisionEvento(a, fs);
                return (smn.length > 0 || dec.length > 0) && (
                  <div style={{ marginTop: 8, fontSize: 14, background: "rgba(255,255,255,.55)", borderRadius: 6, padding: "8px 12px" }}>
                    {smn.length > 0 && <div><b>El SMN recomienda a la población:</b> {smn.join(" ")}</div>}
                    {dec.map((d) => <div key={d.fase} style={{ marginTop: 4 }}><b>{d.fase}:</b> {d.texto}</div>)}
                    {dec.length > 0 && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>Decisión sugerida: criterio interno EMERTEAM según el color del SMN. La decisión final corresponde al organizador.</div>}
                  </div>
                );
              })()}
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
            <TiraDias serie={serie} uvDia={uvDia} niveles={niveles} desde={v.armado[0]} hasta={v.desarme[1]} largada={v.largada} eventoId={ev.id} />
            <Introduccion />
            <Resumen vigentes={vigentes} alertas={alertasEv} eventoId={ev.id} />
            {confDisciplina(ev.disciplina).agua && <AguaPanel ev={ev} />}
            {comunicado && (
              <section className="seccion tarjeta" style={{ borderLeft: "4px solid var(--naranja)", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
                <span><b>Aviso preventivo para {participantes(ev.disciplina)}</b> por {comunicado.motivos.join(", ").toLowerCase()}. Hay un texto sugerido para redes sociales, WhatsApp y mail.</span>
                <Link className="boton primario" to={`/evento/${ev.id}/carrera#comunicacion`}>Ver textos</Link>
              </section>
            )}
            <DatosVigentes ultimaCorrida={ultimaCorrida} procesado={procesado} ajuste={sesgos.find((x) => x.aplicado)} />
          </>
        )}
        {actual === "armado" && (
          <>
            <Dias titulo="Armado" serie={serie} uvDia={uvDia} conWct={confDisciplina(ev.disciplina).wct} niveles={nivelesFase("armado")} desde={v.armado[0]} hasta={v.armado[1]} franjaSegura
              nota={`${ev.ubicacion} · armado desde ${fmtFechaHora(v.armado[0].toISOString())} hasta ${fmtFechaHora(v.armado[1].toISOString())}`} />
            <Probabilistico ev={ev} v={v} fase="armado" quien={participantes(ev.disciplina)} />
            <Recomendaciones lista={delaFase("armado")} vacio="Con el pronóstico actual no hay recomendaciones para el armado." />
          </>
        )}
        {actual === "carrera" && (
          <>
            <DiaCarrera serie={serie} v={v} ev={ev} />
            <Probabilistico ev={ev} v={v} fase="carrera" quien={participantes(ev.disciplina)} />
            <Recomendaciones lista={delaFase("carrera")} vacio="Con el pronóstico actual no hay recomendaciones para el día de carrera." />
            {comunicado && <Comunicacion c={comunicado} quien={participantes(ev.disciplina)} />}
          </>
        )}
        {actual === "desarme" && (
          <>
            <Dias titulo="Desarme" serie={serie} uvDia={uvDia} conWct={confDisciplina(ev.disciplina).wct} niveles={nivelesFase("desarme")} desde={v.desarme[0]} hasta={v.desarme[1]} franjaSegura
              nota={`${ev.ubicacion} · desarme desde ${fmtFechaHora(v.desarme[0].toISOString())} hasta ${fmtFechaHora(v.desarme[1].toISOString())}`} />
            <Probabilistico ev={ev} v={v} fase="desarme" quien={participantes(ev.disciplina)} />
            <Recomendaciones lista={delaFase("desarme")} vacio="Con el pronóstico actual no hay recomendaciones para el desarme." />
          </>
        )}
        {actual === "guia" && <Guia ctx={{ niveles: vigentes, alertas: alertasEv }} />}
        {actual === "mediciones" && (
          <>
            {confDisciplina(ev.disciplina).agua && <AguaPanel ev={ev} refresco={refrescoAgua} />}
            <Mediciones eventoId={ev.id} puedeCargar={admin} miEmail={miEmail} disciplina={ev.disciplina} onGuardada={() => setRefrescoAgua((x) => x + 1)} />
          </>
        )}
        {actual === "equipo" && (
          <>
            <Accesos eventoId={ev.id} productoraId={ev.productora_id} esEditor={editor} esAdmin={admin} miEmail={miEmail} />
            <DatosVigentes ultimaCorrida={ultimaCorrida} procesado={procesado} ajuste={sesgos.find((x) => x.aplicado)} />
            <AjusteLocal ev={ev} sesgos={sesgos} pron={pron} />
            <section className="seccion tarjeta" id="fuentes">
              <div className="rotulo">Fuentes y metodología</div>
              <p className="chico" style={{ marginBottom: 0 }}>
                Modelos ECMWF IFS (CC BY 4.0), NOAA GFS y WRF del SMN a 4 km hasta 72 h (Fuente: Servicio Meteorológico Nacional, CC BY 2.5 AR); avisos oficiales del SMN. WBGT estimado hora por hora por el método de Liljegren et al. (2008). Índice UV con cielo despejado: MET Norway, Locationforecast 2.0 (CC BY 4.0), categorías OMS (2002).
                Escala de estrés térmico: World Athletics (2020). Cada recomendación indica su fuente y su tipo.
                Cada modelo se corrige con las observaciones de hasta dos estaciones del SMN a menos de 60 km (sesgo de temperatura de día y de noche, punto de rocío y viento, últimas 72 h, con al menos 12 horas comparables);
                la corrección se atenúa con la distancia (completa hasta 25 km, la mitad a 60 km) y se recalcula el WBGT. Los modelos se combinan con un promedio ponderado por su error medido en la zona;
                tormenta, precipitación y dirección del viento salen del modelo prioritario.
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
      {ultimaCorrida.length ? `Modelos: ${ultimaCorrida.join(" · ")}` : "Esperando la primera corrida de los modelos"}
      {procesado && ` · procesado ${fmtFechaHora(procesado)}`}
      {ajuste?.estacion && ` · ajustado con observaciones de ${ajuste.estacion.split(" + ").map(titulo).join(" y ")} (SMN)`}
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

function Dias({ titulo, serie, uvDia, conWct, niveles, desde, hasta, nota, franjaSegura }: {
  titulo: string; serie: Map<number, Pronostico & { n: number }>; uvDia: Map<string, number>; conWct?: boolean; niveles: Nivel[];
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
      <div className="grilla grilla-dias">
        {[...dias.entries()].map(([d, ps]) => {
          const t = ps.map((p) => p.t2m).filter((x): x is number => x != null);
          const raf = Math.max(...ps.map((p) => p.rafaga10 ?? 0));
          const hrs = ps.map((p) => p.hr).filter((x): x is number => x != null);
          const uvMax = uvDia.get(d);
          const sts = conWct ? ps.map((p) => wct(p.t2m, p.viento10)).filter((x): x is number => x != null) : [];
          const stMin = sts.length ? Math.min(...sts) : null;
          const lluvia = ps.reduce((a, p) => a + (p.precip ?? 0) * (horasPaso.get(new Date(p.valido).getTime()) ?? 1), 0);
          const delDia = niveles.filter((n) => diaLocal(n.desde) <= d && diaLocal(n.hasta) >= d);
          const peorDia = delDia.reduce<Nivel | null>((m, n) => (!m || n.nivel > m.nivel ? n : m), null);
          const nivelDia = peorDia?.nivel ?? 0;
          const media = ps[Math.floor(ps.length / 2)];
          const peor = ps.reduce((a, p) => ((p.precip ?? 0) > (a.precip ?? 0) ? p : a), media);
          const franja = franjaSegura ? franjaFavorable(d, delDia, desde, hasta) : null;
          if (franjaSegura && !franja) return null; // la fase no ocupa horario diurno ese día
          const estiloDia = peorDia && nivelDia > 0 ? estiloVariable(peorDia.variable, nivelDia) : estiloNivel(0);
          const colorNivel = String(estiloDia.background);
          const nombreDia = peorDia && nivelDia > 0 ? nombreNivel(peorDia.variable, nivelDia) : "Bajo umbral";
          const tipoCielo = iconoTiempo(peor);
          return (
            <article key={d} className="tarjeta dia-tarjeta">
              <div className="dia-franja" style={{ background: colorNivel }} aria-hidden />
              <div className="dia-cab">
                <span className="dia-fecha">{(() => { const [dsem, ...resto] = fmtDia(ps[0].valido).replace(",", "").split(" "); return <>{dsem} <span>{resto.join(" ")}</span></>; })()}</span>
                <span className="badge" style={estiloDia}>{nombreDia}</span>
              </div>
              <div className="dia-clima">
                <Icono tipo={tipoCielo} size={72} />
                <div className="dia-temps">
                  <div className="dia-max">{num(Math.max(...t))}<small>°C</small></div>
                  <div className="dia-min"><b>mín</b>{num(Math.min(...t))}<small>°C</small></div>
                  <div className="dia-cond">{CONDICION[tipoCielo] ?? ""}</div>
                </div>
              </div>
              <div className="dia-datos">
                <div className="dia-dato"><Icono tipo="viento" size={30} /><div><div className="v">{num(raf)}<small>km/h</small></div><div className="e">Ráfaga máx.</div></div></div>
                <div className="dia-dato"><Icono tipo="gota" size={30} /><div><div className="v">{num(lluvia, 1)}<small>mm</small></div><div className="e">Lluvia</div></div></div>
                <div className="dia-dato"><Icono tipo="humedad" size={30} /><div><div className="v">{hrs.length ? `${num(Math.min(...hrs))}–${num(Math.max(...hrs))}` : "—"}<small>%</small></div><div className="e">Humedad</div></div></div>
                <div className="dia-dato"><UvDato uv={uvMax} /></div>
              </div>
              {stMin != null && <div className="dia-st">Sensación térmica mínima <b>{num(stMin)} °C</b> · riesgo {riesgoWct(stMin).toLowerCase()} <span className="chico">(informativo)</span></div>}
              <div className="dia-op">
                {peorDia && nivelDia > 0 ? (
                  <div className="dia-accion" style={{ borderColor: colorNivel }}>
                    <b>{NOMBRE_VARIABLE[peorDia.variable] ?? NOMBRE_CORTO[peorDia.variable]}</b>
                    <span className="dia-accion-nivel" style={{ color: colorTextoNivel(colorNivel) }}>{nombreDia} desde las {fmtHora(new Date(Math.max(new Date(peorDia.desde).getTime(), new Date(`${d}T00:00:00-03:00`).getTime())).toISOString())}</span>
                  </div>
                ) : (
                  <div className="dia-accion" style={{ borderColor: colorNivel }}><span>Sin variables por encima del umbral.</span></div>
                )}
                {franja && (
                  <div className="franja-segura" title="Tramo continuo entre las 6 y las 21 h con el nivel más bajo del día">
                    <span className="punto" style={{ background: estiloNivel(franja.nivel).background, marginTop: 0 }} aria-hidden />
                    Mejor franja para trabajar: <b>{franja.texto}</b>
                  </div>
                )}
                {lejano(ps[0].valido) && <span className="chico">Tendencia · confianza baja</span>}
              </div>
            </article>
          );
        })}
      </div>
      <p className="chico">{nota} · Humedad: mínima y máxima del día · UV: máximo del día. {FUENTE_UV}</p>
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

const CARDINAL = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const cardinal = (dir: number | null) => (dir == null ? "" : CARDINAL[Math.round((((dir % 360) + 360) % 360) / 45) % 8]);
const horaDec = (d: Date) => d.getTime();

function DiaCarrera({ serie, v, ev }: { serie: Map<number, Pronostico & { n: number }>; v: ReturnType<typeof calcular>; ev: Evento }) {
  const escala = escalaCalor(ev.disciplina);
  const conWct = confDisciplina(ev.disciplina).wct;
  const nat = v.natacion;
  const [ini, fin] = v.exposicion;
  const todas = [...serie.entries()].sort((a, b) => a[0] - b[0]);
  // Paso del pronóstico en esta franja (1 h cerca, 3 h a varios días): cada dato representa ± medio paso
  const cerca = todas.filter(([t]) => t >= ini.getTime() - 6 * 3600_000 && t <= fin.getTime() + 6 * 3600_000);
  const pasos = cerca.slice(1).map(([t], i) => t - cerca[i][0]).filter((x) => x > 0);
  const paso = pasos.length ? [...pasos].sort((a, b) => a - b)[Math.floor(pasos.length / 2)] : 3600_000;
  // Cada dato se lee como la hora que empieza en su horario [t, t + 1 h): un dato de las 21:00 no representa
  // un último cuarto de 20:00 a 20:30 aunque sea el más cercano
  const H = 3600_000;
  const toca = (t: number, a: number, b: number) => t < b && t + H > a;
  const enExp = (t: number) => toca(t, ini.getTime(), fin.getTime());
  const enNat = (t: number) => !!nat && toca(t, nat[0].getTime(), nat[1].getTime());
  const enUc = (t: number) => toca(t, v.inicioUltimoCuarto.getTime(), v.finUltimoCuarto.getTime());
  const dentro = todas.filter(([t]) => enExp(t));
  const iDentro = dentro.length ? todas.findIndex(([t]) => t === dentro[0][0]) : -1;
  const antes = iDentro > 0 ? [todas[iDentro - 1]] : [];
  const despues = iDentro >= 0 && todas[iDentro + dentro.length] ? [todas[iDentro + dentro.length]] : [];
  // Con pronóstico cada 3 h, las horas críticas (último cuarto, natación) que caen entre dos datos se estiman
  // interpolando linealmente entre el dato anterior y el siguiente, y se rotulan como estimadas
  type Fila = Pronostico & { n: number; entre?: [number, number] };
  const criticas: [number, Fila][] = [];
  const marcar = (a: Date, b: Date) => {
    for (let h = Math.floor(a.getTime() / H) * H; h < b.getTime(); h += H) {
      if (serie.has(h) || criticas.some(([x]) => x === h)) continue;
      const prev = [...todas].reverse().find(([t]) => t < h);
      const sig = todas.find(([t]) => t > h);
      if (!prev || !sig) continue;
      const w = (h - prev[0]) / (sig[0] - prev[0]);
      const pa = prev[1] as Fila, pb = sig[1] as Fila;
      const li = (x: number | null | undefined, y: number | null | undefined) => (x == null || y == null ? (w < 0.5 ? x : y) ?? null : x + (y - x) * w);
      const k = { ...(w < 0.5 ? pa : pb) } as Fila & Record<string, unknown>;
      for (const c of ["t2m", "td2m", "hr", "viento10", "rafaga10", "wbgt_est", "radiacion", "nubosidad", "cape", "presion", "uv"] as const) {
        (k as Record<string, unknown>)[c] = li((pa as unknown as Record<string, number | null>)[c], (pb as unknown as Record<string, number | null>)[c]);
      }
      k.precip = pb.precip;
      k.valido = new Date(h).toISOString();
      k.entre = [prev[0], sig[0]];
      criticas.push([h, k]);
    }
  };
  marcar(v.inicioUltimoCuarto, v.finUltimoCuarto);
  if (nat) marcar(nat[0], nat[1]);
  const horas = [...antes, ...dentro, ...despues, ...criticas].sort((a, b) => a[0] - b[0]) as [number, Fila][];
  const fase = (t: number): { txt: string; tipo: "fuera" | "exp" | "uc" } => {
    if (!enExp(t)) return { txt: t < ini.getTime() ? "Antes" : "Después", tipo: "fuera" };
    if (enNat(t)) return { txt: "Natación", tipo: "uc" };
    if (enUc(t)) return { txt: "Último cuarto", tipo: "uc" };
    if (t + H <= v.largada.getTime()) return { txt: "Convocatoria", tipo: "exp" };
    if (t <= v.largada.getTime()) return { txt: "Largada", tipo: "exp" };
    if (t < v.finCarrera.getTime()) return { txt: "Carrera", tipo: "exp" };
    return { txt: "Desconcentración", tipo: "exp" };
  };
  const maxW = dentro.length ? Math.max(...dentro.map(([, p]) => p.wbgt_est ?? -99)) : null;
  const nMax = maxW != null && maxW > -99 ? escala.nivel(maxW) : null;
  const pasoH = Math.round(paso / 3600_000);
  const quien = participantes(ev.disciplina);

  return (
    <section className="seccion dc" style={{ background: "var(--superficie)", border: "1px solid var(--borde)", borderRadius: 12, overflow: "hidden" }}>
      <div className="banda dc-banda">
        <h2>Día de carrera · {fmtDia(v.largada.toISOString())}</h2>
        <span className="dc-pills">
          {horas.length > 0 && <span className="dc-pill">Pronóstico cada {pasoH} h</span>}
          <span className="dc-pill">Escala {escala.autor}</span>
        </span>
      </div>
      <div className="dc-cuerpo">
        {v.duracionMin < 15 && (
          <div className="dc-revisar"><b>Revisar dato</b><span>La duración del evento es de {Math.round(v.duracionMin)} min: la carrera y el último cuarto quedan casi sin ventana. Corregila en Editar.</span></div>
        )}
        <div>
          <div className="rotulo" style={{ marginBottom: 10 }}>Ventanas del día</div>
          <Gantt v={v} ev={ev} puntos={todas.map(([t]) => t)} enTarjetas={new Set(horas.map(([t]) => t))} quien={quien} />
        </div>
        <div>
          <div className="rotulo" style={{ marginBottom: 10 }}>Hora por hora</div>
          {horas.length === 0 ? (
            <p className="chico" style={{ margin: 0 }}>El pronóstico del día de carrera aparece cuando la largada entra en el horizonte de los modelos (6 días).</p>
          ) : (
            <div className="dc-horas">
              {horas.map(([t, p]) => {
                const f = fase(t);
                const n = escala.nivel(p.wbgt_est) ?? 0;
                const st = conWct ? wct(p.t2m, p.viento10) : null;
                const icono = iconoTiempo(p, (p.radiacion ?? 0) < 5);
                const cat = p.uv != null ? categoriaUv(p.uv) : null;
                const iCat = cat ? UV_CATEGORIAS.indexOf(cat) : -1;
                return (
                  <article key={t} className={`dc-h ${f.tipo}`}>
                    <div className="dc-h-cab">
                      <b>{fmtHora(p.valido)}</b>
                      <span className={`dc-chip ${f.tipo}`}>{f.txt}</span>
                    </div>
                    {p.entre && <div className="dc-estimado">Estimado entre {fmtHora(new Date(p.entre[0]).toISOString())} y {fmtHora(new Date(p.entre[1]).toISOString())}</div>}
                    <div className="dc-wbgt" style={estiloCalor(escala.variable, n)}>
                      <span className="lab"><small>WBGT</small>{escala.niveles[n]}</span>
                      <span className="val">{num(p.wbgt_est, 1)}<small>°C</small></span>
                    </div>
                    <div className="dc-cielo">
                      <Icono tipo={icono} size={40} />
                      <span className="t">{num(p.t2m)}<small>°C</small></span>
                      <span className="c">{CONDICION[icono] ?? ""}</span>
                    </div>
                    <div className="dc-datos">
                      <div>
                        <span className="rotulo">Viento</span>
                        <span className="v"><span className="flecha" style={{ transform: `rotate(${(p.dir_viento ?? 0) + 180}deg)` }}>↑</span>{num(p.viento10)} <small>km/h</small></span>
                        <span className="sub">ráfaga {num(p.rafaga10)}{p.dir_viento != null ? ` · del ${cardinal(p.dir_viento)}` : ""}</span>
                      </div>
                      <div><span className="rotulo">Humedad</span><span className="v">{num(p.hr)} <small>%</small></span></div>
                      <div>
                        <span className="rotulo">UV</span>
                        <span className="v">{p.uv != null ? Math.round(p.uv) : "—"} <small>{cat ? (p.uv! < 0.5 ? "Sin sol" : cat.nombre) : "sin dato"}</small></span>
                        <span className="dc-uvb" aria-hidden>{UV_CATEGORIAS.map((c, k) => <i key={c.nombre} style={p.uv != null && p.uv >= 0.5 && k <= iCat ? { background: c.oms } : undefined} />)}</span>
                      </div>
                      <div><span className="rotulo">Lluvia</span><span className="v">{num(p.precip, 1)} <small>mm/h</small></span></div>
                      {st != null && (
                        <div className="ancho" title={`Sensación térmica por viento: riesgo ${riesgoWct(st).toLowerCase()} (informativo)`}>
                          <span className="rotulo">Sensación térmica</span><span className="v">{num(st)} <small>°C · informativa</small></span>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <div className="rotulo" style={{ marginBottom: 10 }}>Escala WBGT{nMax != null ? ` · máximo previsto en la exposición de los ${quien}` : ""}</div>
          <div className={`dc-escala${nMax != null ? " con-marca" : ""}`}>
            {escala.rangos.map((r, i) => (
              <div key={r} style={{ ...estiloCalor(escala.variable, i), ...(i === nMax ? { outline: "3px solid #FF6A1A", outlineOffset: -3 } : {}) }}>
                {i === nMax && <span className="marca">{num(maxW, 1)} °C</span>}
                <b>{escala.niveles[i]}</b><span>{r}</span>
              </div>
            ))}
          </div>
        </div>
        <span className="chico">Escala y colores WBGT: {escala.variable === "wbgt" ? "World Athletics (2020), Tabla 1; «Riesgo bajo» corresponde a «Almost Safe»" : escala.variable === "wbgt_wt" ? "World Triathlon, regla 10.3 (banderas)" : "UCI, Parte 2, Anexo C (zonas)"}{conWct ? " · sensación térmica por viento informativa (sin umbral de decisión)" : ""} · viento medio y ráfaga en km/h a 10 m, con la dirección de donde viene · {FUENTE_UV} · las horas fuera de la exposición se muestran atenuadas como contexto.</span>
      </div>
    </section>
  );
}

/** Ventanas del día como carriles sobre una misma escala horaria */
function Gantt({ v, ev, puntos, enTarjetas, quien }: { v: ReturnType<typeof calcular>; ev: Evento; puntos: number[]; enTarjetas: Set<number>; quien: string }) {
  const H = 3600_000;
  const t0 = Math.floor(horaDec(v.personal[0]) / H) * H;
  const t1 = Math.ceil(horaDec(v.personal[1]) / H) * H;
  const total = t1 - t0;
  const pos = (t: number) => `${((t - t0) / total) * 100}%`;
  const ancho = (a: Date, b: Date) => `max(6px, ${((b.getTime() - a.getTime()) / total) * 100}%)`;
  const horasTot = total / H;
  const cada = horasTot > 12 ? 3 : 2;
  const marcas: number[] = [];
  for (let t = t0; t <= t1; t += H) if (Math.round((t - t0) / H) % cada === 0) marcas.push(t);
  const fondo = { ["--h" as string]: `${100 / horasTot}%` } as React.CSSProperties;
  const fila = (lab: string, a: Date, b: Date, extra: React.ReactNode, clase = "") => (
    <>
      <div className={`dc-g-lab ${clase}`}><b>{lab}</b><span>{fmtHora(a.toISOString())} → {fmtHora(b.toISOString())}</span></div>
      <div className="dc-g-carril" style={fondo}>{extra}</div>
    </>
  );
  const pts = puntos.filter((t) => t >= t0 && t <= t1);
  return (
    <div className="dc-gantt">
      <div />
      <div className="dc-g-eje">{marcas.map((t) => <span key={t} style={{ left: pos(t) }}>{fmtHora(new Date(t).toISOString())}</span>)}</div>
      {fila("Personal", v.personal[0], v.personal[1], <div className="dc-g-barra personal" style={{ left: pos(horaDec(v.personal[0])), width: ancho(v.personal[0], v.personal[1]) }} />)}
      {fila(`Exposición`, v.exposicion[0], v.exposicion[1], <div className="dc-g-barra exp" style={{ left: pos(horaDec(v.exposicion[0])), width: ancho(v.exposicion[0], v.exposicion[1]) }} title={`Exposición de los ${quien}`} />)}
      {v.natacion && fila("Natación", v.natacion[0], v.natacion[1], <div className="dc-g-barra uc" style={{ left: pos(horaDec(v.natacion[0])), width: ancho(v.natacion[0], v.natacion[1]) }} />, "uc")}
      {fila(ev.disciplina === "running" || !ev.disciplina ? "Carrera" : "Prueba", v.largada, v.finCarrera, <>
        <div className="dc-g-barra carrera" style={{ left: pos(horaDec(v.largada)), width: ancho(v.largada, v.finCarrera) }} />
        <div className="dc-g-barra uc" style={{ left: pos(horaDec(v.inicioUltimoCuarto)), width: ancho(v.inicioUltimoCuarto, v.finUltimoCuarto), borderRadius: v.finUltimoCuarto.getTime() >= v.finCarrera.getTime() ? "0 5px 5px 0" : 0 }} />
      </>)}
      {fila("Último cuarto", v.inicioUltimoCuarto, v.finUltimoCuarto, <>
        <div className="dc-g-barra uc" style={{ left: pos(horaDec(v.inicioUltimoCuarto)), width: ancho(v.inicioUltimoCuarto, v.finUltimoCuarto) }} />
        <span className="dc-g-zona" style={{ left: `calc(${pos(horaDec(v.finUltimoCuarto))} + 8px)` }}>Zona crítica</span>
      </>, "uc")}
      <div className="dc-g-lab"><b>Pronóstico</b><span>● horas detalladas</span></div>
      <div className="dc-g-carril pron" style={fondo}>
        {pts.map((t) => <i key={t} className={enTarjetas.has(t) ? "lleno" : ""} style={{ left: pos(t) }} title={fmtHora(new Date(t).toISOString())} />)}
      </div>
      <div className="dc-g-largada" style={{ ["--x" as string]: `${(horaDec(v.largada) - t0) / total}` } as React.CSSProperties}>
        <span>Largada {fmtHora(v.largada.toISOString())}</span>
      </div>
    </div>
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
  const r = reglaDe(n.regla, n.variable);
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
          {(n.variable === "calor_personal" || esVariableCalor(n.variable)) && (
            <p className="chico" style={{ margin: "8px 0 0" }}><b>Cálculo del WBGT · {TIPO_FUENTE[REGLAS.emt_wbgt_viento_min.tipo]}:</b> {REGLAS.emt_wbgt_viento_min.fuente}</p>
          )}
        </details>
      )}
    </article>
  );
}

const NOMBRE_MODELO = NOMBRE_FUENTE;
const titulo = (s: string) => s.toLowerCase().replace(/(^|\s|\()\S/g, (m) => m.toUpperCase());

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
  const pw = pesosFuentes(fuentes, sesgos, "t");
  const tot = Object.values(pw).reduce((a, b) => a + b, 0);
  const pesosT = Object.fromEntries(fuentes.map((f) => [f, pw[f] / tot]));
  return (
    <section className="seccion tarjeta" id="ajuste-local">
      <div className="rotulo">Ajuste local y error medido</div>
      <p className="chico" style={{ marginTop: 4 }}>
        Cuánto se equivocó cada modelo en la zona del evento en las últimas 72 h, comparado con hasta dos estaciones del SMN (observación de cada hora), la corrección que se aplica
        y el peso de cada modelo en el pronóstico combinado: el que menos se equivoca, más pesa. Un sesgo positivo indica que el modelo pronosticaba más temperatura que la observada.
      </p>
      <div className="desplaza">
        <table className="tabla">
          <thead>
            <tr><th>Modelo</th><th>Punto de grilla</th><th>Estación SMN</th><th>Horas comparadas</th><th>Sesgo T día / noche</th><th>Factor viento</th><th>Error T sin / con ajuste</th><th>Error viento sin / con ajuste</th><th>Peso</th><th>Estado</th></tr>
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
                  <td>{s?.estaciones?.length
                    ? s.estaciones.map((e) => `${titulo(e.estacion)} · ${num(e.km, 0)} km`).join(" / ") + (s.atenuacion != null && s.atenuacion < 1 ? ` (se aplica el ${num(s.atenuacion * 100, 0)} %)` : "")
                    : s?.estacion ? `${titulo(s.estacion)} · ${num(s.distancia_km, 0)} km` : "Sin estación a menos de 60 km"}</td>
                  <td>{s?.pares ?? 0}</td>
                  <td>{s ? `${firma(s.sesgo_t_dia)} / ${firma(s.sesgo_t_noche)}` : "—"}</td>
                  <td>{s?.factor_viento != null ? `× ${num(s.factor_viento, 2)}` : "—"}</td>
                  <td>{s?.error_t != null ? `${num(s.error_t, 1)} / ${num(s.error_t_corr, 1)} °C` : "—"}</td>
                  <td>{s?.error_viento != null ? `${num(s.error_viento, 0)} / ${num(s.error_viento_corr, 0)} km/h` : "—"}</td>
                  <td>{fuentes.length > 1 ? `${num(pesosT[f] * 100, 0)} %` : "—"}</td>
                  <td>{s?.aplicado ? "Corrección aplicada" : s?.pares ? "Midiendo (faltan horas comparables)" : "Sin datos todavía"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="chico" style={{ marginBottom: 0 }}>
        El error "con ajuste" se mide sobre las mismas horas usadas para calcular la corrección: es una referencia de cuánto mejora, no una garantía para el día de la carrera.
        Mientras algún modelo no tenga error medido, todos pesan lo mismo. El WRF del SMN cubre las primeras 72 h.
        La corrección no reemplaza las mediciones en terreno ni las alertas del SMN.
      </p>
    </section>
  );
}

/** Color legible del nivel sobre fondo claro: los tonos muy claros (WBGT «Precaución», blanco) pasan a texto oscuro */
function colorTextoNivel(c: string): string {
  const x = c.replace("#", "");
  if (x.length !== 6) return "var(--texto)";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "var(--texto)" : c;
}
