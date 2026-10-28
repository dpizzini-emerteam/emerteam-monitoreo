import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { Ctx } from "../main";
import { Barra } from "../componentes/Barra";
import { fmtDia, fmtFechaHora, fmtHora, supabase, type Evento, type Miembro, type Productora, type RegistroAcceso } from "../datos";

const VACIO = { nombre: "", apellido: "", email: "", rol: "", recibe_alertas: true, responsable: false };

const ACCION: Record<RegistroAcceso["accion"], string> = {
  alta: "Alta", baja: "Baja", responsable: "Designado responsable", deja_responsable: "Deja de ser responsable",
  alertas_si: "Activa alertas", alertas_no: "Desactiva alertas", cupo: "Cambio de cupo",
};

/** Listado de productoras. EMERTEAM ve todas y las crea; cada integrante ve solo la suya. */
export function Productoras() {
  const { admin, editor } = useOutletContext<Ctx>();
  const nav = useNavigate();
  const [lista, setLista] = useState<(Productora & { miembros: number; eventos: number })[] | null>(null);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const { data } = await supabase.from("mon_productoras").select("*, mon_productora_miembros(count), mon_eventos(count)").order("nombre");
    const filas = ((data ?? []) as (Productora & { mon_productora_miembros: { count: number }[]; mon_eventos: { count: number }[] })[])
      .map((p) => ({ ...p, miembros: p.mon_productora_miembros?.[0]?.count ?? 0, eventos: p.mon_eventos?.[0]?.count ?? 0 }));
    // Un integrante de una sola productora va directo a su equipo
    if (!admin && filas.length === 1) return nav(`/productora/${filas[0].id}`, { replace: true });
    setLista(filas);
  }, [admin, nav]);

  useEffect(() => void cargar(), [cargar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { data, error } = await supabase.from("mon_productoras").insert({ nombre: nombre.trim() }).select("id").single();
    if (error) return setError(error.message.includes("duplicate") ? "Ya existe una productora con ese nombre." : error.message);
    nav(`/productora/${data.id}`);
  }

  return (
    <>
      <Barra titulo={admin ? "Productoras" : "Mi equipo"} subtitulo="Grupos con acceso a todos los eventos de cada productora">
        <Link className="boton-osc" to="/">← Eventos</Link>
      </Barra>
      <main className="contenedor" style={{ paddingTop: 26, paddingBottom: 26, display: "flex", flexDirection: "column", gap: 20 }}>
        {lista === null && <p>Cargando…</p>}
        {lista?.length === 0 && <div className="tarjeta">{admin ? "Todavía no hay productoras cargadas." : "No integrás el equipo de ninguna productora."}</div>}
        {!!lista?.length && (
          <section className="tarjeta">
            <div className="desplaza">
              <table className="tabla">
                <thead><tr><th>Productora</th><th>Equipo</th><th>Cupo</th><th>Eventos</th><th /></tr></thead>
                <tbody>
                  {lista.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.nombre}</td>
                      <td>{p.miembros}</td>
                      <td>{p.cupo}</td>
                      <td>{p.eventos}</td>
                      <td style={{ textAlign: "right" }}><Link className="boton negro" to={`/productora/${p.id}`}>Abrir</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {editor && (
          <form onSubmit={crear} className="tarjeta form" style={{ alignItems: "end" }}>
            <label>Nueva productora<input required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de la productora" /></label>
            <button className="boton primario">Crear</button>
            {error && <p style={{ color: "var(--rojo)", margin: 0, gridColumn: "1 / -1" }}>{error}</p>}
          </form>
        )}
      </main>
    </>
  );
}

/** Equipo de una productora. El responsable suma y quita integrantes dentro del cupo; EMERTEAM, sin límite,
 *  y es quien designa responsables y amplía el cupo. */
export function ProductoraDetalle() {
  const { admin, editor, session } = useOutletContext<Ctx>();
  const { id } = useParams();
  const miEmail = (session.user.email ?? "").toLowerCase();
  const [prod, setProd] = useState<Productora | null | undefined>(undefined);
  const [lista, setLista] = useState<Miembro[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [registro, setRegistro] = useState<RegistroAcceso[]>([]);
  const [f, setF] = useState(VACIO);
  const [error, setError] = useState("");
  const [cupo, setCupo] = useState("");
  const [nombreProd, setNombreProd] = useState("");

  const cargar = useCallback(async () => {
    if (!id) return;
    const [{ data: p }, { data: m }, { data: ev }, { data: r }] = await Promise.all([
      supabase.from("mon_productoras").select("*").eq("id", id).maybeSingle(),
      supabase.from("mon_productora_miembros").select("*").eq("productora_id", id).order("responsable", { ascending: false }).order("apellido"),
      supabase.from("mon_eventos").select("id,nombre,largada,estado,ubicacion").eq("productora_id", id).order("largada", { ascending: false }).limit(50),
      supabase.from("mon_accesos_registro").select("*").eq("productora_id", id).order("en", { ascending: false }).limit(100),
    ]);
    setProd((p as Productora) ?? null);
    if (p) { setCupo(String(p.cupo)); setNombreProd(p.nombre); }
    setLista((m as Miembro[]) ?? []);
    setEventos((ev as Evento[]) ?? []);
    setRegistro((r as RegistroAcceso[]) ?? []);
  }, [id]);

  useEffect(() => void cargar(), [cargar]);

  if (prod === undefined) return <p className="contenedor" style={{ paddingTop: 26 }}>Cargando…</p>;
  if (prod === null) return <p className="contenedor" style={{ paddingTop: 26 }}>No tenés acceso a esta productora.</p>;

  const soyResponsable = lista.some((m) => m.email === miEmail && m.responsable);
  const gestiona = editor || soyResponsable;
  const usados = lista.filter((m) => !m.responsable).length;
  const completo = usados >= prod.cupo;
  const puedeSumar = editor || (soyResponsable && !completo);
  const responsables = lista.filter((m) => m.responsable).length;
  const solicitud = `mailto:info@emerteam.com.ar?subject=${encodeURIComponent(`${prod.nombre} · Solicitud de ampliación del equipo`)}&body=${encodeURIComponent(
    `Solicito ampliar el cupo del equipo de ${prod.nombre} con acceso al monitoreo ambiental.\n\nPersonas a sumar (nombre, apellido, correo y rol):\n\n`)}`;

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const email = f.email.trim().toLowerCase();
    if (lista.some((m) => m.email === email)) return setError("Ese correo ya integra el equipo.");
    const { error } = await supabase.from("mon_productora_miembros").insert({
      productora_id: prod!.id, email, nombre: f.nombre.trim(), apellido: f.apellido.trim(), rol: f.rol.trim() || null,
      recibe_alertas: f.recibe_alertas, responsable: editor && f.responsable, habilitado_por: miEmail,
    });
    if (error) return setError(error.message.includes("CUPO_PRODUCTORA")
      ? `El equipo ya tiene las ${prod!.cupo} personas del cupo. Para sumar más, solicitá la ampliación a EMERTEAM.`
      : error.message);
    setF(VACIO);
    void cargar();
  }

  async function quitar(m: Miembro) {
    setError("");
    if (m.responsable && responsables === 1 && !window.confirm(`${m.nombre} ${m.apellido} es el único responsable. Sin responsable, el equipo solo lo administra EMERTEAM. ¿Quitarlo igual?`)) return;
    const { error } = await supabase.from("mon_productora_miembros").delete().eq("id", m.id);
    if (error) setError(error.message);
    void cargar();
  }

  async function cambiar(m: Miembro, campos: Partial<Pick<Miembro, "recibe_alertas" | "responsable">>) {
    setError("");
    const { error } = await supabase.from("mon_productora_miembros").update(campos).eq("id", m.id);
    if (error) setError(error.message.replace(/^[A-Z_]+: /, ""));
    void cargar();
  }

  async function guardarProd(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await supabase.from("mon_productoras").update({ nombre: nombreProd.trim(), cupo: parseInt(cupo, 10) }).eq("id", prod!.id);
    if (error) setError(error.message);
    void cargar();
  }

  return (
    <>
      <Barra titulo={prod.nombre} subtitulo="Equipo con acceso a todos los eventos de la productora">
        <Link className="boton-osc" to={admin ? "/productoras" : "/"}>← {admin ? "Productoras" : "Eventos"}</Link>
      </Barra>
      <main className="contenedor" style={{ paddingTop: 26, paddingBottom: 26, display: "flex", flexDirection: "column", gap: 20 }}>
        <section className="tarjeta">
          <div className="rotulo">Equipo</div>
          <p className="chico" style={{ marginTop: 4 }}>
            Cada integrante ve todos los eventos de {prod.nombre}, incluidos los que se carguen más adelante. Ingresa sin contraseña con el correo habilitado y recibe un correo de acceso al ser dado de alta. Quienes reciben alertas son notificados cuando el SMN emite, modifica o levanta una alerta o un aviso a corto plazo para la zona de un evento.
          </p>
          <p className="chico" style={{ marginTop: 4, fontWeight: 600 }}>
            {usados} de {prod.cupo} {prod.cupo === 1 ? "lugar usado" : "lugares usados"} · los responsables no ocupan cupo
            {usados > prod.cupo ? " · por encima del cupo, habilitados por EMERTEAM" : ""}
          </p>
          {lista.length > 0 && (
            <div className="desplaza">
              <table className="tabla">
                <thead><tr><th>Apellido y nombre</th><th>Correo</th><th>Rol</th><th>Alertas</th>{gestiona && <th />}</tr></thead>
                <tbody>
                  {lista.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600 }}>
                        {m.apellido}, {m.nombre}{m.email === miEmail && <span className="chico"> · vos</span>}
                        {m.responsable && <div><span className="badge" style={{ background: "var(--naranja)", color: "#111" }}>Responsable</span></div>}
                      </td>
                      <td>{m.email}{!m.aviso_alta_en && <div className="chico">correo de acceso pendiente</div>}</td>
                      <td>{m.rol ?? "—"}</td>
                      <td>
                        {gestiona || m.email === miEmail
                          ? <input type="checkbox" checked={m.recibe_alertas} onChange={() => void cambiar(m, { recibe_alertas: !m.recibe_alertas })} aria-label="Recibe alertas" style={{ minHeight: 0 }} />
                          : m.recibe_alertas ? "Sí" : "No"}
                      </td>
                      {gestiona && (
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {editor && <button className="boton" onClick={() => void cambiar(m, { responsable: !m.responsable })}>{m.responsable ? "Quitar responsable" : "Hacer responsable"}</button>}{" "}
                          {(editor || !m.responsable) && <button className="boton" onClick={() => void quitar(m)}>Quitar</button>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {editor && responsables === 0 && (
            <p className="chico" style={{ color: "var(--rojo)" }}>El equipo no tiene responsable: solo EMERTEAM puede sumar o quitar integrantes.</p>
          )}
          {gestiona && !puedeSumar && (
            <div className="tarjeta" style={{ marginTop: 14, borderLeft: "4px solid var(--naranja)", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
              <span>El cupo del equipo está completo. Para sumar más personas, solicitá la ampliación a EMERTEAM.</span>
              <a className="boton primario" href={solicitud}>Solicitar ampliación</a>
            </div>
          )}
          {puedeSumar && (
            <form onSubmit={agregar} className="form" style={{ marginTop: 14, alignItems: "end" }}>
              <label>Nombre<input required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
              <label>Apellido<input required value={f.apellido} onChange={(e) => setF({ ...f, apellido: e.target.value })} /></label>
              <label>Correo<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
              <label>Rol (opcional)<input value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })} placeholder="Producción, logística…" /></label>
              <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={f.recibe_alertas} onChange={(e) => setF({ ...f, recibe_alertas: e.target.checked })} style={{ minHeight: 0 }} />
                Recibe alertas
              </label>
              {editor && (
                <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={f.responsable} onChange={(e) => setF({ ...f, responsable: e.target.checked })} style={{ minHeight: 0 }} />
                  Responsable
                </label>
              )}
              <button className="boton primario">Dar acceso</button>
            </form>
          )}
          {error && <p style={{ color: "var(--rojo)", margin: "10px 0 0" }}>{error}</p>}
        </section>

        {editor && (
          <form onSubmit={guardarProd} className="tarjeta form" style={{ alignItems: "end" }}>
            <label>Nombre de la productora<input required value={nombreProd} onChange={(e) => setNombreProd(e.target.value)} /></label>
            <label>Cupo del equipo<input type="number" min={0} max={200} required value={cupo} onChange={(e) => setCupo(e.target.value)} /></label>
            <button className="boton">Guardar</button>
          </form>
        )}

        <section className="tarjeta">
          <div className="rotulo">Eventos de {prod.nombre}</div>
          {eventos.length === 0
            ? <p className="chico" style={{ marginBottom: 0 }}>Todavía no hay eventos asociados. {editor ? "Se asocian desde la edición de cada evento." : "Aparecen acá cuando EMERTEAM los carga."}</p>
            : (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {eventos.map((e) => (
                  <li key={e.id}><Link to={`/evento/${e.id}`}>{e.nombre}</Link> <span className="chico">· {fmtDia(e.largada)} {fmtHora(e.largada)}{e.estado === "cerrado" ? " · cerrado" : ""}</span></li>
                ))}
              </ul>
            )}
        </section>

        {(admin || soyResponsable) && (
          <section className="tarjeta">
            <div className="rotulo">Registro de cambios</div>
            {registro.length === 0
              ? <p className="chico" style={{ marginBottom: 0 }}>Sin cambios registrados.</p>
              : (
                <div className="desplaza">
                  <table className="tabla">
                    <thead><tr><th>Fecha</th><th>Cambio</th><th>Persona</th><th>Hecho por</th></tr></thead>
                    <tbody>
                      {registro.map((r) => (
                        <tr key={r.id}>
                          <td style={{ whiteSpace: "nowrap" }}>{fmtFechaHora(r.en)}</td>
                          <td>{ACCION[r.accion]}{r.accion === "cupo" && r.detalle ? ` (${r.detalle})` : ""}</td>
                          <td>{r.accion === "cupo" ? "—" : <>{r.detalle && <b>{r.detalle} </b>}<span className="chico">{r.email}</span></>}</td>
                          <td className="chico">{r.por ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </section>
        )}
      </main>
    </>
  );
}
