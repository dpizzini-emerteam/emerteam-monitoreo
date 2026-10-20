import { useCallback, useEffect, useState } from "react";
import { analizarDetector, fmtFechaHora, fmtHora, kmPorTrueno, nivelRayoMedido, nivelWBGT, num, supabase, type Medicion } from "../datos";
import { estiloNivel, estiloWA, NOMBRE_WA } from "../reglas";

const SECTORES = ["Largada", "Llegada", "Puesto médico", "Último cuarto", "Recorrido"];
// Rangos de cargas anteriores (antes se elegía un tramo; ahora se carga la lectura del detector)
const RANGOS: [string, string][] = [
  ["sin", "Sin actividad"], [">24", "Más de 24 km"], ["19-24", "19 a 24 km"], ["13-19", "13 a 19 km"], ["<13", "Menos de 13 km"],
];
const MI_KM = 1.609344;
const rangoDesdeKm = (k: number) => (k <= 13 ? "<13" : k <= 19 ? "13-19" : k <= 24 ? "19-24" : ">24");
const NIVEL_RAYO = ["Sin actividad", "Vigilar", "Alerta", "Preparar / demorar", "Suspender"];

type Form = {
  sector: string; tomada_en: string; wbgt: string; temp: string; hr: string; viento_medio: string; rafaga: string;
  altura_viento_m: string; detector: "" | "distancia" | "escuchando" | "na"; rayo_dist: string; unidad: "km" | "mi";
  rayo_conteo: string; trueno: boolean; relampago_trueno_s: string;
};
const unidadGuardada = (): "km" | "mi" => { try { return localStorage.getItem("mon_detector_unidad") === "mi" ? "mi" : "km"; } catch { return "km"; } };

const localAhora = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 16);
const vacio = (): Form => ({
  sector: "Llegada", tomada_en: localAhora(), wbgt: "", temp: "", hr: "", viento_medio: "", rafaga: "",
  altura_viento_m: "2", detector: "", rayo_dist: "", unidad: unidadGuardada(), rayo_conteo: "", trueno: false, relampago_trueno_s: "",
});
const n = (x: string) => (x.trim() === "" ? null : Number(x.replace(",", ".")));

/** Mediciones en terreno: el WBGT medido reemplaza al estimado. Cargan solo integrantes de EMERTEAM. */
export function Mediciones({ eventoId, puedeCargar, miEmail }: { eventoId: string; puedeCargar: boolean; miEmail: string }) {
  const [lista, setLista] = useState<Medicion[]>([]);
  const [f, setF] = useState<Form>(vacio);
  const [foto, setFoto] = useState<File | null>(null);
  const [ubic, setUbic] = useState<{ lat: number; lon: number } | null>(null);
  const [estado, setEstado] = useState<"" | "guardando" | "ok">("");
  const [error, setError] = useState("");
  const [fotos, setFotos] = useState<Record<string, string>>({});

  const cargar = useCallback(async () => {
    const { data } = await supabase.from("mon_mediciones").select("*").eq("evento_id", eventoId).order("tomada_en", { ascending: false }).limit(200);
    const ms = (data as Medicion[]) ?? [];
    setLista(ms);
    const conFoto = ms.filter((m) => m.foto_path).map((m) => m.foto_path as string);
    if (conFoto.length) {
      const { data: urls } = await supabase.storage.from("mon-mediciones").createSignedUrls(conFoto, 3600);
      setFotos(Object.fromEntries((urls ?? []).filter((u) => u.signedUrl).map((u) => [u.path as string, u.signedUrl as string])));
    }
  }, [eventoId]);

  useEffect(() => {
    void cargar();
    const canal = supabase.channel(`mediciones-${eventoId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "mon_mediciones", filter: `evento_id=eq.${eventoId}` }, () => void cargar())
      .subscribe();
    return () => void supabase.removeChannel(canal);
  }, [cargar, eventoId]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  function ubicar() {
    navigator.geolocation?.getCurrentPosition(
      (p) => setUbic({ lat: Number(p.coords.latitude.toFixed(5)), lon: Number(p.coords.longitude.toFixed(5)) }),
      () => setError("No se pudo obtener la ubicación. Revisá el permiso del navegador."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const valores = [f.wbgt, f.temp, f.hr, f.viento_medio, f.rafaga, f.relampago_trueno_s, f.rayo_conteo];
    if (valores.every((v) => v.trim() === "") && !f.detector && !f.trueno) return setError("Cargá al menos un valor medido.");
    const dist = n(f.rayo_dist);
    if (f.detector === "distancia" && (dist == null || dist <= 0 || dist > (f.unidad === "mi" ? 25 : 40)))
      return setError(`Cargá la distancia que muestra el detector (hasta ${f.unidad === "mi" ? "25 mi" : "40 km"}).`);
    const rayo_km = f.detector === "distancia" && dist != null ? Math.round((f.unidad === "mi" ? dist * MI_KM : dist) * 10) / 10 : null;
    const rayo_rango = rayo_km != null ? rangoDesdeKm(rayo_km) : f.detector === "escuchando" ? "sin" : f.detector === "na" ? ">24" : null;
    try { localStorage.setItem("mon_detector_unidad", f.unidad); } catch { /* sin almacenamiento */ }
    const w = n(f.wbgt);
    if (w != null && (w < 0 || w > 45)) return setError("El WBGT tiene que estar entre 0 y 45 °C.");
    setEstado("guardando");
    let foto_path: string | null = null;
    if (foto) {
      const ext = (foto.name.split(".").pop() || "jpg").toLowerCase();
      foto_path = `${eventoId}/${crypto.randomUUID()}.${ext}`;
      const { error: ef } = await supabase.storage.from("mon-mediciones").upload(foto_path, foto, { contentType: foto.type || "image/jpeg" });
      if (ef) { setEstado(""); return setError(`No se pudo subir la foto: ${ef.message}`); }
    }
    const { error: ei } = await supabase.from("mon_mediciones").insert({
      evento_id: eventoId, operador: miEmail, tomada_en: new Date(`${f.tomada_en}:00-03:00`).toISOString(), sector: f.sector,
      lat: ubic?.lat ?? null, lon: ubic?.lon ?? null,
      wbgt: w, temp: n(f.temp), hr: n(f.hr), viento_medio: n(f.viento_medio), rafaga: n(f.rafaga), altura_viento_m: n(f.altura_viento_m),
      rayo_km, rayo_rango, rayo_conteo: n(f.rayo_conteo), rayo_detector: f.detector ? "AcuRite" : null,
      trueno: f.trueno, relampago_trueno_s: n(f.relampago_trueno_s),
      foto_path,
    });
    if (ei) { setEstado(""); return setError(ei.message); }
    setF(vacio()); setFoto(null); setEstado("ok");
    setTimeout(() => setEstado(""), 3000);
    void cargar();
  }

  const ultimaWbgt = lista.find((m) => m.wbgt != null);
  const ultimaRayo = lista.find((m) => nivelRayoMedido(m) != null);
  const det = analizarDetector(lista);
  const reanudarFuturo = det.reanudar && new Date(det.reanudar).getTime() > Date.now();

  return (
    <section className="seccion" aria-labelledby="med-t">
      <h2 id="med-t">Mediciones en terreno</h2>
      <p className="chico" style={{ marginTop: -6 }}>El WBGT medido reemplaza al estimado por los modelos. Las mediciones las carga el equipo EMERTEAM en el lugar.</p>

      <div className="grilla" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))" }}>
        <div className="tarjeta">
          <div className="rotulo">Último WBGT medido</div>
          {ultimaWbgt ? (
            <>
              <div className="condensada" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.1 }}>{num(ultimaWbgt.wbgt, 1)} °C</div>
              <span className="badge" style={estiloWA(nivelWBGT(ultimaWbgt.wbgt) ?? 0)}>{NOMBRE_WA[nivelWBGT(ultimaWbgt.wbgt) ?? 0]}</span>
              <div className="chico" style={{ marginTop: 6 }}>{ultimaWbgt.sector} · {fmtFechaHora(ultimaWbgt.tomada_en)}</div>
            </>
          ) : <p className="chico">Todavía no hay mediciones de WBGT.</p>}
        </div>
        <div className="tarjeta">
          <div className="rotulo">Tormenta eléctrica en terreno</div>
          {ultimaRayo ? (
            <>
              <span className="badge" style={{ ...estiloNivel(nivelRayoMedido(ultimaRayo) ?? 0), marginTop: 8 }}>{NIVEL_RAYO[nivelRayoMedido(ultimaRayo) ?? 0]}</span>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, fontSize: 15 }}>
                <span>{textoRayo(ultimaRayo)}</span>
                {det.tendencia && (
                  <span><b>{det.tendencia === "acerca" ? "Se acerca" : det.tendencia === "aleja" ? "Se aleja" : "Estable"}</b>
                    {det.velocidad != null && det.tendencia !== "estable" && ` a ≈ ${num(Math.abs(det.velocidad))} km/h`}
                    {det.minutosA19 != null && ` · 19 km en ≈ ${det.minutosA19} min`}
                    {det.minutosA13 != null && ` · 13 km en ≈ ${det.minutosA13} min`}
                  </span>
                )}
                {det.rayosPorMin != null && <span>Frecuencia: ≈ {num(det.rayosPorMin, 1)} rayos por minuto (contador del detector)</span>}
                {det.reanudar && (
                  <span><b>{reanudarFuturo ? `Reanudar no antes de las ${fmtHora(det.reanudar)}` : `Sin actividad a 13 km o menos desde las ${fmtHora(det.ultimoCercano!)}`}</b>
                    {reanudarFuturo ? ", si no hay rayos nuevos a 13 km o menos." : ": se cumplen los 30 min para reanudar (confirmar con el satélite)."}</span>
                )}
              </div>
              <div className="chico" style={{ marginTop: 6 }}>{ultimaRayo.sector} · {fmtFechaHora(ultimaRayo.tomada_en)}</div>
            </>
          ) : <p className="chico">Sin registros de rayos.</p>}
          <p className="chico" style={{ marginBottom: 0 }}>Detector (distancia al frente de tormenta): 24 km o menos alerta · 19 km o menos preparar o demorar · 13 km o menos, o trueno audible: suspender · 30 min sin actividad a 13 km o menos para reanudar. Con actividad, cargar una lectura cada 5 minutos: con dos o más se calcula la tendencia.</p>
        </div>
      </div>

      {puedeCargar && (
        <form onSubmit={guardar} className="tarjeta" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="rotulo">Nueva medición</div>
          <div className="form form-med">
            <label>Sector<select value={f.sector} onChange={set("sector")}>{SECTORES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Fecha y hora<input type="datetime-local" required value={f.tomada_en} onChange={set("tomada_en")} /></label>
            <label>WBGT (°C)<input inputMode="decimal" value={f.wbgt} onChange={set("wbgt")} placeholder="ej. 23,4" /></label>
            <label>Temperatura (°C)<input inputMode="decimal" value={f.temp} onChange={set("temp")} /></label>
            <label>Humedad (%)<input inputMode="decimal" value={f.hr} onChange={set("hr")} /></label>
            <label>Viento medio (km/h)<input inputMode="decimal" value={f.viento_medio} onChange={set("viento_medio")} /></label>
            <label>Ráfaga (km/h)<input inputMode="decimal" value={f.rafaga} onChange={set("rafaga")} /></label>
            <label>Altura del anemómetro (m)<input inputMode="decimal" value={f.altura_viento_m} onChange={set("altura_viento_m")} /></label>
            <label>Detector de rayos<select value={f.detector} onChange={set("detector")}>
              <option value="">Sin dato</option>
              <option value="distancia">Muestra una distancia</option>
              <option value="escuchando">Sin rayos (LISTENING)</option>
              <option value="na">Rayos a más de 40 km (NA)</option>
            </select></label>
            {f.detector === "distancia" && (
              <label>Distancia del detector
                <span style={{ display: "flex", gap: 6 }}>
                  <input inputMode="decimal" value={f.rayo_dist} onChange={set("rayo_dist")} placeholder={f.unidad === "mi" ? "ej. 12" : "ej. 19"} style={{ flex: 1, minWidth: 0 }} />
                  <select value={f.unidad} onChange={set("unidad")} style={{ width: 76 }} aria-label="Unidad del detector"><option value="km">km</option><option value="mi">mi</option></select>
                </span>
              </label>
            )}
            <label>Contador del detector (COUNT)<input inputMode="numeric" value={f.rayo_conteo} onChange={set("rayo_conteo")} placeholder="total acumulado" /></label>
            <label>Relámpago-trueno (segundos, respaldo)<input inputMode="decimal" value={f.relampago_trueno_s} onChange={set("relampago_trueno_s")} placeholder="si el detector falla" /></label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "end", minHeight: 42 }}>
              <input type="checkbox" checked={f.trueno} onChange={set("trueno")} style={{ minHeight: 0, width: 20, height: 20 }} /> Se escucha trueno
            </label>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <label className="boton" style={{ flexDirection: "row", fontWeight: 700 }}>
              {foto ? `Foto: ${foto.name.slice(0, 24)}` : "Foto del instrumento"}
              <input type="file" accept="image/*" capture="environment" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} style={{ display: "none" }} />
            </label>
            <button type="button" className="boton" onClick={ubicar}>{ubic ? `Ubicación ${ubic.lat}, ${ubic.lon}` : "Agregar ubicación"}</button>
            <button className="boton primario" disabled={estado === "guardando"}>{estado === "guardando" ? "Guardando…" : "Guardar medición"}</button>
            {estado === "ok" && <span style={{ color: "var(--ok-texto)", fontWeight: 700 }}>Guardada</span>}
          </div>
          {error && <p style={{ color: "var(--rojo)", margin: 0 }}>{error}</p>}
        </form>
      )}

      {lista.length > 0 && (
        <div className="tarjeta desplaza" style={{ marginTop: 16 }}>
          <table className="tabla">
            <thead>
              <tr><th>Hora</th><th>Sector</th><th>WBGT</th><th>T / HR</th><th>Viento / ráfaga</th><th>Rayos</th><th>Foto</th></tr>
            </thead>
            <tbody>
              {lista.map((m) => {
                const nw = nivelWBGT(m.wbgt);
                const nr = nivelRayoMedido(m);
                return (
                  <tr key={m.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtFechaHora(m.tomada_en)}</td>
                    <td>{m.sector}<div className="chico">{m.operador.split("@")[0]}</div></td>
                    <td>{nw != null ? <span className="badge" style={{ ...estiloWA(nw), fontSize: 13 }}>{num(m.wbgt, 1)} °C</span> : "—"}</td>
                    <td>{num(m.temp, 1)} °C · {num(m.hr)} %</td>
                    <td>{num(m.viento_medio)} / {num(m.rafaga)} km/h{m.altura_viento_m != null && <div className="chico">a {num(m.altura_viento_m, 1)} m</div>}</td>
                    <td>{nr != null ? <><span className="badge" style={{ ...estiloNivel(nr), fontSize: 13 }}>{NIVEL_RAYO[nr]}</span><div className="chico">{textoRayo(m)}</div></> : "—"}</td>
                    <td>{m.foto_path && fotos[m.foto_path] ? <a href={fotos[m.foto_path]} target="_blank" rel="noreferrer">Ver</a> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Lectura de rayos en palabras: detector, contador, trueno y conteo relámpago-trueno */
function textoRayo(m: Medicion): string {
  const partes: string[] = [];
  if (m.trueno) partes.push("trueno audible");
  if (m.rayo_km != null) partes.push(`detector ${num(m.rayo_km, 0)} km`);
  else if (m.rayo_rango) partes.push(m.rayo_rango === "sin" ? "detector sin rayos" : `detector ${RANGOS.find((r) => r[0] === m.rayo_rango)?.[1] ?? m.rayo_rango}`);
  if (m.rayo_conteo != null) partes.push(`${num(m.rayo_conteo)} rayos acumulados`);
  if (m.relampago_trueno_s != null) partes.push(`relámpago-trueno ${num(m.relampago_trueno_s)} s (≈ ${num(kmPorTrueno(m.relampago_trueno_s), 1)} km)`);
  return partes.join(" · ");
}
