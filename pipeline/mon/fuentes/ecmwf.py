"""Conector ECMWF IFS Open Data 0,25° (CC BY 4.0). Corridas 00 y 12 UTC, pasos de 3 h hasta 144 h."""

from __future__ import annotations

import logging
import math
import os
import tempfile
from datetime import datetime, timedelta, timezone

from ecmwf.opendata import Client

from .. import grib
from ..calculo import hr_desde_rocio, wbgt_liljegren

log = logging.getLogger(__name__)

PASO = 3
HORIZONTE_MAX = 144
PARAMS = ["2t", "2d", "10u", "10v", "10fg", "tp", "sp", "ssrd", "tcc", "mucape"]


def _cliente() -> Client:
    return Client(source=os.environ.get("MON_ECMWF_SOURCE", "ecmwf"), model="ifs", resol="0p25")


def ultima_corrida() -> datetime | None:
    try:
        c = _cliente().latest(type="fc", stream="oper", step=HORIZONTE_MAX, param="2t")
        return c.replace(tzinfo=timezone.utc)
    except Exception as e:  # noqa: BLE001
        log.warning("ECMWF: no se pudo consultar la última corrida: %s", e)
        return None


def obtener(eventos: list[dict], hasta: datetime, ahora: datetime) -> tuple[datetime, list[dict]] | None:
    corrida = ultima_corrida()
    if corrida is None:
        return None
    puntos = {e["id"]: (float(e["lat"]), float(e["lon"])) for e in eventos}
    horas = min(HORIZONTE_MAX, max(PASO, math.ceil((hasta - corrida).total_seconds() / 3600 / PASO) * PASO))
    pasos = list(range(0, horas + 1, PASO))
    log.info("ECMWF corrida %s, pasos 0..%d, %d eventos", corrida.isoformat(), horas, len(puntos))

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "ecmwf.grib2")
        params = list(PARAMS)
        for _ in range(3):
            try:
                _cliente().retrieve(date=corrida.strftime("%Y%m%d"), time=corrida.hour, type="fc",
                                    stream="oper", step=pasos, param=params, target=path)
                break
            except Exception as e:  # noqa: BLE001
                msg = str(e)
                quitar = [p for p in params if p in msg]
                log.warning("ECMWF: %s", msg[:300])
                if not quitar:
                    raise
                params = [p for p in params if p not in quitar]
        msgs = grib.leer(path, puntos)

    log.info("ECMWF variables: %s", sorted({(m.nombre, m.tipo_paso) for m in msgs}))
    por_paso: dict[int, dict[str, dict[str, float]]] = {}
    for m in msgs:
        por_paso.setdefault(m.fin, {}).setdefault(m.nombre, {}).update(m.valores)

    filas = []
    for ev, punto in puntos.items():
        for paso in pasos:
            if paso == 0:
                continue
            d = {k: v.get(ev) for k, v in por_paso.get(paso, {}).items()}
            prev = {k: v.get(ev) for k, v in por_paso.get(paso - PASO, {}).items()}
            filas.append(_fila(ev, punto, corrida, corrida + timedelta(hours=paso), d, prev))
    return corrida, filas


def _fila(ev, punto, corrida, valido, d, prev) -> dict:
    t = d.get("2t")
    td = d.get("2d")
    t_c = t - 273.15 if t is not None else None
    td_c = td - 273.15 if td is not None else None
    hr = hr_desde_rocio(t_c, td_c) if t_c is not None and td_c is not None else None
    u, v = d.get("10u"), d.get("10v")
    viento_ms = math.hypot(u, v) if u is not None and v is not None else None
    direccion = (math.degrees(math.atan2(-u, -v)) % 360) if viento_ms else None
    rafaga_ms = d.get("10fg", d.get("fg10"))
    pres_hpa = d["sp"] / 100 if d.get("sp") is not None else None
    ssrd = None
    if d.get("ssrd") is not None:
        ssrd = max(d["ssrd"] - (prev.get("ssrd") or 0.0), 0.0) / (PASO * 3600)
    precip = None
    if d.get("tp") is not None:
        precip = max(d["tp"] - (prev.get("tp") or 0.0), 0.0) * 1000 / PASO
    tcc = d.get("tcc")
    if tcc is not None and tcc <= 1.0:
        tcc *= 100
    wbgt = None
    # La radiación es el promedio de las 3 h previas: se evalúa en el centro del intervalo
    if None not in (t_c, hr, pres_hpa, viento_ms, ssrd):
        wbgt = wbgt_liljegren(t_c, hr, pres_hpa, viento_ms, ssrd, punto[0], punto[1],
                              valido - timedelta(minutes=90) if ssrd > 0 else valido)
    return {
        "evento_id": ev, "fuente": "ecmwf",
        "corrida": corrida.isoformat(), "valido": valido.isoformat(),
        "t2m": _r(t_c), "td2m": _r(td_c), "hr": _r(hr),
        "viento10": _r(viento_ms * 3.6 if viento_ms is not None else None, 1),
        "rafaga10": _r(rafaga_ms * 3.6 if rafaga_ms is not None else None, 1),
        "dir_viento": _r(direccion, 0),
        "precip": _r(precip), "prob_precip": None,
        "cape": _r(d.get("mucape"), 0), "radiacion": _r(ssrd, 0),
        "nubosidad": _r(tcc), "presion": _r(pres_hpa), "wbgt_est": wbgt,
    }


def _r(x, n=2):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), n)
