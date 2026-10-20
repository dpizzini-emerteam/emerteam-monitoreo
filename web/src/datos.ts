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
};

export type Acceso = {
  id: string;
  evento_id: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: string | null;
  recibe_alertas: boolean;
};

export async function esAdmin(): Promise<boolean> {
  const { data } = await supabase.from("mon_admins").select("email").limit(1);
  return !!data && data.length > 0;
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
