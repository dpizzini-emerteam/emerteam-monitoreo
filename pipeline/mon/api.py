"""Cliente de la función de ingesta mon-ingesta (autenticación OIDC de GitHub Actions)."""

from __future__ import annotations

import os

import requests

URL = os.environ.get("MON_INGESTA_URL", "https://timwhyxdrputxywsolck.supabase.co/functions/v1/mon-ingesta")


def _token() -> str:
    url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL")
    req = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not url or not req:
        raise RuntimeError("Sin token OIDC: el procesamiento solo corre dentro de GitHub Actions")
    r = requests.get(url, params={"audience": "mon-ingesta"},
                     headers={"Authorization": f"Bearer {req}"}, timeout=30)
    r.raise_for_status()
    return r.json()["value"]


class Ingesta:
    def __init__(self) -> None:
        self.s = requests.Session()
        self.s.headers["x-mon-oidc"] = _token()

    def estado(self, incluir_pronosticos: bool = False) -> dict:
        params = {"incluir": "pronosticos"} if incluir_pronosticos else {}
        r = self.s.get(URL, params=params, timeout=60)
        r.raise_for_status()
        return r.json()

    def pronosticos(self, filas: list[dict]) -> dict:
        r = self.s.post(URL, json={"tipo": "pronosticos", "filas": filas}, timeout=120)
        r.raise_for_status()
        return r.json()

    def niveles(self, por_evento: dict[str, list[dict]]) -> dict:
        r = self.s.post(URL, json={"tipo": "niveles", "eventos": por_evento}, timeout=120)
        r.raise_for_status()
        return r.json()
