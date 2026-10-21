"""Ensambles abiertos con uso comercial: ECMWF ENS open data (CC BY 4.0) y NOAA GEFS (dominio público).

Etapa 1 (exploración): verifica en los índices reales qué parámetros entrega cada miembro y hasta qué plazo,
cuánto pesa cada campo y cuánto tarda la descarga recortada (solo los plazos de la ventana de un evento,
por rangos de bytes) con el WBGT por miembro. No guarda nada en la base.

Ejecución: python -m mon.ensambles [--evento <id>] [--max-pasos N]
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import statistics
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import eccodes
import requests

from . import ventanas
from .calculo import hr_desde_rocio, wbgt_liljegren

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("mon.ensambles")

ECMWF_RAIZ = os.environ.get("MON_ECMWF_RAIZ", "https://data.ecmwf.int/forecasts")
GEFS_RAIZ = os.environ.get("MON_GEFS_RAIZ", "https://noaa-gefs-pds.s3.amazonaws.com")
HILOS = 16
S = requests.Session()
S.mount("https://", requests.adapters.HTTPAdapter(pool_connections=HILOS, pool_maxsize=HILOS * 2))


@dataclass
class Campo:
    modelo: str
    miembro: int          # 0 = control
    paso: int             # h desde la corrida
    param: str            # nombre normalizado (2t, 2d, 2r, 10u, 10v, 10fg, tp, ssrd, sp, cape)
    url: str
    inicio: int
    largo: int
    extra: dict = field(default_factory=dict)


# ---------------------------------------------------------------- ECMWF ENS

def ecmwf_url(corrida: datetime, paso: int, ext: str) -> str:
    return (f"{ECMWF_RAIZ}/{corrida:%Y%m%d}/{corrida:%H}z/ifs/0p25/enfo/"
            f"{corrida:%Y%m%d%H}0000-{paso}h-enfo-ef.{ext}")


def ecmwf_indice(corrida: datetime, paso: int) -> list[dict] | None:
    r = S.get(ecmwf_url(corrida, paso, "index"), timeout=60)
    if r.status_code != 200:
        return None
    return [json.loads(x) for x in r.text.splitlines() if x.strip()]


def ecmwf_ultima(ahora: datetime, paso_control: int = 144) -> datetime | None:
    base = ahora.replace(minute=0, second=0, microsecond=0)
    base -= timedelta(hours=base.hour % 12)
    for k in range(4):
        c = base - timedelta(hours=12 * k)
        r = S.head(ecmwf_url(c, paso_control, "index"), timeout=30)
        if r.status_code == 200:
            return c.replace(tzinfo=timezone.utc)
    return None


ECMWF_PARAM = {"2t": "2t", "2d": "2d", "10u": "10u", "10v": "10v", "10fg": "10fg", "fg10": "10fg", "10fg3": "10fg",
               "tp": "tp", "ssrd": "ssrd", "sp": "sp", "mucape": "cape", "cape": "cape"}


def ecmwf_campos(corrida: datetime, pasos: list[int]) -> tuple[list[Campo], dict]:
    campos, resumen = [], {}
    for p in pasos:
        idx = ecmwf_indice(corrida, p)
        if idx is None:
            resumen[p] = "sin índice"
            continue
        por_param: dict[str, set] = {}
        for x in idx:
            if x.get("levtype") not in ("sfc", None):
                continue
            nombre = ECMWF_PARAM.get(x.get("param", ""))
            miembro = 0 if x.get("type") == "cf" else int(x.get("number", -1))
            por_param.setdefault(x.get("param"), set()).add(miembro)
            if nombre:
                campos.append(Campo("ecmwf", miembro, p, nombre, ecmwf_url(corrida, p, "grib2"),
                                    int(x["_offset"]), int(x["_length"]), {"orig": x.get("param")}))
        interes = set(ECMWF_PARAM) | {"10fg3", "10fg6", "mx2t3", "cp"}
        resumen[p] = {k: (len(v), min(v), max(v)) for k, v in sorted(por_param.items()) if k in interes}
    return campos, resumen


# ---------------------------------------------------------------- GEFS

def gefs_url(corrida: datetime, miembro: int, paso: int, ext: str = "", prod: str = "pgrb2sp25") -> str:
    nombre = "gec00" if miembro == 0 else f"gep{miembro:02d}"
    suf = {"pgrb2sp25": "pgrb2s.0p25", "pgrb2ap5": "pgrb2a.0p50", "pgrb2bp5": "pgrb2b.0p50"}[prod]
    return (f"{GEFS_RAIZ}/gefs.{corrida:%Y%m%d}/{corrida:%H}/atmos/{prod}/"
            f"{nombre}.t{corrida:%H}z.{suf}.f{paso:03d}{ext}")


def gefs_ultima(ahora: datetime, paso_control: int = 240) -> datetime | None:
    base = ahora.replace(minute=0, second=0, microsecond=0)
    base -= timedelta(hours=base.hour % 12)
    for k in range(4):
        c = base - timedelta(hours=12 * k)
        r = S.head(gefs_url(c, 30, paso_control, ".idx"), timeout=30)
        if r.status_code == 200:
            return c.replace(tzinfo=timezone.utc)
    return None


GEFS_PARAM = {("TMP", "2 m above ground"): "2t", ("DPT", "2 m above ground"): "2d",
              ("RH", "2 m above ground"): "2r", ("UGRD", "10 m above ground"): "10u",
              ("VGRD", "10 m above ground"): "10v", ("GUST", "surface"): "10fg",
              ("APCP", "surface"): "tp", ("DSWRF", "surface"): "ssrd", ("PRES", "surface"): "sp",
              ("CAPE", "surface"): "cape", ("CAPE", "180-0 mb above ground"): "cape_180"}


def gefs_idx(url: str) -> list[tuple[int, str, str, str, int | None]] | None:
    r = S.get(url, timeout=60)
    if r.status_code != 200:
        return None
    filas = []
    lineas = [x.split(":") for x in r.text.splitlines() if x.strip()]
    for i, x in enumerate(lineas):
        ini = int(x[1])
        fin = int(lineas[i + 1][1]) if i + 1 < len(lineas) else None
        filas.append((ini, x[3], x[4], x[5] if len(x) > 5 else "", None if fin is None else fin - ini))
    return filas


def gefs_campos(corrida: datetime, pasos: list[int], miembros: range, prod: str = "pgrb2sp25") -> tuple[list[Campo], dict]:
    campos, resumen = [], {}

    def uno(args):
        m, p = args
        return m, p, gefs_idx(gefs_url(corrida, m, p, ".idx", prod))

    with ThreadPoolExecutor(HILOS) as ex:
        for m, p, idx in ex.map(uno, [(m, p) for m in miembros for p in pasos]):
            if idx is None:
                resumen.setdefault(p, {}).setdefault("_faltan", []).append(m)
                continue
            for ini, var, nivel, tiempo, largo in idx:
                clave = GEFS_PARAM.get((var, nivel))
                if m == 1 and (clave or var in ("TMP", "RH", "DPT", "GUST", "DSWRF", "APCP", "CAPE", "LAND", "PRES")):
                    resumen.setdefault(p, {}).setdefault("vars", set()).add(f"{var}:{nivel}:{tiempo}")
                if clave and largo:
                    campos.append(Campo("gefs", m, p, clave, gefs_url(corrida, m, p, "", prod), ini, largo,
                                        {"tiempo": tiempo}))
    for p in resumen:
        if "vars" in resumen[p]:
            resumen[p]["vars"] = sorted(resumen[p]["vars"])
    return campos, resumen


# ---------------------------------------------------------------- descarga y punto

def bajar_bytes(c: Campo) -> bytes | None:
    """Descarga un campo por rango de bytes (en hilos: solo red, sin eccodes)."""
    for intento in range(3):
        try:
            r = S.get(c.url, headers={"Range": f"bytes={c.inicio}-{c.inicio + c.largo - 1}"}, timeout=120)
            if r.status_code in (200, 206) and r.content[:4] == b"GRIB":
                return r.content
        except requests.RequestException:
            pass
        time.sleep(2 * (intento + 1))
    return None


def valor_punto(c: Campo, datos: bytes, lat: float, lon: float, cache: dict) -> float | None:
    """Valor en el punto de grilla más cercano (eccodes no es seguro entre hilos: se llama desde el hilo principal)."""
    gid = eccodes.codes_new_from_message(datos)
    try:
        clave = (c.modelo, eccodes.codes_get(gid, "numberOfDataPoints"))
        if clave not in cache:
            for lo in (lon, lon % 360):
                try:
                    v = eccodes.codes_grib_find_nearest(gid, lat, lo, is_lsm=False, npoints=1)
                    cache[clave] = int(v[0]["index"])
                    break
                except eccodes.GribInternalError:
                    continue
        return float(eccodes.codes_get_double_element(gid, "values", cache[clave]))
    finally:
        eccodes.codes_release(gid)


def bajar(campos: list[Campo], lat: float, lon: float) -> tuple[dict, float, int]:
    cache: dict = {}
    t0 = time.time()
    valores: dict = {}
    with ThreadPoolExecutor(HILOS) as ex:
        for c, datos in zip(campos, ex.map(bajar_bytes, campos)):
            valores[(c.miembro, c.paso, c.param)] = None if datos is None else valor_punto(c, datos, lat, lon, cache)
    return valores, time.time() - t0, sum(c.largo for c in campos)


def wbgt_miembros(modelo: str, corrida: datetime, valores: dict, pasos: list[int], lat: float, lon: float) -> dict:
    """WBGT por miembro y paso (radiación desacumulada entre pasos consecutivos; GEFS promedia desde el inicio del balde)."""
    salida = {}
    miembros = sorted({k[0] for k in valores})
    for m in miembros:
        for i, p in enumerate(pasos):
            if i == 0:
                continue
            g = lambda par, pp=p: valores.get((m, pp, par))  # noqa: E731
            t, td, hr = g("2t"), g("2d"), g("2r")
            if t is None:
                continue
            t_c = t - 273.15
            if hr is None and td is not None:
                hr = hr_desde_rocio(t_c, td - 273.15)
            u, v, sp = g("10u"), g("10v"), g("sp")
            viento = math.hypot(u, v) if u is not None and v is not None else None
            prev = pasos[i - 1]
            ssrd = None
            if modelo == "ecmwf" and g("ssrd") is not None and valores.get((m, prev, "ssrd")) is not None:
                ssrd = max(g("ssrd") - valores[(m, prev, "ssrd")], 0.0) / ((p - prev) * 3600)
            elif modelo == "gefs":
                ssrd = g("ssrd")
            valido = corrida + timedelta(hours=p)
            w = None
            if None not in (hr, viento, sp, ssrd):
                w = wbgt_liljegren(t_c, hr, sp / 100, viento, ssrd, lat, lon,
                                   valido - timedelta(hours=(p - prev) / 2) if ssrd > 0 else valido)
            salida[(m, p)] = w
    return salida


# ---------------------------------------------------------------- exploración

def pasos_ventana(corrida: datetime, ini: datetime, fin: datetime, paso: int, horizonte: int) -> list[int]:
    a = max(0, math.floor((ini - corrida).total_seconds() / 3600 / paso) * paso - paso)  # uno antes para desacumular
    b = min(horizonte, math.ceil((fin - corrida).total_seconds() / 3600 / paso) * paso)
    return list(range(a, b + 1, paso)) if b >= a else []


def explorar(evento: dict | None, max_pasos: int) -> dict:
    ahora = datetime.now(timezone.utc)
    informe: dict = {"ahora": ahora.isoformat()}

    # ECMWF ENS
    ce = ecmwf_ultima(ahora)
    informe["ecmwf_corrida"] = ce.isoformat() if ce else None
    if ce:
        pasos_ref = [0, 90, 93, 144, 150, 360]
        _, res = ecmwf_campos(ce, pasos_ref)
        informe["ecmwf_parametros_por_paso"] = {"_nota": "[miembros, mínimo, máximo]", **{str(k): v for k, v in res.items() if k in (90, 93, 144, 150)}}
        idx = ecmwf_indice(ce, 120) or []
        tam = {}
        for x in idx:
            if x.get("levtype") == "sfc" and x.get("type") == "pf":
                tam.setdefault(x["param"], []).append(int(x["_length"]))
        informe["ecmwf_mb_por_campo"] = {k: round(statistics.mean(v) / 1e6, 2) for k, v in sorted(tam.items())
                                         if k in ECMWF_PARAM or k.startswith("10fg")}
        informe["ecmwf_tipos"] = sorted({(x.get("type"), x.get("stream")) for x in idx}, key=str)

    # GEFS
    cg = gefs_ultima(ahora)
    informe["gefs_corrida"] = cg.isoformat() if cg else None
    if cg:
        for prod in ("pgrb2sp25",):
            _, res = gefs_campos(cg, [3, 6, 120, 240, 246, 384], range(1, 2), prod)
            informe[f"gefs_{prod}"] = res
        idx = gefs_idx(gefs_url(cg, 1, 120, ".idx")) or []
        informe["gefs_mb_por_campo_sp25"] = {f"{v}:{n}": round(l / 1e6, 2) for _, v, n, _, l in idx
                                             if l and (v, n) in GEFS_PARAM}

    # Prueba de tiempos con la ventana de carrera del evento
    if evento and (ce or cg):
        v = ventanas.calcular(evento)
        lat, lon = float(evento["lat"]), float(evento["lon"])
        informe["evento"] = {"nombre": evento.get("nombre"), "exposicion": [v.exposicion[0].isoformat(), v.exposicion[1].isoformat()]}
        for nombre, corrida, paso, horiz in (("ecmwf", ce, 3, 144), ("gefs", cg, 3, 240)):
            if not corrida:
                continue
            pasos = pasos_ventana(corrida, v.exposicion[0], v.exposicion[1], paso, horiz)[:max_pasos]
            if len(pasos) < 2:
                informe[f"prueba_{nombre}"] = f"la ventana queda fuera del horizonte ({horiz} h) o no tiene pasos"
                continue
            if nombre == "ecmwf":
                campos, _ = ecmwf_campos(corrida, pasos)
            else:
                campos, _ = gefs_campos(corrida, pasos, range(0, 31))
            valores, seg, bytes_ = bajar(campos, lat, lon)
            w = wbgt_miembros(nombre, corrida, valores, pasos, lat, lon)
            por_paso = {}
            for p in pasos[1:]:
                ws = sorted(x for (m, pp), x in w.items() if pp == p and x is not None)
                if ws:
                    q = lambda f: ws[min(len(ws) - 1, int(f * (len(ws) - 1) + 0.5))]  # noqa: E731
                    por_paso[(corrida + timedelta(hours=p)).isoformat()] = {
                        "miembros": len(ws), "p10": round(q(0.1), 1), "p50": round(q(0.5), 1), "p90": round(q(0.9), 1)}
            faltan = sorted({k[2] for k, x in valores.items() if x is None})
            informe[f"prueba_{nombre}"] = {
                "pasos": pasos, "campos": len(campos), "mb": round(bytes_ / 1e6, 1), "segundos": round(seg, 1),
                "segundos_por_paso": round(seg / len(pasos), 1), "parametros": sorted({c.param for c in campos}),
                "fallidos": faltan, "wbgt": por_paso,
            }
    return informe


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--evento", default="")
    ap.add_argument("--max-pasos", type=int, default=6)
    args = ap.parse_args()
    evento = None
    try:
        from .api import Ingesta
        evs = Ingesta().estado().get("eventos") or []
        ahora = datetime.now(timezone.utc)
        if args.evento:
            evs = [e for e in evs if e["id"] == args.evento]
        # el evento activo más próximo cuya carrera ya entró en el horizonte del ensamble
        evs = sorted((e for e in evs if datetime.fromisoformat(e["largada"]) > ahora), key=lambda e: e["largada"])
        evento = evs[0] if evs else None
    except Exception as e:  # noqa: BLE001
        log.warning("Sin eventos (%s): solo se exploran los índices", e)
    informe = explorar(evento, args.max_pasos)
    texto = json.dumps(informe, ensure_ascii=False, indent=1, default=str)
    print(texto)
    resumen = os.environ.get("GITHUB_STEP_SUMMARY")
    if resumen:
        with open(resumen, "a", encoding="utf-8") as f:
            f.write("## Exploración de ensambles\n\n```json\n" + texto + "\n```\n")
    with open(os.path.join(tempfile.gettempdir(), "ensambles.json"), "w", encoding="utf-8") as f:
        f.write(texto)
    # Anotaciones de GitHub Actions: se leen por API sin descargar los registros
    compacto = json.dumps(informe, ensure_ascii=False, separators=(",", ":"), default=str)
    for i in range(0, min(len(compacto), 9 * 3800), 3800):
        trozo = compacto[i:i + 3800].replace("%", "%25").replace("\n", " ")
        print(f"::notice title=ensambles {i // 3800}::{trozo}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
