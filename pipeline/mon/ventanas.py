"""Ventanas temporales de cada evento: armado, carrera, último cuarto, personal y desarme."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Argentina/Buenos_Aires")

# Duración estimada (min) por distancia (km): anclajes EMERTEAM y extremos con caminantes
ANCLAS = [(0.0, 0.0), (3.0, 54.0), (5.0, 75.0), (10.0, 120.0), (21.0975, 180.0), (42.195, 360.0)]


def duracion_estimada_min(km: float) -> float:
    """Interpolación lineal entre anclajes; por encima de 42K se extrapola al ritmo del 42K."""
    if km >= ANCLAS[-1][0]:
        return 360.0 * km / 42.195
    for (k0, d0), (k1, d1) in zip(ANCLAS, ANCLAS[1:]):
        if k0 <= km <= k1:
            return d0 + (d1 - d0) * (km - k0) / (k1 - k0)
    return 0.0


@dataclass
class Ventanas:
    largada: datetime
    fin_carrera: datetime
    inicio_ultimo_cuarto: datetime
    exposicion: tuple[datetime, datetime]
    personal: tuple[datetime, datetime]
    armado: tuple[datetime, datetime]
    desarme: tuple[datetime, datetime]


def calcular(ev: dict) -> Ventanas:
    from .reglas import U
    w = U["ventanas"]
    largada = datetime.fromisoformat(ev["largada"]).astimezone(timezone.utc)
    modalidades = ev.get("mon_modalidades") or []
    demora = ev.get("demora_largada_min")
    if demora is None:
        demora = (ev.get("participantes") or 0) / 1000.0 * w["demora_cada_1000"]  # min cada 1.000 participantes
    if ev.get("duracion_propia_min"):
        duracion = float(ev["duracion_propia_min"])
        fin = largada + timedelta(minutes=demora + duracion)
    else:
        fin = largada
        for m in modalidades or [{"distancia_km": 10}]:
            ini = datetime.fromisoformat(m["largada"]).astimezone(timezone.utc) if m.get("largada") else largada
            f = ini + timedelta(minutes=demora + duracion_estimada_min(float(m["distancia_km"])))
            fin = max(fin, f)
        duracion = (fin - largada).total_seconds() / 60 - demora
    ini_uc = largada + timedelta(minutes=demora + w["ultimo_cuarto"] * duracion)
    local = largada.astimezone(TZ)
    dia0 = local.replace(hour=0, minute=0, second=0, microsecond=0)
    armado_ini = (dia0 - timedelta(days=int(ev.get("armado_dias") or 3))).astimezone(timezone.utc)
    return Ventanas(
        largada=largada,
        fin_carrera=fin,
        inicio_ultimo_cuarto=ini_uc,
        exposicion=(largada - timedelta(minutes=w["exposicion_antes_min"]), fin + timedelta(minutes=w["exposicion_despues_min"])),
        personal=(largada - timedelta(minutes=w["personal_antes_min"]), fin + timedelta(minutes=w["personal_despues_min"])),
        armado=(armado_ini, largada - timedelta(minutes=w["armado_hasta_antes_largada_min"])),
        desarme=(fin, fin + timedelta(minutes=w["desarme_min"])),
    )
