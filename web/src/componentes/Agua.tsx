import { useEffect, useState } from "react";
import U from "../../../config/umbrales.json";
import { fmtFechaHora, num, supabase, type Evento, type Medicion } from "../datos";
import { evaluarAguaAbierta, evaluarAguaTriatlon, evaluarCalidad, type ResultadoAgua } from "../disciplinas";
import { estiloNivel } from "../reglas";

const ESTILO: Record<ResultadoAgua["estado"], number> = { ok: 0, reducir: 3, cancelar: 4, fuera: 4, sin_dato: 0 };

/**
 * Agua del triatlón y de las aguas abiertas: temperatura (con la regla de la federación) y calidad microbiológica.
 * Se evalúa con la última medición en terreno; no hay pronóstico de temperatura del agua.
 */
export function AguaPanel({ ev, refresco = 0 }: { ev: Evento; refresco?: number }) {
  const [meds, setMeds] = useState<Medicion[]>([]);
  useEffect(() => {
    void supabase.from("mon_mediciones").select("*").eq("evento_id", ev.id)
      .or("agua_temp.not.is.null,enterococos.not.is.null,ecoli.not.is.null,cianobacterias.not.is.null")
      .order("tomada_en", { ascending: false }).limit(50)
      .then(({ data }) => setMeds((data as Medicion[]) ?? []));
  }, [ev.id, refresco]);

  const tri = ev.disciplina === "triatlon";
  const t = meds.find((m) => m.agua_temp != null);
  const q = meds.find((m) => m.enterococos != null || m.ecoli != null || m.cianobacterias != null);
  const temp = t ? (tri ? evaluarAguaTriatlon(Number(t.agua_temp), t.temp != null ? Number(t.temp) : null, ev.natacion_m ?? null) : evaluarAguaAbierta(Number(t.agua_temp))) : null;
  const calidad = q ? evaluarCalidad(ev.agua_tipo, q.enterococos ?? null, q.ecoli ?? null, q.cianobacterias ?? null) : null;
  const tipo = ev.agua_tipo === "mar" ? "mar" : ev.agua_tipo === "rio" ? "río" : ev.agua_tipo ?? "";

  return (
    <section className="seccion" aria-labelledby="agua-t">
      <h2 id="agua-t">Agua · {tipo}{ev.natacion_m ? ` · natación ${num(ev.natacion_m)} m` : ""}</h2>
      <div className="grilla" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}>
        <div className="tarjeta">
          <div className="rotulo">Temperatura del agua</div>
          {t && temp ? (
            <>
              <div className="condensada" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.1 }}>{num(t.agua_temp, 1)} °C</div>
              <span className="badge" style={estiloNivel(ESTILO[temp.estado])}>{temp.titulo}</span>
              {temp.detalle.map((d) => <p key={d} className="chico" style={{ margin: "6px 0 0", color: "var(--texto)" }}>{d}</p>)}
              {tri && t.temp == null && Number(t.agua_temp) <= U.agua_wt.ajuste_aire.aplica_agua_hasta && (
                <p className="chico" style={{ margin: "6px 0 0" }}>Cargá también la temperatura del aire en la misma medición: con aire de 15 °C o menos se aplica el ajuste por aire frío (regla 4.4(b)).</p>
              )}
              <div className="chico" style={{ marginTop: 6 }}>{t.sector} · {fmtFechaHora(t.tomada_en)}</div>
            </>
          ) : <p className="chico">Sin medición. No hay pronóstico de temperatura del agua: se mide en terreno.</p>}
          <p className="chico" style={{ marginBottom: 0 }}>Cómo medir: {tri ? U.agua_wt.medicion : U.agua_wa.medicion} Fuente: {tri ? U.agua_wt._fuente : U.agua_wa._fuente}.</p>
        </div>
        <div className="tarjeta">
          <div className="rotulo">Calidad del agua</div>
          {q && calidad ? (
            <>
              <span className="badge" style={{ ...estiloNivel(ESTILO[calidad.estado]), marginTop: 8 }}>{calidad.titulo}</span>
              <p className="chico" style={{ margin: "6px 0 0", color: "var(--texto)" }}>
                {[q.enterococos != null && `enterococos ${num(q.enterococos)}`, q.ecoli != null && `E. coli ${num(q.ecoli)}`].filter(Boolean).join(" · ")}{(q.enterococos != null || q.ecoli != null) && " UFC/100 ml"}
                {q.cianobacterias != null && ` · cianobacterias ${num(q.cianobacterias)} cél/ml`}
              </p>
              {calidad.detalle.map((d) => <p key={d} className="chico" style={{ margin: "6px 0 0" }}>{d}</p>)}
              <div className="chico" style={{ marginTop: 6 }}>{fmtFechaHora(q.tomada_en)}</div>
            </>
          ) : <p className="chico">Sin resultados de laboratorio cargados.</p>}
          <p className="chico" style={{ marginBottom: 0 }}>Muestras en 3 puntos; decide el peor resultado. {U.calidad_agua._fuente}.</p>
        </div>
      </div>
    </section>
  );
}
