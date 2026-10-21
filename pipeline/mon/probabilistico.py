"""Pronóstico probabilístico por umbral a partir de ensambles (ECMWF ENS open data y NOAA GEFS).

Para cada evento, ventana operativa y umbral de la escala correspondiente, calcula la probabilidad de
alcanzar el nivel como la fracción de miembros cuyo máximo en la ventana lo alcanza. La mezcla
multimodelo se pondera por modelo (50 % ECMWF, 50 % GEFS), no por miembro.

Cada miembro pasa por la misma cadena que el pronóstico determinístico:
* punto de grilla de tierra más cercano (máscara tierra/mar de ECMWF; GEFS usa el mismo punto, misma grilla 0,25°);
* interpolación a paso horario: lineal para T, Td, HR, viento, presión y CAPE; la radiación media de cada
  intervalo de 3 h se reparte hora a hora según el coseno del ángulo cenital (no linealmente);
* WBGT por Liljegren (thermofeel, Apache 2.0): fracción directa por Erbs y viento de 10 m llevado a 2 m
  dentro de thermofeel (perfil de Liljegren), por eso aquí no se escala el viento;
* corrección de sesgo del determinístico de la misma fuente (ECMWF → ENS, GFS → GEFS), igual para todos los
  miembros: desplaza la distribución pero no corrige su dispersión (los ensambles suelen ser subdispersivos
  en superficie; las probabilidades cercanas a 0 % y 100 % se leen con cautela).

Limitaciones que se guardan con cada probabilidad (columna `aproximacion`):
* lluvia: con paso de 3 h no hay intensidad horaria; se usa P(acumulado en 3 h ≥ 20 mm), que es cota
  superior de P(alguna hora ≥ 20 mm/h);
* tormenta: CAPE con precipitación del intervalo (proxy); a más de 48 h se lee como tendencia;
* ráfaga ECMWF hasta +90 h: máximo de la última hora del intervalo (desde +93 h, máximo de 3 h).

Ejecución: python -m mon.probabilistico [--forzar]
"""

from __future__ import annotations

import argparse
import logging
import math
import os
import re
import sys
import tempfile
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import eccodes

from . import grib, ventanas
from .calculo import cos_cenit, hr_desde_rocio, wbgt_liljegren
from .ensambles import (HILOS, Campo, bajar_bytes, ecmwf_campos, ecmwf_indice, ecmwf_ultima, ecmwf_url,
                        gefs_campos, gefs_ultima)
from .reglas import U, VIENTO, calor_participantes, nivel_tormenta, nivel_viento

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("mon.probabilistico")

PASO = 3
HORIZONTE = 144          # h: ECMWF ENS publica pasos de 3 h hasta +144 h
PESOS = {"ecmwf": 0.5, "gefs": 0.5}
FUENTE_SESGO = {"ecmwf": "ecmwf", "gefs": "gfs"}
LLUVIA_MM = float(U["lluvia"]["intensa_mm_h"])
CONTEXTO_H = 3           # horas de contexto a cada lado de la exposición en la curva horaria

APROX_LLUVIA = (f"Proxy: probabilidad de acumular {LLUVIA_MM:g} mm o más en 3 h. Es cota superior de la probabilidad "
                f"de superar {LLUVIA_MM:g} mm/h en alguna hora (el ensamble tiene paso de 3 h).")
APROX_TORMENTA = "Proxy: CAPE con precipitación en el intervalo de 3 h. A más de 48 h se lee como tendencia, no como probabilidad firme."
APROX_RAFAGA_ECMWF = "ECMWF publica hasta +90 h la ráfaga máxima de la última hora de cada intervalo de 3 h: puede subestimar el máximo."

INSTANTANEOS = ("2t", "2d", "2r", "10u", "10v", "sp", "cape")
P_CALOR = {"2t", "2d", "2r", "10u", "10v", "sp", "ssrd"}
P_RESTO = {"10u", "10v", "10fg", "cape", "tp"}


# ---------------------------------------------------------------- ventanas

@dataclass
class Ventana:
    nombre: str
    ini: datetime
    fin: datetime
    variables: set   # calor | viento | tormenta | lluvia


def _hora(t: datetime) -> datetime:
    return t.replace(minute=0, second=0, microsecond=0)


def horas_de(ini: datetime, fin: datetime) -> list[datetime]:
    """Horas enteras cuyo intervalo [h, h+1) toca la ventana."""
    h, salida = _hora(ini), []
    while h < fin:
        salida.append(h)
        h += timedelta(hours=1)
    return salida


def ventanas_evento(ev: dict, ahora: datetime) -> list[Ventana]:
    v = ventanas.calcular(ev)
    w = U["ventanas"]
    lista = [
        Ventana("carrera", *v.exposicion, {"calor", "viento", "tormenta", "lluvia"}),
        Ventana("armado", *v.armado, {"viento", "tormenta", "lluvia"}),
        Ventana("desarme", *v.desarme, {"viento", "tormenta", "lluvia"}),
    ]
    # Último cuarto de cada modalidad, con la duración estimada que usa la plataforma
    mods = ev.get("mon_modalidades") or []
    if ev.get("duracion_propia_min") or not mods:
        lista.append(Ventana("ultimo_cuarto", v.inicio_ultimo_cuarto, v.fin_carrera, {"calor"}))
    else:
        demora = ev.get("demora_largada_min")
        if demora is None:
            demora = (ev.get("participantes") or 0) / 1000.0 * w["demora_cada_1000"]
        for m in mods:
            ini = datetime.fromisoformat(m["largada"]).astimezone(timezone.utc) if m.get("largada") else v.largada
            dur = ventanas.duracion_estimada_min(float(m["distancia_km"]))
            a = ini + timedelta(minutes=demora + w["ultimo_cuarto"] * dur)
            b = ini + timedelta(minutes=demora + dur)
            lista.append(Ventana(f"ultimo_cuarto:{m.get('nombre') or m['distancia_km']}", a, b, {"calor"}))
    return [x for x in lista if x.fin > ahora]


# ---------------------------------------------------------------- descarga

def _intervalo(corrida: datetime, h: datetime) -> tuple[int, int, float] | None:
    """Paso inicial y final del intervalo de 3 h que contiene la hora, y peso lineal dentro del intervalo."""
    o = (h - corrida).total_seconds() / 3600
    if o <= 0:
        return None
    b = int(math.ceil(o / PASO) * PASO)
    a = b - PASO
    if b > HORIZONTE:
        return None
    return a, b, (o - a) / PASO


def _pasos_y_params(corrida: datetime, horas_calor: set, horas_resto: set) -> dict[int, set]:
    pedidos: dict[int, set] = {}
    for conjunto, params in ((horas_calor, P_CALOR | P_RESTO), (horas_resto, P_RESTO)):
        for h in conjunto:
            it = _intervalo(corrida, h)
            if not it:
                continue
            a, b, _ = it
            for p in (a, b):
                pedidos.setdefault(p, set()).update(params)
            # acumulados y promedios: el paso previo para desacumular (ECMWF) o cerrar el balde (GEFS)
            pedidos.setdefault(a, set()).update({"ssrd", "tp"} & params)
    return pedidos


def _extraer(campos: list[Campo], puntos: dict[str, tuple[float, float]], indices: dict) -> dict:
    """Descarga en hilos (solo red) y lee en el hilo principal (eccodes no es seguro entre hilos)."""
    valores: dict = {}
    with ThreadPoolExecutor(HILOS) as ex:
        for c, datos in zip(campos, ex.map(bajar_bytes, campos)):
            if datos is None:
                continue
            gid = eccodes.codes_new_from_message(datos)
            try:
                clave = (c.modelo, eccodes.codes_get(gid, "numberOfDataPoints"))
                if clave not in indices:
                    indices[clave] = {}
                    for ev, (lat, lon) in puntos.items():
                        for lo in (lon, lon % 360):
                            try:
                                indices[clave][ev] = int(eccodes.codes_grib_find_nearest(gid, lat, lo, is_lsm=False, npoints=1)[0]["index"])
                                break
                            except eccodes.GribInternalError:
                                continue
                ids = indices[clave]
                evs = list(ids)
                vals = eccodes.codes_get_double_elements(gid, "values", [ids[e] for e in evs])
                valores[(c.miembro, c.paso, c.param)] = (dict(zip(evs, (float(x) for x in vals))), c.extra)
            finally:
                eccodes.codes_release(gid)
    return valores


def _puntos_tierra(corrida: datetime, puntos: dict[str, tuple[float, float]], paso: int) -> dict[str, tuple[float, float]]:
    """Punto de tierra más cercano con la máscara de ECMWF ENS (la misma grilla 0,25° sirve para GEFS)."""
    idx = ecmwf_indice(corrida, paso) or []
    lsm = next((x for x in idx if x.get("param") == "lsm"), None)
    if not lsm:
        return puntos
    datos = bajar_bytes(Campo("ecmwf", 1, paso, "lsm", ecmwf_url(corrida, paso, "grib2"), int(lsm["_offset"]), int(lsm["_length"])))
    if not datos:
        return puntos
    with tempfile.TemporaryDirectory() as tmp:
        ruta = os.path.join(tmp, "lsm.grib2")
        with open(ruta, "wb") as f:
            f.write(datos)
        elegidos = grib.puntos_modelo(ruta, puntos)
    return {ev: ((p.lat, p.lon) if (p := elegidos.get(ev)) else puntos[ev]) for ev in puntos}


def descargar(modelo: str, corrida: datetime, pedidos: dict[int, set], puntos: dict) -> dict:
    t0 = time.time()
    pasos = sorted(pedidos)
    if modelo == "ecmwf":
        campos, _ = ecmwf_campos(corrida, pasos)
    else:
        campos, _ = gefs_campos(corrida, pasos, range(0, 31))
    campos = [c for c in campos if c.param in pedidos.get(c.paso, ()) or (c.param == "2r" and "2d" in pedidos.get(c.paso, ()))]
    valores = _extraer(campos, puntos, {})
    miembros = sorted({k[0] for k in valores})
    msg = "%s %s: %d pasos, %d campos, %.0f MB, %d miembros, %.0f s" % (modelo, corrida.isoformat(), len(pasos),
                                                                      len(campos), sum(c.largo for c in campos) / 1e6, len(miembros), time.time() - t0)
    log.info(msg)
    print(f"::notice title=Ensambles {modelo}::{msg}", flush=True)
    return {"valores": valores, "miembros": miembros, "corrida": corrida}


# ---------------------------------------------------------------- serie horaria por miembro

_BALDE = re.compile(r"(\d+)-(\d+) hour (acc|ave)")


def _balde(extra: dict) -> tuple[int, int] | None:
    m = _BALDE.search(str((extra or {}).get("tiempo", "")))
    return (int(m.group(1)), int(m.group(2))) if m else None


def _media_coseno(lat: float, lon: float, a: datetime, b: datetime) -> float:
    n = 18
    return sum(cos_cenit(lat, lon, a + (b - a) * (k + 0.5) / n) for k in range(n)) / n


def _sesgo(sesgos: dict, ev: str, modelo: str) -> dict | None:
    s = sesgos.get((ev, FUENTE_SESGO[modelo]))
    return s if s and s.get("aplicado") else None


def _de_dia(t: datetime) -> bool:
    return 10 <= (t - timedelta(hours=3)).hour <= 19


def serie_miembro(modelo: str, datos: dict, m: int, ev: str, lat: float, lon: float, horas: list[datetime],
                  horas_calor: set, sesgo: dict | None) -> dict[datetime, dict]:
    corrida = datos["corrida"]
    V = datos["valores"]

    def val(paso, param):
        x = V.get((m, paso, param))
        return None if x is None else x[0].get(ev)

    def balde(paso, param):
        x = V.get((m, paso, param))
        return None if x is None else (x[0].get(ev), _balde(x[1]))

    salida = {}
    for h in horas:
        it = _intervalo(corrida, h)
        if not it:
            continue
        a, b, w = it

        def lin(param):
            vb = val(b, param)
            va = val(a, param)
            if vb is None:
                return None
            return vb if va is None else va + (vb - va) * w

        f: dict = {}
        u, v = lin("10u"), lin("10v")
        viento = math.hypot(u, v) if u is not None and v is not None else None
        if modelo == "ecmwf":
            rafaga = val(b, "10fg")   # máximo del intervalo (o de su última hora hasta +90 h)
            tb, ta = val(b, "tp"), (val(a, "tp") or 0.0) if a > 0 else 0.0
            acc3 = max(tb - ta, 0.0) * 1000 if tb is not None else None
            sb, sa = val(b, "ssrd"), (val(a, "ssrd") or 0.0) if a > 0 else 0.0
            ssrd_media = max(sb - sa, 0.0) / (PASO * 3600) if sb is not None else None
        else:
            rafaga = lin("10fg")
            acc3 = ssrd_media = None
            for param in ("tp", "ssrd"):
                xb = balde(b, param)
                if not xb or xb[0] is None or not xb[1]:
                    continue
                vb, (s0, _) = xb
                if s0 == a:
                    r = vb
                else:
                    xa = balde(a, param)
                    if not xa or xa[0] is None:
                        continue
                    r = vb - xa[0] if param == "tp" else (vb * (b - s0) - xa[0] * (a - s0)) / PASO
                if param == "tp":
                    acc3 = max(r, 0.0)
                else:
                    ssrd_media = max(r, 0.0)
        cape = lin("cape")
        f["viento"] = viento * 3.6 if viento is not None else None
        f["rafaga"] = rafaga * 3.6 if rafaga is not None else None
        f["cape"] = cape
        f["acc3"] = acc3
        f["precip"] = acc3 / PASO if acc3 is not None else None
        fv = (sesgo or {}).get("factor_viento")
        if fv:
            f["viento"] = f["viento"] * float(fv) if f["viento"] is not None else None
            f["rafaga"] = f["rafaga"] * float(fv) if f["rafaga"] is not None else None
        if h in horas_calor:
            t, td, hr, sp = lin("2t"), lin("2d"), lin("2r"), lin("sp")
            if t is not None and sp is not None and viento is not None and ssrd_media is not None:
                tc = t - 273.15
                tdc = td - 273.15 if td is not None else None
                if sesgo:
                    tc -= float(sesgo["sesgo_t_dia"] if _de_dia(h) else sesgo["sesgo_t_noche"])
                    if tdc is not None:
                        tdc = min(tdc - float(sesgo.get("sesgo_td") or 0.0), tc)
                if tdc is not None:
                    hr = hr_desde_rocio(tc, tdc)
                if hr is not None:
                    ini = corrida + timedelta(hours=a)
                    mc = _media_coseno(lat, lon, ini, ini + timedelta(hours=PASO))
                    ssrd = ssrd_media * cos_cenit(lat, lon, h) / mc if mc > 0.01 else 0.0
                    f["t"] = tc
                    f["wbgt"] = wbgt_liljegren(tc, hr, sp / 100, viento * float(fv or 1.0), ssrd, lat, lon, h)
        salida[h] = f
    return salida


# ---------------------------------------------------------------- probabilidades

def _cortes_calor(variable: str) -> list[float]:
    if variable == "wbgt_wt":
        return [float(x) for x in U["wbgt_wt"]["cortes"]] + [float(U["wbgt_wt"]["negra_mayor_que"])]
    if variable == "wbgt_uci":
        return [float(x) for x in U["wbgt_uci"]["cortes"]]
    return [float(x) for x in U["wbgt_wa"]["cortes"]]


def evaluar_miembro(serie: dict, ventana: Ventana, var_calor: str, nivel_calor) -> dict:
    """Máximo de cada variable en la ventana y el nivel que alcanza."""
    hs = [serie[h] for h in horas_de(ventana.ini, ventana.fin) if h in serie]
    out: dict = {}
    if not hs:
        return out
    if "calor" in ventana.variables:
        w = [x["wbgt"] for x in hs if x.get("wbgt") is not None]
        if w:
            mx = max(w)
            out[var_calor] = (mx, nivel_calor(mx)[0] or 0)
    if "viento" in ventana.variables:
        r = [x["rafaga"] for x in hs if x.get("rafaga") is not None]
        if r:
            mx = max(r)
            for cat in ("A", "B", "C"):
                out[f"viento_{cat}"] = (mx, nivel_viento(cat, mx)[0] or 0)
    if "tormenta" in ventana.variables:
        nv = [(nivel_tormenta(x["cape"], x["precip"])[0] or 0, x["cape"]) for x in hs if x.get("cape") is not None and x.get("precip") is not None]
        if nv:
            out["tormenta"] = (max(c for _, c in nv), max(n for n, _ in nv))
    if "lluvia" in ventana.variables:
        acc = [x["acc3"] for x in hs if x.get("acc3") is not None]
        if acc:
            mx = max(acc)
            out["lluvia"] = (mx, 2 if mx >= LLUVIA_MM else 0)
    return out


def _cuantil(pares: list[tuple[float, float]], q: float) -> float | None:
    """Cuantil ponderado (pares valor, peso)."""
    if not pares:
        return None
    pares = sorted(pares)
    total = sum(p for _, p in pares)
    acum = 0.0
    for v, p in pares:
        acum += p
        if acum >= q * total - 1e-12:
            return v
    return pares[-1][0]


def niveles_de(variable: str, var_calor: str) -> list[tuple[int, float | None]]:
    if variable == var_calor:
        return [(i + 1, c) for i, c in enumerate(_cortes_calor(variable))]
    if variable.startswith("viento_"):
        return [(i + 1, c) for i, c in enumerate(VIENTO[variable[-1]])]
    if variable == "tormenta":
        t = U["tormenta"]
        return [(1, float(t["posible"]["cape"])), (2, float(t["probable"]["cape"]))]
    if variable == "lluvia":
        return [(2, LLUVIA_MM)]
    return []


def probabilidades(resultados: dict[str, dict[int, dict]], ventana: Ventana, var_calor: str) -> dict:
    """resultados: modelo -> miembro -> {variable: (máximo, nivel)}. Devuelve modelo -> variable -> datos."""
    salida: dict = {}
    variables = sorted({v for por_m in resultados.values() for r in por_m.values() for v in r})
    for variable in variables:
        por_modelo = {}
        for modelo, por_m in resultados.items():
            filas = [r[variable] for r in por_m.values() if variable in r]
            if filas:
                por_modelo[modelo] = filas
        if not por_modelo:
            continue
        pesos = {m: PESOS[m] for m in por_modelo}
        suma = sum(pesos.values())
        for modelo, filas in list(por_modelo.items()) + [("mezcla", None)]:
            if modelo == "mezcla":
                pares = [(v, pesos[m] / suma / len(fs)) for m, fs in por_modelo.items() for v, _ in fs]
                niveles = [(n, pesos[m] / suma / len(fs)) for m, fs in por_modelo.items() for _, n in fs]
                miembros = sum(len(fs) for fs in por_modelo.values())
            else:
                pares = [(v, 1 / len(filas)) for v, _ in filas]
                niveles = [(n, 1 / len(filas)) for _, n in filas]
                miembros = len(filas)
            probs = {n: round(sum(p for nv, p in niveles if nv >= n), 4) for n, _ in niveles_de(variable, var_calor)}
            salida.setdefault(modelo, {})[variable] = {
                "probs": probs, "umbrales": dict(niveles_de(variable, var_calor)), "miembros": miembros,
                "p10": _cuantil(pares, 0.1), "p50": _cuantil(pares, 0.5), "p90": _cuantil(pares, 0.9),
            }
    return salida


def _r(x, n=1):
    return None if x is None else round(float(x), n)


# ---------------------------------------------------------------- proceso

def procesar(eventos: list[dict], sesgos_lista: list[dict], ahora: datetime, forzar: bool, ultimas: dict) -> tuple[list, list]:
    ce = ecmwf_ultima(ahora, HORIZONTE)
    if ce is None:
        log.info("ECMWF ENS: sin corrida disponible")
        return [], []
    pendientes = [e for e in eventos if forzar or ultimas.get(e["id"]) is None
                  or datetime.fromisoformat(ultimas[e["id"]]) < ce]
    if not pendientes:
        log.info("Corrida ENS %s ya procesada para todos los eventos", ce.isoformat())
        return [], []
    cg = gefs_ultima(ahora, HORIZONTE)
    corridas = {"ecmwf": ce, **({"gefs": cg} if cg else {})}
    log.info("Corridas: %s", {k: v.isoformat() for k, v in corridas.items()})

    sesgos = {(s["evento_id"], s["fuente"]): s for s in sesgos_lista}
    plan = {}
    for ev in pendientes:
        vs = ventanas_evento(ev, ahora)
        if not vs:
            continue
        var_calor, nivel_calor = calor_participantes(ev.get("disciplina"))
        carrera = next((x for x in vs if x.nombre == "carrera"), None)
        horas_calor = set()
        for x in vs:
            if "calor" in x.variables:
                horas_calor |= set(horas_de(x.ini, x.fin))
        if carrera:
            horas_calor |= set(horas_de(carrera.ini - timedelta(hours=CONTEXTO_H), carrera.fin + timedelta(hours=CONTEXTO_H)))
        horas_todas = set(horas_calor)
        for x in vs:
            horas_todas |= set(horas_de(x.ini, x.fin))
        horas_todas = {h for h in horas_todas if h >= _hora(ahora)}
        horas_calor &= horas_todas
        plan[ev["id"]] = {"ev": ev, "ventanas": vs, "var_calor": var_calor, "nivel_calor": nivel_calor,
                          "horas": sorted(horas_todas), "horas_calor": horas_calor, "carrera": carrera}
    if not plan:
        log.info("Ningún evento con ventanas por delante")
        return [], []

    puntos = {e: (float(p["ev"]["lat"]), float(p["ev"]["lon"])) for e, p in plan.items()}
    datos = {}
    for modelo, corrida in corridas.items():
        pedidos: dict[int, set] = {}
        for p in plan.values():
            resto = set(p["horas"]) - p["horas_calor"]
            for paso, params in _pasos_y_params(corrida, p["horas_calor"], resto).items():
                pedidos.setdefault(paso, set()).update(params)
        if not pedidos:
            continue
        if modelo == "ecmwf":
            puntos = _puntos_tierra(corrida, puntos, min(pedidos))
            log.info("Puntos de tierra: %s", puntos)
        try:
            datos[modelo] = descargar(modelo, corrida, pedidos, puntos)
        except Exception:  # noqa: BLE001
            log.exception("Fallo la descarga de %s", modelo)
    if "ecmwf" not in datos:
        return [], []

    prob_filas, horas_filas = [], []
    emitido = ahora.isoformat()
    for ev_id, p in plan.items():
        ev = p["ev"]
        lat, lon = puntos[ev_id]
        series = {modelo: {m: serie_miembro(modelo, d, m, ev_id, lat, lon, p["horas"], p["horas_calor"], _sesgo(sesgos, ev_id, modelo))
                           for m in d["miembros"]} for modelo, d in datos.items()}
        corridas_usadas = {m: datos[m]["corrida"].isoformat() for m in datos}
        for x in p["ventanas"]:
            res = {modelo: {m: evaluar_miembro(s, x, p["var_calor"], p["nivel_calor"]) for m, s in por_m.items()}
                   for modelo, por_m in series.items()}
            pr = probabilidades(res, x, p["var_calor"])
            anticip = round((x.ini - ce).total_seconds() / 3600)
            for modelo, por_var in pr.items():
                for variable, d in por_var.items():
                    aprox = APROX_LLUVIA if variable == "lluvia" else APROX_TORMENTA if variable == "tormenta" else None
                    if variable.startswith("viento_") and modelo in ("ecmwf", "mezcla") and (x.ini - ce).total_seconds() / 3600 <= 90:
                        aprox = APROX_RAFAGA_ECMWF
                    for nivel, prob in d["probs"].items():
                        prob_filas.append({
                            "evento_id": ev_id, "corrida": ce.isoformat(), "modelo": modelo, "variable": variable,
                            "nivel": nivel, "ventana": x.nombre, "ventana_desde": x.ini.isoformat(), "ventana_hasta": x.fin.isoformat(),
                            "umbral": d["umbrales"].get(nivel), "prob": min(1.0, max(0.0, prob)),
                            "p10": _r(d["p10"]), "p50": _r(d["p50"]), "p90": _r(d["p90"]),
                            "miembros": d["miembros"], "anticipacion_h": anticip,
                            "corridas": corridas_usadas if modelo == "mezcla" else {modelo: corridas_usadas[modelo]},
                            "aproximacion": aprox, "emitido_en": emitido,
                        })
        # Curva horaria: calor de la disciplina alrededor de la carrera y ráfaga en todas las ventanas
        cortes = _cortes_calor(p["var_calor"])
        for variable, clave, horas in ((p["var_calor"], "wbgt", sorted(p["horas_calor"])), ("rafaga", "rafaga", p["horas"])):
            for h in horas:
                por_modelo = {}
                for modelo, por_m in series.items():
                    vals = [s[h][clave] for s in por_m.values() if h in s and s[h].get(clave) is not None]
                    if vals:
                        por_modelo[modelo] = vals
                if not por_modelo:
                    continue
                suma = sum(PESOS[m] for m in por_modelo)
                for modelo in list(por_modelo) + ["mezcla"]:
                    if modelo == "mezcla":
                        pares = [(v, PESOS[m] / suma / len(vs)) for m, vs in por_modelo.items() for v in vs]
                    else:
                        pares = [(v, 1 / len(por_modelo[modelo])) for v in por_modelo[modelo]]
                    probs = None
                    if clave == "wbgt":
                        probs = {str(i + 1): round(sum(w for v, w in pares if v >= c), 4) for i, c in enumerate(cortes)}
                    horas_filas.append({
                        "evento_id": ev_id, "corrida": ce.isoformat(), "modelo": modelo, "variable": variable,
                        "valido": h.isoformat(), "p10": _r(_cuantil(pares, 0.1)), "p50": _r(_cuantil(pares, 0.5)),
                        "p90": _r(_cuantil(pares, 0.9)), "probs": probs, "miembros": len(pares), "emitido_en": emitido,
                    })
        log.info("%s: %d probabilidades, %d horas", ev["nombre"], sum(1 for f in prob_filas if f["evento_id"] == ev_id),
                 sum(1 for f in horas_filas if f["evento_id"] == ev_id))
    return prob_filas, horas_filas


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--forzar", action="store_true", help="reprocesar aunque la corrida ya esté guardada")
    args = ap.parse_args()
    from .api import Ingesta
    t0 = time.time()
    ahora = datetime.now(timezone.utc)
    api = Ingesta()
    estado = api.estado(incluir="ensambles")
    eventos = estado.get("eventos") or []
    if not eventos:
        log.info("No hay eventos en monitoreo")
        return 0
    try:
        prob, horas = procesar(eventos, estado.get("sesgos") or [], ahora, args.forzar, estado.get("ens_ultimas") or {})
        # En tandas: un solo envío con todas las horas supera el tiempo de escritura de la función
        for i in range(0, len(prob), 1500):
            log.info("ingesta prob: %s", api.ensambles(prob[i:i + 1500], []))
        for i in range(0, len(horas), 1500):
            log.info("ingesta horas: %s", api.ensambles([], horas[i:i + 1500]))
        print(f"::notice title=Ensambles filas::{len(prob)} probabilidades, {len(horas)} horas", flush=True)
    except Exception:  # noqa: BLE001
        log.exception("Fallo el pronóstico probabilístico")
        tb = " | ".join(traceback.format_exc().strip().splitlines()[-6:]).replace("%", "%25")
        print(f"::error title=Ensambles::{tb}", flush=True)
        return 1
    seg = time.time() - t0
    log.info("Duración total: %.0f s", seg)
    print(f"::notice title=Ensambles::duración {seg:.0f} s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
