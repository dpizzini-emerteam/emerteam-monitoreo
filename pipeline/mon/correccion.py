"""Corrección de sesgo con observaciones del SMN y verificación del pronóstico.

Para cada evento se toma la estación del SMN más cercana (hasta 40 km) y se compara, para cada modelo,
el pronóstico guardado de las últimas 72 h con lo observado a la misma hora. Con eso:

* Temperatura: sesgo medio ponderado (los pares más recientes pesan más, vida media 36 h), separado en
  horas de día (10 a 19 h) y de noche, porque el error típico de un punto costero o urbano no es el mismo.
* Punto de rocío: sesgo medio ponderado (la humedad relativa se recalcula con T y Td corregidas).
* Viento: factor de escala observado/pronosticado (también se aplica a la ráfaga).
* WBGT: se recalcula por Liljegren con los valores corregidos.

Es una corrección por promedio móvil del sesgo (decaying average bias), la forma más simple de
post-procesamiento estadístico. Requiere al menos 12 pares; si no los hay, o la estación está lejos,
solo se informa el error medido y no se corrige. Los valores originales del modelo no se modifican:
los corregidos se guardan aparte (columnas *_corr).
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta

from .calculo import hr_desde_rocio, wbgt_liljegren

VENTANA_H = 72
VIDA_MEDIA_H = 36
MIN_PARES = 12
MIN_PARES_FRANJA = 6
DIST_MAX_KM = 40
LIM_T = 4.0
LIM_TD = 5.0
FACTOR_VIENTO = (0.5, 1.6)


def _f(x):
    return None if x is None else float(x)


def _dt(s: str) -> datetime:
    return datetime.fromisoformat(str(s).replace("Z", "+00:00"))


def rocio(t: float, hr: float) -> float | None:
    """Punto de rocío por Magnus (Alduchov y Eskridge, 1996)."""
    if t is None or hr is None or hr <= 0:
        return None
    a, b = 17.625, 243.04
    g = math.log(min(hr, 100) / 100) + a * t / (b + t)
    return b * g / (a - g)


def _de_dia(t: datetime) -> bool:
    return 10 <= (t - timedelta(hours=3)).hour <= 19  # hora oficial argentina


def _media(pares: list[tuple[float, float]]) -> float | None:
    """pares: (valor, peso)"""
    w = sum(p for _, p in pares)
    return sum(v * p for v, p in pares) / w if w > 0 else None


def calcular(filas_fuente: list[dict], obs: dict[datetime, dict], ahora: datetime, distancia_km: float | None) -> dict:
    """Sesgos y errores de una fuente para un evento."""
    dif_t, dif_t_dia, dif_t_noche, dif_td = [], [], [], []
    viento_m, viento_o, err_v = 0.0, 0.0, []
    err_t = []
    for f in filas_fuente:
        t = _dt(f["valido"])
        edad = (ahora - t).total_seconds() / 3600
        if edad <= 0 or edad > VENTANA_H:
            continue
        o = obs.get(t)
        if not o:
            continue
        peso = 0.5 ** (edad / VIDA_MEDIA_H)
        mt, ot = _f(f.get("t2m")), _f(o.get("temp"))
        if mt is not None and ot is not None:
            d = mt - ot
            dif_t.append((d, peso, t))
            (dif_t_dia if _de_dia(t) else dif_t_noche).append((d, peso))
            err_t.append((abs(d), t))
        mtd, otd = _f(f.get("td2m")), rocio(ot, _f(o.get("hr"))) if ot is not None else None
        if mtd is not None and otd is not None:
            dif_td.append((mtd - otd, peso))
        mv, ov = _f(f.get("viento10")), _f(o.get("viento"))
        if mv is not None and ov is not None:
            err_v.append((mv, ov, t))
            if mv >= 3:
                viento_m += mv * peso
                viento_o += ov * peso

    res: dict = {"pares": len(dif_t), "aplicado": False}
    if not dif_t:
        return res
    total = _media([(d, p) for d, p, _ in dif_t])
    dia = _media(dif_t_dia) if len(dif_t_dia) >= MIN_PARES_FRANJA else total
    noche = _media(dif_t_noche) if len(dif_t_noche) >= MIN_PARES_FRANJA else total
    clamp = lambda x, lim: None if x is None else max(-lim, min(lim, x))  # noqa: E731
    res.update({
        "sesgo_t_dia": clamp(dia, LIM_T), "sesgo_t_noche": clamp(noche, LIM_T),
        "sesgo_td": clamp(_media(dif_td), LIM_TD) if len(dif_td) >= MIN_PARES else None,
        "factor_viento": (max(FACTOR_VIENTO[0], min(FACTOR_VIENTO[1], viento_o / viento_m)) if viento_m > 0 and len(err_v) >= MIN_PARES else None),
    })
    res["error_t"] = sum(e for e, _ in err_t) / len(err_t)
    res["error_t_corr"] = sum(abs(_d - (res["sesgo_t_dia"] if _de_dia(t) else res["sesgo_t_noche"])) for _d, _, t in dif_t) / len(dif_t)
    if err_v:
        res["error_viento"] = sum(abs(m - o) for m, o, _ in err_v) / len(err_v)
        fv = res["factor_viento"] or 1.0
        res["error_viento_corr"] = sum(abs(m * fv - o) for m, o, _ in err_v) / len(err_v)
    res["aplicado"] = len(dif_t) >= MIN_PARES and (distancia_km is None or distancia_km <= DIST_MAX_KM)
    return res


def corregir_fila(f: dict, s: dict, lat: float, lon: float) -> dict:
    """Valores corregidos de una fila (vacíos si la corrección no se aplica)."""
    vacio = {"t2m_corr": None, "td2m_corr": None, "hr_corr": None, "viento10_corr": None, "rafaga10_corr": None, "wbgt_corr": None}
    if not s.get("aplicado"):
        return vacio
    t = _dt(f["valido"])
    t2m, td2m = _f(f.get("t2m")), _f(f.get("td2m"))
    if t2m is None:
        return vacio
    tc = t2m - (s["sesgo_t_dia"] if _de_dia(t) else s["sesgo_t_noche"])
    tdc = None
    if td2m is not None:
        tdc = min(td2m - (s.get("sesgo_td") or 0.0), tc)
    hr = hr_desde_rocio(tc, tdc) if tdc is not None else _f(f.get("hr"))
    fv = s.get("factor_viento") or 1.0
    v = _f(f.get("viento10"))
    r = _f(f.get("rafaga10"))
    vc = v * fv if v is not None else None
    rc = r * fv if r is not None else None
    wbgt = None
    pres, rad = _f(f.get("presion")), _f(f.get("radiacion"))
    if None not in (hr, pres, vc, rad):
        # ECMWF guarda la radiación media de las 3 h previas: se evalúa en el centro del intervalo
        momento = t - timedelta(minutes=90) if f.get("fuente") == "ecmwf" and rad > 0 else t
        wbgt = wbgt_liljegren(tc, hr, pres, vc / 3.6, rad, lat, lon, momento)
    rd = lambda x, n=2: None if x is None else round(float(x), n)  # noqa: E731
    return {"t2m_corr": rd(tc), "td2m_corr": rd(tdc), "hr_corr": rd(hr), "viento10_corr": rd(vc, 1),
            "rafaga10_corr": rd(rc, 1), "wbgt_corr": rd(wbgt)}


def aplicar(ev: dict, filas: list[dict], estacion: dict | None, observaciones: list[dict], ahora: datetime) -> tuple[list[dict], list[dict]]:
    """Devuelve (filas con columnas *_corr, sesgos por fuente)."""
    obs = {_dt(o["valido"]): o for o in observaciones}
    dist = _f(estacion.get("km")) if estacion else None
    lat, lon = float(ev["lat"]), float(ev["lon"])
    salida, sesgos = [], []
    for fuente in sorted({f["fuente"] for f in filas}):
        propias = [f for f in filas if f["fuente"] == fuente]
        s = calcular(propias, obs, ahora, dist) if estacion else {"pares": 0, "aplicado": False}
        for f in propias:
            salida.append({**f, **corregir_fila(f, s, lat, lon)})
        rd = lambda x, n=2: None if x is None else round(float(x), n)  # noqa: E731
        sesgos.append({
            "evento_id": ev["id"], "fuente": fuente,
            "estacion": estacion.get("nombre") if estacion else None,
            "estacion_lat": rd(estacion.get("lat"), 4) if estacion else None,
            "estacion_lon": rd(estacion.get("lon"), 4) if estacion else None,
            "distancia_km": rd(dist, 1), "pares": s.get("pares", 0),
            "sesgo_t_dia": rd(s.get("sesgo_t_dia")), "sesgo_t_noche": rd(s.get("sesgo_t_noche")),
            "sesgo_td": rd(s.get("sesgo_td")), "factor_viento": rd(s.get("factor_viento"), 3),
            "error_t": rd(s.get("error_t")), "error_t_corr": rd(s.get("error_t_corr")),
            "error_viento": rd(s.get("error_viento"), 1), "error_viento_corr": rd(s.get("error_viento_corr"), 1),
            "aplicado": bool(s.get("aplicado")), "calculado_en": ahora.isoformat(),
        })
    return salida, sesgos


def con_correccion(fila: dict) -> dict:
    """Fila con los valores corregidos en lugar de los originales (para el cálculo de niveles)."""
    if fila.get("t2m_corr") is None:
        return fila
    f = dict(fila)
    for k in ("t2m", "td2m", "hr", "viento10", "rafaga10"):
        if fila.get(f"{k}_corr") is not None:
            f[k] = fila[f"{k}_corr"]
    if fila.get("wbgt_corr") is not None:
        f["wbgt_est"] = fila["wbgt_corr"]
    return f
