import { Link } from "react-router-dom";
import { fijarDisciplina } from "../reglas";
import { Barra } from "../componentes/Barra";
import { Guia } from "../componentes/Guia";

/** Guía de criterios sin evento: para consultar o capacitar sin abrir una carrera */
export function GuiaPagina() {
  fijarDisciplina(null);
  return (
    <>
      <Barra titulo="Guía de criterios" subtitulo="Umbrales, decisiones y fuentes">
        <Link className="boton-osc" to="/">Eventos</Link>
      </Barra>
      <main className="contenedor" style={{ paddingTop: 24, paddingBottom: 26 }}>
        <Guia ctx={null} />
      </main>
    </>
  );
}
