"""Lectura de GRIB2 con eccodes: valor en el punto de grilla de cada evento.

Con 0,25° (~25 km) el punto de grilla más cercano puede caer sobre el mar o un río ancho
(Mar del Plata, Costanera, Puerto Madryn). Un punto de agua subestima la temperatura máxima y
sobreestima el viento. Si el archivo trae la máscara tierra/mar (GFS: LAND; ECMWF: lsm), se elige
el punto de tierra más cercano entre los cuatro que rodean al evento; si no hay ninguno, el más cercano.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass

import eccodes

log = logging.getLogger(__name__)

MASCARAS = {"lsm", "land"}
UMBRAL_TIERRA = 0.5


@dataclass
class Mensaje:
    nombre: str        # shortName de eccodes
    nivel: str         # typeOfLevel
    altura: int        # level
    inicio: int        # startStep [h]
    fin: int           # endStep [h]
    tipo_paso: str     # stepType: instant | avg | accum | max
    valores: dict      # evento_id -> valor


@dataclass
class Punto:
    indice: int
    lat: float
    lon: float
    tierra: bool | None   # None: el archivo no trae máscara
    distancia_km: float


def _vecinos(gid, lat: float, lon: float) -> list[dict]:
    for lo in (lon, lon % 360):
        try:
            return list(eccodes.codes_grib_find_nearest(gid, lat, lo, is_lsm=False, npoints=4))
        except eccodes.GribInternalError:
            continue
    return []


def _elegir(gid_mascara, gid_ref, lat: float, lon: float) -> Punto | None:
    """Punto de tierra más cercano entre los 4 vecinos (con máscara) o el más cercano (sin máscara)."""
    base = gid_mascara if gid_mascara is not None else gid_ref
    vecinos = sorted(_vecinos(base, lat, lon), key=lambda v: v["distance"])
    if not vecinos:
        return None
    elegido, tierra = vecinos[0], None
    if gid_mascara is not None:
        de_tierra = [v for v in vecinos if float(v["value"]) >= UMBRAL_TIERRA]
        elegido = de_tierra[0] if de_tierra else vecinos[0]
        tierra = bool(de_tierra)
    lo = float(elegido["lon"])
    return Punto(int(elegido["index"]), float(elegido["lat"]), lo - 360 if lo > 180 else lo, tierra,
                 round(float(elegido["distance"]), 1))


def puntos_modelo(path: str, puntos: dict[str, tuple[float, float]]) -> dict[str, Punto]:
    """Recorre el archivo buscando la máscara tierra/mar y define el punto de grilla de cada evento."""
    gid_mascara = gid_ref = None
    with open(path, "rb") as f:
        while True:
            gid = eccodes.codes_grib_new_from_file(f)
            if gid is None:
                break
            nombre = eccodes.codes_get(gid, "shortName")
            if nombre in MASCARAS and gid_mascara is None:
                gid_mascara = gid
            elif gid_ref is None:
                gid_ref = gid
            else:
                eccodes.codes_release(gid)
            if gid_mascara is not None and gid_ref is not None:
                break
    try:
        if gid_ref is None and gid_mascara is None:
            return {}
        salida = {}
        for ev, (lat, lon) in puntos.items():
            p = _elegir(gid_mascara, gid_ref if gid_ref is not None else gid_mascara, lat, lon)
            if p:
                salida[ev] = p
                log.info("Punto de modelo para %s: %.3f, %.3f (%s, a %.1f km)", ev, p.lat, p.lon,
                         "tierra" if p.tierra else "agua" if p.tierra is False else "sin máscara", p.distancia_km)
        return salida
    finally:
        for g in (gid_mascara, gid_ref):
            if g is not None:
                eccodes.codes_release(g)


def _valor(gid, punto: Punto | None, lat: float, lon: float) -> float:
    if punto is not None:
        try:
            return float(eccodes.codes_get_double_element(gid, "values", punto.indice))
        except eccodes.GribInternalError:
            pass
    vec = sorted(_vecinos(gid, lat, lon), key=lambda v: v["distance"])
    return float(vec[0]["value"]) if vec else float("nan")


def leer(path: str, puntos: dict[str, tuple[float, float]], elegidos: dict[str, Punto] | None = None) -> list[Mensaje]:
    """Lee todos los mensajes del archivo y extrae el valor en el punto de grilla de cada evento.
    `elegidos` permite reutilizar los puntos ya definidos (misma grilla en todos los pasos)."""
    if elegidos is None:
        elegidos = puntos_modelo(path, puntos)
    salida: list[Mensaje] = []
    with open(path, "rb") as f:
        while True:
            gid = eccodes.codes_grib_new_from_file(f)
            if gid is None:
                break
            try:
                nombre = eccodes.codes_get(gid, "shortName")
                if nombre in MASCARAS:
                    continue
                vals = {ev: _valor(gid, elegidos.get(ev), lat, lon) for ev, (lat, lon) in puntos.items()}
                salida.append(Mensaje(
                    nombre=nombre,
                    nivel=eccodes.codes_get(gid, "typeOfLevel"),
                    altura=int(eccodes.codes_get(gid, "level")),
                    inicio=int(eccodes.codes_get(gid, "startStep")),
                    fin=int(eccodes.codes_get(gid, "endStep")),
                    tipo_paso=eccodes.codes_get(gid, "stepType"),
                    valores=vals,
                ))
            finally:
                eccodes.codes_release(gid)
    return salida


def es_nan(x) -> bool:
    return x is None or (isinstance(x, float) and math.isnan(x))
