import { useEffect, useState } from "react";

type Tema = "claro" | "oscuro";
const CLAVE = "mon_tema";

function sistema(): Tema {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
}

function guardado(): Tema | null {
  try {
    const v = localStorage.getItem(CLAVE);
    return v === "claro" || v === "oscuro" ? v : null;
  } catch {
    return null;
  }
}

/** Alterna claro/oscuro. Sin elección guardada, sigue la configuración del dispositivo. */
export function BotonTema() {
  const [tema, setTema] = useState<Tema>(() => guardado() ?? sistema());

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const seguir = () => { if (!guardado()) setTema(sistema()); };
    mq?.addEventListener("change", seguir);
    return () => mq?.removeEventListener("change", seguir);
  }, []);

  const cambiar = () => {
    const nuevo: Tema = tema === "oscuro" ? "claro" : "oscuro";
    setTema(nuevo);
    document.documentElement.dataset.tema = nuevo;
    try { localStorage.setItem(CLAVE, nuevo); } catch { /* solo esta visita */ }
  };

  const aOscuro = tema === "claro";
  return (
    <button className="boton-osc boton-tema" onClick={cambiar} aria-label={aOscuro ? "Activar modo oscuro" : "Activar modo claro"} title={aOscuro ? "Modo oscuro" : "Modo claro"}>
      {aOscuro ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
        </svg>
      )}
    </button>
  );
}
