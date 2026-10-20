import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../datos";
import { BotonTema } from "./BotonTema";

export function Barra({ titulo, subtitulo, children, abajo }: { titulo: string; subtitulo?: string; children?: ReactNode; abajo?: ReactNode }) {
  return (
    <header className="barra">
      <div className="contenedor">
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <Link to="/" aria-label="Inicio">
            <img src="/logo-emerteam.png" alt="EMERTEAM" />
          </Link>
          <div className="titulo">
            <b>{titulo}</b>
            {subtitulo && <span>{subtitulo}</span>}
          </div>
        </div>
        <nav aria-label="Acciones">
          {children}
          <BotonTema />
          <button className="boton-osc" onClick={() => supabase.auth.signOut()}>
            Salir
          </button>
        </nav>
      </div>
      {abajo}
    </header>
  );
}
