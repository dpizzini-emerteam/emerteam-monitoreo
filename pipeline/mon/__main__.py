"""Ejecución: python -m mon [--forzar]

1. Lee los eventos en monitoreo y la última corrida procesada por fuente.
2. Para cada fuente, si hay una corrida nueva, descarga los puntos y los guarda.
3. Recalcula los niveles de todos los eventos con el consenso de fuentes.
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timedelta, timezone

from . import motor, ventanas
from .api import Ingesta
from .fuentes import ecmwf, gfs

FUENTES = {"gfs": gfs, "ecmwf": ecmwf}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("mon")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--forzar", action="store_true", help="reprocesar aunque la corrida ya esté guardada")
    ap.add_argument("--fuentes", default="gfs,ecmwf")
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
    log.info("%d eventos; horizonte hasta %s; últimas corridas: %s", len(eventos), hasta.isoformat(), ultimas)

    errores = 0
    for nombre in [f.strip() for f in args.fuentes.split(",") if f.strip()]:
        mod = FUENTES[nombre]
        try:
            disponible = mod.ultima_corrida(ahora) if nombre == "gfs" else mod.ultima_corrida()
            if disponible is None:
                continue
            previa = ultimas.get(nombre)
            if previa and not args.forzar and datetime.fromisoformat(previa) >= disponible:
                log.info("%s: corrida %s ya procesada", nombre, disponible.isoformat())
                continue
            res = mod.obtener(eventos, hasta, ahora)
            if not res:
                continue
            _, filas = res
            log.info("%s: %d filas", nombre, len(filas))
            log.info("%s: %s", nombre, api.pronosticos(filas))
        except Exception:  # noqa: BLE001
            errores += 1
            log.exception("Fallo la fuente %s", nombre)

    # Niveles con todas las fuentes guardadas
    completo = api.estado(incluir_pronosticos=True)
    pron = completo.get("pronosticos") or []
    por_evento = {}
    for ev in completo.get("eventos") or []:
        filas_ev = [p for p in pron if p["evento_id"] == ev["id"]]
        por_evento[ev["id"]] = motor.niveles_evento(ev, filas_ev, ahora)
        log.info("%s: %d tramos de nivel", ev["nombre"], len(por_evento[ev["id"]]))
    log.info("niveles: %s", api.niveles(por_evento))
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
