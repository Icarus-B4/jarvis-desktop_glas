#!/usr/bin/env python3
"""Build the J.A.R.V.I.S. diamond-mark icon (PNG + multi-res ICO) from vector math.

The nav-rail logo is a HORIZONTAL four-pointed diamond (rhombus), wider than tall,
solid cyan frame with an empty diamond cut-out in the center. No external rasterizer
needed: we rasterize the L1 ("Manhattan") diamond distance field directly with numpy.

Run:  python scripts/make_icon.py
"""
import io
import struct
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_PNG = ROOT / "icons" / "icon.png"
OUT_ICO = ROOT / "icons" / "icon.ico"
SIZES = [16, 24, 32, 48, 64, 128, 256]
ASPECT_W = 1.44  # W / H — real nav icon is wider than tall


def render_icon(size: int, aspect_w: float = ASPECT_W) -> Image.Image:
    s = int(size)
    yy, xx = np.mgrid[0:s, 0:s]
    cy = cx = (s - 1) / 2.0
    w = s * 0.46
    h = w / aspect_w
    d_out = np.abs(xx - cx) / w + np.abs(yy - cy) / h
    w2 = w * 0.42
    h2 = h * 0.42
    d_in = np.abs(xx - cx) / w2 + np.abs(yy - cy) / h2

    shape = (d_out < 1.0) & (d_in > 1.0)
    a = shape.astype(np.float64)
    a = np.where((d_out < 1.0) & (d_out > 0.94), (1.0 - d_out) / 0.06, a)
    a = np.where((d_in > 1.0) & (d_in < 1.06), (d_in - 1.0) / 0.06, a)
    a = np.clip(a, 0, 1)

    t = yy / s
    cr = (154 + (39 - 154) * t) / 255.0
    cg = (242 + (180 - 242) * t) / 255.0
    cb = (255 + (224 - 255) * t) / 255.0

    out = np.empty((s, s, 4), dtype=np.uint8)
    out[:, :, 0] = (cr * 255).astype(np.uint8)
    out[:, :, 1] = (cg * 255).astype(np.uint8)
    out[:, :, 2] = (cb * 255).astype(np.uint8)
    out[:, :, 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def write_ico(path: Path, sizes) -> None:
    blobs = []
    for sz in sizes:
        buf = io.BytesIO()
        render_icon(sz).save(buf, format="PNG")
        blobs.append(buf.getvalue())
    header = struct.pack("<HHH", 0, 1, len(blobs))
    entries = b""
    data = b""
    off = 6 + 16 * len(blobs)
    for png, sz in zip(blobs, sizes):
        e = 0 if sz >= 256 else sz
        entries += struct.pack("<BBBBHHII", e, e, 0, 0, 1, 32, len(png), off)
        data += png
        off += len(png)
    path.write_bytes(header + entries + data)


def main() -> None:
    render_icon(512).save(OUT_PNG, "PNG")
    write_ico(OUT_ICO, SIZES)
    print(f"wrote {OUT_PNG} and {OUT_ICO} ({len(SIZES)} resolutions)")


if __name__ == "__main__":
    main()
