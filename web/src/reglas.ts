// Biblioteca de recomendaciones y fuentes. Textos sujetos a validación única de EMERTEAM.

export type TipoFuente = "NT" | "GI" | "CC" | "EF" | "CI";

export const TIPO_FUENTE: Record<TipoFuente, string> = {
  NT: "Norma técnica o legislación",
  GI: "Guía de organismo internacional",
  CC: "Consenso científico",
  EF: "Especificación de fabricante",
  CI: "Criterio interno EMERTEAM",
};

export const REGLAS: Record<string, { tipo: TipoFuente; fuente: string }> = {
  wa2020_wbgt: {
    tipo: "GI",
    fuente:
      "World Athletics Health and Science Department. (2020). Competition medical guidelines for World Athletics Series events (2.ª ed.), tabla 1.",
  },
  srt30_2023_tgbh: {
    tipo: "NT",
    fuente: "Resolución SRT 30/2023. Estrés térmico. Valor límite de acción para trabajadores no aclimatados.",
  },
  emt_viento_A: {
    tipo: "CI",
    fuente: "EMERTEAM. Escala de viento por categoría de estructura. Retiro con base en HSE/HSENI (inflables, Beaufort 5).",
  },
  emt_viento_B: {
    tipo: "CI",
    fuente: "EMERTEAM. Escala de viento por categoría de estructura, con base en ANSI E1.21-2020 (elementos retirables).",
  },
  emt_viento_C: { tipo: "CI", fuente: "EMERTEAM. Escala de viento por categoría de estructura." },
  emt_tormenta_cape: {
    tipo: "CI",
    fuente: "EMERTEAM. Potencial convectivo (CAPE) con precipitación pronosticada. Distancias de descarga: NWS, Lightning Safety Toolkit for Outdoor Venues.",
  },
  emt_lluvia_intensidad: { tipo: "CI", fuente: "EMERTEAM. Intensidad de lluvia superior a 20 mm/h." },
  emt_suelo_saturado: { tipo: "CI", fuente: "EMERTEAM. Lluvia acumulada igual o superior a 30 mm en 72 h." },
};

export const COLOR_NIVEL = ["#2FA34C", "#C79000", "#FF6A1A", "#FF3B30", "#7A1610"];

export const NOMBRE_WA = ["Casi seguro", "Precaución", "Advertencia", "Advertencia severa", "Peligro"];

export const NOMBRE_VARIABLE: Record<string, string> = {
  wbgt: "Estrés térmico de corredores",
  calor_personal: "Estrés térmico del personal",
  viento_A: "Viento · estructuras ultralivianas",
  viento_B: "Viento · superficies de vela",
  viento_C: "Viento · estructuras ingenieriles",
  tormenta: "Tormenta",
  lluvia: "Lluvia y suelo",
};

export const NOMBRE_FASE: Record<string, string> = {
  armado: "Armado",
  carrera: "Carrera",
  personal: "Jornada del personal",
  desarme: "Desarme",
};

const NIVEL_VIENTO = ["Bajo umbral", "Vigilancia", "Reforzar", "Retirar", "Despejar área"];

export function nombreNivel(variable: string, nivel: number): string {
  if (variable === "wbgt") return NOMBRE_WA[nivel];
  if (variable.startsWith("viento_")) return variable === "viento_C" && nivel === 4 ? "Despejar / suspender" : NIVEL_VIENTO[nivel];
  if (variable === "calor_personal") return ["Bajo límite", "Excede carga pesada", "Excede carga moderada"][nivel] ?? "—";
  if (variable === "tormenta") return ["Sin señal", "Tormenta posible", "Tormenta probable"][nivel] ?? "—";
  if (variable === "lluvia") return ["Sin efecto", "Suelo saturado", "Lluvia intensa"][nivel] ?? "—";
  return String(nivel);
}

const ELEMENTOS: Record<string, string> = {
  A: "gazebos plegables, fly banners y arco inflable",
  B: "lonas en vallas, banners en truss, cartelería y columnas de sonido",
  C: "pórtico de truss, carpas estructurales y pantalla LED",
};

/** Texto de recomendación por variable, nivel y fase. null = sin recomendación (nivel 0). */
export function recomendacion(variable: string, nivel: number, fase: string): string | null {
  if (nivel <= 0) return null;
  if (variable === "wbgt") {
    return [
      "",
      "Exhibir bandera de precaución en largada, llegada y puestos. Incluir el aviso de calor en el anuncio previo a la largada. Reforzar hidratación y enfriamiento en el último cuarto.",
      "Advertir a los corredores que regulen el ritmo. Reforzar puntos de enfriamiento y la capacidad de inmersión en agua fría en la llegada. Vigilancia activa del último cuarto y del grupo de mayor riesgo.",
      "Evaluar cambio de horario, acortamiento o retiro voluntario de corredores no aclimatados. Máxima capacidad de enfriamiento en llegada y recorrido.",
      "Evaluar la suspensión o postergación de la carrera.",
    ][nivel];
  }
  if (variable.startsWith("viento_")) {
    const cat = variable.slice(-1);
    const el = ELEMENTOS[cat];
    return [
      "",
      `Vigilar ${el}. Verificar lastre y anclajes.`,
      `Reforzar ${el}: lastre adicional, retirar laterales y lonas no esenciales.`,
      `Retirar ${el}${cat === "A" ? " (desinflar el arco)" : ""}. No montar en esta franja.`,
      `Despejar el área alrededor de ${el} (radio de 1,5 veces su altura)${cat === "C" ? "; evaluar suspensión" : ""}.`,
    ][nivel];
  }
  if (variable === "calor_personal") {
    return nivel === 1
      ? "Tareas pesadas (truss, vallas) por encima del límite para personal no aclimatado: pausas, sombra, hidratación y rotación de cuadrillas."
      : "Tareas moderadas y pesadas por encima del límite: reprogramar el trabajo físico a una franja más fresca.";
  }
  if (variable === "tormenta") {
    return fase === "carrera"
      ? "Activar el protocolo de tormenta eléctrica: alerta a 24 km, demora de largada a 19 km, suspensión y evacuación a 13 km o ante trueno audible. Reanudar con 30 min sin actividad."
      : "Activar el protocolo de tormenta eléctrica: bajar al personal de altura desde los 19 km y suspender el trabajo a 13 km o ante trueno audible.";
  }
  if (variable === "lluvia") {
    return nivel === 1
      ? "Suelo saturado: sumar lastre en carpas y gazebos, revisar drenaje en la llegada y en los puestos médicos."
      : "Lluvia intensa: proteger tableros y cableado eléctrico, revisar anegamiento de la zona de llegada y puestos médicos.";
  }
  return null;
}
