import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CONDICION, Icono, iconoTiempo } from "../componentes/Icono";
import { BotonTema } from "../componentes/BotonTema";
import {
  analizarDetector,
  COLOR_SMN, estadoRayosGLM, fmtFechaHora, fmtHora, kmPorTrueno, nivelRayoMedido, num, ordenarAlertas, supabase, tituloAlerta,
  type AlertaSMN, type Evento, type Medicion, type Nivel, type Pronostico, type Sesgo, type Uv, type Rayo,
} from "../datos";
import { fijarDisciplina, ESTILO_SIN_DATOS, estiloNivel, estiloVariable, NOMBRE_CORTO, NOMBRE_FASE, nombreNivel, recomendacion } from "../reglas";
import { confDisciplina, escalaCalor, estiloCalor, evaluarAguaAbierta, evaluarAguaTriatlon, nombreDisciplina, riesgoWct, wct } from "../disciplinas";
import { cargarExtrasConsenso, categoriaUv, consenso, UV_CATEGORIAS, type ExtrasConsenso } from "../serie";
import { calcular, fasesDeAlerta } from "../ventanas";

const NIVEL_RAYO = ["Sin actividad", "Vigilar", "Alerta", "Preparar / demorar", "Suspender"];
const RANGO: Record<string, string> = { sin: "Sin actividad", ">24": "Rayos a más de 24 km", "19-24": "Rayos a 19–24 km", "13-19": "Rayos a 13–19 km", "<13": "Rayos a menos de 13 km" };
const VIGENCIA_MEDICION = 60 * 60_000; // una medición vale como "actual" durante 60 min
const VIGENCIA_RAYO = 30 * 60_000; // y una de rayos, 30 min (regla de reanudación)

/** Dashboard del día del evento: lo que pasa ahora y en las próximas horas, para proyectar el día del evento */
export function Comando() {
  const { id } = useParams();
  const [ev, setEv] = useState<Evento | null>(null);
  const [pron, setPron] = useState<Pronostico[]>([]);
  const [niveles, setNiveles] = useState<Nivel[]>([]);
  const [alertas, setAlertas] = useState<AlertaSMN[]>([]);
  const [meds, setMeds] = useState<Medicion[]>([]);
  const [rayos, setRayos] = useState<Rayo[]>([]);
  const [uv, setUv] = useState<Uv[]>([]);
  const [sesgos, setSesgos] = useState<Sesgo[]>([]);
  const [extras, setExtras] = useState<ExtrasConsenso | undefined>(undefined);
  const [ahora, setAhora] = useState(Date.now());

  const cargar = useCallback(async () => {
    if (!id) return;
    const [e, p, n, a, m, r, u, sg, ex] = await Promise.all([
      supabase.from("mon_eventos").select("*, mon_modalidades(*)").eq("id", id).single(),
      supabase.from("mon_pronosticos").select("*").eq("evento_id", id).order("valido").limit(5000),
      supabase.from("mon_niveles").select("*").eq("evento_id", id).order("desde").limit(5000),
      supabase.from("mon_alertas_smn").select("*").eq("evento_id", id).neq("estado", "levantada"),
      supabase.from("mon_mediciones").select("*").eq("evento_id", id).order("tomada_en", { ascending: false }).limit(50),
      supabase.from("mon_rayos").select("*").eq("evento_id", id).gte("ocurrido_en", new Date(Date.now() - 60 * 60_000).toISOString()).limit(2000),
      supabase.from("mon_uv").select("evento_id,valido,uv,interpolado").eq("evento_id", id).order("valido").limit(1000),
      supabase.from("mon_sesgos").select("*").eq("evento_id", id),
      cargarExtrasConsenso(id),
    ]);
    if (e.data) setEv(e.data as Evento);
    setExtras(ex);
    setSesgos((sg.data as Sesgo[]) ?? []);
    setPron((p.data as Pronostico[]) ?? []);
    setNiveles((n.data as Nivel[]) ?? []);
    setAlertas(ordenarAlertas(((a.data as AlertaSMN[]) ?? []).filter((x) => !x.hasta || new Date(x.hasta).getTime() > Date.now())));
    setMeds((m.data as Medicion[]) ?? []);
    setRayos((r.data as Rayo[]) ?? []);
    setUv((u.data as Uv[]) ?? []);
  }, [id]);

  useEffect(() => {
    void cargar();
    const canal = supabase.channel(`comando-${id}`);
    for (const tabla of ["mon_niveles", "mon_alertas_smn", "mon_mediciones", "mon_rayos"]) {
      canal.on("postgres_changes", { event: "*", schema: "public", table: tabla, filter: `evento_id=eq.${id}` }, () => void cargar());
    }
    canal.subscribe();
    const reloj = setInterval(() => setAhora(Date.now()), 15_000);
    const recarga = setInterval(() => void cargar(), 5 * 60_000);
    // Evita que la pantalla se apague mientras está proyectada
    let bloqueo: { release: () => Promise<void> } | null = null;
    (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request("screen").then((b) => { bloqueo = b; }).catch(() => undefined);
    return () => { clearInterval(reloj); clearInterval(recarga); void supabase.removeChannel(canal); void bloqueo?.release(); };
  }, [cargar, id]);

  const serie = useMemo(() => consenso(pron, uv, sesgos, extras), [pron, uv, sesgos, extras]);
  fijarDisciplina(ev?.disciplina);
  if (!ev) return <div className="comando"><p style={{ padding: 40 }}>Cargando…</p></div>;
  const v = calcular(ev);
  const det = analizarDetector(meds, ahora);

  // Fase y reloj de carrera
  const t = ahora;
  const fase = t < v.armado[1].getTime() ? "Armado"
    : t < v.largada.getTime() ? "Previa a la largada"
    : t < v.inicioUltimoCuarto.getTime() ? "Carrera en curso"
    : t <= v.finUltimoCuarto.getTime() ? "Último cuarto"
    : t <= v.finCarrera.getTime() ? "Carrera · llegada de la cola"
    : t <= v.desarme[1].getTime() ? "Desarme" : "Finalizado";
  const reloj = `Hora ${new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t))}`;

  // Antes de la exposición del día de carrera, el dashboard muestra el pronóstico de la carrera (no el del armado).
  // Desde la exposición en adelante, lo que pasa ahora: mediciones, rayos en tiempo real y próximas horas.
  const previa = t < v.exposicion[0].getTime();
  const H = 3600_000;
  const todas = [...serie.entries()];
  const ventana = todas.filter(([h]) => h + H > v.exposicion[0].getTime() && h < v.exposicion[1].getTime());
  const horas = previa ? ventana.slice(0, 7) : todas.filter(([h]) => h >= t - H).slice(0, 7);
  // Tarjeta de condiciones: en la previa, la hora más cercana a la largada; si no, la hora actual
  const refFila = previa
    ? ventana.reduce<(typeof ventana)[number] | undefined>((m, x) => (!m || Math.abs(x[0] - v.largada.getTime()) < Math.abs(m[0] - v.largada.getTime()) ? x : m), undefined)
    : horas[0];
  const actualP = refFila?.[1];
  const maxEn = (k: "wbgt_est" | "rafaga10") => ventana.reduce<{ v: number; h: number } | null>((m, [h, p]) => (p[k] != null && (!m || Number(p[k]) > m.v) ? { v: Number(p[k]), h } : m), null);
  const wMax = previa ? maxEn("wbgt_est") : null;
  const rMax = previa ? maxEn("rafaga10") : null;

  // Medición vigente: reemplaza al estimado (solo desde la exposición del día de carrera)
  const medW = previa ? undefined : meds.find((m) => m.wbgt != null && t - new Date(m.tomada_en).getTime() < VIGENCIA_MEDICION);
  const medV = previa ? undefined : meds.find((m) => m.rafaga != null && t - new Date(m.tomada_en).getTime() < VIGENCIA_MEDICION);
  const medR = previa ? undefined : meds.find((m) => nivelRayoMedido(m) != null && t - new Date(m.tomada_en).getTime() < VIGENCIA_RAYO);
  const wbgt = previa ? wMax?.v ?? null : medW?.wbgt ?? actualP?.wbgt_est ?? null;
  const escala = escalaCalor(ev.disciplina);
  const nW = escala.nivel(wbgt);
  const conf = confDisciplina(ev.disciplina);
  const medA = conf.agua ? meds.find((m) => m.agua_temp != null) : undefined;
  const agua = medA ? (ev.disciplina === "triatlon" ? evaluarAguaTriatlon(Number(medA.agua_temp), medA.temp != null ? Number(medA.temp) : null, ev.natacion_m ?? null) : evaluarAguaAbierta(Number(medA.agua_temp))) : null;
  const stAhora = conf.wct ? wct(actualP?.t2m, actualP?.viento10) : null;
  const rafaga = previa ? rMax?.v ?? null : medV?.rafaga ?? actualP?.rafaga10 ?? null;
  // Niveles que rigen la pantalla: en la previa, los del día de carrera (carrera y personal); después, los vigentes ahora
  const nivelesAhora = previa
    ? niveles.filter((n) => (n.fase === "carrera" || n.fase === "personal") && new Date(n.hasta).getTime() > t)
    : niveles.filter((n) => new Date(n.desde).getTime() <= t && new Date(n.hasta).getTime() > t);
  const tormentaPron = Math.max(0, ...nivelesAhora.filter((n) => n.variable === "tormenta").map((n) => n.nivel));
  const nMed = medR ? nivelRayoMedido(medR) ?? 0 : null;
  const glm = estadoRayosGLM(previa ? [] : rayos, t);
  // Manda la fuente más conservadora entre detector/trueno en terreno y satélite
  const nR = nMed == null && glm.cantidad === 0 ? null : Math.max(nMed ?? 0, glm.nivel);
  const fuenteR = nMed != null && nMed >= glm.nivel ? "Detector en terreno" : "Satélite GLM";

  // Acciones vigentes ahora (nivel 2 o más), sin repetir variable
  const acciones = Object.values(
    nivelesAhora.filter((n) => n.nivel >= 2).reduce<Record<string, Nivel>>((acc, n) => {
      const k = `${n.variable}|${n.fase}`;
      if (!acc[k] || n.nivel > acc[k].nivel) acc[k] = n;
      return acc;
    }, {}),
  ).sort((a, b) => b.nivel - a.nivel);

  const pantallaCompleta = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  // Hora de las tarjetas por hora: en qué tramo del evento cae
  const tramo = (h: number): { txt: string; tipo: "" | "exp" | "uc" } => {
    const L = v.largada.getTime();
    if (h >= v.inicioUltimoCuarto.getTime() && h <= v.finUltimoCuarto.getTime()) return { txt: "Último cuarto", tipo: "uc" };
    if (h <= L && L - h < 3600_000) return { txt: "Largada", tipo: "exp" };
    if (h > L && h < v.finCarrera.getTime()) return { txt: "Carrera", tipo: "exp" };
    if (h >= v.exposicion[0].getTime() && h < L) return { txt: "Convocatoria", tipo: "" };
    return { txt: "", tipo: "" };
  };
  const vientoPeor = nivelesAhora.filter((n) => n.variable.startsWith("viento_")).sort((a, b) => b.nivel - a.nivel)[0];
  const nViento = vientoPeor?.nivel ?? 0;
  const iconoAhora = actualP ? iconoTiempo(actualP, (actualP.radiacion ?? 0) < 5) : null;
  // Rayo más cercano informado (detector, trueno o satélite) para la barra de distancias
  const kmRayo = medR?.trueno ? 5 : medR?.rayo_km != null ? Number(medR.rayo_km) : glm.cantidad > 0 && glm.km != null ? glm.km : null;
  const accionesVisibles = acciones.slice(0, meds.length && !previa ? 3 : 4);

  return (
    <div className="comando">
      <header className="cmd-cab">
        <div style={{ minWidth: 0 }}>
          <div className="cmd-evento">{ev.nombre}</div>
          <div className="cmd-sub">{ev.disciplina && ev.disciplina !== "running" ? `${nombreDisciplina(ev.disciplina)} · ` : ""}{ev.ubicacion} · largada {fmtFechaHora(ev.largada)}</div>
        </div>
        <div className="cmd-fase">
          <div>{fase}</div>
          <span>{reloj}{previa ? " · vista del día de carrera" : ""}</span>
        </div>
        <div className="cmd-reloj">
          <Cuenta largada={v.largada.getTime()} fin={v.finCarrera.getTime()} />
        </div>
        <div className="cmd-botones">
          <BotonTema />
          <button onClick={pantallaCompleta}>Pantalla completa</button>
          <Link to={`/evento/${ev.id}/carrera`}>Salir</Link>
        </div>
      </header>

      {alertas.filter((a) => fasesDeAlerta(a, v).length > 0).map((a) => (
        <div key={a.id} className="cmd-alerta alerta" style={{ background: COLOR_SMN[a.color] }} role="alert">
          <b>{tituloAlerta(a)}</b>
          <span>{a.desde ? fmtHora(a.desde) : "ahora"} → {a.hasta ? fmtFechaHora(a.hasta) : "sin fin informado"}</span>
        </div>
      ))}

      <section className="cmd-grilla">
        <div className="cmd-celda">
          <div className="cmd-celda-cab"><Icono tipo="termometro" size={30} /><span className="cmd-rot">{previa ? "WBGT máximo · carrera" : `WBGT ${medW ? "medido" : "estimado"}`}</span></div>
          <div className="cmd-valor">{num(wbgt, 1)}<small>°C</small></div>
          {nW == null ? <span className="badge cmd-badge" style={ESTILO_SIN_DATOS}>Sin dato</span> : <span className="badge cmd-badge" style={estiloCalor(escala.variable, nW)}>{escala.niveles[nW]}</span>}
          <div className="cmd-escala" aria-label={`Escala ${escala.autor}`}>
            {escala.rangos.map((r, i) => (
              <div key={r} className={i === nW ? "activo" : undefined} style={estiloCalor(escala.variable, i)} title={`${escala.niveles[i]} · ${r}`}>
                <span>{r.replace(" °C", "")}</span>
              </div>
            ))}
          </div>
          <div className="cmd-nota">{previa ? (wMax ? `A las ${fmtHora(new Date(wMax.h).toISOString())} · pronóstico` : "Sin pronóstico para la carrera todavía") : medW ? `${medW.sector} · ${fmtHora(medW.tomada_en)}` : "Modelos · sin medición en la última hora"} · escala {escala.autor}</div>
        </div>

        <div className="cmd-celda">
          <div className="cmd-celda-cab"><Icono tipo="viento" size={30} /><span className="cmd-rot">{previa ? "Ráfaga máxima · carrera" : `Ráfaga ${medV ? "medida" : "estimada"}`}</span></div>
          <div className="cmd-valor">{num(rafaga)}<small>km/h</small></div>
          {!vientoPeor && rafaga == null
            ? <span className="badge cmd-badge" style={ESTILO_SIN_DATOS}>Sin dato</span>
            : <span className="badge cmd-badge" style={estiloNivel(nViento)}>{vientoPeor && nViento > 0 ? `${nombreNivel(vientoPeor.variable, nViento)} · ${NOMBRE_CORTO[vientoPeor.variable].replace("Viento · ", "")}` : "Bajo umbral"}</span>}
          <div className="cmd-viento">
            <span className="cmd-brujula" aria-hidden>
              <span className="flecha" style={{ transform: `rotate(${(actualP?.dir_viento ?? 0) + 180}deg)` }}>↑</span>
            </span>
            <span>
              <b>{num(actualP?.viento10)} km/h</b> viento medio
              <small>{actualP?.dir_viento != null ? `del ${cardinal(actualP.dir_viento)}` : "dirección sin dato"}</small>
            </span>
          </div>
          <div className="cmd-nota">{previa ? (rMax ? `A las ${fmtHora(new Date(rMax.h).toISOString())} · pronóstico a 10 m` : "Sin pronóstico para la carrera todavía") : medV ? `${medV.sector} · ${fmtHora(medV.tomada_en)} · a ${num(medV.altura_viento_m, 1)} m` : "Modelos · a 10 m"}</div>
        </div>

        <div className="cmd-celda">
          <div className="cmd-celda-cab"><Icono tipo="rayo" size={30} /><span className="cmd-rot">Tormenta eléctrica{previa ? " · carrera" : ""}</span></div>
          <div className="cmd-valor cmd-valor-txt">{nR != null ? NIVEL_RAYO[nR] : tormentaPron > 0 ? "Pronosticada" : "Sin señal"}</div>
          <span className="badge cmd-badge" style={estiloNivel(nR ?? tormentaPron)}>{nR != null ? fuenteR : "Pronóstico"}</span>
          <div className="cmd-rayos" aria-label="Distancias del protocolo de tormenta">
            {[["> 24 km", 1], ["24–19", 2], ["19–13", 3], ["< 13 · trueno", 4]].map(([txt, n]) => {
              const activo = kmRayo != null && (n === 1 ? kmRayo > 24 : n === 2 ? kmRayo <= 24 && kmRayo > 19 : n === 3 ? kmRayo <= 19 && kmRayo > 13 : kmRayo <= 13);
              return (
                <div key={String(n)} className={activo ? "activo" : undefined} style={estiloNivel(Number(n))}>
                  <span>{txt}</span>
                </div>
              );
            })}
          </div>
          <div className="cmd-nota">
            {glm.cantidad > 0 && <div>Satélite · {glm.cantidad} rayos en 30 min, el más cercano a {num(glm.km, 0)} km ({glm.ultimo ? fmtHora(glm.ultimo) : ""})</div>}
            {medR && <div>Terreno · {medR.trueno ? "trueno audible" : medR.rayo_km != null ? `detector ${num(medR.rayo_km, 0)} km` : RANGO[medR.rayo_rango ?? ""] ?? ""}{medR.relampago_trueno_s != null ? ` · ≈ ${num(kmPorTrueno(medR.relampago_trueno_s), 1)} km` : ""} · {fmtHora(medR.tomada_en)}</div>}
            {det.tendencia && det.tendencia !== "estable" && <div><b>{det.tendencia === "acerca" ? "Se acerca" : "Se aleja"}</b> a ≈ {num(Math.abs(det.velocidad ?? 0))} km/h{det.minutosA19 != null ? ` · 19 km en ≈ ${det.minutosA19} min` : ""}{det.minutosA13 != null ? ` · 13 km en ≈ ${det.minutosA13} min` : ""}</div>}
            {det.reanudar && new Date(det.reanudar).getTime() > ahora && <div><b>Reanudar no antes de las {fmtHora(det.reanudar)}</b></div>}
            {!medR && glm.cantidad === 0 && "Alerta a 24 km · demorar a 19 km · suspender a 13 km o con trueno"}
          </div>
        </div>

        <div className="cmd-celda">
          <div className="cmd-celda-cab"><span className="cmd-rot">{previa ? `Largada${refFila ? ` · ${fmtHora(new Date(refFila[0]).toISOString())}` : ""}` : "Ahora"}</span></div>
          <div className="cmd-ahora">
            {iconoAhora && <Icono tipo={iconoAhora} size={64} />}
            <div>
              <div className="cmd-valor">{num(medW?.temp ?? actualP?.t2m)}<small>°C</small></div>
              <div className="cmd-nota">{iconoAhora ? CONDICION[iconoAhora] ?? "" : "Sin pronóstico"}</div>
            </div>
          </div>
          <div className="dc-datos cmd-datos">
            <div><span className="rotulo">Humedad</span><span className="v"><Icono tipo="humedad" size={18} />{num(medW?.hr ?? actualP?.hr)} <small>%</small></span></div>
            <div><span className="rotulo">Lluvia</span><span className="v"><Icono tipo="gota" size={18} />{num(actualP?.precip, 1)} <small>mm/h</small></span></div>
            <div>
              <span className="rotulo">UV</span>
              <span className="v">{actualP?.uv != null ? Math.round(actualP.uv) : "—"} <small>{actualP?.uv != null ? (actualP.uv < 0.5 ? "Sin sol" : categoriaUv(actualP.uv).nombre) : "sin dato"}</small></span>
              <BarraUv uv={actualP?.uv} />
            </div>
            {stAhora != null
              ? <div title="Sensación térmica por viento (informativa)"><span className="rotulo">Sensación</span><span className="v">{num(stAhora)} <small>°C · {riesgoWct(stAhora).toLowerCase()}</small></span></div>
              : <div><span className="rotulo">Nubosidad</span><span className="v">{num(actualP?.nubosidad)} <small>%</small></span></div>}
          </div>
        </div>
      </section>

      {conf.agua && (
        <section className="cmd-bloque">
          <div className="cmd-rot">Agua</div>
          {medA && agua ? (
            <p style={{ margin: 0, fontSize: 16 }}>
              <span className="badge" style={estiloNivel(agua.estado === "ok" ? 0 : agua.estado === "reducir" ? 3 : 4)}>{agua.titulo}</span>{" "}
              Agua {num(medA.agua_temp, 1)} °C · {medA.sector} · {fmtHora(medA.tomada_en)}
              <span className="cmd-nota" style={{ display: "block" }}>{agua.detalle.join(" ")}</span>
            </p>
          ) : <p className="cmd-nada">Sin medición de la temperatura del agua.</p>}
        </section>
      )}

      <section className="cmd-bloque">
        <div className="cmd-rot">{previa ? `Día de carrera · ${fmtFechaHora(v.exposicion[0].toISOString())} a ${fmtHora(v.exposicion[1].toISOString())} · pronóstico` : "Próximas horas · pronóstico"}</div>
        {horas.length === 0 ? <p className="cmd-nada">{previa ? "El día de carrera todavía está fuera del pronóstico. Se completa solo." : "Sin pronóstico para las próximas horas. Se completa con la próxima actualización de los modelos."}</p> : (
          <div className="cmd-horas">
            {horas.map(([h, p]) => {
              const n = escala.nivel(p.wbgt_est) ?? 0;
              const tr = tramo(h);
              const ic = iconoTiempo(p, (p.radiacion ?? 0) < 5);
              return (
                <article key={h} className={`dc-h ${tr.tipo}`}>
                  <div className="dc-h-cab">
                    <b>{fmtHora(p.valido)}</b>
                    {tr.txt && <span className={`dc-chip ${tr.tipo}`}>{tr.txt}</span>}
                  </div>
                  <div className="dc-wbgt" style={estiloCalor(escala.variable, n)}>
                    <span className="lab"><small>WBGT</small>{escala.niveles[n]}</span>
                    <span className="val">{num(p.wbgt_est, 1)}<small>°C</small></span>
                  </div>
                  <div className="dc-cielo">
                    <Icono tipo={ic} size={34} />
                    <span className="t">{num(p.t2m)}<small>°C</small></span>
                  </div>
                  <div className="dc-datos">
                    <div>
                      <span className="rotulo">Viento</span>
                      <span className="v"><span className="flecha" style={{ transform: `rotate(${(p.dir_viento ?? 0) + 180}deg)` }}>↑</span>{num(p.viento10)}</span>
                      <span className="sub">ráf. {num(p.rafaga10)}</span>
                    </div>
                    <div><span className="rotulo">Humedad</span><span className="v">{num(p.hr)} <small>%</small></span></div>
                    <div><span className="rotulo">UV</span><span className="v">{p.uv != null ? Math.round(p.uv) : "—"}</span><BarraUv uv={p.uv} /></div>
                    <div><span className="rotulo">Lluvia</span><span className="v">{num(p.precip, 1)} <small>mm</small></span></div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className={`cmd-abajo${meds.length && !previa ? " con-meds" : ""}`}>
        <section className="cmd-bloque">
          <div className="cmd-rot">{previa ? "Acciones previstas · día de carrera" : "Acciones vigentes"}{acciones.length > accionesVisibles.length ? ` · ${accionesVisibles.length} de ${acciones.length}` : ""}</div>
          {acciones.length === 0 ? (
            <p className="cmd-nada">{previa ? "Con el pronóstico actual, ninguna variable supera su umbral en el día de carrera." : "Sin acciones vigentes en este momento."}</p>
          ) : (
            <ul className="cmd-acciones">
              {accionesVisibles.map((n) => (
                <li key={n.id} style={{ borderColor: estiloVariable(n.variable, n.nivel).background }}>
                  <span className="badge" style={estiloVariable(n.variable, n.nivel)}>{nombreNivel(n.variable, n.nivel)}</span>
                  <b>{NOMBRE_CORTO[n.variable]}</b> <span className="cmd-fasecita">{NOMBRE_FASE[n.fase]} · {previa ? `${fmtHora(n.desde)} a ${fmtHora(n.hasta)}` : `hasta ${fmtHora(n.hasta)}`}{n.confianza === "baja" ? " · tendencia" : ""}</span>
                  <p>{recomendacion(n.variable, n.nivel, n.fase)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {meds.length > 0 && !previa && (
          <section className="cmd-bloque">
            <div className="cmd-rot">Últimas mediciones en terreno</div>
            <div className="cmd-meds">
              {meds.slice(0, 4).map((m) => (
                <div key={m.id}>
                  <b>{fmtHora(m.tomada_en)} · {m.sector}</b>
                  <span>
                    {[
                      m.wbgt != null ? `WBGT ${num(m.wbgt, 1)}` : null,
                      m.rafaga != null ? `ráf. ${num(m.rafaga)} km/h` : null,
                      nivelRayoMedido(m) != null ? `rayos ${NIVEL_RAYO[nivelRayoMedido(m) ?? 0].toLowerCase()}` : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      <footer className="cmd-pie">EMERTEAM | Sports Risks &amp; Emergency Management · se actualiza sola</footer>
    </div>
  );
}

const CARDINAL = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const cardinal = (dir: number) => CARDINAL[Math.round((((dir % 360) + 360) % 360) / 45) % 8];

/** Escala UV de 5 tramos (OMS) con los alcanzados pintados */
function BarraUv({ uv }: { uv: number | null | undefined }) {
  const i = uv != null && uv >= 0.5 ? UV_CATEGORIAS.indexOf(categoriaUv(uv)) : -1;
  return <span className="dc-uvb" aria-hidden>{UV_CATEGORIAS.map((c, k) => <i key={c.nombre} style={k <= i ? { background: c.oms } : undefined} />)}</span>;
}

/** Cuenta regresiva a la largada; durante la carrera, tiempo transcurrido; después, la hora. Se actualiza cada segundo. */
function Cuenta({ largada, fin }: { largada: number; fin: number }) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const hms = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
  };
  const [valor, rotulo] = t < largada ? [hms(largada - t), "para la largada"]
    : t <= fin ? [hms(t - largada), "de carrera"]
    : [new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t)), "hora"];
  return (
    <>
      {valor}
      <small className="cmd-reloj-rot">{rotulo}</small>
    </>
  );
}
