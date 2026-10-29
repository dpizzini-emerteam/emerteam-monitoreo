import { Link } from "react-router-dom";
import { diaLocal, fmtDia, fmtFechaHora, fmtHora, type AlertaSMN, type Nivel } from "../datos";
import { ESTILO_SIN_DATOS, estiloNivel, estiloVariable, NOMBRE_CORTO, nombreNivel, recomendacion, SIN_PRONOSTICO } from "../reglas";

const BLOQUES = [
  { clave: "armado", titulo: "Armado", fases: ["armado"] },
  { clave: "carrera", titulo: "Día de carrera", fases: ["carrera", "personal"] },
  { clave: "desarme", titulo: "Desarme", fases: ["desarme"] },
] as const;

const ESTADO = ["Sin acciones previstas", "Vigilar", "Actuar", "Retirar", "Suspender / despejar"];

type Franja = { desde: string; hasta: string; confianza: Nivel["confianza"] };
type Item = { variable: string; fase: string; nivel: number; desde: string; franjas: Franja[]; confianza: Nivel["confianza"] };

const peor = (a: Nivel["confianza"], b: Nivel["confianza"]): Nivel["confianza"] =>
  a === "baja" || b === "baja" ? "baja" : a === "media" || b === "media" ? "media" : "alta";

/** Agrupa por variable: nivel máximo y cada franja en que se da ese nivel (solo se unen tramos contiguos) */
function items(niveles: Nivel[]): Item[] {
  const porVar = new Map<string, Nivel[]>();
  for (const n of niveles) if (n.nivel > 0) porVar.set(n.variable, [...(porVar.get(n.variable) ?? []), n]);
  const out: Item[] = [];
  for (const [variable, ns] of porVar) {
    const max = Math.max(...ns.map((n) => n.nivel));
    const top = ns.filter((n) => n.nivel === max).sort((a, b) => a.desde.localeCompare(b.desde));
    const franjas: Franja[] = [];
    for (const n of top) {
      const u = franjas[franjas.length - 1];
      if (u && Date.parse(n.desde) <= Date.parse(u.hasta)) {
        if (n.hasta > u.hasta) u.hasta = n.hasta;
        u.confianza = peor(u.confianza, n.confianza);
      } else franjas.push({ desde: n.desde, hasta: n.hasta, confianza: n.confianza });
    }
    const conf = franjas.reduce<Nivel["confianza"]>((c, f) => peor(c, f.confianza), "alta");
    out.push({ variable, fase: top[0].fase, nivel: max, desde: franjas[0].desde, franjas, confianza: conf });
  }
  return out.sort((a, b) => b.nivel - a.nivel || a.desde.localeCompare(b.desde));
}

function franja(desde: string, hasta: string): string {
  return diaLocal(desde) === diaLocal(hasta)
    ? `${fmtDia(desde)} · ${fmtHora(desde)} a ${fmtHora(hasta)} h`
    : `${fmtFechaHora(desde)} → ${fmtFechaHora(hasta)}`;
}

/** Texto de las franjas para el párrafo principal: la primera y cuántas más hay */
function franjasTexto(fs: Franja[]): string {
  const f = franja(fs[0].desde, fs[0].hasta);
  return fs.length === 1 ? f : `${f}, y ${fs.length - 1} ${fs.length === 2 ? "franja más" : "franjas más"}`;
}

const MAX_FRANJAS = 3;

/** Primera oración de la recomendación: la acción principal */
function accion(it: Item): string {
  const t = recomendacion(it.variable, it.nivel, it.fase) ?? "";
  const i = t.indexOf(". ");
  return i > 0 ? t.slice(0, i + 1) : t;
}

export function Resumen({ vigentes, alertas, eventoId }: { vigentes: Nivel[]; alertas: AlertaSMN[]; eventoId: string }) {
  const bloques = BLOQUES.map((b) => {
    const propios = vigentes.filter((n) => (b.fases as readonly string[]).includes(n.fase));
    const its = items(propios);
    return { ...b, its, nivel: its[0]?.nivel ?? 0, cubierto: propios.length > 0 };
  });
  const principal = bloques.flatMap((b) => b.its.map((it) => ({ ...it, bloque: b.titulo }))).sort((a, b) => b.nivel - a.nivel || a.desde.localeCompare(b.desde))[0];
  const hayDatos = vigentes.length > 0;

  return (
    <section className="seccion resumen" aria-labelledby="resumen-t">
      <div className="banda"><h2 id="resumen-t">Resumen para el organizador</h2></div>
      <div className="resumen-cuerpo">
        {alertas.length > 0 && (
          <p className="resumen-principal" style={{ borderColor: "#FF3B30" }}>
            <b>Alerta oficial vigente:</b> el SMN emitió alerta {alertas.map((a) => `${a.color} por ${a.fenomeno.toLowerCase()}`).join(" y ")} para la zona del evento. Tiene prioridad sobre el pronóstico de esta página.
          </p>
        )}
        {!hayDatos ? (
          <p className="resumen-principal">El resumen se completa con la primera actualización de los modelos para este evento.</p>
        ) : principal ? (
          <p className="resumen-principal" style={{ borderColor: estiloVariable(principal.variable, principal.nivel).background }}>
            <b>Lo principal · {principal.bloque}:</b> {NOMBRE_CORTO[principal.variable]} — {nombreNivel(principal.variable, principal.nivel)} ({franjasTexto(principal.franjas)}). {accion(principal)}
            {principal.confianza === "baja" && " Es una tendencia: se confirma o descarta con las próximas actualizaciones."}
          </p>
        ) : (
          <p className="resumen-principal" style={{ borderColor: "#2FA34C" }}>
            <b>Lo principal:</b> con el pronóstico actual, ninguna variable supera los umbrales en {bloques.filter((b) => b.cubierto).map((b) => b.titulo.toLowerCase()).join(", ").replace(/, ([^,]*)$/, " ni $1")}.
            {bloques.every((b) => b.cubierto) ? " El dispositivo previsto es suficiente; la página avisa si eso cambia." : ` ${bloques.filter((b) => !b.cubierto).map((b) => b.titulo).join(" y ")} todavía sin pronóstico.`}
          </p>
        )}

        <div className="resumen-fases">
          {bloques.map((b) => (
            <Link key={b.clave} to={`/evento/${eventoId}/${b.clave}`} className="resumen-fase">
              <div className="resumen-cab">
                <span className="rotulo">{b.titulo}</span>
                {b.cubierto
                  ? <span className="badge" style={estiloNivel(b.nivel)}>{ESTADO[b.nivel]}</span>
                  : <span className="badge" style={ESTILO_SIN_DATOS}>{SIN_PRONOSTICO}</span>}
              </div>
              {b.its.length === 0 ? (
                <p className="chico" style={{ margin: 0 }}>{b.cubierto ? "Ninguna variable supera su umbral." : "Todavía a más de 6 días. Los niveles se calculan desde 6 días antes y se completan solos."}</p>
              ) : (
                <ul>
                  {b.its.slice(0, 3).map((it) => (
                    <li key={it.variable}>
                      <span className="punto" style={{ background: estiloVariable(it.variable, it.nivel).background }} aria-hidden />
                      <span>
                        <b>{NOMBRE_CORTO[it.variable]}</b> · {nombreNivel(it.variable, it.nivel)}
                        {it.franjas.slice(0, MAX_FRANJAS).map((f) => (
                          <span key={f.desde} className="chico" style={{ display: "block" }}>{franja(f.desde, f.hasta)}{f.confianza === "baja" ? " · tendencia" : ""}</span>
                        ))}
                        {it.franjas.length > MAX_FRANJAS && <span className="chico" style={{ display: "block" }}>y {it.franjas.length - MAX_FRANJAS} más en el detalle</span>}
                      </span>
                    </li>
                  ))}
                  {b.its.length > 3 && <li className="chico">y {b.its.length - 3} más en el detalle</li>}
                </ul>
              )}
              <span className="resumen-ver">Ver {b.titulo.toLowerCase()} →</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
