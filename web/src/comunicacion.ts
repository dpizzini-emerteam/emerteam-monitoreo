// Textos sugeridos para que el organizador comunique a los corredores, en tres formatos:
// redes sociales (breve), WhatsApp (con formato de WhatsApp) y correo (asunto + cuerpo completo).
// Solo se arman cuando hay un aviso preventivo para el día de carrera: estrés térmico (escala World Athletics),
// tormenta, lluvia, o una alerta del SMN vigente durante la ventana del corredor.
import type { AlertaSMN, Evento, Nivel } from "./datos";

export type Comunicado = {
  motivos: string[];
  confirmar: boolean; // pronóstico con confianza baja: conviene esperar la próxima actualización antes de publicar
  redes: string;
  whatsapp: string;
  mail: { asunto: string; cuerpo: string };
};

type Bloque = { clave: string; emoji: string; titulo: string; corto: string; medio: string; largo: string };

const fecha = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
const hora = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

function calor(n: number): Bloque | null {
  const b = [
    null,
    {
      corto: "Se prevé calor moderado: hidratate desde el día anterior, usá ropa clara y gorra, y ajustá el ritmo.",
      medio: "Se prevé calor moderado. Hidratate desde el día anterior, usá ropa clara y gorra, y ajustá el ritmo: no es un día para buscar marcas.",
      largo: "Para el día de la carrera se prevé calor moderado. Te recomendamos hidratarte desde el día anterior, usar ropa clara y gorra, y ajustar el ritmo a las condiciones: no es un día para buscar marcas personales. Si sentís mareo, confusión o escalofríos, detenete y pedí asistencia al personal de la organización.",
    },
    {
      corto: "Se esperan condiciones de calor elevadas: bajá el ritmo, tomá agua en cada puesto y mojate cabeza y cuello.",
      medio: "Se esperan condiciones de calor elevadas. Bajá el ritmo desde la largada, tomá agua en cada puesto y mojate la cabeza y el cuello. Si estuviste enfermo o dormiste mal, no corras.",
      largo: "Para el día de la carrera se esperan condiciones de calor elevadas. Bajá el ritmo desde la largada, tomá agua en cada puesto de hidratación y mojate la cabeza y el cuello. Si en los días previos estuviste enfermo, con fiebre o dormiste mal, te pedimos que no corras. Prestá especial atención en los últimos kilómetros, cuando el cansancio y el calor se suman. Si ves a otro corredor desorientado o con dificultad para mantenerse en pie, avisá al personal más cercano.",
    },
    {
      corto: "Se prevé calor extremo: si no entrenaste con calor, considerá no largar o pasarte a una distancia menor.",
      medio: "Se prevé calor extremo. Si no entrenaste con calor, considerá no largar o pasarte a una distancia menor. Corré sin objetivo de tiempo, hidratate y enfriate en todos los puestos.",
      largo: "Para el día de la carrera se prevé calor extremo. Si no entrenaste con calor en las últimas semanas, te recomendamos considerar no largar o pasarte a una distancia menor. Si corrés, hacelo sin objetivo de tiempo, hidratate y enfriate en todos los puestos, y ante cualquier síntoma (mareo, confusión, náuseas, escalofríos) detenete y pedí asistencia. Si ves a otro corredor con dificultades, avisá al personal más cercano.",
    },
    {
      corto: "Las condiciones de calor previstas son peligrosas. La organización está evaluando cambios en la carrera.",
      medio: "Las condiciones de calor previstas son peligrosas. La organización está evaluando cambios en la carrera: seguí los canales oficiales.",
      largo: "Las condiciones de calor previstas para el día de la carrera son peligrosas. La organización está evaluando cambios de horario, de recorrido o la suspensión de la prueba, y te los vamos a comunicar por este medio y por nuestros canales oficiales. Te pedimos que estés atento a las novedades.",
    },
  ][n];
  return b ? { clave: "calor", emoji: "☀️", titulo: "Calor", ...b } : null;
}

function tormenta(n: number): Bloque | null {
  if (n <= 0) return null;
  return {
    clave: "tormenta", emoji: "⛈️", titulo: "Tormentas",
    corto: `${n >= 2 ? "Es probable" : "Es posible"} que haya tormentas eléctricas. Si se demora o suspende la largada, seguí las indicaciones del personal.`,
    medio: `${n >= 2 ? "Es probable" : "Es posible"} que haya tormentas eléctricas. Si se demora o se suspende la largada, seguí las indicaciones del personal y buscá refugio en edificios o vehículos cerrados; no te refugies bajo árboles ni junto a estructuras metálicas.`,
    largo: `${n >= 2 ? "Es probable" : "Es posible"} que haya tormentas eléctricas el día de la carrera. Ante actividad eléctrica cercana, la organización puede demorar la largada o detener la carrera. En ese caso, seguí las indicaciones del personal y buscá refugio en edificios o vehículos cerrados. No te refugies bajo árboles, carpas ni junto a estructuras metálicas. La actividad se reanuda recién cuando pasan 30 minutos sin rayos cercanos.`,
  };
}

function lluvia(n: number): Bloque | null {
  if (n <= 0) return null;
  return {
    clave: "lluvia", emoji: "🌧️", titulo: "Lluvia",
    corto: n >= 2 ? "Se espera lluvia intensa: usá ropa que no retenga agua y tené cuidado con superficies resbaladizas." : "Puede haber sectores con agua o barro: tené cuidado con superficies resbaladizas.",
    medio: n >= 2
      ? "Se espera lluvia intensa. Usá ropa que no retenga agua, prevení rozaduras y tené cuidado con superficies resbaladizas, sobre todo en la llegada."
      : "Por las lluvias de los días previos puede haber sectores con agua o barro. Tené cuidado con superficies resbaladizas.",
    largo: n >= 2
      ? "Se espera lluvia intensa durante la carrera. Te recomendamos usar ropa que no retenga agua, prevenir rozaduras con vaselina o cinta, y tener especial cuidado con superficies resbaladizas como sendas peatonales, tapas y la zona de llegada. Traé ropa seca para después de cruzar la meta."
      : "Por las lluvias de los días previos puede haber sectores del recorrido con agua o barro. Tené cuidado con superficies resbaladizas como sendas peatonales, tapas y la zona de llegada.",
  };
}

function smn(a: AlertaSMN): Bloque {
  const fen = a.fenomeno.replace(/\s*\(aviso a corto plazo\)$/, "").toLowerCase();
  const tipo = a.tipo === "aviso_corto_plazo" ? "un aviso a corto plazo" : `una alerta ${a.color}`;
  return {
    clave: `smn-${a.id}`, emoji: "⚠️", titulo: "Alerta del SMN",
    corto: `El Servicio Meteorológico Nacional emitió ${tipo} por ${fen} para la zona. Seguí nuestras novedades.`,
    medio: `El Servicio Meteorológico Nacional emitió ${tipo} por ${fen} para la zona de la carrera. La organización sigue su evolución y, ante cualquier cambio, lo va a informar por este medio.`,
    largo: `El Servicio Meteorológico Nacional emitió ${tipo} por ${fen} para la zona de la carrera${a.hasta ? `, vigente hasta el ${fecha(a.hasta)} a las ${hora(a.hasta)} h` : ""}. La organización sigue su evolución junto a su equipo de gestión de riesgo y, si fuera necesario modificar el horario o el recorrido, lo vamos a comunicar por este medio y por nuestros canales oficiales.`,
  };
}

export function armarComunicado(ev: Evento, nivelesCarrera: Nivel[], alertas: AlertaSMN[], ventana: [Date, Date]): Comunicado | null {
  const max = (v: string) => Math.max(0, ...nivelesCarrera.filter((n) => n.variable === v).map((n) => n.nivel));
  const enVentana = alertas.filter((a) => {
    const d = a.desde ? new Date(a.desde).getTime() : 0;
    const h = a.hasta ? new Date(a.hasta).getTime() : Infinity;
    return d <= ventana[1].getTime() && h >= ventana[0].getTime();
  });
  const bloques = [...enVentana.map(smn), tormenta(max("tormenta")), calor(max("wbgt")), lluvia(max("lluvia"))].filter((b): b is Bloque => !!b);
  if (!bloques.length) return null;

  const usados = nivelesCarrera.filter((n) => n.nivel > 0 && ["wbgt", "tormenta", "lluvia"].includes(n.variable));
  const confirmar = usados.length > 0 && usados.every((n) => n.confianza === "baja");
  const dia = fecha(ev.largada);
  const hl = hora(ev.largada);

  const redes = [
    `${ev.nombre} · Aviso para corredores`,
    `${dia.charAt(0).toUpperCase() + dia.slice(1)} · largada ${hl} h`,
    "",
    ...bloques.map((b) => `${b.emoji} ${b.corto}`),
    "",
    "Ante cualquier síntoma durante la carrera, detenete y pedí asistencia al personal. Seguí nuestras cuentas para novedades.",
  ].join("\n");

  const whatsapp = [
    `*${ev.nombre} · Aviso para corredores*`,
    `_${dia} · largada ${hl} h_`,
    "",
    ...bloques.flatMap((b) => [`${b.emoji} *${b.titulo}:* ${b.medio}`, ""]),
    "Ante cualquier síntoma durante la carrera, detenete y pedí asistencia al personal de la organización.",
  ].join("\n");

  const cuerpo = [
    "Hola,",
    "",
    `Te escribimos para compartir las condiciones previstas para ${ev.nombre}, el ${dia} con largada a las ${hl} h, y algunas recomendaciones para que corras de forma segura.`,
    "",
    ...bloques.flatMap((b) => [`${b.titulo}`, b.largo, ""]),
    "Ante cualquier síntoma durante la carrera, detenete y pedí asistencia al personal de la organización. Si ves a otro corredor con dificultades, avisá al puesto más cercano.",
    "",
    "Si las condiciones cambian, te lo vamos a informar por este medio y por nuestros canales oficiales.",
    "",
    "Nos vemos en la largada.",
    "",
    `Organización de ${ev.nombre}`,
  ].join("\n");

  return {
    motivos: bloques.map((b) => b.titulo),
    confirmar,
    redes,
    whatsapp,
    mail: { asunto: `${ev.nombre} · Recomendaciones para el día de la carrera`, cuerpo },
  };
}
