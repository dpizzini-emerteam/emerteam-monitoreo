"""Motor de reglas: serie horaria de consenso entre modelos, confianza y niveles por fase.

Niveles: 0 sin riesgo, 1 vigilancia/precaución, 2 advertencia/acción, 3 retiro/advertencia severa, 4 peligro/suspensión.
Las reglas citan su fuente en `regla` (ver reglas.REGLAS).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import ventanas as vt
from .reglas import calor_participantes, nivel_calor_personal, nivel_lluvia, nivel_tormenta, nivel_viento

from .reglas import U

HORIZONTE_H = U["confianza"]["horizonte_niveles_h"]  # más allá: solo tendencia, sin niveles
PRIORIDAD = ["ecmwf", "gfs", "wrf_smn", "icon"]
# Combinación de modelos: promedio ponderado por la inversa del error cuadrático medido contra estaciones del
# SMN en la zona (después de corregir). Sin error medido para todas las fuentes, pesos iguales. τ evita que una
# fuente con pocos pares y error casualmente bajo se lleve todo el peso. Las variables de tormenta (CAPE,
# precipitación) y la dirección del viento siguen saliendo de la fuente prioritaria, para no mezclar criterios.
MEZCLA_T = ("t2m", "td2m", "hr", "wbgt_est", "presion", "radiacion")
MEZCLA_V = ("viento10",)
TAU = {"t": 0.25, "v": 4.0}  # °C² y (km/h)²


def _hora(dt: str) -> datetime:
    return datetime.fromisoformat(dt).astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


VARIABLES = ("t2m", "td2m", "hr", "viento10", "rafaga10", "dir_viento", "cape", "radiacion", "presion", "wbgt_est", "precip")


def pesos_fuentes(sesgos: list[dict] | None) -> dict[str, dict[str, float]]:
    """{fuente: {'t': ecm, 'v': ecm}} con el error cuadrático medio después de corregir (solo si se aplicó)."""
    out: dict[str, dict[str, float]] = {}
    for s in sesgos or []:
        if not s.get("aplicado"):
            continue
        d = {}
        if s.get("rmse_t_corr") is not None:
            d["t"] = float(s["rmse_t_corr"]) ** 2
        if s.get("rmse_viento_corr") is not None:
            d["v"] = float(s["rmse_viento_corr"]) ** 2
        out[s["fuente"]] = d
    return out


def _pesos(disponibles: list[str], ecm: dict[str, dict[str, float]], fam: str) -> dict[str, float]:
    if disponibles and all(fam in ecm.get(f, {}) for f in disponibles):
        return {f: 1.0 / (ecm[f][fam] + TAU[fam]) for f in disponibles}
    return {f: 1.0 for f in disponibles}


def _media_pond(vals: list[tuple[float, float]]) -> float | None:
    w = sum(p for _, p in vals)
    return sum(v * p for v, p in vals) / w if w > 0 else None


def _mediana(vals: list[float]) -> float | None:
    v = sorted(vals)
    if not v:
        return None
    m = len(v) // 2
    return v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2


# Verificación fuera de muestra por plazo de anticipación (mon_verif_modelos): errores de cada modelo contra
# las estaciones del SMN, agrupados por plazo. Cuando todas las fuentes de una hora tienen muestra suficiente
# en su plazo, el peso usa el desvío del error (lo que queda después de corregir el sesgo medio) en lugar del
# error de las últimas 72 h. Ver config/umbrales.json → verificacion.
PLAZOS = [int(x) for x in U["verificacion"]["plazos_h"]]
MIN_PARES_VERIF = int(U["verificacion"]["min_pares"])


def plazo(horas: float) -> str:
    """Tramo de anticipación ("0-24", "24-48", …) al que pertenece un plazo en horas."""
    for a, b in zip(PLAZOS, PLAZOS[1:]):
        if horas < b:
            return f"{a}-{b}"
    return f"{PLAZOS[-2]}-{PLAZOS[-1]}"


def verif_por_plazo(filas: list[dict] | None) -> dict[tuple[str, str, str], float]:
    """{(fuente, plazo, 't'|'v'): ecm} con el cuadrado del desvío del error, solo con muestra suficiente."""
    out = {}
    for f in filas or []:
        if f.get("n") is None or int(f["n"]) < MIN_PARES_VERIF or f.get("desvio") is None:
            continue
        fam = "t" if f["variable"] == "temp" else "v" if f["variable"] == "viento" else None
        if fam:
            out[(f["fuente"], f["plazo"], fam)] = float(f["desvio"]) ** 2
    return out


def serie_consenso(pron: list[dict], ecm: dict[str, dict[str, float]] | None = None,
                   verif: dict[tuple[str, str, str], float] | None = None,
                   ens_rafaga: dict[datetime, float] | None = None) -> dict[datetime, dict]:
    """Serie horaria: promedio ponderado de las fuentes disponibles (ver MEZCLA_*), variables de tormenta y
    dirección de la fuente prioritaria, y dispersión entre fuentes.

    Lluvia y ráfaga: con tres valores o más por hora se toma la mediana (resiste al modelo que se aparta, como
    la lluvia débil y persistente de GFS), sumando a la ráfaga la mediana del ensamble ECMWF + GEFS cuando existe."""
    ecm = ecm or {}
    verif = verif or {}
    ens_rafaga = ens_rafaga or {}
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
                fila["corrida"] = serie[a].get("corrida")
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
        # Otra variable faltante en la fuente principal: siguiente fuente
        for c in VARIABLES:
            if base.get(c) is None:
                for f in disponibles[1:]:
                    if por_fuente[f][h].get(c) is not None:
                        base[c] = por_fuente[f][h][c]
                        base.setdefault("completado", []).append(f"{c}:{f}")
                        break
        if len(disponibles) > 1:
            pt, pv = _pesos(disponibles, ecm, "t"), _pesos(disponibles, ecm, "v")
            # Pesos por plazo de anticipación verificados fuera de muestra, si todas las fuentes los tienen
            plazos = {f: plazo((h - _hora(por_fuente[f][h]["corrida"])).total_seconds() / 3600)
                      for f in disponibles if por_fuente[f][h].get("corrida")}
            for fam in ("t", "v"):
                e = {f: verif.get((f, plazos.get(f, ""), fam)) for f in disponibles}
                if all(x is not None for x in e.values()):
                    w = {f: 1.0 / (e[f] + TAU[fam]) for f in disponibles}
                    if fam == "t":
                        pt = w
                    else:
                        pv = w
                    base["pesos_por_plazo"] = True
            for c in MEZCLA_T + MEZCLA_V:
                pp = pv if c in MEZCLA_V else pt
                vals = [(float(por_fuente[f][h][c]), pp[f]) for f in disponibles if por_fuente[f][h].get(c) is not None]
                if len(vals) > 1:
                    base[c] = _media_pond(vals)
            # Ráfaga: promedio ponderado de las fuentes que la publican, llevado al viento medio combinado con el
            # factor de ráfaga de esas mismas fuentes (no mezcla el viento de un modelo con la ráfaga de otro)
            con = [f for f in disponibles if por_fuente[f][h].get("rafaga10") is not None and por_fuente[f][h].get("viento10") is not None]
            if con:
                r = _media_pond([(float(por_fuente[f][h]["rafaga10"]), pv[f]) for f in con])
                vm = _media_pond([(float(por_fuente[f][h]["viento10"]), pv[f]) for f in con])
                if base.get("viento10") is not None and vm and vm >= 5:
                    r = float(base["viento10"]) * min(2.5, max(1.2, r / vm))
                # Con tres valores o más (modelos y mediana del ensamble), la mediana
                candidatas = [float(por_fuente[f][h]["rafaga10"]) for f in con]
                if h in ens_rafaga:
                    candidatas.append(float(ens_rafaga[h]))
                if len(candidatas) >= 3:
                    r = _mediana(candidatas)
                    base["rafaga_mediana"] = len(candidatas)
                base["rafaga10"] = round(r, 1)
            lluvias = [float(por_fuente[f][h]["precip"]) for f in disponibles if por_fuente[f][h].get("precip") is not None]
            if len(lluvias) >= 3:
                base["precip"] = round(_mediana(lluvias), 2)
                base["precip_mediana"] = len(lluvias)
            base["fuente_principal"] = "mezcla"
            base["pesos"] = {f: round(pt[f] / sum(pt.values()), 2) for f in disponibles}
        # Ráfaga faltante en todas las fuentes que tienen la hora: no hay de dónde estimarla
        if base.get("rafaga10") is None and base.get("viento10") is not None:
            base.setdefault("completado", []).append("rafaga10:sin_dato")
        wb = [float(por_fuente[f][h]["wbgt_est"]) for f in disponibles if por_fuente[f][h].get("wbgt_est") is not None]
        rf = [float(por_fuente[f][h]["rafaga10"]) for f in disponibles if por_fuente[f][h].get("rafaga10") is not None]
        base["disp_wbgt"] = (max(wb) - min(wb)) if len(wb) > 1 else None
        base["disp_rafaga"] = (max(rf) - min(rf)) if len(rf) > 1 else None
        vv = [float(por_fuente[f][h]["viento10"]) for f in disponibles if por_fuente[f][h].get("viento10") is not None]
        base["disp_viento"] = (max(vv) - min(vv)) if len(vv) > 1 else None
        base["n_fuentes"] = len(disponibles)
        salida[h] = base
    return salida


def confianza(fila: dict, horas_adelante: float) -> str:
    c = U["confianza"]
    if fila.get("n_fuentes", 1) < 2:
        return "baja" if horas_adelante > c["un_modelo_baja_h"] else "media"
    dw, dr, dv = fila.get("disp_wbgt"), fila.get("disp_rafaga"), fila.get("disp_viento")
    peor = "alta"
    if (dw is not None and dw >= c["wbgt"][1]) or (dr is not None and dr >= c["rafaga"][1]) or (dv is not None and dv >= c["viento"][1]):
        peor = "baja"
    elif (dw is not None and dw >= c["wbgt"][0]) or (dr is not None and dr >= c["rafaga"][0]) or (dv is not None and dv >= c["viento"][0]):
        peor = "media"
    if horas_adelante > c["alta_hasta_h"] and peor == "alta":
        peor = "media"
    return peor


def _en(t: datetime, rango: tuple[datetime, datetime]) -> bool:
    return rango[0] <= t < rango[1]


def niveles_evento(ev: dict, pron: list[dict], ahora: datetime, ecm: dict[str, dict[str, float]] | None = None,
                   verif: dict | None = None, ens_rafaga: dict | None = None, serie: dict | None = None) -> list[dict]:
    serie = serie if serie is not None else serie_consenso(pron, ecm, verif, ens_rafaga)
    v = vt.calcular(ev)
    var_calor, nivel_calor = calor_participantes(ev.get("disciplina"))
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
                evaluaciones.append((var_calor, *nivel_calor(fila.get("wbgt_est"))))
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
