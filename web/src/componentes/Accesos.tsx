import { useCallback, useEffect, useState } from "react";
import { supabase, type Acceso } from "../datos";

const VACIO = { nombre: "", apellido: "", email: "", rol: "", recibe_alertas: true };

/** Equipo con acceso al evento. Gestionan EMERTEAM y el organizador; el resto solo ve. */
export function Accesos({ eventoId, puedeGestionar, miEmail }: { eventoId: string; puedeGestionar: boolean; miEmail: string }) {
  const [lista, setLista] = useState<Acceso[]>([]);
  const [f, setF] = useState(VACIO);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const { data } = await supabase.from("mon_accesos").select("*").eq("evento_id", eventoId).order("apellido");
    setLista((data as Acceso[]) ?? []);
  }, [eventoId]);

  useEffect(() => void cargar(), [cargar]);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const email = f.email.trim().toLowerCase();
    if (lista.some((a) => a.email === email)) return setError("Ese correo ya tiene acceso.");
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

  if (!puedeGestionar && lista.length === 0) return null;

  return (
    <section className="seccion tarjeta" aria-labelledby="accesos-t">
      <div className="rotulo" id="accesos-t">Equipo con acceso</div>
      <p className="chico" style={{ marginTop: 4 }}>Ingresan sin contraseña con el correo habilitado. Quienes reciben alertas son notificados por correo ante cambios de nivel y alertas del SMN.</p>
      {lista.length > 0 && (
        <div className="desplaza">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #111" }}>
                <th style={{ padding: "6px 8px" }}>Apellido y nombre</th>
                <th style={{ padding: "6px 8px" }}>Correo</th>
                <th style={{ padding: "6px 8px" }}>Rol</th>
                <th style={{ padding: "6px 8px" }}>Alertas</th>
                {puedeGestionar && <th />}
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid var(--borde)" }}>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{a.apellido}, {a.nombre}</td>
                  <td style={{ padding: "6px 8px" }}>{a.email}</td>
                  <td style={{ padding: "6px 8px" }}>{a.rol ?? "—"}</td>
                  <td style={{ padding: "6px 8px" }}>
                    {puedeGestionar || a.email === miEmail ? (
                      <input type="checkbox" checked={a.recibe_alertas} onChange={() => void alertas(a)} aria-label="Recibe alertas" style={{ minHeight: 0 }} />
                    ) : a.recibe_alertas ? "Sí" : "No"}
                  </td>
                  {puedeGestionar && (
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>
                      <button className="boton" onClick={() => void quitar(a.id)}>Quitar</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {puedeGestionar && (
        <form onSubmit={agregar} className="form" style={{ marginTop: 14, alignItems: "end" }}>
          <label>Nombre<input required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
          <label>Apellido<input required value={f.apellido} onChange={(e) => setF({ ...f, apellido: e.target.value })} /></label>
          <label>Correo<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label>Rol (opcional)<input value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })} placeholder="Producción, logística…" /></label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={f.recibe_alertas} onChange={(e) => setF({ ...f, recibe_alertas: e.target.checked })} style={{ minHeight: 0 }} />
            Recibe alertas
          </label>
          <button className="boton primario">Dar acceso</button>
          {error && <p style={{ color: "var(--rojo)", margin: 0, gridColumn: "1 / -1" }}>{error}</p>}
        </form>
      )}
    </section>
  );
}
