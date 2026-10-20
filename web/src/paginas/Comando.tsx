import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Icono, iconoTiempo } from "../componentes/Icono";
import {
  COLOR_SMN, estadoRayosGLM, fmtFechaHora, fmtHora, kmPorTrueno, nivelRayoMedido, nivelWBGT, num, ordenarAlertas, supabase, tituloAlerta,
  type AlertaSMN, type Evento, type Medicion, type Nivel, type Pronostico, type Rayo,
} from "../datos";
import { ESTILO_SIN_DATOS, estiloNivel, estiloVariable, estiloWA, NOMBRE_CORTO, NOMBRE_FASE, NOMBRE_WA, nombreNivel, recomendacion } from "../reglas";
import { consenso } from "../serie";
import { calcular } from "../ventanas";

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
  const [ahora, setAhora] = useState(Date.now());

  const cargar = useCallback(async () => {
    if (!id) return;
    const [e, p, n, a, m, r] = await Promise.all([
      supabase.from("mon_eventos").select("*, mon_modalidades(*)").eq("id", id).single(),
      supabase.from("mon_pronosticos").select("*").eq("evento_id", id).order("valido").limit(5000),
      supabase.from("mon_niveles").select("*").eq("evento_id", id).order("desde").limit(5000),
      supabase.from("mon_alertas_smn").select("*").eq("evento_id", id).neq("estado", "levantada"),
      supabase.from("mon_mediciones").select("*").eq("evento_id", id).order("tomada_en", { ascending: false }).limit(50),
      supabase.from("mon_rayos").select("*").eq("evento_id", id).gte("ocurrido_en", new Date(Date.now() - 60 * 60_000).toISOString()).limit(2000),
    ]);
    if (e.data) setEv(e.data as Evento);
    setPron((p.data as Pronostico[]) ?? []);
    setNiveles((n.data as Nivel[]) ?? []);
    setAlertas(ordenarAlertas(((a.data as AlertaSMN[]) ?? []).filter((x) => !x.hasta || new Date(x.hasta).getTime() > Date.now())));
    setMeds((m.data as Medicion[]) ?? []);
    setRayos((r.data as Rayo[]) ?? []);
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

  const serie = useMemo(() => consenso(pron), [pron]);
  if (!ev) return <div className="comando"><p style={{ padding: 40 }}>Cargando…</p></div>;
  const v = calcular(ev);

  // Fase y reloj de carrera
  const t = ahora;
  const fase = t < v.armado[1].getTime() ? "Armado"
    : t < v.largada.getTime() ? "Previa a la largada"
    : t < v.inicioUltimoCuarto.getTime() ? "Carrera en curso"
    : t <= v.finCarrera.getTime() ? "Último cuarto"
    : t <= v.desarme[1].getTime() ? "Desarme" : "Finalizado";
  const min = Math.round((t - v.largada.getTime()) / 60_000);
  const reloj = min < 0 ? `Largada en ${Math.floor(-min / 60)} h ${-min % 60} min` : t <= v.finCarrera.getTime() ? `Carrera: ${Math.floor(min / 60)} h ${min % 60} min` : "";

  // Hora actual del pronóstico y próximas 6 horas
  const horas = [...serie.entries()].filter(([h]) => h >= t - 3600_000).slice(0, 7);
  const actualP = horas[0]?.[1];

  // Medición vigente: reemplaza al estimado
  const medW = meds.find((m) => m.wbgt != null && t - new Date(m.tomada_en).getTime() < VIGENCIA_MEDICION);
  const medV = meds.find((m) => m.rafaga != null && t - new Date(m.tomada_en).getTime() < VIGENCIA_MEDICION);
  const medR = meds.find((m) => nivelRayoMedido(m) != null && t - new Date(m.tomada_en).getTime() < VIGENCIA_RAYO);
  const wbgt = medW?.wbgt ?? actualP?.wbgt_est ?? null;
  const nW = nivelWBGT(wbgt);
  const rafaga = medV?.rafaga ?? actualP?.rafaga10 ?? null;
  const nivelesAhora = niveles.filter((n) => new Date(n.desde).getTime() <= t && new Date(n.hasta).getTime() > t);
  const tormentaPron = Math.max(0, ...nivelesAhora.filter((n) => n.variable === "tormenta").map((n) => n.nivel));
  const nMed = medR ? nivelRayoMedido(medR) ?? 0 : null;
  const glm = estadoRayosGLM(rayos, t);
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

  return (
    <div className="comando">
      <header className="cmd-cab">
        <div>
          <div className="cmd-evento">{ev.nombre}</div>
          <div className="cmd-sub">{ev.ubicacion} · largada {fmtFechaHora(ev.largada)}</div>
        </div>
        <div className="cmd-fase">
          <div>{fase}</div>
          {reloj && <span>{reloj}</span>}
        </div>
        <div className="cmd-reloj">
          {new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t))}
          <span>
            <button onClick={pantallaCompleta}>Pantalla completa</button>
            <Link to={`/evento/${ev.id}/carrera`}>Salir</Link>
          </span>
        </div>
      </header>

      {alertas.map((a) => (
        <div key={a.id} className="cmd-alerta alerta" style={{ background: COLOR_SMN[a.color] }} role="alert">
          <b>{tituloAlerta(a)}</b>
          <span>{a.desde ? fmtHora(a.desde) : "ahora"} → {a.hasta ? fmtFechaHora(a.hasta) : "sin fin informado"}</span>
        </div>
      ))}

      <section className="cmd-grilla">
        <div className="cmd-celda">
          <div className="cmd-rot">WBGT {medW ? "medido" : "estimado"}</div>
          <div className="cmd-valor">{num(wbgt, 1)}<small>°C</small></div>
          {nW == null ? <span className="badge cmd-badge" style={ESTILO_SIN_DATOS}>Sin dato</span> : <span className="badge cmd-badge" style={estiloWA(nW)}>{NOMBRE_WA[nW]}</span>}
          <div className="cmd-nota">{medW ? `${medW.sector} · ${fmtHora(medW.tomada_en)}` : "Modelos · sin medición en la última hora"}</div>
        </div>
        <div className="cmd-celda">
          <div className="cmd-rot">Ráfaga {medV ? "medida" : "estimada"}</div>
          <div className="cmd-valor">{num(rafaga)}<small>km/h</small></div>
          {(() => {
            const nv = Math.max(0, ...nivelesAhora.filter((n) => n.variable.startsWith("viento_")).map((n) => n.nivel));
            const peor = nivelesAhora.filter((n) => n.variable.startsWith("viento_")).sort((a, b) => b.nivel - a.nivel)[0];
            if (!peor && rafaga == null) return <span className="badge cmd-badge" style={ESTILO_SIN_DATOS}>Sin dato</span>;
            return <span className="badge cmd-badge" style={estiloNivel(nv)}>{peor && nv > 0 ? `${nombreNivel(peor.variable, nv)} · ${NOMBRE_CORTO[peor.variable].replace("Viento · ", "")}` : "Bajo umbral"}</span>;
          })()}
          <div className="cmd-nota">{medV ? `${medV.sector} · ${fmtHora(medV.tomada_en)} · a ${num(medV.altura_viento_m, 1)} m` : "Modelos · ráfaga a 10 m"}</div>
        </div>
        <div className="cmd-celda">
          <div className="cmd-rot">Tormenta eléctrica</div>
          <div className="cmd-valor" style={{ fontSize: "clamp(28px, 4vw, 54px)" }}>{nR != null ? NIVEL_RAYO[nR] : tormentaPron > 0 ? "Pronosticada" : "Sin señal"}</div>
          <span className="badge cmd-badge" style={estiloNivel(nR ?? tormentaPron)}>{nR != null ? fuenteR : "Pronóstico"}</span>
          <div className="cmd-nota">
            {glm.cantidad > 0 && <div>Satélite: {glm.cantidad} rayos en 30 min, el más cercano a {num(glm.km, 0)} km ({glm.ultimo ? fmtHora(glm.ultimo) : ""})</div>}
            {medR && <div>Terreno: {medR.trueno ? "trueno audible" : RANGO[medR.rayo_rango ?? ""] ?? ""}{medR.relampago_trueno_s != null ? ` · ≈ ${num(kmPorTrueno(medR.relampago_trueno_s), 1)} km` : ""} · {fmtHora(medR.tomada_en)}</div>}
            {!medR && glm.cantidad === 0 && "24 km alerta · 19 km demorar · 13 km o trueno: suspender"}
          </div>
        </div>
        <div className="cmd-celda">
          <div className="cmd-rot">Ahora</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {actualP && <Icono tipo={iconoTiempo(actualP)} size={72} />}
            <div className="cmd-valor">{num(medW?.temp ?? actualP?.t2m)}<small>°C</small></div>
          </div>
          <div className="cmd-nota">HR {num(medW?.hr ?? actualP?.hr)} % · lluvia {num(actualP?.precip, 1)} mm/h</div>
        </div>
      </section>

      <section className="cmd-bloque">
        <div className="cmd-rot">Acciones vigentes</div>
        {acciones.length === 0 ? (
          <p className="cmd-nada">Sin acciones vigentes en este momento.</p>
        ) : (
          <ul className="cmd-acciones">
            {acciones.slice(0, 5).map((n) => (
              <li key={n.id} style={{ borderColor: estiloVariable(n.variable, n.nivel).background }}>
                <span className="badge" style={estiloVariable(n.variable, n.nivel)}>{nombreNivel(n.variable, n.nivel)}</span>
                <b>{NOMBRE_CORTO[n.variable]}</b> <span className="cmd-fasecita">{NOMBRE_FASE[n.fase]} · hasta {fmtHora(n.hasta)}</span>
                <p>{recomendacion(n.variable, n.nivel, n.fase)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cmd-bloque">
        <div className="cmd-rot">Próximas horas · pronóstico</div>
        <div className="cmd-horas">
          {horas.map(([h, p]) => {
            const n = nivelWBGT(p.wbgt_est) ?? 0;
            const uc = h >= v.inicioUltimoCuarto.getTime() && h <= v.finCarrera.getTime() + 3600_000;
            return (
              <div key={h} className="cmd-hora" style={uc ? { outline: "3px solid var(--naranja)" } : undefined}>
                <b>{fmtHora(p.valido)}</b>
                <Icono tipo={iconoTiempo(p, (p.radiacion ?? 0) < 5)} size={44} />
                <span>{num(p.t2m)}°</span>
                <span className="cmd-wbgt" style={estiloWA(n)}>WBGT {num(p.wbgt_est, 1)}</span>
                <span className="cmd-chico">ráf. {num(p.rafaga10)}</span>
                <span className="cmd-chico">{num(p.precip, 1)} mm/h</span>
              </div>
            );
          })}
        </div>
      </section>

      {meds.length > 0 && (
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
                    nivelRayoMedido(m) != null ? `rayos: ${NIVEL_RAYO[nivelRayoMedido(m) ?? 0].toLowerCase()}` : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      <footer className="cmd-pie">EMERTEAM · Monitoreo ambiental · se actualiza sola</footer>
    </div>
  );
}
