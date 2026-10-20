import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../datos";

/** Eliminación definitiva de un evento (solo editores). Pide escribir el nombre para confirmar. */
export function EliminarEvento({ id, nombre }: { id: string; nombre: string }) {
  const nav = useNavigate();
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<"" | "borrando">("");
  const [error, setError] = useState("");
  const coincide = texto.trim().toLowerCase() === nombre.trim().toLowerCase();

  async function eliminar() {
    if (!coincide) return;
    setEstado("borrando");
    setError("");
    // Fotos de mediciones (carpeta del evento en el almacenamiento)
    const { data: fotos } = await supabase.storage.from("mon-mediciones").list(id, { limit: 1000 });
    if (fotos?.length) await supabase.storage.from("mon-mediciones").remove(fotos.map((f) => `${id}/${f.name}`));
    // El resto (modalidades, pronósticos, niveles, alertas, accesos, mediciones, informe) se borra en cascada
    const { data: borrados, error: e } = await supabase.from("mon_eventos").delete().eq("id", id).select("id");
    if (e || !borrados?.length) {
      setEstado("");
      return setError(e?.message ?? "No se pudo eliminar: solo un editor EMERTEAM puede hacerlo.");
    }
    nav("/", { replace: true });
  }

  return (
    <section className="tarjeta zona-riesgo">
      <div className="rotulo">Eliminar evento</div>
      <p className="chico" style={{ marginTop: 4 }}>
        Borra el evento y todo lo asociado: pronósticos, niveles, alertas, mediciones con sus fotos, accesos del organizador, registro de correos e informe. No se puede deshacer.
      </p>
      {!abierto ? (
        <button type="button" className="boton peligro" onClick={() => setAbierto(true)}>Eliminar evento</button>
      ) : (
        <div className="confirmar-borrado">
          <label>Para confirmar, escribí el nombre del evento: <b>{nombre}</b>
            <input value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus aria-label="Nombre del evento para confirmar" />
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="boton peligro" disabled={!coincide || estado === "borrando"} onClick={() => void eliminar()}>
              {estado === "borrando" ? "Eliminando…" : "Eliminar definitivamente"}
            </button>
            <button type="button" className="boton" onClick={() => { setAbierto(false); setTexto(""); setError(""); }}>Cancelar</button>
          </div>
          {error && <p style={{ color: "var(--rojo)", margin: 0 }}>{error}</p>}
        </div>
      )}
    </section>
  );
}
