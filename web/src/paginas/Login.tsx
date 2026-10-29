import { useEffect, useState } from "react";
import { supabase } from "../datos";
import { Pie } from "../componentes/Pie";
import { BotonTema } from "../componentes/BotonTema";

export function Login() {
  const [email, setEmail] = useState("");
  // Error traído por el enlace del correo (vencido o ya usado): se muestra una vez
  const [errorEnlace] = useState(() => {
    try { const m = sessionStorage.getItem("mon_error_enlace") ?? ""; sessionStorage.removeItem("mon_error_enlace"); return m; } catch { return ""; }
  });
  const [estado, setEstado] = useState<"" | "enviando" | "enviado" | "error">(errorEnlace ? "error" : "");
  const [error, setError] = useState(errorEnlace);
  const [espera, setEspera] = useState(() => restante());
  const [codigo, setCodigo] = useState("");
  const [validando, setValidando] = useState(false);
  const [errorCodigo, setErrorCodigo] = useState("");
  const redirect = window.location.origin + window.location.pathname;

  // Cuenta regresiva entre pedidos: evita que los toques repetidos agoten el cupo de correos
  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera(restante()), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  async function enlace(e: React.FormEvent) {
    e.preventDefault();
    if (restante() > 0) return;
    setEstado("enviando");
    marcarPedido();
    setEspera(restante());
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      // Cualquier correo puede pedir el enlace; lo que ve cada uno lo define RLS (mon_accesos / organizador).
      options: { emailRedirectTo: redirect },
    });
    if (error) {
      setError(mensajeError(error.message, (error as { code?: string }).code));
      setEstado("error");
    } else setEstado("enviado");
  }

  // Mismo mail, segundo camino: el código de 6 números sirve cuando el enlace abre en otro navegador o dispositivo.
  async function entrarConCodigo(e: React.FormEvent) {
    e.preventDefault();
    const token = codigo.replace(/\D/g, "");
    if (token.length !== 6) { setErrorCodigo("El código tiene 6 números."); return; }
    setValidando(true); setErrorCodigo("");
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: "email" });
    setValidando(false);
    if (error) setErrorCodigo(/expired|invalid/i.test(error.message) ? "El código no es válido o ya venció. Pedí otro mail." : "No se pudo validar el código. Probá de nuevo.");
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
          <BotonTema />
        </div>
      </header>
      <main className="contenedor" style={{ paddingTop: 48, paddingBottom: 48 }}>
        <div className="tarjeta" style={{ maxWidth: 440, margin: "0 auto", padding: 28 }}>
          <h1 style={{ margin: "0 0 6px", fontSize: 30, fontWeight: 800, textTransform: "uppercase" }}>Ingresar</h1>
          <p className="chico" style={{ marginTop: 0 }}>Sin contraseña: te enviamos un mail con un botón para entrar y un código.</p>
          {estado === "enviado" ? (
            <>
              <p>
                Te enviamos un mail a <b>{email}</b>. Tocá el botón «Ingresar» del mail o escribí acá el código de 6 números que viene en el mismo mail.
                Puede tardar unos minutos; revisá también la carpeta de correo no deseado.
              </p>
              <form onSubmit={entrarConCodigo} style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
                <label>
                  Código
                  <input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={codigo} onChange={(e) => setCodigo(e.target.value)}
                    style={{ fontSize: 26, letterSpacing: "0.3em", textAlign: "center" }} />
                </label>
                <button className="boton primario" style={{ justifyContent: "center" }} disabled={validando}>{validando ? "Validando…" : "Entrar"}</button>
                {errorCodigo && <p style={{ color: "var(--rojo)", margin: 0 }}>{errorCodigo}</p>}
              </form>
              <button className="boton" style={{ justifyContent: "center", width: "100%" }} disabled={espera > 0}
                onClick={() => { setEstado(""); setError(""); setCodigo(""); setErrorCodigo(""); }}>
                {espera > 0 ? `Podés pedir otro mail en ${espera} s` : "No me llegó: pedir otro mail"}
              </button>
            </>
          ) : (
            <form onSubmit={enlace} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label>
                Correo electrónico
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </label>
              <button className="boton primario" style={{ justifyContent: "center" }} disabled={estado === "enviando" || espera > 0}>
                {estado === "enviando" ? "Enviando…" : espera > 0 ? `Esperá ${espera} s para pedir otro enlace` : "Enviarme el mail de ingreso"}
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

const CLAVE_PEDIDO = "mon_login_ultimo_pedido";
const ESPERA_S = 60;
let ultimoEnMemoria = 0;

function marcarPedido() {
  ultimoEnMemoria = Date.now();
  try { localStorage.setItem(CLAVE_PEDIDO, String(ultimoEnMemoria)); } catch { /* sin almacenamiento: queda en memoria */ }
}

function restante(): number {
  let ultimo = ultimoEnMemoria;
  try { ultimo = Math.max(ultimo, Number(localStorage.getItem(CLAVE_PEDIDO) ?? 0)); } catch { /* idem */ }
  return Math.max(0, Math.ceil((ultimo + ESPERA_S * 1000 - Date.now()) / 1000));
}

function mensajeError(mensaje: string, codigo?: string): string {
  if (codigo === "over_email_send_rate_limit" || /email rate limit/i.test(mensaje))
    return "Se alcanzó el límite de envíos de enlaces por hora. Esperá unos minutos y pedilo una sola vez; si ya pediste uno, revisá tu correo.";
  if (codigo === "over_request_rate_limit" || /only request this after|rate limit/i.test(mensaje))
    return "Pediste un enlace hace muy poco. Esperá un minuto antes de pedir otro.";
  if (/signup|not allowed|not found/i.test(mensaje)) return "Ese correo no tiene acceso habilitado. Pedile acceso a EMERTEAM.";
  if (/invalid.*email|email.*invalid/i.test(mensaje)) return "El correo no es válido. Revisalo y probá de nuevo.";
  if (/fetch|network/i.test(mensaje)) return "No hay conexión. Revisá internet y probá de nuevo.";
  return "No se pudo enviar el enlace. Probá de nuevo en unos minutos.";
}
