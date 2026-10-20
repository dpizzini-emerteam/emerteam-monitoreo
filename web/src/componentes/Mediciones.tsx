import { useCallback, useEffect, useState } from "react";
import { fmtFechaHora, kmPorTrueno, nivelRayoMedido, nivelWBGT, num, supabase, type Medicion } from "../datos";
import { estiloNivel, estiloWA, NOMBRE_WA } from "../reglas";

const SECTORES = ["Largada", "Llegada", "Puesto médico", "Último cuarto", "Recorrido"];
const RANGOS: [string, string][] = [
  ["", "Sin dato"],
  ["sin", "Sin actividad"],
  [">24", "Más de 24 km"],
  ["19-24", "19 a 24 km"],
  ["13-19", "13 a 19 km"],
  ["<13", "Menos de 13 km"],
];
const NIVEL_RAYO = ["Sin actividad", "Vigilar", "Alerta", "Preparar / demorar", "Suspender"];

type Form = {
  sector: string; tomada_en: string; wbgt: string; temp: string; hr: string; viento_medio: string; rafaga: string;
  altura_viento_m: string; rayo_rango: string; rayo_tendencia: string; trueno: boolean; relampago_trueno_s: string;
};

const localAhora = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 16);
const vacio = (): Form => ({
  sector: "Llegada", tomada_en: localAhora(), wbgt: "", temp: "", hr: "", viento_medio: "", rafaga: "",
  altura_viento_m: "2", rayo_rango: "", rayo_tendencia: "", trueno: false, relampago_trueno_s: "",
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
    const valores = [f.wbgt, f.temp, f.hr, f.viento_medio, f.rafaga, f.relampago_trueno_s];
    if (valores.every((v) => v.trim() === "") && !f.rayo_rango && !f.trueno) return setError("Cargá al menos un valor medido.");
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
      rayo_rango: f.rayo_rango || null, rayo_tendencia: f.rayo_tendencia || null, trueno: f.trueno, relampago_trueno_s: n(f.relampago_trueno_s),
      foto_path,
    });
    if (ei) { setEstado(""); return setError(ei.message); }
    setF(vacio()); setFoto(null); setEstado("ok");
    setTimeout(() => setEstado(""), 3000);
    void cargar();
  }

  const ultimaWbgt = lista.find((m) => m.wbgt != null);
  const ultimaRayo = lista.find((m) => nivelRayoMedido(m) != null);

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
              <div className="chico" style={{ marginTop: 6 }}>
                {ultimaRayo.trueno ? "Trueno audible" : ultimaRayo.rayo_rango ? RANGOS.find((r) => r[0] === ultimaRayo.rayo_rango)?.[1] : ""}
                {ultimaRayo.relampago_trueno_s != null && ` · relámpago-trueno ${num(ultimaRayo.relampago_trueno_s)} s (≈ ${num(kmPorTrueno(ultimaRayo.relampago_trueno_s), 1)} km)`}
                <br />{ultimaRayo.sector} · {fmtFechaHora(ultimaRayo.tomada_en)}
              </div>
            </>
          ) : <p className="chico">Sin registros de rayos.</p>}
          <p className="chico" style={{ marginBottom: 0 }}>Escalera NWS: 24 km alerta · 19 km preparar o demorar · 13 km o trueno audible: suspender · 30 min sin actividad para reanudar.</p>
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
            <label>Detector de rayos<select value={f.rayo_rango} onChange={set("rayo_rango")}>{RANGOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
            <label>Tendencia de la tormenta<select value={f.rayo_tendencia} onChange={set("rayo_tendencia")}>
              <option value="">Sin dato</option><option value="acercandose">Se acerca</option><option value="estable">Estable</option><option value="alejandose">Se aleja</option>
            </select></label>
            <label>Relámpago-trueno (segundos)<input inputMode="decimal" value={f.relampago_trueno_s} onChange={set("relampago_trueno_s")} placeholder="cuenta entre luz y sonido" /></label>
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
                    <td>{nr != null ? <span className="badge" style={{ ...estiloNivel(nr), fontSize: 13 }}>{NIVEL_RAYO[nr]}</span> : "—"}</td>
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
