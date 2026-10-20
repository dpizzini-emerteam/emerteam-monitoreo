"""Cálculos físicos: geometría solar, fracción directa y WBGT (Liljegren)."""

from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np
import thermofeel

S0 = 1361.0  # constante solar [W/m2]


def cos_cenit(lat: float, lon: float, t: datetime) -> float:
    """Coseno del ángulo cenital solar (algoritmo NOAA simplificado)."""
    t = t.astimezone(timezone.utc)
    doy = t.timetuple().tm_yday
    hora = t.hour + t.minute / 60 + t.second / 3600
    g = 2 * math.pi / 365 * (doy - 1 + (hora - 12) / 24)
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g)
            - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g)
            - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                    - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    tst = hora * 60 + eqt + 4 * lon
    ha = math.radians(tst / 4 - 180)
    phi = math.radians(lat)
    c = math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.cos(ha)
    return max(c, 0.0)


def fraccion_directa(ssrd: float, cossza: float, t: datetime) -> float:
    """Fracción directa de la radiación global por el modelo de Erbs et al. (1982)."""
    if ssrd <= 0 or cossza <= 0.02:
        return 0.0
    doy = t.timetuple().tm_yday
    e0 = 1 + 0.033 * math.cos(2 * math.pi * doy / 365)
    kt = min(ssrd / (S0 * e0 * cossza), 1.0)
    if kt <= 0.22:
        kd = 1 - 0.09 * kt
    elif kt <= 0.80:
        kd = 0.9511 - 0.1604 * kt + 4.388 * kt**2 - 16.638 * kt**3 + 12.336 * kt**4
    else:
        kd = 0.165
    return float(min(max(1 - kd, 0.0), 0.9))


def hr_desde_rocio(t_c: float, td_c: float) -> float:
    """Humedad relativa [%] desde temperatura y punto de rocío [°C] (Magnus)."""
    a, b = 17.625, 243.04
    hr = 100 * math.exp(a * td_c / (b + td_c)) / math.exp(a * t_c / (b + t_c))
    return float(min(max(hr, 1.0), 100.0))


def wbgt_liljegren(t_c: float, hr: float, presion_hpa: float, viento_ms: float,
                   ssrd: float, lat: float, lon: float, t: datetime) -> float | None:
    """WBGT estimado [°C] por el método de Liljegren et al. (2008), vía thermofeel (ECMWF)."""
    vals = (t_c, hr, presion_hpa, viento_ms, ssrd)
    if any(v is None or (isinstance(v, float) and math.isnan(v)) for v in vals):
        return None
    cz = cos_cenit(lat, lon, t)
    fd = fraccion_directa(ssrd, cz, t)
    w = thermofeel.calculate_wbgt_liljegren(
        np.array([t_c + 273.15]), np.array([hr]), np.array([presion_hpa]),
        np.array([max(viento_ms, 0.0)]), np.array([max(ssrd, 0.0)]),
        np.array([fd]), np.array([cz]),
    )
    v = float(w[0]) - 273.15
    return None if math.isnan(v) else round(v, 2)
