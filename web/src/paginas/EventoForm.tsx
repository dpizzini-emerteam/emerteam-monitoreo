import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Ctx } from "../main";
import { Barra } from "../componentes/Barra";
import { supabase, type Evento, type Modalidad } from "../datos";
import { buscarUbicacion, leerCoordenadas, type Resultado } from "../geocodificar";

// Argentina no aplica horario de verano: UTC−03:00 fijo
const OFFSET = "-03:00";

function aLocal(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
  return d.toISOString().slice(0, 16);
}

type Form = {
  nombre: string;
  largada: string; // AAAA-MM-DDTHH:MM local
  ubicacion: string;
  lat: string;
  lon: string;
  organizador_email: string;
  participantes: string;
  armado_dias: string;
  cupo_equipo: string;
  duracion_propia_min: string;
  demora_largada_min: string;
  portico: "estructural" | "inflable";
  estado: "activo" | "cerrado";
};

const VACIO: Form = {
  nombre: "", largada: "", ubicacion: "", lat: "", lon: "", organizador_email: "",
  participantes: "", armado_dias: "3", cupo_equipo: "3", duracion_propia_min: "", demora_largada_min: "",
  portico: "estructural", estado: "activo",
};

export function EventoForm() {
  const { editor, session } = useOutletContext<Ctx>();
  const { id } = useParams();
  const nav = useNavigate();
  const [f, setF] = useState<Form>(VACIO);
  const [mods, setMods] = useState<Modalidad[]>([{ nombre: "21K", distancia_km: 21.0975, participantes: null }]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const mapaRef = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const marca = useRef<L.CircleMarker | null>(null);
  const centrado = useRef(false);
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (!id) return;
    supabase.from("mon_eventos").select("*, mon_modalidades(*)").eq("id", id).single().then(({ data }) => {
      if (!data) return;
      const e = data as Evento;
      setF({
        nombre: e.nombre, largada: aLocal(e.largada), ubicacion: e.ubicacion, lat: String(e.lat), lon: String(e.lon),
        organizador_email: e.organizador_email, participantes: String(e.participantes), armado_dias: String(e.armado_dias), cupo_equipo: String(e.cupo_equipo ?? 3),
        duracion_propia_min: e.duracion_propia_min ? String(e.duracion_propia_min) : "",
        demora_largada_min: e.demora_largada_min != null ? String(e.demora_largada_min) : "",
        portico: e.portico, estado: e.estado,
      });
      setMods(e.mon_modalidades ?? []);
    });
  }, [id]);

  useEffect(() => {
    if (!mapaRef.current || mapa.current) return;
    const m = L.map(mapaRef.current).setView([-34.6, -58.42], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: "© OpenStreetMap",
    }).addTo(m);
    m.on("click", (ev: L.LeafletMouseEvent) => {
      setF((p) => ({ ...p, lat: ev.latlng.lat.toFixed(4), lon: ev.latlng.lng.toFixed(4) }));
    });
    mapa.current = m;
  }, []);

  useEffect(() => {
    const lat = parseFloat(f.lat), lon = parseFloat(f.lon);
    if (!mapa.current || Number.isNaN(lat) || Number.isNaN(lon)) return;
    if (!marca.current) marca.current = L.circleMarker([lat, lon], { radius: 9, color: "#111", fillColor: "#FF6A1A", fillOpacity: 1 }).addTo(mapa.current);
    else marca.current.setLatLng([lat, lon]);
    // Al abrir un evento existente, el mapa se centra en su punto
    if (!centrado.current) { mapa.current.setView([lat, lon], 14); centrado.current = true; }
  }, [f.lat, f.lon]);

  async function buscar(texto = busqueda) {
    if (!texto.trim()) return;
    setBuscando(true);
    const r = await buscarUbicacion(texto);
    setBuscando(false);
    setResultados(r);
    if (r.length === 1) elegir(r[0]);
  }

  function elegir(r: Resultado) {
    centrado.current = true;
    setF((p) => ({
      ...p, lat: String(r.lat), lon: String(r.lon),
      ubicacion: p.ubicacion.trim() ? p.ubicacion : r.fuente === "Coordenadas" ? "" : [r.etiqueta, r.detalle].filter(Boolean).join(", "),
    }));
    mapa.current?.setView([r.lat, r.lon], r.zoom);
    setResultados(null);
  }

  if (!editor) return <p className="contenedor" style={{ paddingTop: 26 }}>Solo los editores de EMERTEAM pueden cargar y editar eventos.</p>;

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const largada = new Date(`${f.largada}:00${OFFSET}`);
    if (!id && largada.getTime() < Date.now()) return setError("La fecha de largada ya pasó.");
    if (!mods.length || mods.some((m) => !m.nombre || !(m.distancia_km > 0))) return setError("Cargá al menos una modalidad con distancia.");
    let lat = parseFloat(f.lat), lon = parseFloat(f.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      // Sin coordenadas: se buscan con el lugar o con lo escrito en el buscador
      const texto = busqueda.trim() || f.ubicacion.trim();
      const r = texto ? await buscarUbicacion(texto) : [];
      if (!r.length) return setError("Indicá la ubicación: buscá una ciudad, dirección o coordenadas, o tocá el mapa.");
      if (r.length > 1 && !busqueda.trim()) { setResultados(r); return setError("Hay más de una coincidencia para el lugar: elegí la correcta en la lista."); }
      lat = r[0].lat; lon = r[0].lon;
    }
    const ubicacion = f.ubicacion.trim() || (busqueda.trim() && !leerCoordenadas(busqueda) ? busqueda.trim() : `${lat}, ${lon}`);
    setGuardando(true);
    const fila = {
      nombre: f.nombre.trim(), largada: largada.toISOString(), ubicacion,
      lat, lon, organizador_email: f.organizador_email.trim().toLowerCase(),
      participantes: parseInt(f.participantes, 10), armado_dias: parseInt(f.armado_dias, 10), cupo_equipo: parseInt(f.cupo_equipo, 10),
      duracion_propia_min: f.duracion_propia_min ? parseInt(f.duracion_propia_min, 10) : null,
      demora_largada_min: f.demora_largada_min ? parseInt(f.demora_largada_min, 10) : null,
      portico: f.portico, estado: f.estado, actualizado_en: new Date().toISOString(),
      ...(id ? {} : { creado_por: session.user.email }),
    };
    const res = id
      ? await supabase.from("mon_eventos").update(fila).eq("id", id).select("id").single()
      : await supabase.from("mon_eventos").insert(fila).select("id").single();
    if (res.error || !res.data) {
      setGuardando(false);
      return setError(res.error?.message ?? "No se pudo guardar.");
    }
    const evId = res.data.id as string;
    await supabase.from("mon_modalidades").delete().eq("evento_id", evId);
    const { error: em } = await supabase.from("mon_modalidades").insert(
      mods.map((m) => ({ evento_id: evId, nombre: m.nombre, distancia_km: m.distancia_km, participantes: m.participantes })),
    );
    setGuardando(false);
    if (em) return setError(em.message);
    nav(`/evento/${evId}`);
  }

  return (
    <>
      <Barra titulo={id ? "Editar evento" : "Nuevo evento"} subtitulo="El monitoreo se activa al guardar">
        <Link className="boton-osc" to="/">← Eventos</Link>
      </Barra>
      <main className="contenedor" style={{ paddingTop: 26, paddingBottom: 26 }}>
        <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="tarjeta form">
            <label style={{ gridColumn: "1 / -1" }}>Nombre del evento<input required value={f.nombre} onChange={set("nombre")} /></label>
            <label>Fecha y hora de largada (hora argentina)<input type="datetime-local" required value={f.largada} onChange={set("largada")} /></label>
            <label>Participantes (total)<input type="number" min={0} required value={f.participantes} onChange={set("participantes")} /></label>
            <label>Correo del organizador<input type="email" required value={f.organizador_email} onChange={set("organizador_email")} /></label>
            <label>Días de armado<input type="number" min={1} max={10} required value={f.armado_dias} onChange={set("armado_dias")} /></label>
            <label>Cupo del equipo del organizador<input type="number" min={0} max={200} required value={f.cupo_equipo} onChange={set("cupo_equipo")} /></label>
            <label>Pórtico<select value={f.portico} onChange={set("portico")}><option value="estructural">Estructural</option><option value="inflable">Inflable</option></select></label>
            <label>Duración propia (min, opcional)<input type="number" min={1} value={f.duracion_propia_min} onChange={set("duracion_propia_min")} placeholder="estimada por distancia" /></label>
            <label>Demora de largada (min, opcional)<input type="number" min={0} value={f.demora_largada_min} onChange={set("demora_largada_min")} placeholder="1 min cada 1.000" /></label>
            {id && <label>Estado<select value={f.estado} onChange={set("estado")}><option value="activo">Activo</option><option value="cerrado">Cerrado</option></select></label>}
          </div>

          <div className="tarjeta">
            <div className="rotulo" style={{ marginBottom: 10 }}>Modalidades</div>
            {mods.map((m, i) => (
              <div key={i} className="form" style={{ marginBottom: 10, alignItems: "end" }}>
                <label>Nombre<input required value={m.nombre} onChange={(e) => setMods(mods.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} /></label>
                <label>Distancia (km)<input type="number" step="0.0001" min={0.1} required value={m.distancia_km} onChange={(e) => setMods(mods.map((x, j) => (j === i ? { ...x, distancia_km: parseFloat(e.target.value) } : x)))} /></label>
                <label>Participantes<input type="number" min={0} value={m.participantes ?? ""} onChange={(e) => setMods(mods.map((x, j) => (j === i ? { ...x, participantes: e.target.value ? parseInt(e.target.value, 10) : null } : x)))} /></label>
                <button type="button" className="boton" onClick={() => setMods(mods.filter((_, j) => j !== i))} disabled={mods.length === 1}>Quitar</button>
              </div>
            ))}
            <button type="button" className="boton" onClick={() => setMods([...mods, { nombre: "", distancia_km: 10, participantes: null }])}>+ Agregar modalidad</button>
          </div>

          <div className="tarjeta">
            <div className="rotulo" style={{ marginBottom: 6 }}>Ubicación del punto de largada y llegada</div>
            <p className="chico" style={{ marginTop: 0 }}>Alcanza con uno de estos datos: ciudad, dirección, lugar conocido, coordenadas o un enlace de Google Maps. Después podés ajustar el punto tocando el mapa.</p>
            <div className="buscador-ubicacion">
              <input
                value={busqueda}
                onChange={(e) => { setBusqueda(e.target.value); setResultados(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void buscar(); } }}
                placeholder="Ej.: Mar del Plata · Av. Libertador 1500, CABA · Parque Tres de Febrero · -38.0285, -57.5340"
                aria-label="Buscar ubicación"
              />
              <button type="button" className="boton primario" onClick={() => void buscar()} disabled={buscando || !busqueda.trim()}>{buscando ? "Buscando…" : "Buscar"}</button>
            </div>
            {resultados && (
              resultados.length === 0
                ? <p className="chico" style={{ color: "var(--rojo)" }}>Sin resultados. Probá con la ciudad, agregá la provincia o tocá el punto en el mapa.</p>
                : resultados.length > 1 && (
                  <ul className="resultados-ubicacion">
                    {resultados.map((r, i) => (
                      <li key={i}>
                        <button type="button" onClick={() => elegir(r)}>
                          <b>{r.etiqueta}</b>{r.detalle && <span>{r.detalle}</span>}<small>{r.fuente}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
            )}
            <div className="form" style={{ margin: "12px 0" }}>
              <label style={{ gridColumn: "span 2" }}>Lugar (como se muestra en la web)<input value={f.ubicacion} onChange={set("ubicacion")} placeholder="Se completa con la búsqueda" /></label>
              <label>Latitud<input value={f.lat} onChange={set("lat")} inputMode="decimal" /></label>
              <label>Longitud<input value={f.lon} onChange={set("lon")} inputMode="decimal" /></label>
            </div>
            <div ref={mapaRef} style={{ height: 380, borderRadius: 8, border: "1px solid var(--borde)" }} />
          </div>

          {error && <p style={{ color: "var(--rojo)", margin: 0 }}>{error}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="boton primario" disabled={guardando}>{guardando ? "Guardando…" : "Guardar y activar monitoreo"}</button>
            <Link className="boton" to="/">Cancelar</Link>
          </div>
        </form>
      </main>
    </>
  );
}
