import { useCallback, useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { Ctx } from "../main";
import { Barra } from "../componentes/Barra";
import { supabase, type IntegranteEquipo, type RolEquipo } from "../datos";

const ROLES: Record<RolEquipo, { nombre: string; detalle: string }> = {
  editor: { nombre: "Editor", detalle: "Ve todos los eventos, los carga y edita, y administra este equipo." },
  lector: { nombre: "Lector", detalle: "Ve todos los eventos y sus recomendaciones. No edita." },
};

const VACIO = { nombre: "", email: "", rol: "lector" as RolEquipo };

/** Equipo EMERTEAM con acceso a todos los eventos. Solo los editores lo modifican. */
export function Equipo() {
  const { admin, editor, session } = useOutletContext<Ctx>();
  const yo = (session.user.email ?? "").toLowerCase();
  const [lista, setLista] = useState<IntegranteEquipo[]>([]);
  const [f, setF] = useState(VACIO);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const { data } = await supabase.from("mon_admins").select("email,nombre,rol,creado_en").order("nombre");
    setLista((data as IntegranteEquipo[]) ?? []);
  }, []);

  useEffect(() => void cargar(), [cargar]);

  if (!admin) return <p className="contenedor" style={{ paddingTop: 26 }}>Esta sección es solo para el equipo EMERTEAM.</p>;

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const email = f.email.trim().toLowerCase();
    if (lista.some((x) => x.email === email)) return setError("Ese correo ya integra el equipo.");
    setGuardando(true);
    const { error } = await supabase.from("mon_admins").insert({ email, nombre: f.nombre.trim(), rol: f.rol });
    setGuardando(false);
    if (error) return setError(error.message);
    setF(VACIO);
    void cargar();
  }

  async function cambiarRol(x: IntegranteEquipo, rol: RolEquipo) {
    setError("");
    const { error } = await supabase.from("mon_admins").update({ rol }).eq("email", x.email);
    if (error) setError(error.message);
    void cargar();
  }

  async function quitar(x: IntegranteEquipo) {
    setError("");
    const { error } = await supabase.from("mon_admins").delete().eq("email", x.email);
    if (error) setError(error.message);
    void cargar();
  }

  return (
    <>
      <Barra titulo="Equipo EMERTEAM" subtitulo="Acceso a todos los eventos">
        <Link className="boton-osc" to="/">← Eventos</Link>
      </Barra>
      <main className="contenedor" style={{ paddingTop: 26, paddingBottom: 26, display: "flex", flexDirection: "column", gap: 20 }}>
        <div className="grilla" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
          {(Object.keys(ROLES) as RolEquipo[]).map((r) => (
            <div key={r} className="tarjeta" style={{ borderLeft: `5px solid ${r === "editor" ? "var(--naranja)" : "var(--gris-tec)"}` }}>
              <div className="rotulo">{ROLES[r].nombre}</div>
              <p style={{ margin: "6px 0 0" }}>{ROLES[r].detalle}</p>
            </div>
          ))}
        </div>

        <section className="tarjeta">
          <div className="desplaza">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Rol</th>
                  {editor && <th />}
                </tr>
              </thead>
              <tbody>
                {lista.map((x) => {
                  const soyYo = x.email === yo;
                  return (
                    <tr key={x.email}>
                      <td style={{ fontWeight: 600 }}>{x.nombre}{soyYo && <span className="chico"> · vos</span>}</td>
                      <td>{x.email}</td>
                      <td>
                        {editor && !soyYo ? (
                          <select value={x.rol} onChange={(e) => void cambiarRol(x, e.target.value as RolEquipo)} aria-label={`Rol de ${x.nombre}`}>
                            <option value="editor">Editor</option>
                            <option value="lector">Lector</option>
                          </select>
                        ) : (
                          ROLES[x.rol].nombre
                        )}
                      </td>
                      {editor && (
                        <td style={{ textAlign: "right" }}>
                          {!soyYo && <button className="boton" onClick={() => void quitar(x)}>Quitar</button>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {editor ? (
            <form onSubmit={agregar} className="form" style={{ marginTop: 18, alignItems: "end" }}>
              <label>Nombre y apellido<input required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
              <label>Correo<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
              <label>Rol
                <select value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value as RolEquipo })}>
                  <option value="lector">Lector</option>
                  <option value="editor">Editor</option>
                </select>
              </label>
              <button className="boton primario" disabled={guardando}>{guardando ? "Agregando…" : "Agregar al equipo"}</button>
            </form>
          ) : (
            <p className="chico" style={{ marginBottom: 0 }}>Solo los editores pueden modificar el equipo.</p>
          )}
          {error && <p style={{ color: "var(--rojo)", margin: "10px 0 0" }}>{error}</p>}
          <p className="chico" style={{ marginBottom: 0 }}>
            Ingresan sin contraseña, con un enlace al correo cargado. Nadie puede cambiar su propio rol ni quitarse del equipo.
          </p>
        </section>
      </main>
    </>
  );
}
