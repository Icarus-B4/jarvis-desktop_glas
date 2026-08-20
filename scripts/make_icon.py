#!/usr/bin/env python3
"""Build a transparent multi-resolution J.A.R.V.I.S. .ico from the existing logo asset.

The shipped logo at icons/ico.png is the real J.A.R.V.I.S. diamond mark but sits on an
opaque WHITE background, which looks wrong in the Windows taskbar / system tray (needs
alpha). This script:
  1. loads icons/ico.png
  2. turns near-white pixels into transparent (soft edges)
  3. writes a cleaned transparent icons/icon.png
  4. writes a multi-resolution icons/icon.ico (16/24/32/48/64/128/256)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "icons" / "ico.png"
OUT_PNG = ROOT / "icons" / "icon.png"
OUT_ICO = ROOT / "icons" / "icon.ico"
SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main() -> int:
    if not SRC.exists():
        print(f"ERROR: source logo not found at {SRC}", file=sys.stderr)
        return 1

    img = Image.open(SRC).convert("RGBA")
    print(f"source size: {img.size}")

    arr = np.asarray(img, dtype=np.float32) / 255.0
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]

    # "whiteness" of a pixel (high when close to white)
    lum = (r + g + b) / 3.0
    # cyan-ish pixels have low red, so they survive the white test
    is_white = (r > 0.85) & (g > 0.85) & (b > 0.85)

    # soft alpha: fully white -> 0, otherwise keep existing alpha
    white_amount = np.clip((lum - 0.80) / 0.18, 0.0, 1.0)
    new_alpha = np.where(is_white, (1.0 - white_amount), a / 255.0)
    new_alpha = (new_alpha * 255.0).clip(0, 255).astype(np.uint8)

    rgba = np.dstack([r, g, b, new_alpha]) * 255.0
    out = Image.fromarray(rgba.astype(np.uint8), "RGBA")

    # tiny cleanup: remove single-pixel noise from hard thresholding
    out = out.filter(ImageFilter.MedianFilter(size=3))

    out.save(OUT_PNG, "PNG")
    print(f"wrote {OUT_PNG} ({out.size})")

    # Build multi-resolution .ico. Each target size is resampled from the
    # transparent source so edges stay crisp.
    frames = []
    for size in SIZES:
        frames.append(out.resize(size, Image.LANCZOS))
    out.save(OUT_ICO, "ICO", sizes=SIZES, appended_images=frames[1:])
    print(f"wrote {OUT_ICO} sizes={SIZES}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
