"""Umbrales operativos. Cada regla lleva su fuente y tipo (ver especificación, sección 5).

Tipos: NT (norma técnica o legislación), GI (guía de organismo internacional),
CC (consenso científico), EF (especificación de fabricante), CI (criterio interno EMERTEAM).
"""

from __future__ import annotations

import json
from pathlib import Path

# Fuente única de umbrales, compartida con la web (guía): config/umbrales.json
U = json.loads((Path(__file__).resolve().parents[2] / "config" / "umbrales.json").read_text(encoding="utf-8"))

REGLAS = {
    "wa2020_wbgt": {"tipo": "GI", "fuente": "World Athletics (2020). Competition Medical Guidelines, 2.ª ed., tabla 1."},
    "srt30_2023_tgbh": {"tipo": "NT", "fuente": "Res. SRT 30/2023 (valor límite de acción, no aclimatados)."},
    "emt_wbgt_viento_min": {"tipo": "CI", "fuente": "Criterio interno EMERTEAM: piso de viento de 1,3 m/s a 10 m (~1 m/s a 2 m) en el WBGT estimado; base: Kjellstrom et al., ClimateCHIP (1 m/s por movimiento de las personas en actividad)."},
    "emt_viento_A": {"tipo": "CI", "fuente": "Criterio interno EMERTEAM; retiro con base en HSE/HSENI (inflables, Beaufort 5)."},
    "emt_viento_B": {"tipo": "CI", "fuente": "Criterio interno EMERTEAM, con base en ANSI E1.21 (elementos retirables)."},
    "emt_viento_C": {"tipo": "CI", "fuente": "Criterio interno EMERTEAM."},
    "emt_tormenta_cape": {"tipo": "CI", "fuente": "Criterio interno EMERTEAM: potencial convectivo (CAPE) con precipitación."},
    "emt_lluvia_intensidad": {"tipo": "CI", "fuente": "Criterio interno EMERTEAM: intensidad > 20 mm/h."},
    "emt_suelo_saturado": {"tipo": "CI", "fuente": "Criterio interno EMERTEAM: acumulado ≥ 30 mm en 72 h."},
    "wt_wbgt": {"tipo": "GI", "fuente": "World Triathlon Competition Rules, regla 10.3 (banderas WBGT); James et al. (2025), Sports Med 55:1515-1526."},
    "uci_wbgt": {"tipo": "GI", "fuente": "UCI Cycling Regulations, Parte 2, Anexo C: Protocolo de Alta Temperatura (2024)."},
}

# Escala World Athletics (2020): <21, 21–25, 25–28, 28–30, >30 °C
WA_CORTES = [float(x) for x in U["wbgt_wa"]["cortes"]]

# Viento por categoría (ráfaga, km/h): vigilancia, reforzar, retirar, despejar/suspender
VIENTO = {k: [float(x) for x in U["viento"][k]] for k in ("A", "B", "C")}

# Personal (Res. SRT 30/2023, VLA no aclimatados): carga pesada 23,0 °C; moderada 25,0 °C
PERSONAL = [float(U["calor_personal"]["pesada"]), float(U["calor_personal"]["moderada"])]


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


# World Triathlon: verde < 25,7 · azul 25,7–27,8 · naranja 27,9–30,0 · roja 30,1–32,2 · negra > 32,2 °C
WT = U["wbgt_wt"]
# UCI Anexo C: blanca < 15 · verde 15–17,9 · amarilla 18–22,9 · naranja 23–27,9 · roja ≥ 28 °C
UCI_CORTES = [float(x) for x in U["wbgt_uci"]["cortes"]]


def nivel_wbgt_wt(wbgt):
    if wbgt is None:
        return None, None, None, None
    w = float(wbgt)
    c = [float(x) for x in WT["cortes"]]
    n = 4 if w > float(WT["negra_mayor_que"]) else _escalon(w, c, inclusivo=True)
    umbral = float(WT["negra_mayor_que"]) if n == 4 else (c[n - 1] if n else None)
    return n, w, umbral, "wt_wbgt"


def nivel_wbgt_uci(wbgt):
    if wbgt is None:
        return None, None, None, None
    w = float(wbgt)
    n = _escalon(w, UCI_CORTES, inclusivo=True)
    return n, w, (UCI_CORTES[n - 1] if n else None), "uci_wbgt"


def calor_participantes(disciplina: str | None):
    """Variable y función de la escala de calor de la disciplina (running y sin dato: World Athletics)."""
    escala = (U.get("disciplinas", {}).get(disciplina or "running") or {}).get("calor", "wbgt")
    return {"wbgt_wt": ("wbgt_wt", nivel_wbgt_wt), "wbgt_uci": ("wbgt_uci", nivel_wbgt_uci)}.get(escala, ("wbgt", nivel_wbgt_wa))


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
    t = U["tormenta"]
    if c >= t["probable"]["cape"] and p >= t["probable"]["precip"]:
        n = 2
    elif c >= t["posible"]["cape"] and p >= t["posible"]["precip"]:
        n = 1
    else:
        n = 0
    return n, c, (float(t["probable"]["cape"]) if n == 2 else float(t["posible"]["cape"]) if n == 1 else None), "emt_tormenta_cape"


def nivel_lluvia(precip, lluvia72):
    """Devuelve el mayor de intensidad (>20 mm/h → 2) y suelo saturado (≥30 mm/72 h → 1)."""
    if precip is None:
        return None, None, None, None
    p = float(precip)
    ll = U["lluvia"]
    if p > ll["intensa_mm_h"]:
        return 2, p, float(ll["intensa_mm_h"]), "emt_lluvia_intensidad"
    if lluvia72 >= ll["suelo_saturado_mm"]:
        return 1, round(lluvia72, 1), float(ll["suelo_saturado_mm"]), "emt_suelo_saturado"
    return 0, p, None, "emt_lluvia_intensidad"
