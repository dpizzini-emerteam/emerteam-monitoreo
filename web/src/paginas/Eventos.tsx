import { useEffect, useState } from "react";
import { nombreDisciplina } from "../disciplinas";
import { nombreCorto } from "../reglas";
import { Link, useOutletContext } from "react-router-dom";
import type { Ctx } from "../main";
import { Barra } from "../componentes/Barra";
import { Introduccion } from "../componentes/Introduccion";
import { diaLocal, fmtDia, fmtHora, supabase, type Evento, type Nivel } from "../datos";
import { COLOR_NIVEL, ESTILO_SIN_DATOS, estiloNivel, estiloVariable, NOMBRE_FASE, nombreNivel, SIN_PRONOSTICO } from "../reglas";

type Max = { nivel: number; variable: string; desde: string };
type Resumen = Record<string, Record<string, Max>>; // evento -> fase -> nivel máximo vigente

export function Eventos() {
  const { admin, editor, session } = useOutletContext<Ctx>();
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [resumen, setResumen] = useState<Resumen>({});
  const [cubiertas, setCubiertas] = useState<Record<string, Set<string>>>({}); // evento -> fases con pronóstico
  // Ocultar realizados y cerrados: preferencia de cada usuario en este navegador
  const [ocultar, setOcultar] = useState(() => {
    try { return localStorage.getItem("mon_ocultar_realizados") === "1"; } catch { return false; }
  });
  const cambiarOcultar = (v: boolean) => {
    setOcultar(v);
    try { localStorage.setItem("mon_ocultar_realizados", v ? "1" : "0"); } catch { /* sin almacenamiento */ }
  };
  const hoy = diaLocal(new Date().toISOString());
  const realizado = (e: Evento) => diaLocal(e.largada) < hoy;
  const [enGrupo, setEnGrupo] = useState(false); // integra el equipo de alguna productora

  useEffect(() => {
    if (admin) return;
    supabase.from("mon_productoras").select("id", { count: "exact", head: true }).then(({ count }) => setEnGrupo((count ?? 0) > 0));
  }, [admin]);

  useEffect(() => {
    (async () => {
      // Orden: primero los próximos (del más cercano al más lejano), después los realizados (del más reciente al más antiguo)
      let q = supabase.from("mon_eventos").select("*, mon_modalidades(*)").order("largada");
      // Los cerrados solo los ve EMERTEAM, y solo si no los oculta
      if (!admin || ocultar) q = q.eq("estado", "activo");
      const { data } = await q;
      setEventos((data as Evento[]) ?? []);
      const ids = (data ?? []).map((e) => e.id);
      if (ids.length) {
        const { data: niv } = await supabase
          .from("mon_niveles")
          .select("evento_id,fase,nivel,variable,desde")
          .in("evento_id", ids)
          .gt("hasta", new Date().toISOString())
          .limit(10000);
        const r: Resumen = {};
        const c: Record<string, Set<string>> = {};
        for (const n of (niv ?? []) as Pick<Nivel, "evento_id" | "fase" | "nivel" | "variable" | "desde">[]) {
          // La jornada del personal transcurre el día de carrera
          const fase = n.fase === "personal" ? "carrera" : n.fase;
          (c[n.evento_id] ??= new Set()).add(fase);
          if (n.nivel <= 0) continue;
          r[n.evento_id] ??= {};
          const prev = r[n.evento_id][fase];
          if (!prev || n.nivel > prev.nivel || (n.nivel === prev.nivel && n.desde < prev.desde)) r[n.evento_id][fase] = n;
        }
        setResumen(r);
        setCubiertas(c);
      }
    })();
  }, [ocultar, admin]);

  const visibles = (eventos ?? []).filter((e) => !(ocultar && realizado(e)));
  const ocultos = (eventos?.length ?? 0) - visibles.length;
  const proximos = visibles.filter((e) => !realizado(e));
  const pasados = visibles.filter(realizado).reverse();
  const agrupar = (lista: Evento[]) => {
    const g: [string, Evento[]][] = [];
    for (const e of lista) {
      const d = diaLocal(e.largada);
      const u = g[g.length - 1];
      if (u && u[0] === d) u[1].push(e); else g.push([d, [e]]);
    }
    // Dentro de un mismo día, por hora de largada
    for (const [, evs] of g) evs.sort((a, b) => a.largada.localeCompare(b.largada));
    return g;
  };
  const grupos: { titulo?: string; dias: [string, Evento[]][] }[] = [
    { dias: agrupar(proximos) },
    ...(pasados.length ? [{ titulo: "Realizados", dias: agrupar(pasados) }] : []),
  ];

  return (
    <>
      <Barra titulo={admin ? "Administración" : "Mis eventos"} subtitulo={session.user.email ?? ""}>
        <Link className="boton-osc" to="/guia">Guía</Link>
        {(admin || enGrupo) && (
          <Link className="boton-osc" to="/productoras">
            {admin ? "Productoras" : "Mi equipo"}
          </Link>
        )}
        {admin && (
          <Link className="boton-osc" to="/equipo">
            Equipo EMERTEAM
          </Link>
        )}
        {editor && (
          <Link className="boton-osc" to="/evento/nuevo">
            + Nuevo evento
          </Link>
        )}
      </Barra>
      <main className="contenedor" style={{ paddingTop: 26, paddingBottom: 26 }}>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8, fontWeight: 500, marginBottom: 12 }}>
          <input type="checkbox" checked={ocultar} onChange={(e) => cambiarOcultar(e.target.checked)} style={{ minHeight: 0 }} />
          {admin ? "Ocultar eventos realizados y cerrados" : "Ocultar eventos realizados"}
          {ocultar && ocultos > 0 && <span className="chico" style={{ fontWeight: 400 }}>({ocultos} {ocultos === 1 ? "oculto" : "ocultos"})</span>}
        </label>
        {!admin && <Introduccion />}
        {eventos === null && <p>Cargando…</p>}
        {eventos !== null && visibles.length === 0 && ocultos > 0 && (
          <div className="tarjeta">No hay eventos por realizarse. Desmarcá la opción para ver los anteriores.</div>
        )}
        {eventos?.length === 0 && (
          <div className="tarjeta">
            {editor
              ? "No hay eventos cargados. Usá “Nuevo evento” para activar el monitoreo."
              : admin
              ? "No hay eventos cargados."
              : "Todavía no tenés eventos asignados. Si esperabas ver uno, pedile al responsable de tu productora o a EMERTEAM que te sume al equipo."}
          </div>
        )}
        {grupos.map((gr) => gr.dias.length > 0 && (
          <div key={gr.titulo ?? "proximos"}>
            {gr.titulo && <div className="banda" style={{ marginTop: 34 }}><h2>{gr.titulo}</h2></div>}
        {gr.dias.map(([dia, evs]) => (
          <section key={dia} className="seccion" style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: 28 }}>
              {fmtDia(evs[0].largada)} <span className="chico" style={{ fontFamily: "inherit", textTransform: "none" }}>{evs.length > 1 ? `${evs.length} eventos` : ""}</span>
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {evs.map((e) => {
                const r = resumen[e.id] ?? {};
                const max = Math.max(0, ...Object.values(r).map((m) => m.nivel));
                const cub = cubiertas[e.id];
                return (
                  <article key={e.id} className="tarjeta" style={{ display: "grid", gridTemplateColumns: "minmax(240px,2fr) repeat(auto-fit,minmax(130px,1fr))", gap: 14, alignItems: "center" }}>
                    <div style={{ borderLeft: `5px solid ${cub?.size ? COLOR_NIVEL[max] : "var(--borde-input)"}`, paddingLeft: 12 }}>
                      <div className="condensada" style={{ fontSize: 22, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.1 }}>{e.nombre}</div>
                      <div className="chico">
                        {e.disciplina && e.disciplina !== "running" && <b>{nombreDisciplina(e.disciplina)} · </b>}{e.ubicacion} · {fmtHora(e.largada)} · {(e.mon_modalidades ?? []).map((m) => (m.largada ? `${m.nombre} ${fmtHora(m.largada)}` : m.nombre)).join(", ")} · {e.participantes.toLocaleString("es-AR")} participantes
                        {e.estado === "cerrado" ? " · cerrado" : realizado(e) ? " · realizado" : ""}
                      </div>
                    </div>
                    {(["armado", "carrera", "desarme"] as const).map((f) => {
                      const m = r[f];
                      return (
                        <div key={f} className="fase-estado">
                          <div className="rotulo">{NOMBRE_FASE[f]}</div>
                          {cub?.has(f)
                            ? <span className="badge" style={m ? estiloVariable(m.variable, m.nivel) : estiloNivel(0)}>{m ? nombreNivel(m.variable, m.nivel) : "Bajo umbral"}</span>
                            : <span className="badge" style={ESTILO_SIN_DATOS}>{SIN_PRONOSTICO}</span>}
                          <div className="chico">
                            {m ? `${nombreCorto(m.variable, e.disciplina)} · ${fmtDia(m.desde)} ${fmtHora(m.desde)}`
                              : cub?.has(f) ? "Ninguna variable supera su umbral" : "Se calcula desde 6 días antes"}
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      {editor && (
                        <Link className="boton" to={`/evento/${e.id}/editar`}>
                          Editar
                        </Link>
                      )}
                      <Link className="boton negro" to={`/evento/${e.id}`}>
                        Abrir
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
          </div>
        ))}
      </main>
    </>
  );
}
