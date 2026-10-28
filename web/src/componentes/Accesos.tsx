import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, type Acceso } from "../datos";

const VACIO = { nombre: "", apellido: "", email: "", rol: "", recibe_alertas: true };

/** Quién ve el evento: el equipo de la productora (se administra en su página) y los accesos adicionales del
 *  evento, que solo da EMERTEAM y sin cupo (personas ajenas a la productora: Defensa Civil, seguridad, cliente final). */
export function Accesos({ eventoId, productoraId, esEditor, esAdmin, miEmail }: {
  eventoId: string; productoraId: string | null | undefined; esEditor: boolean; esAdmin: boolean; miEmail: string;
}) {
  const [lista, setLista] = useState<Acceso[]>([]);
  const [prod, setProd] = useState<{ id: string; nombre: string; miembros: number } | null>(null);
  const [f, setF] = useState(VACIO);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const { data } = await supabase.from("mon_accesos").select("*").eq("evento_id", eventoId).order("apellido");
    setLista((data as Acceso[]) ?? []);
    if (productoraId) {
      const { data: p } = await supabase.from("mon_productoras").select("id,nombre,mon_productora_miembros(count)").eq("id", productoraId).maybeSingle();
      const fila = p as { id: string; nombre: string; mon_productora_miembros: { count: number }[] } | null;
      setProd(fila ? { id: fila.id, nombre: fila.nombre, miembros: fila.mon_productora_miembros?.[0]?.count ?? 0 } : null);
    } else setProd(null);
  }, [eventoId, productoraId]);

  useEffect(() => void cargar(), [cargar]);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const email = f.email.trim().toLowerCase();
    if (lista.some((a) => a.email === email)) return setError("Ese correo ya tiene acceso a este evento.");
    const { error } = await supabase.from("mon_accesos").insert({
      evento_id: eventoId, email, nombre: f.nombre.trim(), apellido: f.apellido.trim(),
      rol: f.rol.trim() || null, recibe_alertas: f.recibe_alertas, habilitado_por: miEmail,
    });
    if (error) return setError(error.message);
    setF(VACIO);
    void cargar();
  }

  async function quitar(id: string) {
    await supabase.from("mon_accesos").delete().eq("id", id);
    void cargar();
  }

  async function alertas(a: Acceso) {
    await supabase.from("mon_accesos").update({ recibe_alertas: !a.recibe_alertas }).eq("id", a.id);
    void cargar();
  }

  if (!esAdmin && !prod && lista.length === 0) return null;

  return (
    <section className="seccion tarjeta" aria-labelledby="accesos-t">
      <div className="rotulo" id="accesos-t">Quién ve este evento</div>
      {prod ? (
        <p style={{ marginTop: 6 }}>
          El equipo de <b>{prod.nombre}</b> ({prod.miembros} {prod.miembros === 1 ? "persona" : "personas"}) ve este evento y todos los de la productora.{" "}
          <Link to={`/productora/${prod.id}`}>Ver el equipo</Link>
        </p>
      ) : esAdmin ? (
        <p className="chico" style={{ marginTop: 6, color: esEditor ? "var(--rojo)" : undefined }}>
          El evento no está asociado a una productora{esEditor ? ": asocialo desde «Editar» para que su equipo lo vea." : "."}
        </p>
      ) : null}

      {(esAdmin || lista.length > 0) && (
        <>
          <div className="rotulo" style={{ marginTop: 14 }}>Accesos adicionales del evento</div>
          <p className="chico" style={{ marginTop: 4 }}>
            Personas ajenas a la productora con acceso solo a este evento. Los habilita EMERTEAM, sin cupo. Reciben un correo de acceso al ser dadas de alta y, si reciben alertas, los correos del SMN para la zona del evento.
          </p>
          {lista.length > 0 && (
            <div className="desplaza">
              <table className="tabla">
                <thead><tr><th>Apellido y nombre</th><th>Correo</th><th>Rol</th><th>Alertas</th>{esEditor && <th />}</tr></thead>
                <tbody>
                  {lista.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>{a.apellido}, {a.nombre}{a.email === miEmail && <span className="chico"> · vos</span>}</td>
                      <td>{a.email}{esAdmin && !a.aviso_alta_en && <div className="chico">correo de acceso pendiente</div>}</td>
                      <td>{a.rol ?? "—"}</td>
                      <td>
                        {esEditor || a.email === miEmail
                          ? <input type="checkbox" checked={a.recibe_alertas} onChange={() => void alertas(a)} aria-label="Recibe alertas" style={{ minHeight: 0 }} />
                          : a.recibe_alertas ? "Sí" : "No"}
                      </td>
                      {esEditor && <td style={{ textAlign: "right" }}><button className="boton" onClick={() => void quitar(a.id)}>Quitar</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {esEditor && (
            <form onSubmit={agregar} className="form" style={{ marginTop: 14, alignItems: "end" }}>
              <label>Nombre<input required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
              <label>Apellido<input required value={f.apellido} onChange={(e) => setF({ ...f, apellido: e.target.value })} /></label>
              <label>Correo<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
              <label>Rol u organismo (opcional)<input value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })} placeholder="Defensa Civil, seguridad, sponsor…" /></label>
              <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={f.recibe_alertas} onChange={(e) => setF({ ...f, recibe_alertas: e.target.checked })} style={{ minHeight: 0 }} />
                Recibe alertas
              </label>
              <button className="boton primario">Dar acceso</button>
              {error && <p style={{ color: "var(--rojo)", margin: 0, gridColumn: "1 / -1" }}>{error}</p>}
            </form>
          )}
        </>
      )}
    </section>
  );
}
