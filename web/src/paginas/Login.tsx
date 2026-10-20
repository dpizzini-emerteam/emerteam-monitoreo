import { useState } from "react";
import { supabase } from "../datos";
import { Pie } from "../componentes/Pie";

export function Login() {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"" | "enviando" | "enviado" | "error">("");
  const [error, setError] = useState("");
  const redirect = window.location.origin + window.location.pathname;

  async function enlace(e: React.FormEvent) {
    e.preventDefault();
    setEstado("enviando");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: redirect },
    });
    if (error) {
      setError(error.message);
      setEstado("error");
    } else setEstado("enviado");
  }

  async function google() {
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirect } });
  }

  return (
    <>
      <header className="barra">
        <div className="contenedor">
          <img src="/logo-emerteam.png" alt="EMERTEAM" />
          <div className="titulo">
            <b>Monitoreo ambiental</b>
            <span>Carrera · Armado · Desarme</span>
          </div>
        </div>
      </header>
      <main className="contenedor" style={{ paddingTop: 48, paddingBottom: 48 }}>
        <div className="tarjeta" style={{ maxWidth: 440, margin: "0 auto", padding: 28 }}>
          <h1 style={{ margin: "0 0 6px", fontSize: 30, fontWeight: 800, textTransform: "uppercase" }}>Ingresar</h1>
          <p className="chico" style={{ marginTop: 0 }}>Sin contraseña: con tu cuenta de Google o con un enlace a tu correo.</p>
          <button className="boton" style={{ width: "100%", justifyContent: "center" }} onClick={google}>
            Continuar con Google
          </button>
          <div className="chico" style={{ textAlign: "center", margin: "16px 0" }}>o</div>
          {estado === "enviado" ? (
            <p>
              Te enviamos un enlace a <b>{email}</b>. Abrilo desde este dispositivo para ingresar.
            </p>
          ) : (
            <form onSubmit={enlace} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label>
                Correo electrónico
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </label>
              <button className="boton primario" style={{ justifyContent: "center" }} disabled={estado === "enviando"}>
                {estado === "enviando" ? "Enviando…" : "Enviarme el enlace"}
              </button>
              {estado === "error" && <p style={{ color: "var(--rojo)", margin: 0 }}>{error}</p>}
            </form>
          )}
        </div>
      </main>
      <Pie />
    </>
  );
}
