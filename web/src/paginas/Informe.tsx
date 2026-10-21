import { useCallback, useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import type { Ctx } from "../main";
import { Barra } from "../componentes/Barra";
import { fmtDia, fmtFechaHora, fmtHora, num, supabase, type AlertaSMN, type Evento, type Medicion, type Pronostico, type Rayo, type Sesgo, type Uv } from "../datos";
import { armarInforme, type FaseInforme, type FilaHistorial, type Informe as TInforme, type Pico, type RecoInforme } from "../informe";
import { fijarDisciplina, estiloVariable, NOMBRE_VARIABLE, nombreNivel } from "../reglas";
import { categoriaUv } from "../serie";
import { escalaCalor, participantes } from "../disciplinas";

type Registro = {
  evento_id: string; estado: "borrador" | "aprobado"; notas_corredores: string | null; notas_trabajadores: string | null;
  actualizado_por: string | null; actualizado_en: string; aprobado_por: string | null; aprobado_en: string | null; contenido: TInforme | null;
};

const FASE: Record<string, string> = { armado: "Armado", personal: "Jornada del personal (día de carrera)", desarme: "Desarme", carrera: "Carrera" };
const NIVEL_RAYO = ["sin actividad", "vigilar", "alerta", "preparar o demorar", "suspender"];

const pico = (p: Pico, unidad: string, dec = 0) =>
  p ? `${num(p.valor, dec)}${unidad ? ` ${unidad}` : ""} (${p.sector ? `${p.sector}, ` : ""}${fmtFechaHora(p.hora)})` : "Sin registro";

/** Oraciones del resumen, armadas solo con datos registrados */
function resumen(inf: TInforme): string[] {
  const c = inf.corredores;
  const out: string[] = [];
  const w = c.wbgtMed ?? c.wbgtEst;
  if (w) {
    const e = escalaCalor(inf.evento.disciplina);
    const n = e.nivel(w.valor) ?? 0;
    out.push(`Durante la exposición de los ${participantes(inf.evento.disciplina)} (${fmtHora(inf.ventanas.exposicion[0])} a ${fmtHora(inf.ventanas.exposicion[1])}) el WBGT máximo fue de ${num(w.valor, 1)} °C, ${c.wbgtMed ? `medido en ${c.wbgtMed.sector}` : "estimado por los modelos"} a las ${fmtHora(w.hora)}: nivel «${e.niveles[n]}» de la escala de ${e.autor}.`);
  }
  const r = c.rafagaMed ?? c.rafagaEst;
  if (r) out.push(`La ráfaga máxima fue de ${num(r.valor)} km/h${c.rafagaMed ? ` (medida en ${c.rafagaMed.sector})` : " (estimada a 10 m)"} y la lluvia acumulada en esa ventana, de ${num(c.lluviaMm, 1)} mm.`);
  out.push(c.rayos.cantidad
    ? `El satélite GOES-19 registró ${c.rayos.cantidad} rayos a menos de 24 km durante la exposición; el más cercano, a ${num(c.rayos.minKm, 0)} km a las ${fmtHora(c.rayos.hora ?? inf.ventanas.exposicion[0])}.`
    : `No se registraron rayos a menos de 24 km durante la exposición de los ${participantes(inf.evento.disciplina)}.`);
  out.push(inf.alertas.length
    ? `${inf.alertas.length === 1 ? "Rigió una alerta" : `Rigieron ${inf.alertas.length} alertas`} del SMN para la zona del evento entre el armado y el desarme.`
    : "No hubo alertas del SMN para la zona del evento entre el armado y el desarme.");
  const accionC = c.recos.filter((x) => x.nivel >= 2).length;
  const accionT = inf.trabajadores.reduce((s, f) => s + f.recos.filter((x) => x.nivel >= 2).length, 0);
  out.push(`EMERTEAM emitió ${accionC} ${accionC === 1 ? "recomendación" : "recomendaciones"} de acción para la carrera y ${accionT} para armado, jornada del personal y desarme.`);
  return out;
}

function TablaRecos({ recos }: { recos: RecoInforme[] }) {
  if (!recos.length) return <p className="inf-texto">No se emitieron recomendaciones por encima del umbral.</p>;
  return (
    <table className="inf-tabla">
      <thead><tr><th>Variable</th><th>Nivel máximo</th><th>Franja</th><th>Primera emisión</th></tr></thead>
      <tbody>
        {recos.map((r) => (
          <tr key={`${r.fase}${r.variable}`}>
            <td>{NOMBRE_VARIABLE[r.variable] ?? r.variable}</td>
            <td><span className="inf-nivel" style={estiloVariable(r.variable, r.nivel)}>{nombreNivel(r.variable, r.nivel)}</span></td>
            <td>{fmtDia(r.desde)} {fmtHora(r.desde)} a {fmtDia(r.hasta) === fmtDia(r.desde) ? "" : `${fmtDia(r.hasta)} `}{fmtHora(r.hasta)}</td>
            <td>{fmtFechaHora(r.primera_emision)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Documento({ inf, reg }: { inf: TInforme; reg: Registro | null }) {
  return (
    <article className="inf-doc">
      <header className="inf-cab">
        <img src="/logo-emerteam.png" alt="EMERTEAM" />
        <div>
          <h1>Informe post-evento</h1>
          <p>Monitoreo ambiental · {inf.evento.nombre} · {fmtDia(inf.evento.largada)}</p>
        </div>
      </header>

      <div className="inf-datos">
        <div><span>Evento</span>{inf.evento.nombre}</div>
        <div><span>Largada</span>{fmtFechaHora(inf.evento.largada)}</div>
        <div><span>Lugar</span>{inf.evento.ubicacion}</div>
        <div><span>Modalidades</span>{inf.evento.modalidades} · {inf.evento.participantes.toLocaleString("es-AR")} participantes</div>
      </div>

      <h2 className="inf-banda">Resumen</h2>
      <div className="inf-recuadro">
        {resumen(inf).map((o, i) => <p key={i}>{o}</p>)}
      </div>

      <h2 className="inf-banda" style={{ textTransform: "capitalize" }}>{participantes(inf.evento.disciplina)}</h2>
      <table className="inf-tabla">
        <tbody>
          <tr><th>Exposición de los {participantes(inf.evento.disciplina)}</th><td>{fmtHora(inf.ventanas.exposicion[0])} a {fmtHora(inf.ventanas.exposicion[1])} · último cuarto {fmtHora(inf.ventanas.ultimoCuarto[0])} a {fmtHora(inf.ventanas.ultimoCuarto[1])}</td></tr>
          <tr><th>WBGT medido máximo</th><td>{pico(inf.corredores.wbgtMed, "°C", 1)}</td></tr>
          <tr><th>WBGT estimado máximo</th><td>{pico(inf.corredores.wbgtEst, "°C", 1)}</td></tr>
          <tr><th>Temperatura máxima · humedad media</th><td>{pico(inf.corredores.temperaturaMax, "°C")} · {inf.corredores.humedadMedia != null ? `${inf.corredores.humedadMedia} %` : "sin registro"}{inf.corredores.hrMin != null ? ` (mínima ${inf.corredores.hrMin} %, máxima ${inf.corredores.hrMax} %)` : ""}</td></tr>
          {inf.corredores.uvMax !== undefined && <tr><th>Índice UV máximo (cielo despejado)</th><td>{inf.corredores.uvMax ? `${pico(inf.corredores.uvMax, "")} · ${categoriaUv(inf.corredores.uvMax.valor).nombre}` : "sin registro"}</td></tr>}
          <tr><th>Ráfaga máxima</th><td>{inf.corredores.rafagaMed ? `${pico(inf.corredores.rafagaMed, "km/h")} medida` : `${pico(inf.corredores.rafagaEst, "km/h")} estimada`}</td></tr>
          <tr><th>Lluvia acumulada</th><td>{num(inf.corredores.lluviaMm, 1)} mm</td></tr>
          <tr><th>Tormenta eléctrica</th><td>
            Satélite: {inf.corredores.rayos.cantidad ? `${inf.corredores.rayos.cantidad} rayos a menos de 24 km, el más cercano a ${num(inf.corredores.rayos.minKm, 0)} km` : "sin rayos a menos de 24 km"}
            {inf.corredores.rayosTerreno.detalle && ` · terreno: ${NIVEL_RAYO[inf.corredores.rayosTerreno.nivelMax]}, ${inf.corredores.rayosTerreno.detalle}`}
          </td></tr>
        </tbody>
      </table>
      <h3 className="inf-sub">Recomendaciones emitidas para la carrera</h3>
      <TablaRecos recos={inf.corredores.recos} />
      {reg?.notas_corredores?.trim() && (
        <div className="inf-recuadro inf-notas"><h3 className="inf-sub" style={{ marginTop: 0 }}>Observaciones de EMERTEAM</h3>{reg.notas_corredores.split("\n").filter(Boolean).map((l, i) => <p key={i}>{l}</p>)}</div>
      )}

      <h2 className="inf-banda">Trabajadores · armado, jornada del personal y desarme</h2>
      {inf.trabajadores.map((f: FaseInforme) => (
        <div key={f.fase} className="inf-fase">
          <h3 className="inf-sub">{FASE[f.fase]} · {fmtFechaHora(f.desde)} a {fmtFechaHora(f.hasta)}</h3>
          <table className="inf-tabla">
            <tbody>
              <tr><th>Ráfaga máxima</th><td>{f.rafagaMed ? `${pico(f.rafagaMed, "km/h")} medida` : `${pico(f.rafagaEst, "km/h")} estimada`}</td></tr>
              <tr><th>WBGT estimado máximo</th><td>{pico(f.wbgtEst, "°C", 1)}</td></tr>
              <tr><th>Lluvia acumulada</th><td>{num(f.lluviaMm, 1)} mm</td></tr>
              {f.hrMin !== undefined && <tr><th>Humedad relativa</th><td>{f.hrMin != null ? `${f.hrMin} a ${f.hrMax} %` : "sin registro"}</td></tr>}
              {f.uvMax !== undefined && <tr><th>Índice UV máximo (cielo despejado)</th><td>{f.uvMax ? `${pico(f.uvMax, "")} · ${categoriaUv(f.uvMax.valor).nombre}` : "sin registro"}</td></tr>}
            </tbody>
          </table>
          <TablaRecos recos={f.recos} />
        </div>
      ))}
      {reg?.notas_trabajadores?.trim() && (
        <div className="inf-recuadro inf-notas"><h3 className="inf-sub" style={{ marginTop: 0 }}>Observaciones de EMERTEAM</h3>{reg.notas_trabajadores.split("\n").filter(Boolean).map((l, i) => <p key={i}>{l}</p>)}</div>
      )}

      <h2 className="inf-banda">Alertas oficiales del SMN</h2>
      {inf.alertas.length ? (
        <table className="inf-tabla">
          <thead><tr><th>Alerta</th><th>Vigencia</th></tr></thead>
          <tbody>{inf.alertas.map((a, i) => <tr key={i}><td>{a.titulo}</td><td>{a.desde ? fmtFechaHora(a.desde) : "—"} a {a.hasta ? fmtFechaHora(a.hasta) : "—"}</td></tr>)}</tbody>
        </table>
      ) : <p className="inf-texto">Sin alertas del SMN para la zona del evento.</p>}

      <div className="inf-final">
      <h2 className="inf-banda">Fuentes y método</h2>
      <div className="inf-recuadro inf-chico">
        <p>Pronóstico: modelos ECMWF IFS, NOAA GFS y WRF del SMN (Fuente: Servicio Meteorológico Nacional), combinados según su error medido en la zona. WBGT estimado hora por hora por el método de Liljegren et al. (2008); el WBGT medido en terreno reemplaza al estimado. Escala de estrés térmico: World Athletics (2020), Competition Medical Guidelines, tabla 1.</p>
        <p>Tormenta eléctrica: satélite GOES-19, Geostationary Lightning Mapper (NOAA), y detector y trueno en terreno; distancias de acción según NWS: 24 km alerta, 19 km preparación o demora, 13 km o trueno audible suspensión. Alertas: Servicio Meteorológico Nacional (CAP).</p>
        <p>Viento sobre estructuras y lluvia: criterios EMERTEAM. Estrés térmico del personal: Res. SRT 30/2023.</p>
        <p>Índice UV con cielo despejado: MET Norway, Locationforecast 2.0 (licencia CC BY 4.0); categorías según OMS (2002), Global Solar UV Index. Humedad relativa: modelos, corregida con la estación del SMN más cercana cuando corresponde.</p>
        {reg?.estado === "aprobado" && reg.aprobado_en && <p>Informe aprobado por EMERTEAM el {fmtFechaHora(reg.aprobado_en)}.</p>}
      </div>

      <footer className="inf-pie">
        <span>EMERTEAM | Sports Risks &amp; Emergency Management</span>
        <span>Dirección técnica · Diego A. Pizzini · Licenciado en Protección Civil y Emergencias</span>
      </footer>
      </div>
    </article>
  );
}

export function Informe() {
  const { id } = useParams();
  const { admin, editor, session } = useOutletContext<Ctx>();
  const miEmail = (session.user.email ?? "").toLowerCase();
  const [ev, setEv] = useState<Evento | null>(null);
  const [vivo, setVivo] = useState<TInforme | null>(null);
  const [reg, setReg] = useState<Registro | null>(null);
  const [notasC, setNotasC] = useState("");
  const [notasT, setNotasT] = useState("");
  const [estado, setEstado] = useState("");

  const cargar = useCallback(async () => {
    if (!id) return;
    const [e, r] = await Promise.all([
      supabase.from("mon_eventos").select("*, mon_modalidades(*)").eq("id", id).single(),
      supabase.from("mon_informes").select("*").eq("evento_id", id).maybeSingle(),
    ]);
    if (!e.data) return;
    setEv(e.data as Evento);
    const registro = (r.data as Registro | null) ?? null;
    setReg(registro);
    setNotasC(registro?.notas_corredores ?? "");
    setNotasT(registro?.notas_trabajadores ?? "");
    if (admin) {
      const [p, h, m, ry, a, u, sg] = await Promise.all([
        supabase.from("mon_pronosticos").select("*").eq("evento_id", id).order("valido").limit(5000),
        supabase.from("mon_niveles_historial").select("*").eq("evento_id", id).limit(10000),
        supabase.from("mon_mediciones").select("*").eq("evento_id", id).limit(1000),
        supabase.from("mon_rayos").select("*").eq("evento_id", id).limit(10000),
        supabase.from("mon_alertas_smn").select("*").eq("evento_id", id),
        supabase.from("mon_uv").select("evento_id,valido,uv,interpolado").eq("evento_id", id).order("valido").limit(2000),
        supabase.from("mon_sesgos").select("*").eq("evento_id", id),
      ]);
      setVivo(armarInforme(e.data as Evento, (p.data as Pronostico[]) ?? [], (h.data as FilaHistorial[]) ?? [],
        (m.data as Medicion[]) ?? [], (ry.data as Rayo[]) ?? [], (a.data as AlertaSMN[]) ?? [], (u.data as Uv[]) ?? [], (sg.data as Sesgo[]) ?? []));
    }
  }, [id, admin]);

  useEffect(() => void cargar(), [cargar]);

  async function guardar(aprobar: boolean) {
    if (!id || !vivo) return;
    setEstado("Guardando…");
    const fila = {
      evento_id: id, notas_corredores: notasC.trim() || null, notas_trabajadores: notasT.trim() || null,
      actualizado_por: miEmail, actualizado_en: new Date().toISOString(),
      ...(aprobar ? { estado: "aprobado", aprobado_por: miEmail, aprobado_en: new Date().toISOString(), contenido: vivo } : {}),
    };
    const { error } = await supabase.from("mon_informes").upsert(fila, { onConflict: "evento_id" });
    setEstado(error ? `No se pudo guardar: ${error.message}` : aprobar ? "Aprobado: el organizador ya puede verlo." : "Borrador guardado.");
    void cargar();
  }

  async function volverABorrador() {
    if (!id) return;
    await supabase.from("mon_informes").update({ estado: "borrador", aprobado_por: null, aprobado_en: null }).eq("evento_id", id);
    setEstado("Volvió a borrador: el organizador deja de verlo.");
    void cargar();
  }

  fijarDisciplina(ev?.disciplina);
  if (!ev) return <><Barra titulo="Informe post-evento" /><p className="contenedor" style={{ paddingTop: 26 }}>Cargando…</p></>;
  // El organizador ve la copia aprobada; EMERTEAM ve el borrador con los datos actuales
  const mostrar: TInforme | null = admin ? vivo : reg?.estado === "aprobado" ? reg.contenido : null;

  return (
    <>
      <div className="no-imprimir">
        <Barra titulo={`Informe post-evento · ${ev.nombre}`} subtitulo={reg?.estado === "aprobado" ? "Aprobado" : admin ? "Borrador" : ""}>
          <Link className="boton-osc" to={`/evento/${ev.id}`}>Volver al evento</Link>
          {mostrar && <button className="boton-osc" onClick={() => window.print()}>Imprimir o guardar PDF</button>}
        </Barra>
      </div>
      <main className="contenedor" style={{ paddingTop: 22 }}>
        {editor && vivo && (
          <section className="tarjeta no-imprimir" style={{ marginBottom: 18, display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="rotulo">Revisión de EMERTEAM</div>
            <p className="chico" style={{ margin: 0 }}>
              El informe se arma solo con el pronóstico, las mediciones, los rayos, las alertas y las recomendaciones registradas. Las observaciones son opcionales:
              si quedan vacías, la sección no aparece. Al aprobar se guarda una copia fija y el organizador la ve en la pestaña del evento.
            </p>
            <label>Observaciones sobre los {participantes(ev.disciplina)}<textarea rows={3} value={notasC} onChange={(e) => setNotasC(e.target.value)} /></label>
            <label>Observaciones sobre los trabajadores<textarea rows={3} value={notasT} onChange={(e) => setNotasT(e.target.value)} /></label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <button className="boton" onClick={() => void guardar(false)}>Guardar borrador</button>
              <button className="boton primario" onClick={() => void guardar(true)}>{reg?.estado === "aprobado" ? "Actualizar versión aprobada" : "Aprobar y publicar al organizador"}</button>
              {reg?.estado === "aprobado" && <button className="boton" onClick={() => void volverABorrador()}>Volver a borrador</button>}
              {estado && <span className="chico" style={{ fontWeight: 600 }}>{estado}</span>}
            </div>
          </section>
        )}
        {mostrar ? <Documento inf={mostrar} reg={reg} /> : (
          <div className="tarjeta">{admin ? "Armando el informe…" : "El informe post-evento todavía no fue aprobado por EMERTEAM."}</div>
        )}
      </main>
    </>
  );
}
