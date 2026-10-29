"""Exploración de fuentes nuevas (no guarda nada): pronóstico a 5 días del SMN (datos abiertos) e ICON global (DWD).

Publica lo encontrado como anotaciones de GitHub Actions (los logs completos no se leen desde la sesión).
Ejecución: python -m mon.explorar_fuentes
"""

from __future__ import annotations

import bz2
import io
import re
import sys
import tempfile
import time
import zipfile
from datetime import datetime, timedelta, timezone

import eccodes
import requests

UA = {"user-agent": "EMERTEAM-Monitoreo/1.0 (info@emerteam.com.ar)"}
DWD = "https://opendata.dwd.de/weather/nwp/icon/grib"


def nota(titulo: str, texto: str) -> None:
    texto = texto.replace("%", "%25").replace("\r", "").replace("\n", " ⏎ ")
    for i in range(0, len(texto), 3500):
        print(f"::notice title={titulo} {i // 3500 + 1}::{texto[i:i + 3500]}", flush=True)


def smn() -> None:
    for dato in ("pron5d", "pronostico"):
        try:
            r = requests.get(f"https://ssl.smn.gob.ar/dpd/zipopendata.php?dato={dato}", headers=UA, timeout=60)
            nota(f"SMN {dato} HTTP", f"{r.status_code} · {r.headers.get('content-type')} · {len(r.content)} bytes")
            if r.status_code != 200 or not r.content[:2] == b"PK":
                nota(f"SMN {dato} cuerpo", r.text[:600] if r.status_code == 200 else "")
                continue
            z = zipfile.ZipFile(io.BytesIO(r.content))
            nota(f"SMN {dato} archivos", ", ".join(f"{i.filename} ({i.file_size} B)" for i in z.infolist()))
            for info in z.infolist()[:2]:
                txt = z.read(info).decode("latin1")
                lineas = txt.splitlines()
                nota(f"SMN {dato} cabecera {info.filename}", "\n".join(lineas[:40]))
                for buscada in ("AEROPARQUE", "SAN FERNANDO", "BUENOS AIRES", "MAR DEL PLATA", "VICENTE"):
                    idx = [i for i, l in enumerate(lineas) if buscada in l.upper()]
                    if idx:
                        i0 = idx[0]
                        nota(f"SMN {dato} {buscada}", f"{len(idx)} coincidencias · " + "\n".join(lineas[i0:i0 + 45]))
        except Exception as e:  # noqa: BLE001
            nota(f"SMN {dato} error", repr(e)[:800])


def _ultima_icon() -> datetime | None:
    ahora = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    base = ahora - timedelta(hours=ahora.hour % 6)
    for k in range(4):
        c = base - timedelta(hours=6 * k)
        url = f"{DWD}/{c:%H}/t_2m/icon_global_icosahedral_single-level_{c:%Y%m%d%H}_120_T_2M.grib2.bz2"
        if requests.head(url, headers=UA, timeout=30).status_code == 200:
            return c
    return None


def _grib(url: str) -> tuple[bytes, float, int]:
    t0 = time.time()
    r = requests.get(url, headers=UA, timeout=120)
    r.raise_for_status()
    crudo = len(r.content)
    return bz2.decompress(r.content), time.time() - t0, crudo


def icon() -> None:
    try:
        c = _ultima_icon()
        nota("ICON corrida", str(c))
        if c is None:
            return
        r = requests.get(f"{DWD}/{c:%H}/", headers=UA, timeout=60)
        carpetas = sorted(set(re.findall(r'href="([a-z0-9_]+)/"', r.text)))
        nota("ICON carpetas", ", ".join(carpetas))
        r = requests.get(f"{DWD}/{c:%H}/vmax_10m/", headers=UA, timeout=60)
        pasos = sorted({int(x) for x in re.findall(rf"{c:%Y%m%d%H}_(\d{{3}})_VMAX_10M", r.text)})
        nota("ICON pasos VMAX_10M", f"{len(pasos)} pasos: {pasos[:5]} … {pasos[-8:]}")
        for var, carpeta, paso in (("T_2M", "t_2m", 24), ("VMAX_10M", "vmax_10m", 24), ("TOT_PREC", "tot_prec", 24),
                                   ("ASWDIR_S", "aswdir_s", 24), ("ASWDIFD_S", "aswdifd_s", 24), ("CAPE_ML", "cape_ml", 24),
                                   ("TD_2M", "td_2m", 24), ("PS", "ps", 24), ("U_10M", "u_10m", 24), ("VMAX_10M", "vmax_10m", 120),
                                   ("CLCT", "clct", 24)):
            url = f"{DWD}/{c:%H}/{carpeta}/icon_global_icosahedral_single-level_{c:%Y%m%d%H}_{paso:03d}_{var}.grib2.bz2"
            try:
                datos, seg, crudo = _grib(url)
                gid = eccodes.codes_new_from_message(datos)
                info = {k: eccodes.codes_get(gid, k) for k in ("shortName", "stepType", "startStep", "endStep", "numberOfDataPoints", "units")}
                try:
                    info["gridType"] = eccodes.codes_get(gid, "gridType")
                except Exception:  # noqa: BLE001
                    pass
                eccodes.codes_release(gid)
                nota(f"ICON {var} +{paso}", f"{info} · {crudo / 1e6:.1f} MB bz2 · {seg:.1f} s")
            except Exception as e:  # noqa: BLE001
                nota(f"ICON {var} error", repr(e)[:500])
        r = requests.get(f"{DWD}/{c:%H}/clat/", headers=UA, timeout=60)
        nota("ICON clat", " ".join(re.findall(r'href="([^"]+\.bz2)"', r.text))[:600])
    except Exception as e:  # noqa: BLE001
        nota("ICON error", repr(e)[:800])


def main() -> int:
    smn()
    icon()
    return 0


if __name__ == "__main__":
    sys.exit(main())
