import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  // PKCE: el enlace vuelve con ?code= (no con #access_token, que choca con el ruteo por #)
  { auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" } },
);

export type Modalidad = { id?: string; nombre: string; distancia_km: number; participantes: number | null; largada?: string | null };

export type Evento = {
  id: string;
  nombre: string;
  largada: string;
  ubicacion: string;
  lat: number;
  lon: number;
  organizador_email: string;
  participantes: number;
  armado_dias: number;
  cupo_equipo: number;
  creado_en?: string;
  actualizado_en?: string;
  duracion_propia_min: number | null;
  demora_largada_min: number | null;
  portico: "estructural" | "inflable";
  estado: "activo" | "cerrado";
  mon_modalidades?: Modalidad[];
};

export type Pronostico = {
  evento_id: string;
  fuente: string;
  corrida: string;
  valido: string;
  t2m: number | null;
  td2m: number | null;
  hr: number | null;
  viento10: number | null;
  rafaga10: number | null;
  dir_viento: number | null;
  precip: number | null;
  prob_precip: number | null;
  cape: number | null;
  radiacion: number | null;
  nubosidad: number | null;
  presion: number | null;
  wbgt_est: number | null;
  procesado_en: string;
  // Punto de grilla usado (tierra más cercana) y valores corregidos con observaciones del SMN
  punto_lat?: number | null;
  punto_lon?: number | null;
  punto_tierra?: boolean | null;
  t2m_corr?: number | null;
  td2m_corr?: number | null;
  hr_corr?: number | null;
  viento10_corr?: number | null;
  rafaga10_corr?: number | null;
  wbgt_corr?: number | null;
  // Índice UV con cielo despejado (MET Norway), agregado al armar la serie
  uv?: number | null;
};

/** Índice UV con cielo despejado por hora (MET Norway, Locationforecast 2.0) */
export type Uv = { evento_id: string; valido: string; uv: number; interpolado: boolean };

/** Corrección aplicada y error medido para un evento y un modelo */
export type Sesgo = {
  evento_id: string;
  fuente: string;
  estacion: string | null;
  distancia_km: number | null;
  pares: number;
  sesgo_t_dia: number | null;
  sesgo_t_noche: number | null;
  sesgo_td: number | null;
  factor_viento: number | null;
  error_t: number | null;
  error_t_corr: number | null;
  error_viento: number | null;
  error_viento_corr: number | null;
  aplicado: boolean;
  calculado_en: string;
};

export type Nivel = {
  id: number;
  evento_id: string;
  fase: "armado" | "carrera" | "personal" | "desarme";
  variable: string;
  desde: string;
  hasta: string;
  nivel: number;
  valor: number | null;
  umbral: number | null;
  regla: string;
  confianza: "baja" | "media" | "alta" | null;
  origen: string;
};

export type AlertaSMN = {
  id: string;
  evento_id: string | null;
  fenomeno: string;
  color: "amarillo" | "naranja" | "rojo" | "violeta";
  desde: string | null;
  hasta: string | null;
  emitida: string | null;
  estado: string;
  zona: string | null;
  tipo: "alerta" | "aviso_corto_plazo";
  severidad: string | null;
  fuente_url: string | null;
};

const PESO_SMN: Record<string, number> = { rojo: 3, naranja: 2, amarillo: 1 };
/** Alertas SMN vigentes, de la más grave a la menos grave; los avisos a corto plazo primero a igual color */
export function ordenarAlertas(a: AlertaSMN[]): AlertaSMN[] {
  return [...a].sort((x, y) => (PESO_SMN[y.color] ?? 0) - (PESO_SMN[x.color] ?? 0) || (x.tipo === y.tipo ? 0 : x.tipo === "aviso_corto_plazo" ? -1 : 1));
}
export const tituloAlerta = (a: AlertaSMN) =>
  `${a.tipo === "aviso_corto_plazo" ? "Aviso a corto plazo" : "Alerta"} ${a.color} SMN · ${a.fenomeno.replace(/\s*\(aviso a corto plazo\)$/, "")}`;

export type Acceso = {
  id: string;
  evento_id: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: string | null;
  recibe_alertas: boolean;
};

export type RolEquipo = "editor" | "lector";
export type IntegranteEquipo = { email: string; nombre: string; rol: RolEquipo; creado_en: string };

/** Rol en el equipo EMERTEAM de la cuenta actual (null si no integra el equipo) */
export async function miRol(email: string): Promise<RolEquipo | null> {
  // Si la consulta falla o tarda más de 12 s, se sigue como organizador (lo que ve cada uno lo define la base)
  try {
    const consulta = supabase.from("mon_admins").select("rol").eq("email", email.toLowerCase()).maybeSingle();
    const espera = new Promise<{ data: null }>((ok) => setTimeout(() => ok({ data: null }), 12_000));
    const { data } = await Promise.race([consulta, espera]);
    return (data?.rol as RolEquipo | undefined) ?? null;
  } catch {
    return null;
  }
}

export const TZ = "America/Argentina/Buenos_Aires";

export function fmtHora(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function fmtDia(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(iso));
}

export function fmtFechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** Clave de día local AAAA-MM-DD en Buenos Aires */
export function diaLocal(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function num(x: number | null | undefined, dec = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export type Medicion = {
  id: string;
  evento_id: string;
  operador: string;
  tomada_en: string;
  sector: string;
  lat: number | null;
  lon: number | null;
  wbgt: number | null;
  temp: number | null;
  hr: number | null;
  viento_medio: number | null;
  rafaga: number | null;
  altura_viento_m: number | null;
  rayo_detector: string | null;
  rayo_rango: string | null;
  rayo_conteo: number | null;
  rayo_tendencia: string | null;
  trueno: boolean | null;
  relampago_trueno_s: number | null;
  foto_path: string | null;
};

/** Nivel WBGT World Athletics (0–4) */
export const nivelWBGT = (w: number | null | undefined) => (w == null ? null : w >= 30 ? 4 : w >= 28 ? 3 : w >= 25 ? 2 : w >= 21 ? 1 : 0);

/** Distancia del rayo por relámpago-trueno: 343 m/s */
export const kmPorTrueno = (s: number | null | undefined) => (s == null ? null : (s * 343) / 1000);

/** Nivel de tormenta por medición en terreno, escalera NWS: 24 / 19 / 13 km; trueno audible = suspensión */
export function nivelRayoMedido(m: Pick<Medicion, "trueno" | "rayo_rango" | "relampago_trueno_s">): number | null {
  if (m.trueno) return 4;
  const km = kmPorTrueno(m.relampago_trueno_s);
  const rango = m.rayo_rango;
  const desdeRango = rango === "<13" ? 4 : rango === "13-19" ? 3 : rango === "19-24" ? 2 : rango === ">24" ? 1 : rango === "sin" ? 0 : null;
  const desdeKm = km == null ? null : km < 13 ? 4 : km < 19 ? 3 : km < 24 ? 2 : 1;
  if (desdeRango == null && desdeKm == null) return null;
  return Math.max(desdeRango ?? 0, desdeKm ?? 0);
}

/** Colores de las alertas del SMN */
export const COLOR_SMN: Record<string, string> = { amarillo: "#F5C400", naranja: "#FF6A1A", rojo: "#FF3B30", violeta: "#8E5BD9" };

export type Rayo = { id: number; evento_id: string; ocurrido_en: string; lat: number; lon: number; distancia_km: number; fuente: string };

/** Rayos por satélite en los últimos 30 min: distancia mínima y nivel (24 km alerta · 19 km preparar · 13 km suspender) */
export function estadoRayosGLM(rayos: Rayo[], ahora = Date.now()): { nivel: number; km: number | null; cantidad: number; ultimo: string | null } {
  const recientes = rayos.filter((r) => ahora - new Date(r.ocurrido_en).getTime() <= 30 * 60_000);
  if (!recientes.length) return { nivel: 0, km: null, cantidad: 0, ultimo: null };
  const km = Math.min(...recientes.map((r) => Number(r.distancia_km)));
  const nivel = km < 13 ? 4 : km < 19 ? 3 : km < 24 ? 2 : 1;
  const ultimo = recientes.map((r) => r.ocurrido_en).sort().at(-1) ?? null;
  return { nivel, km, cantidad: recientes.length, ultimo };
}
