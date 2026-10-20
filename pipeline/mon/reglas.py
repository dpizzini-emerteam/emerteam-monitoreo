"""Umbrales operativos. Cada regla lleva su fuente y tipo (ver especificación, sección 5).

Tipos: NT (norma técnica o legislación), GI (guía de organismo internacional),
CC (consenso científico), EF (especificación de fabricante), CI (criterio interno EMERTEAM).
"""

from __future__ import annotations

REGLAS = {
    "wa2020_wbgt": {"tipo": "GI", "fuente": "World Athletics (2020). Competition Medical Guidelines, 2.ª ed., tabla 1."},
    "srt30_2023_tgbh": {"tipo": "NT", "fuente": "Res. SRT 30/2023 (valor límite de acción, no aclimatados)."},
    "emt_viento_A": {"tipo": "CI", "fuente": "Criterio interno EMERTEAM; retiro con base en HSE/HSENI (inflables, Beaufort 5)."},
    "emt_viento_B": {"tipo": "CI", "fuente": "Criterio interno EMERTEAM, con base en ANSI E1.21 (elementos retirables)."},
    "emt_viento_C": {"tipo": "CI", "fuente": "Criterio interno EMERTEAM."},
    "emt_tormenta_cape": {"tipo": "CI", "fuente": "Criterio interno EMERTEAM: potencial convectivo (CAPE) con precipitación."},
    "emt_lluvia_intensidad": {"tipo": "CI", "fuente": "Criterio interno EMERTEAM: intensidad > 20 mm/h."},
    "emt_suelo_saturado": {"tipo": "CI", "fuente": "Criterio interno EMERTEAM: acumulado ≥ 30 mm en 72 h."},
}

# Escala World Athletics (2020): <21, 21–25, 25–28, 28–30, >30 °C
WA_CORTES = [21.0, 25.0, 28.0, 30.0]

# Viento por categoría (ráfaga, km/h): vigilancia, reforzar, retirar, despejar/suspender
VIENTO = {
    "A": [25.0, 30.0, 38.0, 45.0],
    "B": [35.0, 40.0, 45.0, 55.0],
    "C": [35.0, 45.0, 55.0, 65.0],
}

# Personal (Res. SRT 30/2023, VLA no aclimatados): carga pesada 23,0 °C; moderada 25,0 °C
PERSONAL = [23.0, 25.0]


def _escalon(valor: float, cortes: list[float], inclusivo: bool = False) -> int:
    n = 0
    for c in cortes:
        if valor > c or (inclusivo and valor >= c):
            n += 1
    return n


def nivel_wbgt_wa(wbgt):
    if wbgt is None:
        return None, None, None, None
    n = _escalon(float(wbgt), WA_CORTES, inclusivo=True)
    umbral = WA_CORTES[n - 1] if n > 0 else None
    return n, float(wbgt), umbral, "wa2020_wbgt"


def nivel_calor_personal(wbgt):
    if wbgt is None:
        return None, None, None, None
    w = float(wbgt)
    n = 2 if w > PERSONAL[1] else (1 if w > PERSONAL[0] else 0)
    return n, w, (PERSONAL[n - 1] if n else None), "srt30_2023_tgbh"


def nivel_viento(cat: str, rafaga):
    if rafaga is None:
        return None, None, None, None
    cortes = VIENTO[cat]
    n = _escalon(float(rafaga), cortes, inclusivo=True)
    return n, float(rafaga), (cortes[n - 1] if n else None), f"emt_viento_{cat}"


def nivel_tormenta(cape, precip):
    if cape is None or precip is None:
        return None, None, None, None
    c, p = float(cape), float(precip)
    if c >= 2000 and p >= 5:
        n = 2
    elif c >= 1000 and p >= 1:
        n = 1
    else:
        n = 0
    return n, c, (2000.0 if n == 2 else 1000.0 if n == 1 else None), "emt_tormenta_cape"


def nivel_lluvia(precip, lluvia72):
    """Devuelve el mayor de intensidad (>20 mm/h → 2) y suelo saturado (≥30 mm/72 h → 1)."""
    if precip is None:
        return None, None, None, None
    p = float(precip)
    if p > 20:
        return 2, p, 20.0, "emt_lluvia_intensidad"
    if lluvia72 >= 30:
        return 1, round(lluvia72, 1), 30.0, "emt_suelo_saturado"
    return 0, p, None, "emt_lluvia_intensidad"
