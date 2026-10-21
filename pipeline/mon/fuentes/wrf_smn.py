"""Conector WRF determinístico del SMN (4 km, horario, 72 h). Datos abiertos en AWS (bucket smn-ar-wrf),
licencia Creative Commons Atribución 2.5 Argentina: «Fuente: Servicio Meteorológico Nacional».

Modelo regional WRF-ARW 4.0 con asimilación local (SAP.SMN-ANA), corridas 00, 06, 12 y 18 UTC. La temperatura
a 2 m y el viento a 10 m vienen calibrados por el SMN contra estaciones (metodología RAFK). No publica ráfaga
ni CAPE: la ráfaga se completa en el consenso con el factor de ráfaga de otra fuente.

Cada archivo horario (~37 MB) trae el campo completo comprimido por variable: se baja entero (hilos solo para
la descarga) y se lee el punto de grilla más cercano a cada evento en el hilo principal.
"""

from __future__ import annotations

import logging
import math
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import numpy as np
import requests

from ..calculo import wbgt_liljegren
from ..correccion import rocio

log = logging.getLogger(__name__)

BASE = os.environ.get("MON_WRF_BASE", "https://smn-ar-wrf.s3.us-west-2.amazonaws.com")
HORIZONTE = 72
HILOS = 8


def _url(c: datetime, paso: int) -> str:
    return f"{BASE}/DATA/WRF/DET/{c:%Y/%m/%d/%H}/WRFDETAR_01H_{c:%Y%m%d_%H}_{paso:03d}.nc"


def ultima_corrida(ahora: datetime) -> datetime | None:
    """Última corrida con el paso final (+72 h) publicado."""
    base = ahora.replace(minute=0, second=0, microsecond=0)
    base -= timedelta(hours=base.hour % 6)
    for k in range(0, 6):
        c = base - timedelta(hours=6 * k)
        try:
            if requests.head(_url(c, HORIZONTE), timeout=30).status_code == 200:
                return c.replace(tzinfo=timezone.utc)
        except requests.RequestException as e:
            log.warning("WRF SMN: no se pudo verificar %s: %s", c, e)
    return None


def _bajar(url: str, destino: str) -> bool:
    for intento in range(3):
        try:
            with requests.get(url, stream=True, timeout=120) as r:
                if r.status_code != 200:
                    return False
                with open(destino, "wb") as fh:
                    for b in r.iter_content(1 << 20):
                        fh.write(b)
            return True
        except requests.RequestException as e:
            log.warning("WRF SMN: intento %d %s: %s", intento + 1, url, e)
    return False


def _r(x, n=2):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), n)


def _val(h, nombre: str, j: int, i: int) -> float | None:
    if nombre not in h:
        return None
    v = float(np.asarray(h[nombre][0, j, i]))
    return None if not math.isfinite(v) or abs(v) > 1e19 else v


def obtener(eventos: list[dict], hasta: datetime, ahora: datetime) -> tuple[datetime, list[dict]] | None:
    import h5py  # solo esta fuente lo necesita

    corrida = ultima_corrida(ahora)
    if corrida is None:
        log.info("WRF SMN: sin corrida disponible")
        return None
    ultimo = min(HORIZONTE, max(1, math.ceil((hasta - corrida).total_seconds() / 3600)))
    pasos = list(range(0, ultimo + 1))
    puntos = {e["id"]: (float(e["lat"]), float(e["lon"])) for e in eventos}
    log.info("WRF SMN corrida %s, pasos 0..%d, %d eventos", corrida.isoformat(), ultimo, len(puntos))

    filas: list[dict] = []
    with tempfile.TemporaryDirectory() as tmp:
        rutas = {p: os.path.join(tmp, f"{p:03d}.nc") for p in pasos}
        with ThreadPoolExecutor(HILOS) as ex:
            ok = dict(zip(pasos, ex.map(lambda p: _bajar(_url(corrida, p), rutas[p]), pasos)))
        celdas: dict[str, tuple[int, int, float, float]] = {}
        previo: dict[str, dict[str, float | None]] = {}
        for p in pasos:
            if not ok.get(p):
                log.error("WRF SMN: falta el paso %03d; se corta la serie", p)
                break
            with h5py.File(rutas[p], "r") as h:
                if not celdas:
                    la, lo = np.asarray(h["lat"][...], dtype=float), np.asarray(h["lon"][...], dtype=float)
                    for ev, (plat, plon) in puntos.items():
                        d2 = (la - plat) ** 2 + ((lo - plon) * math.cos(math.radians(plat))) ** 2
                        j, i = np.unravel_index(int(np.argmin(d2)), la.shape)
                        celdas[ev] = (int(j), int(i), float(la[j, i]), float(lo[j, i]))
                valido = corrida + timedelta(hours=p)
                for ev, (j, i, plat, plon) in celdas.items():
                    acc_sw, acc_pp = _val(h, "ACSWDNB", j, i), _val(h, "PP", j, i)
                    ant = previo.get(ev)
                    previo[ev] = {"sw": acc_sw, "pp": acc_pp}
                    if p == 0 or ant is None:
                        continue  # el paso 0 solo sirve de base para los acumulados
                    t, hr = _val(h, "T2", j, i), _val(h, "HR2", j, i)
                    v_ms, dirv, pres = _val(h, "magViento10", j, i), _val(h, "dirViento10", j, i), _val(h, "PSFC", j, i)
                    rad = max((acc_sw - ant["sw"]) / 3600, 0.0) if acc_sw is not None and ant["sw"] is not None else None
                    pp = max(acc_pp - ant["pp"], 0.0) if acc_pp is not None and ant["pp"] is not None else None
                    td = rocio(t, hr) if t is not None and hr is not None else None
                    wbgt = None
                    if None not in (t, hr, pres, v_ms, rad):
                        # radiación media de la hora previa: se evalúa el sol en el centro del intervalo
                        wbgt = wbgt_liljegren(t, hr, pres, v_ms, rad, puntos[ev][0], puntos[ev][1],
                                              valido - timedelta(minutes=30) if rad > 0 else valido)
                    filas.append({
                        "evento_id": ev, "fuente": "wrf_smn",
                        "corrida": corrida.isoformat(), "valido": valido.isoformat(),
                        "t2m": _r(t), "td2m": _r(td), "hr": _r(hr),
                        "viento10": _r(v_ms * 3.6 if v_ms is not None else None, 1), "rafaga10": None,
                        "dir_viento": _r(dirv, 0), "precip": _r(pp), "prob_precip": None,
                        "cape": None, "radiacion": _r(rad, 0), "nubosidad": None, "presion": _r(pres),
                        "wbgt_est": wbgt, "punto_lat": round(plat, 3), "punto_lon": round(plon, 3), "punto_tierra": None,
                    })
            os.remove(rutas[p])
    return corrida, filas
