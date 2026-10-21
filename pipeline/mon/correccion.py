"""Corrección de sesgo con observaciones del SMN y verificación del pronóstico.

Para cada evento se toman hasta dos estaciones del SMN a 60 km o menos y se compara, para cada modelo, el
pronóstico guardado de las últimas 72 h con lo observado a la misma hora (tiempo presente cada hora y
registro horario oficial del día anterior). Con eso:

* Temperatura: sesgo medio ponderado (los pares más recientes pesan más, vida media 36 h), separado en
  horas de día (10 a 19 h) y de noche, porque el error típico de un punto costero o urbano no es el mismo.
* Punto de rocío: sesgo medio ponderado (la humedad relativa se recalcula con T y Td corregidas).
* Viento: factor de escala observado/pronosticado (también se aplica a la ráfaga).
* WBGT: se recalcula por Liljegren con los valores corregidos.

Es una corrección por promedio móvil del sesgo (decaying average bias; Cui et al., 2012), la forma más
simple de post-procesamiento estadístico. Con dos estaciones, el sesgo de cada una se pondera por la
inversa de la distancia. Como el error de un modelo global (celdas de ~25 km) está correlacionado en esa
escala pero no más allá, la corrección se atenúa con la distancia: completa hasta 25 km y lineal hasta la
mitad a 60 km (criterio interno EMERTEAM). Requiere al menos 12 pares por estación; si no los hay solo se
informa el error medido y no se corrige. Los valores originales del modelo no se modifican: los corregidos
se guardan aparte (columnas *_corr).
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta

from .calculo import hr_desde_rocio, wbgt_liljegren

VENTANA_H = 72
VIDA_MEDIA_H = 36
MIN_PARES = 12
MIN_PARES_FRANJA = 6
DIST_MAX_KM = 60
DIST_PLENA_KM = 25
ATEN_MIN = 0.5
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


def atenuacion(km: float | None) -> float:
    """Fracción del sesgo que se aplica según la distancia estación-evento."""
    if km is None or km <= DIST_PLENA_KM:
        return 1.0
    if km >= DIST_MAX_KM:
        return ATEN_MIN
    return 1.0 - (1.0 - ATEN_MIN) * (km - DIST_PLENA_KM) / (DIST_MAX_KM - DIST_PLENA_KM)


def _pares(filas_fuente: list[dict], obs: dict[datetime, dict], ahora: datetime) -> list[dict]:
    """Pares pronóstico-observación de las últimas VENTANA_H horas."""
    out = []
    for f in filas_fuente:
        t = _dt(f["valido"])
        edad = (ahora - t).total_seconds() / 3600
        if edad <= 0 or edad > VENTANA_H:
            continue
        o = obs.get(t)
        if not o:
            continue
        ot = _f(o.get("temp"))
        out.append({"t": t, "peso": 0.5 ** (edad / VIDA_MEDIA_H), "mt": _f(f.get("t2m")), "ot": ot,
                    "mtd": _f(f.get("td2m")), "otd": rocio(ot, _f(o.get("hr"))) if ot is not None else None,
                    "mv": _f(f.get("viento10")), "ov": _f(o.get("viento"))})
    return out


def _sesgos_estacion(pares: list[dict]) -> dict:
    """Sesgo de temperatura (día/noche), de rocío y factor de viento contra una estación."""
    dif_t = [(p["mt"] - p["ot"], p["peso"], p["t"]) for p in pares if p["mt"] is not None and p["ot"] is not None]
    res: dict = {"pares": len(dif_t)}
    if len(dif_t) < MIN_PARES:
        return res
    total = _media([(d, w) for d, w, _ in dif_t])
    dia = [(d, w) for d, w, t in dif_t if _de_dia(t)]
    noche = [(d, w) for d, w, t in dif_t if not _de_dia(t)]
    dif_td = [(p["mtd"] - p["otd"], p["peso"]) for p in pares if p["mtd"] is not None and p["otd"] is not None]
    vm = sum(p["mv"] * p["peso"] for p in pares if p["mv"] is not None and p["ov"] is not None and p["mv"] >= 3)
    vo = sum(p["ov"] * p["peso"] for p in pares if p["mv"] is not None and p["ov"] is not None and p["mv"] >= 3)
    n_v = sum(1 for p in pares if p["mv"] is not None and p["ov"] is not None)
    res.update({
        "sesgo_t_dia": _media(dia) if len(dia) >= MIN_PARES_FRANJA else total,
        "sesgo_t_noche": _media(noche) if len(noche) >= MIN_PARES_FRANJA else total,
        "sesgo_td": _media(dif_td) if len(dif_td) >= MIN_PARES else None,
        "factor_viento": vo / vm if vm > 0 and n_v >= MIN_PARES else None,
    })
    return res


def calcular(filas_fuente: list[dict], obs_por_est: list[tuple[dict, dict[datetime, dict]]], ahora: datetime) -> dict:
    """Sesgos combinados de una fuente para un evento.

    obs_por_est: [(estación con 'km', {hora: observación})]. Devuelve los sesgos que se aplican (ya combinados
    y atenuados), el error medido antes y después de corregir y el detalle por estación.
    """
    clamp = lambda x, lim: None if x is None else max(-lim, min(lim, x))  # noqa: E731
    detalle, validas, todos = [], [], []
    for est, obs in obs_por_est:
        km = _f(est.get("km"))
        pares = _pares(filas_fuente, obs, ahora)
        s = _sesgos_estacion(pares)
        detalle.append({"estacion": est.get("nombre"), "km": km, "pares": s["pares"],
                        "sesgo_t_dia": s.get("sesgo_t_dia"), "sesgo_t_noche": s.get("sesgo_t_noche")})
        todos.append(pares)
        if s["pares"] >= MIN_PARES and (km is None or km <= DIST_MAX_KM):
            validas.append((max(km or 0.0, 5.0), s))
    res: dict = {"pares": max((d["pares"] for d in detalle), default=0), "aplicado": False, "detalle": detalle}
    if not validas:
        # Error sin corregir de la estación más cercana, para informar
        if todos and todos[0]:
            e = [abs(p["mt"] - p["ot"]) for p in todos[0] if p["mt"] is not None and p["ot"] is not None]
            res["error_t"] = sum(e) / len(e) if e else None
        return res
    wsum = sum(1 / km for km, _ in validas)
    km_ef = len(validas) / wsum  # media armónica: la estación cercana domina
    k = atenuacion(km_ef)

    def comb(clave: str) -> float | None:
        vals = [(s[clave], 1 / km) for km, s in validas if s.get(clave) is not None]
        return _media(vals) if vals else None

    fv = comb("factor_viento")
    res.update({
        "sesgo_t_dia": clamp(k * comb("sesgo_t_dia"), LIM_T),
        "sesgo_t_noche": clamp(k * comb("sesgo_t_noche"), LIM_T),
        "sesgo_td": clamp(k * comb("sesgo_td"), LIM_TD) if comb("sesgo_td") is not None else None,
        "factor_viento": max(FACTOR_VIENTO[0], min(FACTOR_VIENTO[1], 1 + k * (fv - 1))) if fv is not None else None,
        "distancia_km": km_ef, "atenuacion": k, "aplicado": True,
    })
    # Error antes y después de corregir, sobre todos los pares de las estaciones usadas
    et, ec, ev, evc = [], [], [], []
    fvv = res["factor_viento"] or 1.0
    for pares in todos:
        for p in pares:
            if p["mt"] is not None and p["ot"] is not None:
                d = p["mt"] - p["ot"]
                et.append(abs(d))
                ec.append(abs(d - (res["sesgo_t_dia"] if _de_dia(p["t"]) else res["sesgo_t_noche"])))
            if p["mv"] is not None and p["ov"] is not None:
                ev.append(abs(p["mv"] - p["ov"]))
                evc.append(abs(p["mv"] * fvv - p["ov"]))
    if et:
        res["error_t"], res["error_t_corr"] = sum(et) / len(et), sum(ec) / len(ec)
        res["rmse_t_corr"] = math.sqrt(sum(x * x for x in ec) / len(ec))
    if ev:
        res["error_viento"], res["error_viento_corr"] = sum(ev) / len(ev), sum(evc) / len(evc)
        res["rmse_viento_corr"] = math.sqrt(sum(x * x for x in evc) / len(evc))
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


def aplicar(ev: dict, filas: list[dict], estaciones: list[dict], observaciones: dict[str, list[dict]],
            ahora: datetime) -> tuple[list[dict], list[dict]]:
    """Devuelve (filas con columnas *_corr, sesgos por fuente). estaciones: [{nombre, lat, lon, km}]."""
    obs_por_est = [(e, {_dt(o["valido"]): o for o in observaciones.get(e["nombre"], [])}) for e in estaciones]
    lat, lon = float(ev["lat"]), float(ev["lon"])
    salida, sesgos = [], []
    rd = lambda x, n=2: None if x is None else round(float(x), n)  # noqa: E731
    cercana = estaciones[0] if estaciones else None
    for fuente in sorted({f["fuente"] for f in filas}):
        propias = [f for f in filas if f["fuente"] == fuente]
        s = calcular(propias, obs_por_est, ahora) if estaciones else {"pares": 0, "aplicado": False, "detalle": []}
        for f in propias:
            salida.append({**f, **corregir_fila(f, s, lat, lon)})
        usadas = [d for d in s.get("detalle", []) if d["pares"] >= MIN_PARES] or s.get("detalle", [])[:1]
        sesgos.append({
            "evento_id": ev["id"], "fuente": fuente,
            "estacion": " + ".join(d["estacion"] for d in usadas) if usadas else (cercana or {}).get("nombre"),
            "estacion_lat": rd(cercana.get("lat"), 4) if cercana else None,
            "estacion_lon": rd(cercana.get("lon"), 4) if cercana else None,
            "distancia_km": rd(s.get("distancia_km", _f(cercana.get("km")) if cercana else None), 1),
            "pares": s.get("pares", 0),
            "sesgo_t_dia": rd(s.get("sesgo_t_dia")), "sesgo_t_noche": rd(s.get("sesgo_t_noche")),
            "sesgo_td": rd(s.get("sesgo_td")), "factor_viento": rd(s.get("factor_viento"), 3),
            "error_t": rd(s.get("error_t")), "error_t_corr": rd(s.get("error_t_corr")),
            "error_viento": rd(s.get("error_viento"), 1), "error_viento_corr": rd(s.get("error_viento_corr"), 1),
            "rmse_t_corr": rd(s.get("rmse_t_corr")), "rmse_viento_corr": rd(s.get("rmse_viento_corr"), 1),
            "atenuacion": rd(s.get("atenuacion"), 2),
            "estaciones": [{**d, "km": rd(d["km"], 1), "sesgo_t_dia": rd(d["sesgo_t_dia"]), "sesgo_t_noche": rd(d["sesgo_t_noche"])}
                           for d in s.get("detalle", [])],
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
