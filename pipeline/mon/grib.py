"""Lectura de GRIB2 con eccodes: valor en el punto de grilla más cercano a cada evento."""

from __future__ import annotations

from dataclasses import dataclass

import eccodes


@dataclass
class Mensaje:
    nombre: str        # shortName de eccodes
    nivel: str         # typeOfLevel
    altura: int        # level
    inicio: int        # startStep [h]
    fin: int           # endStep [h]
    tipo_paso: str     # stepType: instant | avg | accum | max
    valores: dict      # evento_id -> valor


def _cercano(gid, lat: float, lon: float) -> float:
    for lo in (lon, lon % 360):
        try:
            return float(eccodes.codes_grib_find_nearest(gid, lat, lo)[0]["value"])
        except eccodes.GribInternalError:
            continue
    return float("nan")


def leer(path: str, puntos: dict[str, tuple[float, float]]) -> list[Mensaje]:
    """Lee todos los mensajes del archivo y extrae el valor más cercano a cada punto."""
    salida: list[Mensaje] = []
    with open(path, "rb") as f:
        while True:
            gid = eccodes.codes_grib_new_from_file(f)
            if gid is None:
                break
            try:
                vals = {}
                for ev, (lat, lon) in puntos.items():
                    vals[ev] = _cercano(gid, lat, lon)
                salida.append(Mensaje(
                    nombre=eccodes.codes_get(gid, "shortName"),
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
