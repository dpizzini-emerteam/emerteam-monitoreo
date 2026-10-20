"""Conector NOAA GFS 0,25° horario (NOMADS, filtro por subregión). Dominio público."""

from __future__ import annotations

import logging
import math
import os
import tempfile
import time
from datetime import datetime, timedelta, timezone

import requests

from .. import grib
from ..calculo import hr_desde_rocio, wbgt_liljegren

log = logging.getLogger(__name__)

BASE = os.environ.get("MON_GFS_BASE", "https://nomads.ncep.noaa.gov")
FILTRO = BASE + "/cgi-bin/filter_gfs_0p25_1hr.pl"
PROD = BASE + "/pub/data/nccf/com/gfs/prod"
HORARIO_MAX = 120    # pasos horarios publicados; después, cada 3 h
HORIZONTE_MAX = 168  # alcance útil: armado, carrera y desarme dentro de 7 días
PAUSA_S = 0.7        # NOMADS bloquea más de ~120 pedidos por minuto

VARIABLES = ["TMP", "DPT", "RH", "UGRD", "VGRD", "GUST", "APCP", "DSWRF", "CAPE", "PRES", "TCDC"]
NIVELES = ["2_m_above_ground", "10_m_above_ground", "surface", "entire_atmosphere"]


def ultima_corrida(ahora: datetime) -> datetime | None:
    """Última corrida con el paso final publicado."""
    base = ahora.replace(minute=0, second=0, microsecond=0)
    base -= timedelta(hours=base.hour % 6)
    for k in range(0, 5):
        c = base - timedelta(hours=6 * k)
        url = f"{PROD}/gfs.{c:%Y%m%d}/{c:%H}/atmos/gfs.t{c:%H}z.pgrb2.0p25.f{HORIZONTE_MAX:03d}.idx"
        try:
            r = requests.head(url, timeout=30)
            if r.status_code == 200:
                return c.replace(tzinfo=timezone.utc)
        except requests.RequestException as e:
            log.warning("GFS: no se pudo verificar %s: %s", url, e)
    return None


def _caja(puntos: dict[str, tuple[float, float]]) -> dict[str, float]:
    lats = [p[0] for p in puntos.values()]
    lons = [p[1] % 360 for p in puntos.values()]
    return {
        "toplat": math.ceil(max(lats)) + 1, "bottomlat": math.floor(min(lats)) - 1,
        "leftlon": math.floor(min(lons)) - 1, "rightlon": math.ceil(max(lons)) + 1,
    }


def _descargar(corrida: datetime, paso: int, caja: dict, destino: str) -> bool:
    params = {
        "dir": f"/gfs.{corrida:%Y%m%d}/{corrida:%H}/atmos",
        "file": f"gfs.t{corrida:%H}z.pgrb2.0p25.f{paso:03d}",
        "subregion": "", **{k: str(v) for k, v in caja.items()},
    }
    for v in VARIABLES:
        params[f"var_{v}"] = "on"
    for n in NIVELES:
        params[f"lev_{n}"] = "on"
    for intento in range(4):
        try:
            r = requests.get(FILTRO, params=params, timeout=60)
            if r.status_code == 200 and r.content[:4] == b"GRIB":
                with open(destino, "wb") as f:
                    f.write(r.content)
                return True
            log.warning("GFS f%03d: respuesta %s", paso, r.status_code)
        except requests.RequestException as e:
            log.warning("GFS f%03d: %s", paso, e)
        time.sleep(5 * (intento + 1))
    return False


def _hora_desde_balde(actual: tuple[int, int, float], previo: tuple[int, int, float] | None,
                      acumulado: bool) -> float:
    """Valor horario medio del último intervalo a partir de un 'balde' GFS
    (acumulado o promedio desde el inicio del balde). Sirve para pasos de 1 h y de 3 h."""
    s, e, v = actual
    if previo is None or previo[0] != s or not (s <= previo[1] < e):
        return max(v / (e - s), 0.0) if acumulado else v
    _, pe, vp = previo
    if acumulado:
        return max((v - vp) / (e - pe), 0.0)
    return max((v * (e - s) - vp * (pe - s)) / (e - pe), 0.0)


def _pasos(maximo: int) -> list[int]:
    return [p for p in list(range(1, HORARIO_MAX + 1)) + list(range(HORARIO_MAX + 3, HORIZONTE_MAX + 1, 3)) if p <= maximo]


def obtener(eventos: list[dict], hasta: datetime, ahora: datetime) -> tuple[datetime, list[dict]] | None:
    corrida = ultima_corrida(ahora)
    if corrida is None:
        log.info("GFS: sin corrida disponible")
        return None
    puntos = {e["id"]: (float(e["lat"]), float(e["lon"])) for e in eventos}
    caja = _caja(puntos)
    pasos = _pasos(max(1, math.ceil((hasta - corrida).total_seconds() / 3600)))
    log.info("GFS corrida %s, pasos 1..%d, %d eventos", corrida.isoformat(), pasos[-1], len(puntos))

    baldes_prev: dict[tuple[str, str], tuple[int, int, float]] = {}
    filas: list[dict] = []
    with tempfile.TemporaryDirectory() as tmp:
        for paso in pasos:
            path = os.path.join(tmp, f"f{paso:03d}.grb2")
            if not _descargar(corrida, paso, caja, path):
                log.error("GFS: falta el paso f%03d; se corta la serie", paso)
                break
            msgs = grib.leer(path, puntos)
            os.remove(path)
            if paso == 1:
                log.info("GFS variables: %s", sorted({(m.nombre, m.nivel, m.tipo_paso) for m in msgs}))
            valido = corrida + timedelta(hours=paso)
            horarios = {m.nombre for m in msgs if m.tipo_paso in ("accum", "avg") and m.fin - m.inicio == 1}
            for ev in puntos:
                d: dict[str, float] = {}
                for m in msgs:
                    v = m.valores[ev]
                    clave = (ev, m.nombre)
                    if m.nombre in horarios:
                        if m.fin - m.inicio == 1:
                            d[m.nombre] = v
                            baldes_prev[clave] = (m.inicio, m.fin, v)
                        continue
                    if m.tipo_paso in ("accum", "avg"):
                        actual = (m.inicio, m.fin, v)
                        d[m.nombre] = _hora_desde_balde(actual, baldes_prev.get(clave), m.tipo_paso == "accum")
                        baldes_prev[clave] = actual
                    else:
                        d[m.nombre] = v
                filas.append(_fila(ev, puntos[ev], corrida, valido, d))
            time.sleep(PAUSA_S)
    return corrida, filas


def _fila(ev: str, punto: tuple[float, float], corrida: datetime, valido: datetime, d: dict) -> dict:
    t = d.get("2t")
    td = d.get("2d")
    t_c = t - 273.15 if t is not None else None
    td_c = td - 273.15 if td is not None else None
    hr = d.get("2r")
    if hr is None and t_c is not None and td_c is not None:
        hr = hr_desde_rocio(t_c, td_c)
    u, v = d.get("10u"), d.get("10v")
    viento_ms = math.hypot(u, v) if u is not None and v is not None else None
    direccion = (math.degrees(math.atan2(-u, -v)) % 360) if viento_ms else None
    rafaga_ms = d.get("gust", d.get("i10fg"))
    pres = d.get("sp")
    pres_hpa = pres / 100 if pres is not None else None
    ssrd = d.get("dswrf", d.get("sdswrf"))
    wbgt = None
    if None not in (t_c, hr, pres_hpa, viento_ms, ssrd):
        wbgt = wbgt_liljegren(t_c, hr, pres_hpa, viento_ms, ssrd, punto[0], punto[1], valido)
    return {
        "evento_id": ev, "fuente": "gfs",
        "corrida": corrida.isoformat(), "valido": valido.isoformat(),
        "t2m": _r(t_c), "td2m": _r(td_c), "hr": _r(hr),
        "viento10": _r(viento_ms * 3.6 if viento_ms is not None else None, 1),
        "rafaga10": _r(rafaga_ms * 3.6 if rafaga_ms is not None else None, 1),
        "dir_viento": _r(direccion, 0),
        "precip": _r(d.get("tp")), "prob_precip": None,
        "cape": _r(d.get("cape"), 0), "radiacion": _r(ssrd, 0),
        "nubosidad": _r(d.get("tcc")), "presion": _r(pres_hpa),
        "wbgt_est": wbgt,
    }


def _r(x, n=2):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), n)
