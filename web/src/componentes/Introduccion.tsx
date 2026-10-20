import { useState } from "react";
import { COLOR_NIVEL, TEXTO_NIVEL } from "../reglas";

const CLAVE = "mon_intro_oculta";

function leerOculta(): boolean {
  try {
    return localStorage.getItem(CLAVE) === "1";
  } catch {
    return false;
  }
}

const NIVELES = [
  ["Bajo umbral", "Ninguna acción adicional."],
  ["Vigilar", "Seguir la evolución y verificar."],
  ["Actuar", "Medidas preventivas."],
  ["Retirar", "Retirar estructuras o reprogramar tareas."],
  ["Suspender", "Despejar áreas o evaluar suspensión."],
];

/** Explicación breve de la herramienta. Se puede cerrar y volver a abrir; se recuerda en este navegador. */
export function Introduccion() {
  const [oculta, setOculta] = useState(leerOculta);

  const cambiar = (v: boolean) => {
    setOculta(v);
    try {
      if (v) localStorage.setItem(CLAVE, "1");
      else localStorage.removeItem(CLAVE);
    } catch { /* sin almacenamiento: solo en esta visita */ }
  };

  if (oculta) {
    return (
      <button className="enlace-intro" onClick={() => cambiar(false)}>
        ¿Cómo se lee esta página?
      </button>
    );
  }

  return (
    <section className="intro tarjeta" aria-labelledby="intro-t">
      <div className="intro-cab">
        <h2 id="intro-t">Cómo funciona el monitoreo ambiental</h2>
        <button className="boton" onClick={() => cambiar(true)}>Entendido</button>
      </div>
      <div className="intro-cols">
        <p>
          EMERTEAM sigue de forma automática, cada dos horas, el pronóstico de los modelos meteorológicos ECMWF y GFS y las alertas
          oficiales del Servicio Meteorológico Nacional para el lugar y la fecha de tu evento. No hace falta actualizar la página.
        </p>
        <p>
          Se evalúan tres momentos: el armado, el día de carrera (corredores y jornada del personal) y el desarme.
          El calor, el viento sobre las estructuras, la tormenta eléctrica y la lluvia se comparan con umbrales de normas y guías
          internacionales, y cada caso se traduce en un nivel y una recomendación concreta, con su fuente.
        </p>
        <p>
          Cuanto más lejos está la fecha, más incierto es el pronóstico: esos casos se marcan como tendencia. Si el SMN emite una
          alerta, aparece arriba de todo y suena un aviso. EMERTEAM recomienda; la decisión final es del organizador.
        </p>
      </div>
      <div className="intro-niveles" role="list" aria-label="Niveles">
        {NIVELES.map(([n, d], i) => (
          <div key={n} role="listitem" style={{ background: COLOR_NIVEL[i], color: TEXTO_NIVEL[i] }}>
            <b>{n}</b>
            <span>{d}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
