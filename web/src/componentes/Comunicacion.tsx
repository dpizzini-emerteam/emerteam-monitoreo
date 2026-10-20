import { useState } from "react";
import type { Comunicado } from "../comunicacion";

const FORMATOS = [
  { clave: "redes", titulo: "Redes sociales" },
  { clave: "whatsapp", titulo: "WhatsApp" },
  { clave: "mail", titulo: "Mail" },
] as const;
type Formato = (typeof FORMATOS)[number]["clave"];

function Copiar({ texto, etiqueta = "Copiar" }: { texto: string; etiqueta?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="boton"
      onClick={async () => {
        try { await navigator.clipboard.writeText(texto); } catch {
          const t = document.createElement("textarea");
          t.value = texto; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
        }
        setOk(true);
        setTimeout(() => setOk(false), 2000);
      }}
    >
      {ok ? "Copiado" : etiqueta}
    </button>
  );
}

/** Texto sugerido para comunicar a los corredores, listo para copiar en cada canal */
export function Comunicacion({ c }: { c: Comunicado }) {
  const [f, setF] = useState<Formato>("redes");
  const texto = f === "redes" ? c.redes : f === "whatsapp" ? c.whatsapp : c.mail.cuerpo;
  return (
    <section className="seccion tarjeta comunicacion" id="comunicacion" aria-labelledby="comunicacion-t">
      <div className="rotulo" id="comunicacion-t">Texto sugerido para comunicar a los corredores</div>
      <p className="chico" style={{ marginTop: 4 }}>
        Aviso preventivo por: {c.motivos.join(", ").toLowerCase()}. Elegí el canal, copiá el texto y adaptalo a la voz de tu marca.
      </p>
      {c.confirmar && (
        <p className="chico" style={{ borderLeft: "4px solid var(--amarillo, #C79000)", paddingLeft: 10 }}>
          El pronóstico todavía es una tendencia. Conviene publicar cuando se confirme en las próximas actualizaciones.
        </p>
      )}
      <div className="formatos" role="tablist" aria-label="Canal">
        {FORMATOS.map((x) => (
          <button key={x.clave} role="tab" aria-selected={f === x.clave} className={`formato${f === x.clave ? " activo" : ""}`} onClick={() => setF(x.clave)}>
            {x.titulo}
          </button>
        ))}
      </div>
      {f === "mail" && (
        <div className="texto-asunto">
          <span><b>Asunto:</b> {c.mail.asunto}</span>
          <Copiar texto={c.mail.asunto} etiqueta="Copiar asunto" />
        </div>
      )}
      <pre className="texto-sugerido" role="tabpanel">{texto}</pre>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Copiar texto={texto} etiqueta={f === "mail" ? "Copiar cuerpo" : "Copiar texto"} />
        {f === "whatsapp" && (
          <a className="boton" href={`https://wa.me/?text=${encodeURIComponent(c.whatsapp)}`} target="_blank" rel="noreferrer">Abrir en WhatsApp</a>
        )}
        {f === "mail" && (
          <a className="boton" href={`mailto:?subject=${encodeURIComponent(c.mail.asunto)}&body=${encodeURIComponent(c.mail.cuerpo)}`}>Abrir en el correo</a>
        )}
      </div>
    </section>
  );
}
