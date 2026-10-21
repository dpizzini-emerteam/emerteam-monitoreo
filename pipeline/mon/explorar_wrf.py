"""Exploración del WRF determinístico del SMN (4 km, datos abiertos en AWS, bucket smn-ar-wrf, CC BY 2.5 AR).

Lee por rangos HTTP (sin bajar el archivo completo) la estructura de un archivo horario y deja el resultado
como anotaciones de GitHub Actions: variables, dimensiones, compresión, fragmentación y atributos.
Uso: python -m mon.explorar_wrf [AAAAMMDDHH]
"""

from __future__ import annotations

import sys
import time
from datetime import datetime, timedelta, timezone

import fsspec
import h5py
import numpy as np
import requests

BUCKET = "https://smn-ar-wrf.s3.us-west-2.amazonaws.com"


def nota(t: str) -> None:
    print(f"::notice title=WRF::{t.replace('%', '%25').replace(chr(10), ' ')}"[:3900], flush=True)


def ultima() -> str:
    ahora = datetime.now(timezone.utc)
    for k in range(0, 48, 6):
        c = (ahora - timedelta(hours=k)).replace(minute=0, second=0, microsecond=0)
        c = c - timedelta(hours=c.hour % 6)
        p = f"DATA/WRF/DET/{c:%Y/%m/%d/%H}/WRFDETAR_01H_{c:%Y%m%d_%H}_072.nc"
        if requests.head(f"{BUCKET}/{p}", timeout=20).status_code == 200:
            return c.strftime("%Y%m%d%H")
    raise SystemExit("sin corrida")


def main() -> None:
    c = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else ultima()
    d = datetime.strptime(c, "%Y%m%d%H")
    tipos = sys.argv[2].split(",") if len(sys.argv) > 2 and sys.argv[2] else ["01H", "10M", "24H"]
    for tipo, paso in (("01H", "024"), ("10M", "024"), ("24H", "001")):
        if tipo not in tipos:
            continue
        url = f"{BUCKET}/DATA/WRF/DET/{d:%Y/%m/%d/%H}/WRFDETAR_{tipo}_{d:%Y%m%d_%H}_{paso}.nc"
        t0 = time.time()
        fs = fsspec.filesystem("http")
        with fs.open(url, block_size=2**20, cache_type="readahead") as fh, h5py.File(fh, "r") as h:
            partes = []
            for k, v in h.items():
                if isinstance(v, h5py.Dataset):
                    at = {a: (v.attrs[a].decode() if isinstance(v.attrs[a], bytes) else (v.attrs[a].tolist() if hasattr(v.attrs[a], "tolist") else v.attrs[a]))
                          for a in v.attrs if a in ("units", "long_name", "description", "standard_name", "coordinates", "grid_mapping", "_FillValue", "scale_factor")}
                    partes.append(f"{k}{list(v.shape)} {v.dtype} ch={v.chunks} comp={v.compression} {at}")
            nota(f"{tipo} {paso}: " + " || ".join(partes))
            glob = {a: (h.attrs[a].decode() if isinstance(h.attrs[a], bytes) else str(h.attrs[a])) for a in list(h.attrs)[:25]}
            nota(f"{tipo} atributos: {glob}")
            if tipo == "01H":
                for n in ("lat", "lon", "XLAT", "XLONG", "Lambert_Conformal", "x", "y", "time"):
                    if n in h:
                        v = h[n]
                        if v.ndim >= 1 and v.size > 1:
                            a = np.asarray(v[...]).astype(float)
                            nota(f"{n}: min {np.nanmin(a):.4f} max {np.nanmax(a):.4f} paso {np.ravel(a)[1] - np.ravel(a)[0]:.4f} ejemplo {np.ravel(a)[:3].tolist()}")
                        else:
                            nota(f"{n}: {np.asarray(v[...]).tolist()} attrs {dict((a, str(v.attrs[a])) for a in v.attrs)}")
                # Lectura de un punto (Buenos Aires) para medir costo de acceso puntual
                if "lat" in h and "lon" in h and h["lat"].ndim == 2:
                    la, lo = np.asarray(h["lat"][...]), np.asarray(h["lon"][...])
                    j, i = np.unravel_index(np.argmin((la + 34.6) ** 2 + (lo + 58.4) ** 2), la.shape)
                    vals = {k: np.asarray(h[k][..., j, i]).ravel()[:3].tolist() for k, v in h.items()
                            if isinstance(v, h5py.Dataset) and v.ndim >= 3}
                    nota(f"punto BA j={j} i={i} lat {la[j, i]:.3f} lon {lo[j, i]:.3f}: {vals}")
        nota(f"{tipo}: {time.time() - t0:.1f} s")


if __name__ == "__main__":
    main()
