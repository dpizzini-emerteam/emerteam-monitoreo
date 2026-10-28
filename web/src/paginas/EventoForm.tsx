import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Ctx } from "../main";
import { Barra } from "../componentes/Barra";
import { EliminarEvento } from "../componentes/EliminarEvento";
import { supabase, type Evento, type Modalidad, type Productora } from "../datos";
import { buscarUbicacion, leerCoordenadas, type Resultado } from "../geocodificar";
import { confDisciplina, DISCIPLINAS, nombreDisciplina, type Disciplina } from "../disciplinas";

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
  productora_id: string;
  duracion_propia_min: string;
  demora_largada_min: string;
  portico: "estructural" | "inflable";
  estado: "activo" | "cerrado";
  disciplina: Disciplina;
  agua_tipo: "" | "mar" | "rio" | "lago" | "laguna";
  natacion_m: string;
  natacion_min: string;
};

const VACIO: Form = {
  nombre: "", largada: "", ubicacion: "", lat: "", lon: "", organizador_email: "",
  participantes: "", armado_dias: "3", productora_id: "", duracion_propia_min: "", demora_largada_min: "",
  portico: "estructural", estado: "activo", disciplina: "running", agua_tipo: "", natacion_m: "", natacion_min: "",
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
  const [productoras, setProductoras] = useState<Productora[]>([]);

  useEffect(() => {
    supabase.from("mon_productoras").select("id,nombre,cupo").order("nombre").then(({ data }) => setProductoras((data as Productora[]) ?? []));
  }, []);

  useEffect(() => {
    if (!id) return;
    supabase.from("mon_eventos").select("*, mon_modalidades(*)").eq("id", id).single().then(({ data }) => {
      if (!data) return;
      const e = data as Evento;
      setF({
        nombre: e.nombre, largada: aLocal(e.largada), ubicacion: e.ubicacion, lat: String(e.lat), lon: String(e.lon),
        organizador_email: e.organizador_email, participantes: String(e.participantes), armado_dias: String(e.armado_dias), productora_id: e.productora_id ?? "",
        duracion_propia_min: e.duracion_propia_min ? String(e.duracion_propia_min) : "",
        demora_largada_min: e.demora_largada_min != null ? String(e.demora_largada_min) : "",
        portico: e.portico, estado: e.estado, disciplina: e.disciplina ?? "running", agua_tipo: e.agua_tipo ?? "",
        natacion_m: e.natacion_m ? String(e.natacion_m) : "", natacion_min: e.natacion_min ? String(e.natacion_min) : "",
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
  const conf = confDisciplina(f.disciplina);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const largada = new Date(`${f.largada}:00${OFFSET}`);
    if (!id && largada.getTime() < Date.now()) return setError("La fecha de largada ya pasó.");
    if (!mods.length || mods.some((m) => !m.nombre || !(m.distancia_km > 0))) return setError("Cargá al menos una modalidad con distancia.");
    // La duración por distancia solo está calibrada para running: el resto de las disciplinas la carga
    if (f.disciplina !== "running" && !f.duracion_propia_min) return setError("Cargá la duración estimada del evento: el cálculo por distancia solo vale para running.");
    if (f.duracion_propia_min && parseInt(f.duracion_propia_min, 10) < 15)
      return setError(`Una duración de ${f.duracion_propia_min} min es demasiado corta y deja sin sentido la ventana de carrera y el último cuarto. Revisala${f.disciplina === "running" ? " o dejala vacía para estimarla por distancia" : ""}.`);
    if (conf.agua && !f.agua_tipo) return setError("Indicá el tipo de agua (mar, río, lago o laguna).");
    if (conf.agua && !f.natacion_m) return setError("Cargá la distancia de natación en metros: define la regla de temperatura del agua.");
    if (f.disciplina === "triatlon" && !f.natacion_min) return setError("Cargá la duración estimada de la natación: es la zona crítica del triatlón.");
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
      participantes: parseInt(f.participantes, 10), armado_dias: parseInt(f.armado_dias, 10), productora_id: f.productora_id || null,
      duracion_propia_min: f.duracion_propia_min ? parseInt(f.duracion_propia_min, 10) : null,
      demora_largada_min: f.demora_largada_min ? parseInt(f.demora_largada_min, 10) : null,
      portico: f.portico, estado: f.estado, actualizado_en: new Date().toISOString(),
      disciplina: f.disciplina, agua_tipo: conf.agua ? f.agua_tipo || null : null,
      natacion_m: conf.agua && f.natacion_m ? parseInt(f.natacion_m, 10) : null,
      natacion_min: f.disciplina === "triatlon" && f.natacion_min ? parseInt(f.natacion_min, 10) : null,
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
            <label>Disciplina<select value={f.disciplina} onChange={set("disciplina")}>{DISCIPLINAS.map((d) => <option key={d} value={d}>{nombreDisciplina(d)}</option>)}</select></label>
            {conf.agua && (
              <>
                <label>Tipo de agua<select required value={f.agua_tipo} onChange={set("agua_tipo")}>
                  <option value="">Elegí…</option><option value="mar">Mar</option><option value="rio">Río</option><option value="lago">Lago</option><option value="laguna">Laguna</option>
                </select></label>
                <label>Distancia de natación (m)<input type="number" min={50} required value={f.natacion_m} onChange={set("natacion_m")} placeholder="ej. 1500" /></label>
              </>
            )}
            {f.disciplina === "triatlon" && (
              <label>Duración de la natación (min, primeros en salir hasta los últimos)<input type="number" min={1} required value={f.natacion_min} onChange={set("natacion_min")} placeholder="ej. 50" /></label>
            )}
            <label>Fecha y hora de largada (hora argentina)<input type="datetime-local" required value={f.largada} onChange={set("largada")} /></label>
            <label>Participantes (total)<input type="number" min={0} required value={f.participantes} onChange={set("participantes")} /></label>
            <label>Correo del organizador<input type="email" required value={f.organizador_email} onChange={set("organizador_email")} /></label>
            <label>Días de armado<input type="number" min={1} max={10} required value={f.armado_dias} onChange={set("armado_dias")} /></label>
            <label>Productora (su equipo ve el evento)
              <select value={f.productora_id} onChange={set("productora_id")}>
                <option value="">Sin productora</option>
                {productoras.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
            <label>Pórtico<select value={f.portico} onChange={set("portico")}><option value="estructural">Estructural</option><option value="inflable">Inflable</option></select></label>
            {f.disciplina === "running"
              ? <label>Duración propia (min, opcional)<input type="number" value={f.duracion_propia_min} onChange={set("duracion_propia_min")} placeholder="estimada por distancia" min={15} /></label>
              : <label>Duración estimada del evento (min, hasta el último participante)<input type="number" min={15} required value={f.duracion_propia_min} onChange={set("duracion_propia_min")} /></label>}
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
              <label style={{ gridColumn: "1 / -1" }}>Lugar (como se muestra en la web)<input value={f.ubicacion} onChange={set("ubicacion")} placeholder="Se completa con la búsqueda" /></label>
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
        {id && f.nombre && <div style={{ marginTop: 36 }}><EliminarEvento id={id} nombre={f.nombre} /></div>}
      </main>
    </>
  );
}
