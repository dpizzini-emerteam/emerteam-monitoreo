"""Ejecución: python -m mon [--forzar]

1. Lee los eventos en monitoreo y la última corrida procesada por fuente.
2. Para cada fuente, si hay una corrida nueva, descarga los puntos y los guarda.
3. Recalcula los niveles de todos los eventos con el consenso de fuentes.
"""

from __future__ import annotations

import argparse
import logging
import sys
import traceback
from datetime import datetime, timedelta, timezone

from . import correccion, motor, ventanas
from .api import Ingesta
from .fuentes import ecmwf, gfs, icon, metno, wrf_smn

FUENTES = {"gfs": gfs, "ecmwf": ecmwf, "wrf_smn": wrf_smn, "icon": icon}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("mon")


def anotar(titulo: str) -> None:
    """Deja el error como anotación de GitHub Actions (visible por API sin descargar logs)."""
    tb = traceback.format_exc().strip().splitlines()
    texto = " | ".join(tb[-6:]).replace("%", "%25").replace("\r", "").replace("\n", " ")
    print(f"::error title={titulo}::{texto}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--forzar", action="store_true", help="reprocesar aunque la corrida ya esté guardada")
    ap.add_argument("--fuentes", default="gfs,ecmwf,wrf_smn,icon")
    args = ap.parse_args()

    ahora = datetime.now(timezone.utc)
    api = Ingesta()
    estado = api.estado()
    eventos = estado.get("eventos") or []
    if not eventos:
        log.info("No hay eventos en monitoreo")
        return 0
    hasta = max(ventanas.calcular(e).desarme[1] for e in eventos) + timedelta(hours=3)
    ultimas = estado.get("ultimas_corridas") or {}
    por_evento = estado.get("ultimas_por_evento") or {}
    log.info("%d eventos; horizonte hasta %s; últimas corridas: %s", len(eventos), hasta.isoformat(), ultimas)

    errores = 0
    for nombre in [f.strip() for f in args.fuentes.split(",") if f.strip()]:
        mod = FUENTES[nombre]
        try:
            disponible = mod.ultima_corrida() if nombre == "ecmwf" else mod.ultima_corrida(ahora)
            if disponible is None:
                continue
            # Eventos que todavía no tienen esta corrida (los recién cargados o con fecha/lugar cambiados)
            pendientes = [e for e in eventos if args.forzar or not (por_evento.get(e["id"], {}).get(nombre))
                          or datetime.fromisoformat(por_evento[e["id"]][nombre]) < disponible]
            if not pendientes:
                log.info("%s: corrida %s ya procesada para todos los eventos", nombre, disponible.isoformat())
                continue
            hasta_p = max(ventanas.calcular(e).desarme[1] for e in pendientes) + timedelta(hours=3)
            log.info("%s: %d eventos a procesar con la corrida %s", nombre, len(pendientes), disponible.isoformat())
            res = mod.obtener(pendientes, hasta_p, ahora)
            if not res:
                continue
            _, filas = res
            log.info("%s: %d filas", nombre, len(filas))
            log.info("%s: %s", nombre, api.pronosticos(filas))
        except Exception:  # noqa: BLE001
            errores += 1
            log.exception("Fallo la fuente %s", nombre)
            anotar(f"Fuente {nombre}")

    # Índice UV con cielo despejado (MET Norway): se reemplaza completo en cada corrida
    try:
        uv = metno.obtener(eventos, {e["id"]: ventanas.calcular(e).desarme[1] + timedelta(hours=3) for e in eventos})
        if uv:
            log.info("uv: %s", api.uv(uv))
    except Exception:  # noqa: BLE001
        errores += 1
        log.exception("Fallo el índice UV")
        anotar("UV")

    try:
        _niveles(api, ahora)
    except Exception:  # noqa: BLE001
        log.exception("Fallo el cálculo de niveles")
        anotar("Niveles")
        errores += 1
    return 1 if errores else 0


def _niveles(api: Ingesta, ahora: datetime) -> None:
    """Corrección de sesgo con observaciones del SMN y niveles con todas las fuentes guardadas."""
    completo = api.estado(incluir_pronosticos=True)
    pron = completo.get("pronosticos") or []
    estaciones = completo.get("estaciones_evento") or {k: [v] for k, v in (completo.get("estaciones") or {}).items()}
    observaciones = completo.get("observaciones") or {}
    por_evento, correcciones, sesgos = {}, [], []
    verif = motor.verif_por_plazo(completo.get("verif"))
    log.info("verificación por plazo: %d combinaciones con muestra suficiente", len(verif))
    ens = completo.get("ens_rafaga") or {}
    archivo = []
    emision = ahora.replace(minute=0, second=0, microsecond=0)
    emision -= timedelta(hours=emision.hour % 6)  # una copia del consenso cada 6 h
    for ev in completo.get("eventos") or []:
        filas_ev = [p for p in pron if p["evento_id"] == ev["id"]]
        try:
            corregidas, s = correccion.aplicar(ev, filas_ev, estaciones.get(ev["id"]) or [], observaciones, ahora)
            sesgos += s
            correcciones += [{k: f.get(k) for k in ("evento_id", "fuente", "corrida", "valido", "t2m_corr", "td2m_corr",
                                                     "hr_corr", "viento10_corr", "rafaga10_corr", "wbgt_corr")} for f in corregidas]
            for x in s:
                log.info("%s · %s: estación %s (%s km), %d pares, sesgo T día %s / noche %s, factor viento %s, "
                         "error T %s → %s, atenuación %s, aplicado %s", ev["nombre"], x["fuente"], x["estacion"],
                         x["distancia_km"], x["pares"], x["sesgo_t_dia"], x["sesgo_t_noche"], x["factor_viento"],
                         x["error_t"], x["error_t_corr"], x["atenuacion"], x["aplicado"])
            filas_ev = [correccion.con_correccion(f) for f in corregidas]
        except Exception:  # noqa: BLE001
            log.exception("Corrección de %s", ev["nombre"])
            anotar(f"Corrección {ev['nombre']}")
        ecm = motor.pesos_fuentes([x for x in sesgos if x["evento_id"] == ev["id"]])
        ens_ev = {datetime.fromisoformat(x["valido"]).astimezone(timezone.utc): float(x["p50"])
                  for x in ens.get(ev["id"], []) if x.get("p50") is not None}
        serie = motor.serie_consenso(filas_ev, ecm, verif, ens_ev)
        por_evento[ev["id"]] = motor.niveles_evento(ev, filas_ev, ahora, serie=serie)
        # Copia del consenso para verificarlo después contra lo observado (cada 3 h de validez)
        for h, f in serie.items():
            if h >= ahora - timedelta(hours=1) and h.hour % 3 == 0:
                archivo.append({"evento_id": ev["id"], "fuente": "mezcla", "corrida": emision.isoformat(), "valido": h.isoformat(),
                                **{k: (round(float(f[k]), 2) if f.get(k) is not None else None)
                                   for k in ("t2m", "td2m", "viento10", "rafaga10", "precip", "wbgt_est")}})
        log.info("%s: %d tramos de nivel", ev["nombre"], len(por_evento[ev["id"]]))
    if correcciones:
        log.info("correcciones: %s", api.correcciones(correcciones))
    if sesgos:
        log.info("sesgos: %s", api.sesgos(sesgos))
    log.info("niveles: %s", api.niveles(por_evento))
    if archivo:
        try:
            log.info("archivo del consenso: %s", api.archivo(archivo))
        except Exception:  # noqa: BLE001
            log.exception("Archivo del consenso")
            anotar("Archivo del consenso")


if __name__ == "__main__":
    sys.exit(main())
