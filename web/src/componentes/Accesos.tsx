import { useCallback, useEffect, useState } from "react";
import { supabase, type Acceso } from "../datos";

const VACIO = { nombre: "", apellido: "", email: "", rol: "", recibe_alertas: true };

/** Equipo con acceso al evento. Gestionan EMERTEAM y el organizador; el resto solo ve.
 *  El organizador tiene un cupo (por defecto 3); ampliarlo lo hace solo un editor EMERTEAM. */
export function Accesos({ eventoId, eventoNombre, cupo, puedeGestionar, esEditor, miEmail }: {
  eventoId: string; eventoNombre: string; cupo: number; puedeGestionar: boolean; esEditor: boolean; miEmail: string;
}) {
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
    if (error) return setError(error.message.includes("CUPO_EQUIPO")
      ? `El equipo ya tiene las ${cupo} personas del cupo. Para sumar más, solicitá la ampliación a EMERTEAM.`
      : error.message);
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
  const completo = lista.length >= cupo;
  const puedeSumar = puedeGestionar && (esEditor || !completo);
  const solicitud = `mailto:info@emerteam.com.ar?subject=${encodeURIComponent(`${eventoNombre} · Solicitud de ampliación del equipo`)}&body=${encodeURIComponent(
    `Solicito ampliar el equipo con acceso al monitoreo de ${eventoNombre}.\n\nPersonas a sumar (nombre, apellido, correo y rol):\n\n`)}`;

  return (
    <section className="seccion tarjeta" aria-labelledby="accesos-t">
      <div className="rotulo" id="accesos-t">Equipo con acceso</div>
      <p className="chico" style={{ marginTop: 4 }}>Ingresan sin contraseña con el correo habilitado. Quienes reciben alertas son notificados por correo cuando el SMN emite, modifica o levanta una alerta o un aviso a corto plazo para la zona del evento. Los cambios del pronóstico se consultan en la web.</p>
      <p className="chico" style={{ marginTop: 4, fontWeight: 600 }}>
        {lista.length} de {cupo} {cupo === 1 ? "persona habilitada" : "personas habilitadas"}
        {esEditor && lista.length > cupo ? " · por encima del cupo, habilitadas por EMERTEAM" : ""}
      </p>
      {lista.length > 0 && (
        <div className="desplaza">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--texto)" }}>
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
      {puedeGestionar && !puedeSumar && (
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
          <button className="boton primario">Dar acceso</button>
          {error && <p style={{ color: "var(--rojo)", margin: 0, gridColumn: "1 / -1" }}>{error}</p>}
        </form>
      )}
    </section>
  );
}
