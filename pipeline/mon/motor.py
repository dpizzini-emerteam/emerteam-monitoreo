"""Motor de reglas: serie horaria de consenso entre modelos, confianza y niveles por fase.

Niveles: 0 sin riesgo, 1 vigilancia/precaución, 2 advertencia/acción, 3 retiro/advertencia severa, 4 peligro/suspensión.
Las reglas citan su fuente en `regla` (ver reglas.REGLAS).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import ventanas as vt
from .reglas import nivel_calor_personal, nivel_lluvia, nivel_tormenta, nivel_viento, nivel_wbgt_wa

HORIZONTE_H = 144          # más allá del día 6 solo tendencia, sin niveles
PRIORIDAD = ["ecmwf", "gfs", "icon"]


def _hora(dt: str) -> datetime:
    return datetime.fromisoformat(dt).astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


VARIABLES = ("t2m", "td2m", "hr", "viento10", "rafaga10", "dir_viento", "cape", "radiacion", "presion", "wbgt_est", "precip")


def serie_consenso(pron: list[dict]) -> dict[datetime, dict]:
    """Serie horaria: valores de la fuente prioritaria disponible y dispersión entre fuentes."""
    por_fuente: dict[str, dict[datetime, dict]] = {}
    for p in pron:
        por_fuente.setdefault(p["fuente"], {})[_hora(p["valido"])] = p
    # interpola las fuentes trihorarias a horario
    for f, serie in por_fuente.items():
        horas = sorted(serie)
        for a, b in zip(horas, horas[1:]):
            paso = int((b - a).total_seconds() // 3600)
            for k in range(1, paso):
                t = a + timedelta(hours=k)
                w = k / paso
                fila = {}
                for c in ("t2m", "td2m", "hr", "viento10", "rafaga10", "cape", "radiacion", "presion", "wbgt_est"):
                    va, vb = serie[a].get(c), serie[b].get(c)
                    fila[c] = None if va is None or vb is None else float(va) + (float(vb) - float(va)) * w
                fila["precip"] = serie[b].get("precip")  # mm/h promedio del intervalo
                fila["fuente"] = f
                fila["interpolado"] = True
                serie[t] = fila
    horas = sorted({h for s in por_fuente.values() for h in s})
    salida = {}
    for h in horas:
        disponibles = [f for f in PRIORIDAD if h in por_fuente.get(f, {})]
        if not disponibles:
            continue
        base = dict(por_fuente[disponibles[0]][h])
        base["fuente_principal"] = disponibles[0]
        # Variable faltante en la fuente principal (p. ej. ráfaga ECMWF fuera de su alcance): siguiente fuente
        for c in VARIABLES:
            if base.get(c) is None:
                for f in disponibles[1:]:
                    if por_fuente[f][h].get(c) is not None:
                        base[c] = por_fuente[f][h][c]
                        base.setdefault("completado", []).append(f"{c}:{f}")
                        break
        wb = [float(por_fuente[f][h]["wbgt_est"]) for f in disponibles if por_fuente[f][h].get("wbgt_est") is not None]
        rf = [float(por_fuente[f][h]["rafaga10"]) for f in disponibles if por_fuente[f][h].get("rafaga10") is not None]
        base["disp_wbgt"] = (max(wb) - min(wb)) if len(wb) > 1 else None
        base["disp_rafaga"] = (max(rf) - min(rf)) if len(rf) > 1 else None
        base["n_fuentes"] = len(disponibles)
        salida[h] = base
    return salida


def confianza(fila: dict, horas_adelante: float) -> str:
    if fila.get("n_fuentes", 1) < 2:
        return "baja" if horas_adelante > 72 else "media"
    dw, dr = fila.get("disp_wbgt"), fila.get("disp_rafaga")
    peor = "alta"
    if (dw is not None and dw >= 2) or (dr is not None and dr >= 20):
        peor = "baja"
    elif (dw is not None and dw >= 1) or (dr is not None and dr >= 10):
        peor = "media"
    if horas_adelante > 96 and peor == "alta":
        peor = "media"
    return peor


def _en(t: datetime, rango: tuple[datetime, datetime]) -> bool:
    return rango[0] <= t < rango[1]


def niveles_evento(ev: dict, pron: list[dict], ahora: datetime) -> list[dict]:
    serie = serie_consenso(pron)
    v = vt.calcular(ev)
    crudos: list[tuple] = []  # (fase, variable, hora, nivel, valor, umbral, regla, confianza)
    acumulado: list[tuple[datetime, float]] = []
    for h in sorted(serie):
        fila = serie[h]
        adelante = (h - ahora).total_seconds() / 3600
        if adelante > HORIZONTE_H or h < ahora - timedelta(hours=1):
            if fila.get("precip") is not None:
                acumulado.append((h, float(fila["precip"])))
            continue
        conf = confianza(fila, adelante)
        if fila.get("precip") is not None:
            acumulado.append((h, float(fila["precip"])))
        lluvia72 = sum(p for t, p in acumulado if h - timedelta(hours=72) < t <= h)

        fases = []
        if _en(h, v.armado):
            fases.append("armado")
        if _en(h, v.exposicion):
            fases.append("carrera")
        if _en(h, v.personal):
            fases.append("personal")
        if _en(h, v.desarme):
            fases.append("desarme")
        for fase in fases:
            evaluaciones = []
            if fase == "carrera":
                evaluaciones.append(("wbgt", *nivel_wbgt_wa(fila.get("wbgt_est"))))
            if fase in ("armado", "personal", "desarme"):
                evaluaciones.append(("calor_personal", *nivel_calor_personal(fila.get("wbgt_est"))))
            for cat in ("A", "B", "C"):
                if fase == "personal" and cat == "A":
                    continue
                evaluaciones.append((f"viento_{cat}", *nivel_viento(cat, fila.get("rafaga10"))))
            evaluaciones.append(("tormenta", *nivel_tormenta(fila.get("cape"), fila.get("precip"))))
            evaluaciones.append(("lluvia", *nivel_lluvia(fila.get("precip"), lluvia72)))
            for variable, nivel, valor, umbral, regla in evaluaciones:
                if nivel is None:
                    continue
                crudos.append((fase, variable, h, nivel, valor, umbral, regla, conf))

    # Agrupa horas consecutivas con el mismo nivel en tramos
    filas: list[dict] = []
    crudos.sort(key=lambda x: (x[0], x[1], x[2]))
    actual = None
    for fase, variable, h, nivel, valor, umbral, regla, conf in crudos:
        if (actual and actual["fase"] == fase and actual["variable"] == variable
                and actual["nivel"] == nivel and actual["_fin"] == h and actual["regla"] == regla):
            actual["_fin"] = h + timedelta(hours=1)
            if valor is not None and (actual["valor"] is None or valor > actual["valor"]):
                actual["valor"] = valor
            if conf == "baja" or (conf == "media" and actual["confianza"] == "alta"):
                actual["confianza"] = conf
            continue
        if actual:
            filas.append(actual)
        actual = {"evento_id": ev["id"], "fase": fase, "variable": variable, "nivel": nivel,
                  "valor": valor, "umbral": umbral, "regla": regla, "confianza": conf,
                  "origen": "pronostico", "_ini": h, "_fin": h + timedelta(hours=1)}
    if actual:
        filas.append(actual)
    for f in filas:
        f["desde"] = f.pop("_ini").isoformat()
        f["hasta"] = f.pop("_fin").isoformat()
        if f["valor"] is not None:
            f["valor"] = round(float(f["valor"]), 2)
    return filas
