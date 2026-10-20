"""Índice UV con cielo despejado: MET Norway, Locationforecast 2.0 (api.met.no), licencia CC BY 4.0.

La API entrega el UV solo en los pasos horarios (~2,5 días). Las horas sin dato se completan con la forma
de la curva diaria del UV con cielo despejado (Madronich, 2007: UVI ≈ 12,5 · μ0^2,42): se interpola el factor
k = UVI / (12,5 · μ0^2,42) entre pasos con sol y, después del último dato, se usa el k medio de las últimas 24 h
(el k refleja ozono y aerosoles, que varían poco de un día al siguiente). Esas horas quedan marcadas como interpoladas.
Las condiciones de uso exigen identificarse en el User-Agent y no consultar más de lo necesario.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import requests

from ..calculo import cos_cenit

log = logging.getLogger("mon.metno")
URL = "https://api.met.no/weatherapi/locationforecast/2.0/complete"
AGENTE = "EMERTEAM-Monitoreo/1.0 (+https://riesgoambiental.emerteam.com.ar; info@emerteam.com.ar)"
MU_MIN = 0.05  # por debajo el sol está casi en el horizonte y el factor k no es estable


def _forma(mu: float) -> float:
    return 12.5 * mu ** 2.42 if mu > 0 else 0.0


def obtener_evento(ev: dict, hasta: datetime) -> list[dict]:
    lat, lon = round(float(ev["lat"]), 4), round(float(ev["lon"]), 4)
    r = requests.get(URL, params={"lat": lat, "lon": lon}, headers={"User-Agent": AGENTE}, timeout=30)
    r.raise_for_status()
    js = r.json()
    actualizado = js["properties"]["meta"].get("updated_at")
    puntos: list[tuple[datetime, float]] = []
    for s in js["properties"]["timeseries"]:
        uv = s["data"]["instant"]["details"].get("ultraviolet_index_clear_sky")
        if uv is None:
            continue
        puntos.append((datetime.fromisoformat(s["time"].replace("Z", "+00:00")), float(uv)))
    if not puntos:
        return []
    exactos = {t: uv for t, uv in puntos}
    # factor k en los pasos con sol
    ks = [(t, uv / _forma(mu)) for t, uv in puntos if (mu := cos_cenit(lat, lon, t)) >= MU_MIN and _forma(mu) > 0]
    filas = []
    t = puntos[0][0]
    fin = min(hasta, puntos[-1][0] + timedelta(days=7))  # mismo alcance que el pronóstico de los modelos
    ultimos = [k for tk, k in ks if tk >= ks[-1][0] - timedelta(hours=24)] if ks else []
    k_ext = sum(ultimos) / len(ultimos) if ultimos else None
    while t <= fin:
        if t in exactos:
            uv, interp = exactos[t], False
        else:
            mu = cos_cenit(lat, lon, t)
            if mu <= 0 or not ks:
                uv = 0.0
            else:
                antes = [x for x in ks if x[0] <= t]
                despues = [x for x in ks if x[0] >= t]
                if antes and despues:
                    (t0, k0), (t1, k1) = antes[-1], despues[0]
                    k = k0 if t1 == t0 else k0 + (k1 - k0) * (t - t0) / (t1 - t0)
                elif antes:
                    k = k_ext if k_ext is not None else antes[-1][1]
                else:
                    k = despues[0][1]
                uv = k * _forma(mu)
            interp = True
        filas.append({"evento_id": ev["id"], "valido": t.isoformat(), "uv": round(max(uv, 0.0), 1),
                      "interpolado": interp, "fuente": "met_no", "actualizado_en": actualizado})
        t += timedelta(hours=1)
    return filas


def obtener(eventos: list[dict], hasta_por_evento: dict[str, datetime]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for ev in eventos:
        try:
            out[ev["id"]] = obtener_evento(ev, hasta_por_evento.get(ev["id"], datetime.now(timezone.utc) + timedelta(days=10)))
            log.info("UV %s: %d horas", ev["nombre"], len(out[ev["id"]]))
        except Exception:  # noqa: BLE001
            log.exception("UV de %s", ev["nombre"])
    return out
