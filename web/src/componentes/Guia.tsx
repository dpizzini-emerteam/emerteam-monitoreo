// Guía de criterios para los equipos: niveles, umbrales, decisiones posibles, recomendaciones, escalas y fuentes.
// Los umbrales salen de config/umbrales.json (los mismos que usa el procesamiento) y las recomendaciones
// de reglas.ts (las mismas que muestra la web): la guía no puede contradecir al sistema.
import type { ReactNode } from "react";
import U from "../../../config/umbrales.json";
import { fmtDia, fmtHora, num, type AlertaSMN, type Nivel } from "../datos";
import {
  COLOR_NIVEL, estiloNivel, estiloWA, NOMBRE_FASE, NOMBRE_VARIABLE, NOMBRE_WA, nombreNivel, recomendacion, REGLAS, TIPO_FUENTE,
} from "../reglas";
import { Icono, type TipoIcono } from "./Icono";
import { DISCIPLINAS, ESCALAS, confDisciplina, estiloCalor, nombreDisciplina } from "../disciplinas";

const coma = (x: number, d = 0) => num(x, d);
const KM_MI = 1 / 1.609344; // detector configurado en millas

const SECCIONES: { id: string; titulo: string; icono: TipoIcono }[] = [
  { id: "g-leer", titulo: "Cómo leer la web", icono: "solnube" },
  { id: "g-calor", titulo: "Calor · participantes", icono: "termometro" },
  { id: "g-personal", titulo: "Calor · personal", icono: "estructura" },
  { id: "g-viento", titulo: "Viento y estructuras", icono: "viento" },
  { id: "g-tormenta", titulo: "Tormenta eléctrica", icono: "tormenta" },
  { id: "g-lluvia", titulo: "Lluvia y suelo", icono: "lluvia" },
  { id: "g-smn", titulo: "Alertas del SMN", icono: "alerta" },
  { id: "g-disciplinas", titulo: "Otras disciplinas", icono: "gota" },
  { id: "g-decisiones", titulo: "Decisiones", icono: "corredor" },
  { id: "g-fuentes", titulo: "Fuentes", icono: "gota" },
  { id: "g-glosario", titulo: "Glosario", icono: "nube" },
];

type Contexto = { niveles: Nivel[]; alertas: AlertaSMN[] } | null;

/** "En este evento": el nivel más alto vigente de las variables de la sección */
function EnEsteEvento({ ctx, variables }: { ctx: Contexto; variables: string[] }) {
  if (!ctx) return null;
  const ns = ctx.niveles.filter((n) => variables.includes(n.variable));
  if (!ns.length) return <p className="guia-ahora sin">En este evento: todavía sin pronóstico para estas variables.</p>;
  const max = ns.filter((n) => n.nivel > 0).sort((a, b) => b.nivel - a.nivel || a.desde.localeCompare(b.desde))[0];
  if (!max) return <p className="guia-ahora ok">En este evento: con el pronóstico actual, ninguna de estas variables supera su umbral.</p>;
  return (
    <p className="guia-ahora">
      En este evento: <b>{NOMBRE_VARIABLE[max.variable]} · {nombreNivel(max.variable, max.nivel)}</b> · {NOMBRE_FASE[max.fase]}, desde {fmtDia(max.desde)} {fmtHora(max.desde)}
      {max.confianza === "baja" ? " (tendencia)" : ""}
    </p>
  );
}

function Seccion({ id, titulo, icono, organizador, children }: { id: string; titulo: string; icono: TipoIcono; organizador: ReactNode; children?: ReactNode }) {
  return (
    <section className="seccion guia-seccion" id={id} aria-labelledby={`${id}-t`}>
      <div className="banda guia-banda"><Icono tipo={icono} size={30} /><h2 id={`${id}-t`}>{titulo}</h2></div>
      <div className="guia-cuerpo">
        <div className="guia-organizador">{organizador}</div>
        {children}
      </div>
    </section>
  );
}

function Tecnico({ children }: { children: ReactNode }) {
  return (
    <details className="guia-tecnico">
      <summary>Detalle técnico</summary>
      <div>{children}</div>
    </details>
  );
}

function Fuente({ regla }: { regla: keyof typeof REGLAS }) {
  const r = REGLAS[regla];
  return <p className="chico guia-fuente"><b>Fuente · {TIPO_FUENTE[r.tipo]}:</b> {r.fuente}</p>;
}

export function Guia({ ctx }: { ctx: Contexto }) {
  const wa = U.wbgt_wa.cortes;
  const rangoWA = [`< ${coma(wa[0])} °C`, `${coma(wa[0])} a ${coma(wa[1])} °C`, `${coma(wa[1])} a ${coma(wa[2])} °C`, `${coma(wa[2])} a ${coma(wa[3])} °C`, `> ${coma(wa[3])} °C`];
  const nombreWAen = ["Almost Safe", "Caution", "Warning", "Severe Warning", "Danger"];
  const r = U.rayos;
  const c = U.confianza;
  const w = U.ventanas;
  const sinAccionWA = "Sin medidas adicionales: dispositivo y vigilancia habituales.";

  return (
    <div className="guia">
      <section className="seccion">
        <h2 style={{ marginBottom: 6 }}>Guía de criterios</h2>
        <p className="chico" style={{ marginTop: 0, maxWidth: 820 }}>
          Qué mide la web, con qué umbrales, qué decisiones abre cada nivel y en qué se basa cada criterio. Cada sección empieza con lo que necesita saber el organizador; el detalle técnico está en el desplegable.
          {ctx && " Arriba de cada sección se indica cómo está hoy este evento."}
        </p>
        <nav className="guia-indice" aria-label="Secciones de la guía">
          {SECCIONES.map((s) => <a key={s.id} href={`#${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" }); }}>{s.titulo}</a>)}
        </nav>
      </section>

      <Seccion id="g-leer" titulo="Cómo leer la web" icono="solnube" organizador={
        <p>La web traduce el pronóstico, las alertas oficiales y las mediciones en terreno en <b>niveles de acción</b> por fase del evento. EMERTEAM recomienda; la decisión final corresponde al organizador.</p>
      }>
        <h3>Niveles de acción</h3>
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>Nivel</th><th>Qué significa</th></tr></thead>
            <tbody>
              {[["Bajo umbral", "Ninguna variable supera su umbral. Dispositivo habitual."],
                ["Vigilar", "Hay una condición a seguir. Preparar las medidas, sin modificar todavía el plan."],
                ["Actuar", "Aplicar las medidas recomendadas en la fase indicada."],
                ["Retirar", "Retirar elementos o modificar la actividad en la franja indicada."],
                ["Suspender / despejar", "Suspender la actividad expuesta o despejar el área."]].map(([n, t], i) => (
                <tr key={n}><td><span className="badge" style={estiloNivel(i)}>{n}</span></td><td>{t}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="chico">El estrés térmico de los participantes usa la escala y los colores oficiales de World Athletics; el resto de las variables, el semáforo EMERTEAM. Los dos códigos no se mezclan.</p>

        <h3>Orden de prioridad de la información</h3>
        <ol className="guia-lista">
          <li><b>Alertas del SMN</b> para la zona: tienen prioridad sobre el pronóstico.</li>
          <li><b>Mediciones en terreno y rayos detectados</b>: describen lo que pasa ahora en el lugar.</li>
          <li><b>Pronóstico</b>: anticipa; su confianza depende del plazo y del acuerdo entre modelos.</li>
        </ol>

        <h3>Confianza del pronóstico</h3>
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>Confianza</th><th>Cuándo</th><th>Cómo usarla</th></tr></thead>
            <tbody>
              <tr><td><b>Alta</b></td><td>Los dos modelos coinciden y faltan {c.alta_hasta_h} h o menos.</td><td>Base para ajustar el dispositivo.</td></tr>
              <tr><td><b>Media</b></td><td>Diferencias moderadas entre modelos (WBGT ≥ {coma(c.wbgt[0])} °C, ráfaga ≥ {coma(c.rafaga[0])} km/h o viento ≥ {coma(c.viento[0])} km/h), un solo modelo a menos de {c.un_modelo_baja_h} h, o más de {c.alta_hasta_h} h de plazo.</td><td>Preparar medidas; confirmar en la próxima actualización.</td></tr>
              <tr><td><b>Baja · tendencia</b></td><td>Modelos muy distintos (WBGT ≥ {coma(c.wbgt[1])} °C, ráfaga ≥ {coma(c.rafaga[1])} km/h o viento ≥ {coma(c.viento[1])} km/h) o un solo modelo a más de {c.un_modelo_baja_h} h.</td><td>Aviso anticipado; no comunicar a los participantes todavía.</td></tr>
            </tbody>
          </table>
        </div>
        <p className="chico">Más allá de {Math.round(c.horizonte_niveles_h / 24)} días no se calculan niveles: la fase figura como «Sin pronóstico» hasta que entra en el horizonte de los modelos.</p>

        <h3>Fases y ventanas</h3>
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>Fase</th><th>Desde</th><th>Hasta</th><th>Qué se evalúa</th></tr></thead>
            <tbody>
              <tr><td><b>Armado</b></td><td>00 h del primer día de armado</td><td>{w.armado_hasta_antes_largada_min / 60} h antes de la largada</td><td>Viento sobre estructuras, calor del personal, tormenta y lluvia.</td></tr>
              <tr><td><b>Ventana de los participantes</b></td><td>{w.exposicion_antes_min} min antes de la largada</td><td>{w.exposicion_despues_min} min después del último participante estimado</td><td>Calor de los participantes, viento, tormenta y lluvia.</td></tr>
              <tr><td><b>Último cuarto</b></td><td>Running: cuando el 10 % más rápido entra al último 25 % del recorrido. Otras disciplinas o duración propia: al {Math.round(w.ultimo_cuarto * 100)} % de la duración</td><td>Running: llegada del 90 % (los tiempos de llegada salen de 35 millones de resultados, RunRepeat). Otras: fin de la prueba</td><td>Zona crítica: mayor carga térmica acumulada y más asistencias. Criterio interno EMERTEAM.</td></tr>
              <tr><td><b>Jornada del personal</b></td><td>{w.personal_antes_min / 60} h antes de la largada</td><td>{w.personal_despues_min / 60} h después del último participante</td><td>Calor del personal y viento.</td></tr>
              <tr><td><b>Desarme</b></td><td>Llegada del último participante</td><td>{w.desarme_min / 60} h después</td><td>Viento sobre estructuras, calor del personal, tormenta y lluvia.</td></tr>
            </tbody>
          </table>
        </div>
        <Tecnico>
          <p>Pronóstico: modelos ECMWF IFS (0,25°, cada 3 h hasta 6 días), NOAA GFS (0,25°, horario hasta 5 días y cada 3 h hasta 7 días) y WRF del SMN (4 km, horario hasta 72 h, temperatura y viento calibrados por el SMN; Fuente: Servicio Meteorológico Nacional), revisados cada hora. Se toma el punto de grilla de tierra más cercano al evento, cada modelo se corrige con las observaciones horarias de hasta dos estaciones del SMN y la serie de consenso es un promedio ponderado por el error que cada modelo tuvo en la zona en las últimas 72 h. Tormenta, precipitación y dirección del viento salen del modelo prioritario (ECMWF).</p>
          <p>Ajuste local: si hay una estación del SMN a menos de {U.correccion.distancia_max_km} km con al menos {U.correccion.pares_min} horas comparables en las últimas {U.correccion.ventana_h} h, se corrige el sesgo de temperatura (por separado de día y de noche), punto de rocío y viento, y se recalcula el WBGT. El detalle está en «Equipo y fuentes».</p>
          <p>La duración se estima por distancia (5K ≈ 75 min, 10K ≈ 120 min, 21K ≈ 180 min, 42K ≈ 360 min para el último corredor; en las demás disciplinas se carga la duración estimada) más una demora de largada de {w.demora_cada_1000} min cada 1.000 participantes, salvo que el evento tenga una duración propia cargada.</p>
        </Tecnico>
      </Seccion>

      <Seccion id="g-calor" titulo="Estrés térmico de participantes" icono="termometro" organizador={
        <p>El <b>WBGT</b> resume en un solo valor el efecto combinado de temperatura, humedad, sol y viento sobre quien compite. Es el índice que usa World Athletics para decidir medidas por calor. El riesgo se concentra en el <b>último cuarto</b> de la carrera y en el <b>grupo de mayor riesgo: hombres mayores de 35 años</b>.</p>
      }>
        <EnEsteEvento ctx={ctx} variables={["wbgt"]} />
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>WBGT</th><th>Nivel World Athletics</th><th>Medidas recomendadas</th></tr></thead>
            <tbody>
              {NOMBRE_WA.map((n, i) => (
                <tr key={n}>
                  <td style={{ whiteSpace: "nowrap" }}><b>{rangoWA[i]}</b></td>
                  <td><span className="badge" style={estiloWA(i)}>{n}</span><div className="chico">{nombreWAen[i]}</div></td>
                  <td>{recomendacion("wbgt", i, "carrera") ?? sinAccionWA}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Fuente regla="wa2020_wbgt" />
        <Tecnico>
          <p>WBGT estimado: método de Liljegren et al. (2008) con temperatura, humedad, presión, viento y radiación solar del pronóstico, hora por hora. Por la radiación, el valor de mediodía puede superar al de la tarde aunque la temperatura sea mayor después.</p>
          <p>WBGT medido: con termómetro de globo negro, en el recorrido, expuesto al sol y a la altura del torso de los participantes. Cuando hay medición reciente en terreno, manda sobre el estimado.</p>
          <p>Los niveles se evalúan en toda la ventana de los participantes y se informa la franja en que se alcanza cada nivel. Un mismo WBGT pesa más en el último cuarto, por la carga térmica acumulada, y en participantes no aclimatados (primeros días de calor de la temporada).</p>
        </Tecnico>
      </Seccion>

      <Seccion id="g-personal" titulo="Estrés térmico del personal" icono="estructura" organizador={
        <p>El personal de armado, desarme y puestos trabaja más horas y con más esfuerzo físico que los participantes. La referencia es la <b>Resolución SRT 30/2023</b> (valor límite de acción para trabajadores no aclimatados), con el mismo índice WBGT, que la norma llama TGBH.</p>
      }>
        <EnEsteEvento ctx={ctx} variables={["calor_personal"]} />
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>TGBH</th><th>Nivel</th><th>Medidas recomendadas</th></tr></thead>
            <tbody>
              <tr><td style={{ whiteSpace: "nowrap" }}><b>≤ {coma(U.calor_personal.pesada, 1)} °C</b></td><td><span className="badge" style={estiloNivel(0)}>{nombreNivel("calor_personal", 0)}</span></td><td>Sin medidas adicionales: hidratación y pausas habituales.</td></tr>
              <tr><td style={{ whiteSpace: "nowrap" }}><b>&gt; {coma(U.calor_personal.pesada, 1)} °C</b></td><td><span className="badge" style={estiloNivel(1)}>{nombreNivel("calor_personal", 1)}</span></td><td>{recomendacion("calor_personal", 1, "armado")}</td></tr>
              <tr><td style={{ whiteSpace: "nowrap" }}><b>&gt; {coma(U.calor_personal.moderada, 1)} °C</b></td><td><span className="badge" style={estiloNivel(2)}>{nombreNivel("calor_personal", 2)}</span></td><td>{recomendacion("calor_personal", 2, "armado")}</td></tr>
            </tbody>
          </table>
        </div>
        <Fuente regla="srt30_2023_tgbh" />
        <Tecnico>
          <p>Carga pesada: montaje de truss, vallas, pórticos y traslado manual de materiales. Carga moderada: armado de gazebos, cartelería, tareas de logística con desplazamiento constante.</p>
          <p>El régimen de trabajo y descanso, las correcciones por vestimenta y los planes de aclimatación están en el anexo de la resolución. Personal aclimatado tolera valores algo mayores; ante la duda se aplica el criterio de no aclimatado.</p>
        </Tecnico>
      </Seccion>

      <Seccion id="g-viento" titulo="Viento y estructuras" icono="viento" organizador={
        <p>El riesgo por viento depende de <b>qué estructura</b> esté expuesta. Por eso hay tres escalas, según la superficie que ofrece al viento y cómo está anclada. Se evalúa la <b>ráfaga</b>, no el viento medio: es la que vuelca o desprende elementos.</p>
      }>
        <EnEsteEvento ctx={ctx} variables={["viento_A", "viento_B", "viento_C"]} />
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead>
              <tr><th>Categoría</th>{[1, 2, 3, 4].map((n) => <th key={n}><span className="badge" style={estiloNivel(n)}>{nombreNivel("viento_A", n)}</span></th>)}</tr>
            </thead>
            <tbody>
              {(["A", "B", "C"] as const).map((k) => (
                <tr key={k}>
                  <td><b>{{ A: "Estructuras ultralivianas", B: "Superficies de vela", C: "Estructuras ingenieriles" }[k]}</b><div className="chico">{{ A: "Gazebos plegables, fly banners, arco inflable", B: "Lonas en vallas, banners en truss, cartelería, columnas de sonido", C: "Pórtico de truss, carpas estructurales, pantalla LED" }[k]}</div></td>
                  {U.viento[k].map((v, i) => <td key={i} style={{ whiteSpace: "nowrap" }}>≥ {coma(v)} km/h</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Medidas por nivel</h3>
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>Nivel</th><th>Medida (ejemplo: estructuras ultralivianas)</th></tr></thead>
            <tbody>
              {[1, 2, 3, 4].map((n) => <tr key={n}><td><span className="badge" style={estiloNivel(n)}>{nombreNivel("viento_A", n)}</span></td><td>{recomendacion("viento_A", n, "armado")}</td></tr>)}
            </tbody>
          </table>
        </div>
        <p className="chico">Para superficies de vela y estructuras ingenieriles las medidas son equivalentes, aplicadas a sus elementos; en estructuras ingenieriles el último nivel incluye evaluar la suspensión.</p>
        <Fuente regla="emt_viento_A" />
        <Fuente regla="emt_viento_B" />
        <Fuente regla="emt_viento_C" />
        <Tecnico>
          <p>El pronóstico da la ráfaga a 10 m de altura sobre terreno abierto. A la altura de un gazebo o una valla suele ser menor, y en calles con edificios puede canalizarse y aumentar. Por eso la medición con anemómetro a la altura de la estructura, en el lugar, manda sobre el pronóstico.</p>
          <p>Cuando un modelo no publica la ráfaga a ese plazo, se estima con el viento medio de ese mismo modelo y el factor de ráfaga del otro. Si los modelos difieren mucho en el viento, la confianza baja y el nivel se toma como tendencia.</p>
          <p>Radio de seguridad para despejar: 1,5 veces la altura de la estructura. La especificación del fabricante o el cálculo estructural, si existen, tienen prioridad sobre esta escala.</p>
        </Tecnico>
      </Seccion>

      <Seccion id="g-tormenta" titulo="Tormenta eléctrica" icono="tormenta" organizador={
        <p>El rayo es el riesgo meteorológico con menor margen de reacción. Se actúa por <b>distancia de la actividad eléctrica</b>, con una escalera de tres pasos, y <b>trueno audible significa suspender</b>: si se oye, el rayo puede alcanzar el lugar.</p>
      }>
        <EnEsteEvento ctx={ctx} variables={["tormenta"]} />
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>Detector (frente de tormenta)</th><th>Si está en millas</th><th>Nivel</th><th>Carrera</th><th>Armado y desarme</th></tr></thead>
            <tbody>
              <tr><td><b>{r.alerta_km} km o menos</b></td><td>{Math.round(r.alerta_km * KM_MI)} mi o menos</td><td><span className="badge" style={estiloNivel(2)}>Alerta</span></td><td>Avisar al equipo y a la organización; preparar la demora y los refugios.</td><td>Avisar al personal; preparar el descenso de trabajos en altura.</td></tr>
              <tr><td><b>{r.demora_km} km o menos</b></td><td>{Math.round(r.demora_km * KM_MI)} mi o menos</td><td><span className="badge" style={estiloNivel(3)}>Demora / preparación</span></td><td>Demorar la largada; preparar la evacuación del recorrido.</td><td>Bajar al personal de altura; asegurar estructuras.</td></tr>
              <tr><td><b>{r.suspension_km} km o menos, o trueno audible</b></td><td>{Math.round(r.suspension_km * KM_MI)} mi o menos</td><td><span className="badge" style={estiloNivel(4)}>Suspensión</span></td><td>Suspender y evacuar a refugio.</td><td>Suspender el trabajo y evacuar a refugio.</td></tr>
            </tbody>
          </table>
        </div>
        <p><b>Reanudar</b> recién cuando pasan <b>{r.reanudar_min} minutos sin actividad</b> a {r.suspension_km} km o menos. Cada nuevo rayo cercano reinicia la cuenta.</p>
        <h3>Cómo usar el detector</h3>
        <p>El detector portátil muestra la <b>distancia estimada al frente de la tormenta</b> (el borde más cercano), no la del rayo puntual, y el contador acumulado de rayos (COUNT). Con actividad, cargá una lectura cada 5 minutos en Mediciones: con dos o más lecturas la web calcula si la tormenta <b>se acerca o se aleja</b>, a qué velocidad, <b>cuántos minutos faltan</b> para los {r.demora_km} y los {r.suspension_km} km, y la hora a partir de la cual se puede reanudar. Decidí por la tendencia de varias lecturas, no por una sola, y cruzala con el satélite.</p>
        <p>Cuando vuelve a «LISTENING» pasaron 30 minutos sin rayos a cualquier distancia (hasta 40 km): si eso ocurre, también se cumple la regla de reanudación. La regla puede cumplirse antes si siguen cayendo rayos lejos.</p>
        <p><b>Respaldo sin detector:</b> contá los segundos entre el relámpago y el trueno y dividí por 3 para obtener los kilómetros. Sirve sobre todo para confirmar el último tramo: el trueno se oye hasta unos 15 km, menos con el ruido del evento, así que <b>si se oye trueno, se suspende</b> sin importar los segundos.</p>
        <div className="guia-dos">
          <div><h3>Refugios aptos</h3><p>Edificios cerrados con instalación eléctrica y cañerías; vehículos de techo metálico con ventanillas cerradas.</p></div>
          <div><h3>No son refugio</h3><p>Carpas, gazebos, pórticos, estructuras metálicas abiertas, baños químicos, árboles, paradas de colectivo.</p></div>
        </div>
        <h3>Pronóstico de tormenta</h3>
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>Nivel</th><th>Criterio</th><th>Medida</th></tr></thead>
            <tbody>
              <tr><td><span className="badge" style={estiloNivel(1)}>{nombreNivel("tormenta", 1)}</span></td><td>CAPE ≥ {U.tormenta.posible.cape} J/kg con precipitación ≥ {U.tormenta.posible.precip} mm/h</td><td rowSpan={2}>{recomendacion("tormenta", 1, "carrera")}</td></tr>
              <tr><td><span className="badge" style={estiloNivel(2)}>{nombreNivel("tormenta", 2)}</span></td><td>CAPE ≥ {U.tormenta.probable.cape} J/kg con precipitación ≥ {U.tormenta.probable.precip} mm/h</td></tr>
            </tbody>
          </table>
        </div>
        <Fuente regla="emt_tormenta_cape" />
        <Tecnico>
          <p>Detección: el satélite GOES-19 (sensor GLM) informa rayos cada pocos minutos en un radio de 50 km, con una precisión de ubicación del orden de 8 a 10 km y sin detectar todos los rayos. En terreno se suman el detector portátil (AcuRite: alcance de 1 a 40 km; el fabricante advierte que puede haber detecciones falsas y que no debe ser la única fuente de aviso) y el conteo relámpago-trueno (segundos × 0,343 = km). <b>Manda la lectura más conservadora.</b> La tendencia se calcula con una recta de mínimos cuadrados sobre las lecturas de los últimos 45 minutos.</p>
          <p>El pronóstico de tormenta indica que la atmósfera es favorable a tormentas, no dónde ni a qué hora va a caer un rayo. Sirve para preparar el protocolo, no para decidir la demora o la suspensión.</p>
        </Tecnico>
      </Seccion>

      <Seccion id="g-lluvia" titulo="Lluvia y suelo" icono="lluvia" organizador={
        <p>La lluvia afecta sobre todo a la <b>infraestructura</b> (anclajes en suelo blando, tableros eléctricos, anegamiento de la llegada) y a la <b>seguridad del recorrido</b> (superficies resbaladizas).</p>
      }>
        <EnEsteEvento ctx={ctx} variables={["lluvia"]} />
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>Criterio</th><th>Nivel</th><th>Medidas recomendadas</th></tr></thead>
            <tbody>
              <tr><td>Acumulado ≥ {U.lluvia.suelo_saturado_mm} mm en {U.lluvia.suelo_horas} h</td><td><span className="badge" style={estiloNivel(1)}>{nombreNivel("lluvia", 1)}</span></td><td>{recomendacion("lluvia", 1, "armado")}</td></tr>
              <tr><td>Intensidad &gt; {U.lluvia.intensa_mm_h} mm/h</td><td><span className="badge" style={estiloNivel(2)}>{nombreNivel("lluvia", 2)}</span></td><td>{recomendacion("lluvia", 2, "armado")}</td></tr>
            </tbody>
          </table>
        </div>
        <Fuente regla="emt_lluvia_intensidad" />
        <Fuente regla="emt_suelo_saturado" />
        <Tecnico>
          <p>El monto y el horario exactos de la lluvia en un punto son de las variables con más error de pronóstico; el acumulado de varios días es más confiable que la intensidad de una hora. Una lluvia intensa casi siempre viene con tormenta: revisar también esa sección.</p>
        </Tecnico>
      </Seccion>

      <Seccion id="g-smn" titulo="Alertas del SMN" icono="alerta" organizador={
        <p>Las alertas y avisos del <b>Servicio Meteorológico Nacional</b> son la información oficial y <b>tienen prioridad sobre el pronóstico de esta web</b>. Aparecen arriba de todo, con sonido, y generan un correo a quienes reciben alertas.</p>
      }>
        {ctx && (ctx.alertas.length
          ? <p className="guia-ahora">En este evento: {ctx.alertas.length === 1 ? "hay una alerta vigente" : `hay ${ctx.alertas.length} alertas vigentes`} del SMN.</p>
          : <p className="guia-ahora ok">En este evento: sin alertas del SMN vigentes.</p>)}
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>Tipo</th><th>Qué es</th><th>Qué hacer</th></tr></thead>
            <tbody>
              <tr><td><b>Alerta</b> amarilla, naranja o roja</td><td>Fenómenos previstos para las próximas horas o días en la zona, de severidad creciente según el color.</td><td>Revisar el plan para la franja de vigencia; con naranja o roja, evaluar con EMERTEAM la modificación o suspensión de la actividad expuesta.</td></tr>
              <tr><td><b>Aviso a corto plazo</b></td><td>Fenómeno inminente o en curso, en general tormentas fuertes, para las próximas horas.</td><td>Activar el protocolo correspondiente de inmediato.</td></tr>
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
          {[["Amarilla", "#F5C400"], ["Naranja", "#FF6A1A"], ["Roja", "#FF3B30"]].map(([n, col]) => <span key={n} className="badge" style={{ background: col, color: "#111" }}>{n}</span>)}
        </div>
        <Tecnico>
          <p>La web lee el feed oficial del SMN en formato CAP cada 5 minutos y muestra solo las alertas cuyo polígono contiene el punto del evento y cuya vigencia coincide con el armado, la carrera o el desarme. Cuando el SMN deja de publicarla, figura como levantada.</p>
        </Tecnico>
      </Seccion>

      <Seccion id="g-disciplinas" titulo="Otras disciplinas" icono="gota" organizador={
        <p>Cada evento tiene una disciplina. Cambia <b>la escala de calor</b> (la de su federación internacional) y suma <b>el agua</b> en triatlón y aguas abiertas. Viento, tormenta, lluvia, estructuras y personal siguen los mismos criterios para todas. Lo que no tiene norma publicada <b>se muestra pero no genera niveles ni avisos</b> hasta que EMERTEAM fije su criterio.</p>
      }>
        <EnEsteEvento ctx={ctx} variables={["wbgt_wt", "wbgt_uci"]} />
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>Disciplina</th><th>Escala de calor</th><th>Agua</th><th>Sensación térmica por viento</th></tr></thead>
            <tbody>
              {DISCIPLINAS.map((d) => {
                const c = confDisciplina(d);
                return <tr key={d}><td><b>{nombreDisciplina(d)}</b></td><td>{ESCALAS[c.calor].autor}</td><td>{c.agua ? "Temperatura y calidad, medidas en terreno" : "—"}</td><td>{c.wct ? "Informativa" : "—"}</td></tr>;
              })}
            </tbody>
          </table>
        </div>

        <h3>Calor · triatlón (World Triathlon) y ciclismo (UCI)</h3>
        <div className="guia-dos">
          {(["wbgt_wt", "wbgt_uci"] as const).map((v) => (
            <div key={v}>
              <div className="desplaza">
                <table className="tabla guia-tabla">
                  <thead><tr><th>{ESCALAS[v].autor}</th><th>WBGT</th><th>Medida</th></tr></thead>
                  <tbody>
                    {ESCALAS[v].niveles.map((nombre, i) => (
                      <tr key={nombre}><td><span className="badge" style={estiloCalor(v, i)}>{nombre}</span></td><td style={{ whiteSpace: "nowrap" }}>{ESCALAS[v].rangos[i]}</td><td>{recomendacion(v, i, "carrera") ?? "Sin medidas adicionales."}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Fuente regla={v === "wbgt_wt" ? "wt_wbgt" : "uci_wbgt"} />
            </div>
          ))}
        </div>
        <p className="chico">Triatlón: bandera roja y negra según World Triathlon; azul y naranja con medidas de EMERTEAM. Ciclismo: medidas del Anexo C de la UCI. «Por encima de 28 °C» se toma desde 28,0 °C por prudencia.</p>

        <h3>Calor · aguas abiertas</h3>
        <p>Durante el nado <b>manda la temperatura del agua</b>: en el agua el sudor no evapora y, cuando el agua se acerca a la temperatura de la piel, el nadador acumula calor. El WBGT del aire (escala World Athletics) se usa para las fases en tierra (espera, salida del agua) y para el personal embarcado.</p>
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>WBGT</th><th>Medida para aguas abiertas</th></tr></thead>
            <tbody>
              {[1, 2, 3, 4].map((i) => (
                <tr key={i}><td><span className="badge" style={estiloCalor("wbgt", i)}>{ESCALAS.wbgt.niveles[i]}</span> <span className="chico">{ESCALAS.wbgt.rangos[i]}</span></td><td>{recomendacion("wbgt", i, "carrera", "aguas_abiertas")}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <Fuente regla="aa_calor" />

        <h3>Agua · triatlón (World Triathlon)</h3>
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>Agua</th><th>750 m</th><th>1000 m</th><th>1500 m</th><th>1900 a 3000 m</th><th>3800 a 4000 m</th></tr></thead>
            <tbody>
              {U.agua_wt.franjas.map((f, i) => {
                const hasta = i === 0 ? null : U.agua_wt.franjas[i - 1].desde;
                const rango = i === 0 ? `≥ ${coma(f.desde, 1)} °C` : f.desde < 0 ? `< ${coma(hasta!, 1)} °C` : `${coma(f.desde, 1)} a ${coma(hasta! - 0.1, 1)} °C`;
                return <tr key={i}><td style={{ whiteSpace: "nowrap" }}><b>{rango}</b></td>{(f.valores as (number | string | null)[]).map((x, j) => <td key={j}>{x === null ? <span className="badge" style={estiloNivel(4)}>Se cancela</span> : x === "orig" ? "Original" : `${x} m`}</td>)}</tr>;
              })}
            </tbody>
          </table>
        </div>
        <p>Neopreno obligatorio con agua de {coma(U.agua_wt.neopreno_obligatorio_hasta, 1)} °C o menos. Para grupos de edad, prohibido desde {coma(U.agua_wt.neopreno_prohibido_grupos_edad.hasta_1500, 1)} °C (natación de hasta 1500 m) o {coma(U.agua_wt.neopreno_prohibido_grupos_edad.mas_de_1500, 1)} °C (más de 1500 m y 60 años o más). Con agua de 22 °C o menos y aire de 15 °C o menos se usa la <b>temperatura ajustada por aire frío</b> (regla 4.4(b)); con aire de 5 °C se cancela la natación. Medición: {U.agua_wt.medicion}</p>

        <h3>Agua · aguas abiertas (World Aquatics)</h3>
        <p>La temperatura del agua tiene que estar entre <b>{coma(U.agua_wa.minima)} y {coma(U.agua_wa.maxima)} °C</b>. Fuera de ese rango no se larga; en carrera se repite la medición a los 30 minutos y se detiene si persiste. Neopreno obligatorio con menos de {coma(U.agua_wa.neopreno_obligatorio_bajo)} °C. Medición: {U.agua_wa.medicion}</p>

        <h3>Calidad del agua (World Aquatics OWS 10.1)</h3>
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>Agua</th><th>Excelente</th><th>Buena</th><th>Inaceptable</th></tr></thead>
            <tbody>
              {(["mar", "continental"] as const).map((t) => {
                const l = U.calidad_agua[t];
                return <tr key={t}><td><b>{t === "mar" ? "Mar" : "Río, lago o laguna"}</b></td><td>enterococos &lt; {l.excelente.enterococos} · E. coli &lt; {l.excelente.ecoli}</td><td>&lt; {l.buena.enterococos} · &lt; {l.buena.ecoli}</td><td>&gt; {l.buena.enterococos} · &gt; {l.buena.ecoli}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
        <p className="chico">UFC por 100 ml; muestras en 3 puntos, decide el peor resultado. Cianobacterias: más de {coma(U.calidad_agua.cianobacterias_max)} células/ml es inaceptable. World Triathlon exige al menos calidad «buena».</p>

        <h3>Sin umbral publicado: se muestra, no genera niveles</h3>
        <ul>
          <li><b>Sensación térmica por viento</b> (ciclismo, montaña y el segmento de bici del triatlón): se calcula con temperatura de hasta 10 °C y viento desde 4,8 km/h. Riesgo moderado desde −10 °C, alto desde −28 °C (Environment and Climate Change Canada).</li>
          <li><b>Viento y ráfagas sobre ciclistas, lluvia en bajadas y curvas, visibilidad, oleaje y corriente:</b> ninguna federación fija valores; se vigilan en terreno.</li>
          <li><b>Rayos sobre el agua:</b> la evacuación desde el agua lleva más tiempo. La guía de la NATA (Walsh et al., 2013) indica tener a todos fuera del agua antes de que la tormenta llegue a unos 9 km.</li>
          <li><b>Carreras de montaña:</b> el pronóstico corresponde al punto de largada; la temperatura baja unos 6,5 °C por cada 1000 m de altura y el viento en filos es mayor.</li>
        </ul>
        <Tecnico>
          <p>La temperatura del agua no tiene pronóstico confiable en ríos, lagos y lagunas: se mide en terreno con el protocolo de la federación y la web aplica la regla a la última medición. Para el ajuste por aire frío se usa la temperatura del aire cargada en la misma medición, redondeando agua y aire hacia abajo (fila y columna más frías de la tabla).</p>
          <p>En triatlón, la natación es zona crítica junto con el último cuarto: concentra entre el 67 y el 71 % de las muertes, mayormente de causa cardíaca en hombres de edad media (USA Triathlon, 2012; Harris et al., 2017).</p>
        </Tecnico>
      </Seccion>

      <Seccion id="g-decisiones" titulo="Decisiones y responsabilidades" icono="corredor" organizador={
        <p>EMERTEAM <b>recomienda</b>, con el fundamento y la fuente de cada criterio. La <b>decisión final corresponde al organizador</b>. Las decisiones se escalonan: cuanto antes se toma una medida menor, menos probable es tener que tomar una mayor el día del evento.</p>
      }>
        <ol className="guia-escalera">
          {[["Continuar con vigilancia", "Seguir la evolución en cada actualización. Dispositivo habitual.", 1],
            ["Ajustar el dispositivo", "Reforzar hidratación, enfriamiento, lastre o personal; avisar a los participantes.", 2],
            ["Demorar", "Postergar la largada o una tarea hasta que pase la condición (tormenta, viento).", 3],
            ["Modificar", "Cambiar horario, acortar distancias, retirar estructuras o habilitar el retiro voluntario.", 3],
            ["Suspender", "Suspender o neutralizar la carrera o el trabajo expuesto, y evacuar si corresponde.", 4]].map(([t, d, n]) => (
            <li key={t as string}><span className="guia-paso" style={{ background: COLOR_NIVEL[n as number], color: n === 4 ? "#fff" : "#111" }} /><div><b>{t}</b><p>{d}</p></div></li>
          ))}
        </ol>
        <h3>Comunicación</h3>
        <p>Cuando hay un aviso preventivo para el día de carrera, la pestaña <b>Día de carrera</b> ofrece un texto sugerido para los participantes (corredores, atletas, nadadores o ciclistas) en tres formatos: redes sociales, WhatsApp y mail. Con confianza baja conviene esperar a que el pronóstico se confirme antes de publicar.</p>
        <Tecnico>
          <p>Cada decisión tomada y la evolución de los niveles quedan registradas y alimentan el informe post-evento, que EMERTEAM aprueba y comparte con el organizador.</p>
        </Tecnico>
      </Seccion>

      <Seccion id="g-fuentes" titulo="Fuentes de cada criterio" icono="gota" organizador={
        <p>Cada criterio indica su fuente y su tipo, para distinguir lo que es <b>norma</b>, lo que es <b>guía internacional</b> y lo que es <b>criterio interno de EMERTEAM</b>.</p>
      }>
        <div className="desplaza">
          <table className="tabla guia-tabla">
            <thead><tr><th>Criterio</th><th>Tipo</th><th>Fuente</th></tr></thead>
            <tbody>
              {Object.entries(REGLAS).map(([k, v]) => (
                <tr key={k}>
                  <td>{{ wa2020_wbgt: "Calor · participantes (World Athletics)", srt30_2023_tgbh: "Calor · personal", emt_viento_A: "Viento · ultralivianas", emt_viento_B: "Viento · superficies de vela", emt_viento_C: "Viento · estructuras ingenieriles", emt_tormenta_cape: "Tormenta", emt_lluvia_intensidad: "Lluvia intensa", emt_suelo_saturado: "Suelo saturado", wt_wbgt: "Calor · atletas de triatlón", aa_calor: "Calor · nadadores (medidas)", uci_wbgt: "Calor · ciclistas" }[k] ?? k}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{TIPO_FUENTE[v.tipo]}</td>
                  <td>{v.fuente}</td>
                </tr>
              ))}
              <tr><td>Rayos · distancias</td><td>{TIPO_FUENTE.GI}</td><td>National Weather Service (NOAA). Lightning Safety Toolkit for Outdoor Venues.</td></tr>
              <tr><td>WBGT estimado</td><td>{TIPO_FUENTE.CC}</td><td>Liljegren, J. C., Carhart, R. A., Lawday, P., Tschopp, S. y Sharp, R. (2008). Modeling the wet bulb globe temperature using standard meteorological measurements. Journal of Occupational and Environmental Hygiene, 5(10), 645-655.</td></tr>
              <tr><td>Agua · triatlón</td><td>{TIPO_FUENTE.GI}</td><td>World Triathlon. Competition Rules 2026, reglas 4.2, 4.4(a), 4.4(b) y 4.4(e).</td></tr>
              <tr><td>Agua · aguas abiertas</td><td>{TIPO_FUENTE.GI}</td><td>World Aquatics. Open Water Swimming Rules (2025), OWS 7.2, 9.1.6.3, 10.1 y 11.4.7.</td></tr>
              <tr><td>Agua fría, base experimental</td><td>{TIPO_FUENTE.CC}</td><td>Saycell, J., Lomax, M., Massey, H. y Tipton, M. (2018). Scientific rationale for changing lower water temperature limits for triathlon racing to 12 °C with wetsuits and 16 °C without wetsuits. British Journal of Sports Medicine, 52(11), 702-708.</td></tr>
              <tr><td>Sensación térmica por viento</td><td>{TIPO_FUENTE.GI}</td><td>Environment and Climate Change Canada; National Weather Service (2001). Wind Chill Temperature Index. Informativo, sin umbral de decisión.</td></tr>
              <tr><td>Alertas</td><td>Fuente oficial</td><td>Servicio Meteorológico Nacional. Sistema de Alerta Temprana (feed CAP).</td></tr>
            </tbody>
          </table>
        </div>
      </Seccion>

      <Seccion id="g-glosario" titulo="Glosario" icono="nube" organizador={<p>Términos que aparecen en la web.</p>}>
        <dl className="guia-glosario">
          {[["WBGT / TGBH", "Temperatura de globo y bulbo húmedo. Índice de estrés térmico que combina temperatura, humedad, radiación solar y viento. TGBH es su nombre en la normativa argentina."],
            ["Ráfaga", "Viento máximo de pocos segundos. Es la que importa para estructuras."],
            ["Viento medio", "Promedio del viento en varios minutos."],
            ["CAPE", "Energía disponible para el desarrollo de tormentas, en J/kg. Valores altos favorecen tormentas fuertes."],
            ["GLM", "Sensor de rayos del satélite GOES-19 de NOAA."],
            ["ECMWF / GFS", "Modelos globales de pronóstico del Centro Europeo y de la NOAA de Estados Unidos."],
            ["WRF SMN", "Modelo regional del Servicio Meteorológico Nacional, con celdas de 4 km: representa mejor la ciudad y la costa en los primeros 3 días."],
            ["Confianza", "Qué tan firme es el pronóstico, según el plazo y el acuerdo entre modelos."],
            ["Tendencia", "Pronóstico con confianza baja: anticipa una posibilidad que todavía puede cambiar."],
            ["Sesgo", "Error sistemático de un modelo en un lugar (por ejemplo, pronosticar siempre 2 °C de menos). Se corrige con observaciones."],
            ["Último cuarto", "Último 25 % del recorrido. En running, la franja horaria va desde que el 10 % más rápido entra a ese tramo hasta que llega el 90 % del pelotón: concentra la mayor carga térmica y las asistencias."]].map(([t, d]) => (
            <div key={t}><dt>{t}</dt><dd>{d}</dd></div>
          ))}
        </dl>
      </Seccion>
    </div>
  );
}
