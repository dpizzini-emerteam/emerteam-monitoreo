// Ubicación del evento a partir de lo que el usuario tenga a mano: coordenadas, un enlace de Google Maps,
// una dirección, una ciudad o un lugar conocido. Fuentes sin costo:
//  · API Georef del Gobierno de la Nación (datos.gob.ar): direcciones y localidades de Argentina.
//  · Nominatim de OpenStreetMap: lugares y parques. Su política exige un pedido por búsqueda explícita
//    (sin autocompletar) y como máximo uno por segundo, por eso solo se consulta al tocar Buscar.

export type Resultado = {
  etiqueta: string;
  detalle: string;
  lat: number;
  lon: number;
  zoom: number;
  fuente: "Coordenadas" | "Georef (datos.gob.ar)" | "OpenStreetMap";
};

const GEOREF = "https://apis.datos.gob.ar/georef/api";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const enArgentina = (lat: number, lon: number) => lat < -21 && lat > -56 && lon < -53 && lon > -74;

/** Coordenadas sueltas ("-38.02, -57.53") o dentro de un enlace de Google Maps / OpenStreetMap */
export function leerCoordenadas(texto: string): Resultado | null {
  const t = texto.trim();
  const patrones = [
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/, // google.com/maps/.../@lat,lon,zoom
    /[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
    /[#&]map=\d+\/(-?\d{1,2}\.\d+)\/(-?\d{1,3}\.\d+)/, // openstreetmap.org/#map=z/lat/lon
    /^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/, // "-38.02, -57.53" o "-38,02 -57,53"
  ];
  for (const p of patrones) {
    const m = t.match(p);
    if (!m) continue;
    const lat = parseFloat(m[1].replace(",", "."));
    const lon = parseFloat(m[2].replace(",", "."));
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { etiqueta: `${r4(lat)}, ${r4(lon)}`, detalle: enArgentina(lat, lon) ? "Coordenadas ingresadas" : "Coordenadas fuera de Argentina: verificalas", lat: r4(lat), lon: r4(lon), zoom: 15, fuente: "Coordenadas" };
    }
  }
  return null;
}

async function json<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

type GeorefDireccion = { nomenclatura: string; ubicacion: { lat: number | null; lon: number | null } };
type GeorefLocalidad = { nombre: string; categoria?: string; centroide: { lat: number; lon: number }; departamento?: { nombre: string }; provincia: { nombre: string } };
type Osm = { display_name: string; lat: string; lon: string; type?: string; addresstype?: string; category?: string };

const titulo = (s: string) => s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

async function georef(texto: string): Promise<Resultado[]> {
  // "Ciudad, Provincia" → nombre + provincia; con número de calle se busca también como dirección
  const [primero, ...resto] = texto.split(",").map((s) => s.trim()).filter(Boolean);
  const provincia = resto.at(-1);
  const conAltura = /\d/.test(primero ?? "");
  const q = new URLSearchParams({ max: "5" });
  const pedidos: Promise<Resultado[]>[] = [];

  if (conAltura) {
    const pd = new URLSearchParams({ direccion: primero, max: "5" });
    if (provincia) pd.set("provincia", provincia);
    pedidos.push(json<{ direcciones: GeorefDireccion[] }>(`${GEOREF}/direcciones?${pd}`).then((d) =>
      (d?.direcciones ?? []).filter((x) => x.ubicacion.lat != null && x.ubicacion.lon != null).map((x) => ({
        etiqueta: titulo(x.nomenclatura.split(",")[0]),
        detalle: x.nomenclatura.split(",").slice(1).join(",").trim(),
        lat: r4(x.ubicacion.lat!), lon: r4(x.ubicacion.lon!), zoom: 17, fuente: "Georef (datos.gob.ar)" as const,
      }))));
  } else {
    q.set("nombre", primero ?? texto);
    if (provincia) q.set("provincia", provincia);
    q.set("orden", "nombre");
    pedidos.push(json<{ localidades: GeorefLocalidad[] }>(`${GEOREF}/localidades?${q}&campos=nombre,categoria,centroide,departamento.nombre,provincia.nombre`).then((d) => {
      const vistos = new Set<string>();
      return (d?.localidades ?? []).filter((x) => {
        const k = `${x.nombre}|${x.departamento?.nombre}|${x.provincia.nombre}`;
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
      }).map((x) => ({
        etiqueta: x.nombre,
        detalle: [x.departamento?.nombre, x.provincia.nombre].filter(Boolean).join(", "),
        lat: r4(x.centroide.lat), lon: r4(x.centroide.lon), zoom: 13, fuente: "Georef (datos.gob.ar)" as const,
      }));
    }));
  }
  return (await Promise.all(pedidos)).flat();
}

async function osm(texto: string): Promise<Resultado[]> {
  const p = new URLSearchParams({ q: texto, format: "jsonv2", countrycodes: "ar", limit: "5", "accept-language": "es" });
  const d = await json<Osm[]>(`${NOMINATIM}?${p}`);
  return (d ?? []).map((x) => {
    const partes = x.display_name.split(",").map((s) => s.trim());
    const tipo = x.addresstype ?? x.type ?? "";
    const zoom = /city|town|municipality|state|county/.test(tipo) ? 13 : /suburb|village|neighbourhood|quarter/.test(tipo) ? 14 : 16;
    return {
      etiqueta: partes[0],
      detalle: partes.slice(1, 4).join(", "),
      lat: r4(parseFloat(x.lat)), lon: r4(parseFloat(x.lon)), zoom, fuente: "OpenStreetMap" as const,
    };
  });
}

/** Busca con todas las fuentes y devuelve los resultados sin duplicados (a menos de ~200 m) */
export async function buscarUbicacion(texto: string): Promise<Resultado[]> {
  const t = texto.trim();
  if (!t) return [];
  const coord = leerCoordenadas(t);
  if (coord) return [coord];
  const [g, o] = await Promise.all([georef(t), osm(t)]);
  const out: Resultado[] = [];
  for (const r of [...g, ...o]) {
    if (!out.some((x) => Math.abs(x.lat - r.lat) < 0.002 && Math.abs(x.lon - r.lon) < 0.002)) out.push(r);
  }
  return out.slice(0, 8);
}
