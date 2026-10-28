import { useCallback, useEffect, useState } from "react";
import U from "../../../config/umbrales.json";
import { supabase } from "../datos";

/** Qué genera correo además de las alertas del SMN. Lo maneja solo EMERTEAM: por productora (vale para todos sus
 *  eventos) o por evento (prevalece). Sin configuración: SMN y rayos detectados. */
export type ConfigAvisos = {
  rayos: boolean; viento: boolean; viento_nivel: number; tormenta: boolean; calor: boolean; calor_nivel: number;
  lluvia: boolean; probabilistico: boolean;
};
type Fila = ConfigAvisos & { id: string; productora_id: string | null; evento_id: string | null; actualizado_por: string | null; actualizado_en: string };

export const CONFIG_BASE: ConfigAvisos = { rayos: true, viento: false, viento_nivel: 2, tormenta: false, calor: false, calor_nivel: 2, lluvia: false, probabilistico: false };

const NIVEL_VIENTO = ["", "Vigilancia", "Reforzar", "Retirar", "Despejar"];
const NIVEL_CALOR = ["", "Precaución", "Advertencia", "Advertencia severa", "Peligro"];
const kmh = (n: number) => `A ${U.viento.A[n - 1]} · B ${U.viento.B[n - 1]} · C ${U.viento.C[n - 1]} km/h`;

const SWITCHES: { k: keyof ConfigAvisos; titulo: string; detalle: string }[] = [
  { k: "rayos", titulo: "Rayos detectados", detalle: "Satélite GOES-19, en armado, carrera y desarme, al entrar a 24, 19 y 13 km. El correo recuerda que la decisión se toma con detectores en terreno y trueno audible." },
  { k: "viento", titulo: "Viento", detalle: "Ráfaga pronosticada por categoría de estructura, desde el nivel elegido." },
  { k: "tormenta", titulo: "Tormenta pronosticada", detalle: "Potencial convectivo con precipitación." },
  { k: "calor", titulo: "Calor", detalle: "Escala de la disciplina (World Athletics en running) desde el nivel elegido. Personal desde que excede la carga moderada." },
  { k: "lluvia", titulo: "Lluvia intensa y suelo saturado", detalle: "Más de 20 mm/h, o 30 mm o más en 72 h." },
  { k: "probabilistico", titulo: "Preparar y Activar (probabilístico)", detalle: "Desde D-3 con 30 % y desde D-1 con 60 %." },
];

export function resumenAvisos(c: ConfigAvisos): string {
  const on = ["Alertas del SMN"];
  if (c.rayos) on.push("rayos detectados");
  if (c.viento) on.push(`viento desde ${NIVEL_VIENTO[c.viento_nivel].toLowerCase()}`);
  if (c.tormenta) on.push("tormenta pronosticada");
  if (c.calor) on.push(`calor desde ${NIVEL_CALOR[c.calor_nivel].toLowerCase()}`);
  if (c.lluvia) on.push("lluvia intensa");
  if (c.probabilistico) on.push("preparar y activar");
  return on.length === 1 ? on[0] : `${on.slice(0, -1).join(", ")} y ${on.at(-1)}`;
}

export function AvisosTablero({ productoraId, eventoId, productoraDelEvento, productoraNombre, editor, miEmail }: {
  productoraId?: string; eventoId?: string; productoraDelEvento?: string | null; productoraNombre?: string | null; editor: boolean; miEmail: string;
}) {
  const [propia, setPropia] = useState<Fila | null>(null);
  const [heredada, setHeredada] = useState<Fila | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const q = supabase.from("mon_avisos_config").select("*");
    const { data } = await (eventoId ? q.eq("evento_id", eventoId) : q.eq("productora_id", productoraId!)).maybeSingle();
    setPropia((data as Fila) ?? null);
    if (eventoId && productoraDelEvento) {
      const { data: h } = await supabase.from("mon_avisos_config").select("*").eq("productora_id", productoraDelEvento).maybeSingle();
      setHeredada((h as Fila) ?? null);
    } else setHeredada(null);
  }, [eventoId, productoraId, productoraDelEvento]);

  useEffect(() => void cargar(), [cargar]);

  const vigente: ConfigAvisos = propia ?? heredada ?? CONFIG_BASE;
  const origen = propia
    ? eventoId ? "Configuración propia de este evento" : "Configuración de la productora, vale para todos sus eventos"
    : heredada ? `Heredada de ${productoraNombre ?? "la productora"}` : "Configuración base";

  async function guardar(cambio: Partial<ConfigAvisos>) {
    if (!editor) return;
    setError("");
    setGuardando(true);
    const base = { ...vigente, ...cambio };
    const valores = {
      ...Object.fromEntries((Object.keys(CONFIG_BASE) as (keyof ConfigAvisos)[]).map((k) => [k, base[k]])),
      actualizado_por: miEmail, actualizado_en: new Date().toISOString(),
    };
    const res = propia
      ? await supabase.from("mon_avisos_config").update(valores).eq("id", propia.id)
      : await supabase.from("mon_avisos_config").insert({ ...valores, ...(eventoId ? { evento_id: eventoId } : { productora_id: productoraId }) });
    setGuardando(false);
    if (res.error) setError(res.error.message);
    void cargar();
  }

  async function volver() {
    if (!propia) return;
    setError("");
    const { error } = await supabase.from("mon_avisos_config").delete().eq("id", propia.id);
    if (error) setError(error.message);
    void cargar();
  }

  return (
    <section className="seccion tarjeta" aria-labelledby="avisos-t">
      <div className="rotulo" id="avisos-t">Avisos por correo</div>
      <p className="chico" style={{ marginTop: 4 }}>
        Las alertas y los avisos a corto plazo del SMN salen siempre. Los avisos de pronóstico solo salen con confianza media o alta, dentro de las 48 h previas, y como máximo dos correos por evento por día. Lo que exceda ese tope se incluye en el correo siguiente. Los rayos detectados y el SMN no tienen tope.
      </p>
      <p className="chico" style={{ fontWeight: 600 }}>
        {origen}{propia?.actualizado_por ? ` · último cambio ${propia.actualizado_por}` : ""}
      </p>
      {!editor ? (
        <p style={{ margin: 0 }}>Generan correo {resumenAvisos(vigente)}.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SWITCHES.map((s) => (
            <div key={s.k} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", borderTop: "1px solid var(--borde)", paddingTop: 10 }}>
              <label style={{ flexDirection: "row", alignItems: "center", gap: 10, fontWeight: 700, minWidth: 260 }}>
                <input type="checkbox" role="switch" checked={!!vigente[s.k]} disabled={guardando}
                  onChange={(e) => void guardar({ [s.k]: e.target.checked } as Partial<ConfigAvisos>)} style={{ minHeight: 0, width: 20, height: 20 }} />
                {s.titulo}
              </label>
              {s.k === "viento" && vigente.viento && (
                <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>Desde
                  <select value={vigente.viento_nivel} disabled={guardando} onChange={(e) => void guardar({ viento_nivel: Number(e.target.value) })}>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{NIVEL_VIENTO[n]} ({kmh(n)})</option>)}
                  </select>
                </label>
              )}
              {s.k === "calor" && vigente.calor && (
                <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>Desde
                  <select value={vigente.calor_nivel} disabled={guardando} onChange={(e) => void guardar({ calor_nivel: Number(e.target.value) })}>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{NIVEL_CALOR[n]}</option>)}
                  </select>
                </label>
              )}
              <span className="chico" style={{ flex: "1 1 280px" }}>{s.detalle}</span>
            </div>
          ))}
          {eventoId && propia && (
            <div><button className="boton" onClick={() => void volver()}>{productoraDelEvento ? `Volver a la configuración de ${productoraNombre ?? "la productora"}` : "Volver a la configuración base"}</button></div>
          )}
          <p className="chico" style={{ margin: 0 }}>
            El nivel elegido decide desde cuándo sale el correo. La clasificación y las recomendaciones de la página siguen los umbrales de la guía.
            {eventoId && !propia ? " Al tocar un switch, este evento pasa a tener configuración propia." : ""}
          </p>
        </div>
      )}
      {error && <p style={{ color: "var(--rojo)", margin: "10px 0 0" }}>{error}</p>}
    </section>
  );
}
