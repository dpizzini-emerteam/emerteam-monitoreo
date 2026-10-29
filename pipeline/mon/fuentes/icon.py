"""Conector DWD ICON global (13 km, grilla icosaédrica). Datos abiertos del Deutscher Wetterdienst (CC BY 4.0).

Corridas 00 y 12 UTC hasta +180 h (las de 06 y 18 llegan a +120 h y no se usan): pasos horarios hasta +78 h y
de 3 h después. Cada variable y paso es un archivo GRIB2 global comprimido con bzip2; se descargan en hilos,
se descomprimen y se lee el valor de la celda elegida para cada evento.

Celda: la de tierra (fracción de tierra ≥ 0,5) más cercana entre las 8 más próximas al evento, con las
coordenadas de las celdas (CLAT/CLON) y la fracción de tierra (FR_LAND) de la propia corrida.

Variables: T_2M, TD_2M, U_10M, V_10M, VMAX_10M (ráfaga máxima del intervalo), TOT_PREC (acumulada desde el
inicio), PS, ASWDIR_S y ASWDIFD_S (radiación directa y difusa, promedio desde el inicio), CLCT y CAPE_ML.
La radiación directa y difusa por separado permite calcular el WBGT con la fracción directa del modelo en
lugar de estimarla con Erbs.
"""

from __future__ import annotations

import bz2
import logging
import math
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import eccodes
import numpy as np
import requests

from ..calculo import hr_desde_rocio, wbgt_liljegren

log = logging.getLogger(__name__)

BASE = os.environ.get("MON_ICON_BASE", "https://opendata.dwd.de/weather/nwp/icon/grib")
UA = {"user-agent": "EMERTEAM-Monitoreo/1.0 (info@emerteam.com.ar)"}
HORARIO_MAX = 78
HORIZONTE_MAX = 168   # mismo alcance útil que GFS
HILOS = 16
VARS = ["T_2M", "TD_2M", "U_10M", "V_10M", "VMAX_10M", "TOT_PREC", "PS", "ASWDIR_S", "ASWDIFD_S", "CLCT", "CAPE_ML"]
S = requests.Session()
S.headers.update(UA)
S.mount("https://", requests.adapters.HTTPAdapter(pool_connections=HILOS, pool_maxsize=HILOS * 2, max_retries=2))


def _url(corrida: datetime, var: str, paso: int | None, invariante: bool = False) -> str:
    carpeta = var.lower()
    if invariante:
        return f"{BASE}/{corrida:%H}/{carpeta}/icon_global_icosahedral_time-invariant_{corrida:%Y%m%d%H}_{var}.grib2.bz2"
    return f"{BASE}/{corrida:%H}/{carpeta}/icon_global_icosahedral_single-level_{corrida:%Y%m%d%H}_{paso:03d}_{var}.grib2.bz2"


def pasos_hasta(horas: int) -> list[int]:
    return [p for p in list(range(1, HORARIO_MAX + 1)) + list(range(HORARIO_MAX + 3, 181, 3)) if p <= horas]


def ultima_corrida(ahora: datetime) -> datetime | None:
    """Última corrida 00 o 12 UTC con el paso de +168 h publicado (todas las variables salen juntas)."""
    base = ahora.replace(minute=0, second=0, microsecond=0)
    base -= timedelta(hours=base.hour % 12)
    for k in range(3):
        c = base - timedelta(hours=12 * k)
        try:
            if S.head(_url(c, "T_2M", HORIZONTE_MAX), timeout=30).status_code == 200 \
                    and S.head(_url(c, "CAPE_ML", HORIZONTE_MAX), timeout=30).status_code == 200:
                return c.replace(tzinfo=timezone.utc)
        except requests.RequestException as e:
            log.warning("ICON: no se pudo verificar la corrida %s: %s", c.isoformat(), e)
    return None


def _bajar(url: str) -> bytes | None:
    for intento in range(3):
        try:
            r = S.get(url, timeout=120)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return bz2.decompress(r.content)
        except Exception as e:  # noqa: BLE001
            if intento == 2:
                log.warning("ICON: falló %s: %s", url.rsplit("/", 1)[-1], e)
    return None


def _valores(datos: bytes) -> np.ndarray:
    gid = eccodes.codes_new_from_message(datos)
    try:
        return eccodes.codes_get_values(gid)
    finally:
        eccodes.codes_release(gid)


def _celdas(corrida: datetime, puntos: dict[str, tuple[float, float]]) -> dict[str, tuple[int, float, float, bool]]:
    """{evento: (índice, lat, lon, tierra)}: celda de tierra más cercana entre las 8 más próximas."""
    with ThreadPoolExecutor(3) as ex:
        clat, clon, frl = ex.map(_bajar, [_url(corrida, v, None, True) for v in ("CLAT", "CLON", "FR_LAND")])
    if clat is None or clon is None:
        raise RuntimeError("ICON: sin coordenadas de celdas (CLAT/CLON)")
    lat, lon = np.radians(_valores(clat)), np.radians(_valores(clon))
    tierra = _valores(frl) if frl is not None else None
    x, y, z = np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)
    salida = {}
    for ev, (la, lo) in puntos.items():
        a, b = math.radians(la), math.radians(lo)
        d = 2 - 2 * (x * math.cos(a) * math.cos(b) + y * math.cos(a) * math.sin(b) + z * math.sin(a))
        cerca = np.argsort(d)[:8]
        elegido, es_tierra = int(cerca[0]), None
        if tierra is not None:
            de_tierra = [int(i) for i in cerca if tierra[i] >= 0.5]
            es_tierra = bool(de_tierra)
            if de_tierra:
                elegido = de_tierra[0]
        salida[ev] = (elegido, math.degrees(float(lat[elegido])), math.degrees(float(lon[elegido])), es_tierra)
    return salida


def obtener(eventos: list[dict], hasta: datetime, ahora: datetime) -> tuple[datetime, list[dict]] | None:
    corrida = ultima_corrida(ahora)
    if corrida is None:
        log.info("ICON: sin corrida completa disponible")
        return None
    puntos = {e["id"]: (float(e["lat"]), float(e["lon"])) for e in eventos}
    celdas = _celdas(corrida, puntos)
    horas = min(HORIZONTE_MAX, max(1, math.ceil((hasta - corrida).total_seconds() / 3600)))
    # Desde el paso anterior a ahora (para desacumular), sin bajar horas ya pasadas
    desde = max(0, math.floor((ahora - corrida).total_seconds() / 3600) - 3)
    pasos = [p for p in pasos_hasta(horas) if p >= desde]
    pedidos = [(v, p) for p in pasos for v in VARS]
    log.info("ICON corrida %s: %d pasos (%d..%d), %d archivos, %d eventos", corrida.isoformat(), len(pasos), pasos[0], pasos[-1],
             len(pedidos), len(puntos))
    idx = {ev: c[0] for ev, c in celdas.items()}
    evs = list(idx)
    valores: dict[tuple[str, int], dict[str, float]] = {}
    with ThreadPoolExecutor(HILOS) as ex:
        for (v, p), datos in zip(pedidos, ex.map(lambda vp: _bajar(_url(corrida, vp[0], vp[1])), pedidos)):
            if datos is None:
                continue
            gid = eccodes.codes_new_from_message(datos)
            try:
                vals = eccodes.codes_get_double_elements(gid, "values", [idx[e] for e in evs])
            finally:
                eccodes.codes_release(gid)
            valores[(v, p)] = dict(zip(evs, (float(x) for x in vals)))
    log.info("ICON: %d de %d archivos leídos", len(valores), len(pedidos))

    filas = []
    for ev, punto in puntos.items():
        celda = celdas[ev]
        # El paso 0 no se publica para las acumuladas: se parte de cero
        previo = (0, {"TOT_PREC": 0.0, "ASWDIR_S": 0.0, "ASWDIFD_S": 0.0}) if pasos[0] == 1 else None
        for p in pasos:
            d = {v: valores.get((v, p), {}).get(ev) for v in VARS}
            if previo is not None and d.get("T_2M") is not None:
                filas.append(_fila(ev, punto, celda, corrida, p, d, previo))
            previo = (p, d)
    return corrida, filas


def _desacumular(actual: float | None, anterior: float | None, p: int, p0: int, promedio: bool) -> float | None:
    """TOT_PREC acumulada desde el inicio → mm/h del intervalo; radiación promedio desde el inicio → W/m² del intervalo."""
    if actual is None or anterior is None or p <= p0:
        return None
    if promedio:
        return max((actual * p - anterior * p0) / (p - p0), 0.0)
    return max(actual - anterior, 0.0) / (p - p0)


def _fila(ev: str, punto: tuple[float, float], celda, corrida: datetime, p: int, d: dict, previo) -> dict:
    p0, d0 = previo
    t, td = d.get("T_2M"), d.get("TD_2M")
    t_c = t - 273.15 if t is not None else None
    td_c = td - 273.15 if td is not None else None
    hr = hr_desde_rocio(t_c, td_c) if t_c is not None and td_c is not None else None
    u, v = d.get("U_10M"), d.get("V_10M")
    viento_ms = math.hypot(u, v) if u is not None and v is not None else None
    direccion = (math.degrees(math.atan2(-u, -v)) % 360) if viento_ms else None
    rafaga_ms = d.get("VMAX_10M")
    pres_hpa = d["PS"] / 100 if d.get("PS") is not None else None
    precip = _desacumular(d.get("TOT_PREC"), d0.get("TOT_PREC"), p, p0, False)
    directa = _desacumular(d.get("ASWDIR_S"), d0.get("ASWDIR_S"), p, p0, True)
    difusa = _desacumular(d.get("ASWDIFD_S"), d0.get("ASWDIFD_S"), p, p0, True)
    ssrd = directa + difusa if directa is not None and difusa is not None else None
    fdir = (directa / ssrd) if ssrd and ssrd > 1 else 0.0
    valido = corrida + timedelta(hours=p)
    medio = valido - timedelta(minutes=30 * (p - p0))  # centro del intervalo de la radiación
    wbgt = None
    if None not in (t_c, hr, pres_hpa, viento_ms, ssrd):
        wbgt = wbgt_liljegren(t_c, hr, pres_hpa, viento_ms, ssrd, punto[0], punto[1], medio if ssrd > 0 else valido,
                              fdir=fdir)
    return {
        "evento_id": ev, "fuente": "icon",
        "corrida": corrida.isoformat(), "valido": valido.isoformat(),
        "t2m": _r(t_c), "td2m": _r(td_c), "hr": _r(hr),
        "viento10": _r(viento_ms * 3.6 if viento_ms is not None else None, 1),
        "rafaga10": _r(rafaga_ms * 3.6 if rafaga_ms is not None else None, 1),
        "dir_viento": _r(direccion, 0),
        "precip": _r(precip), "prob_precip": None,
        "cape": _r(d.get("CAPE_ML"), 0), "radiacion": _r(ssrd, 0),
        "nubosidad": _r(d.get("CLCT")), "presion": _r(pres_hpa), "wbgt_est": wbgt,
        "punto_lat": round(celda[1], 3), "punto_lon": round(celda[2], 3), "punto_tierra": celda[3],
    }


def _r(x, n=2):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), n)
