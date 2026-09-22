#!/usr/bin/env python3
"""Draw the OpenGraph card at assets/og.png.

LinkedIn is the only distribution channel in the plan, and a post without an
og:image renders as a text-only card. This is the one raster asset on the site —
generated rather than hand-made, so the wordmark and palette can never drift from
css/base.css. Run it if either changes.

    python3 make-og.py
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
GROUND = (11, 16, 21)          # --ground
SURFACE = (18, 27, 35)         # --surface
INK = (221, 231, 238)          # --ink
MUTED = (125, 147, 162)        # --muted
SIGNAL = (46, 155, 210)        # --signal
REFLECT = (190, 135, 34)       # --reflect
GRID = (27, 40, 51)            # --grid

MONO = "/System/Library/Fonts/Menlo.ttc"
SANS = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def font(path, size, index=0):
    try:
        return ImageFont.truetype(path, size, index=index)
    except Exception:
        return ImageFont.load_default()


def ringing(n, a0=50 / 60, gs=(10 - 50) / (10 + 50), gl=1.0, waves=9):
    """The load voltage of an unterminated line, exactly as js/viz/reflection.js
    computes it: a step arrives at Td, and each round trip adds another of size
    a0(1+GL)(GL*Gs)^m. With Gs negative the result is the familiar staircase that
    overshoots and converges. Drawn rather than sketched so the card is the same
    physics as the first page of the site."""
    out = []
    for i in range(n):
        t = i / n * 9.0                       # in units of Td
        v = 0.0
        for m in range(waves):
            arrive = 2 * m + 1
            if t >= arrive:
                edge = min(1.0, (t - arrive) * 5.0)   # finite rise
                v += a0 * (1 + gl) * ((gl * gs) ** m) * edge
        out.append(v)
    return out


def main():
    img = Image.new("RGB", (W, H), GROUND)
    d = ImageDraw.Draw(img)

    for x in range(0, W, 60):
        d.line([(x, 0), (x, H)], fill=GRID, width=1)
    for y in range(0, H, 60):
        d.line([(0, y), (W, y)], fill=GRID, width=1)

    # ---- wordmark: SIPI, matching the masthead brand ----
    fw = font(MONO, 104, index=1)
    parts = [("SI", INK), ("PI", SIGNAL)]
    total = sum(d.textlength(t, font=fw) for t, _ in parts)
    x = (W - total) / 2
    for text, colour in parts:
        d.text((x, 74), text, font=fw, fill=colour)
        x += d.textlength(text, font=fw)

    fs = font(SANS, 42)
    tag = "Signal and power integrity, visualised"
    d.text(((W - d.textlength(tag, font=fs)) / 2, 208), tag, font=fs, fill=INK)

    fm = font(MONO, 25)
    sub = "reflections  ·  crosstalk  ·  loss  ·  jitter  ·  PDN impedance"
    d.text(((W - d.textlength(sub, font=fm)) / 2, 268), sub, font=fm, fill=MUTED)

    # ---- the waveform, in its own band well clear of every text row ----
    x0, x1 = 96, W - 96
    top, bottom = 352, 486
    settle = bottom - (bottom - top) * 0.52
    vs = ringing(x1 - x0)
    scale = (bottom - settle) / 1.0
    d.line([(x0, bottom), (x1, bottom)], fill=GRID, width=2)
    d.line([(x0, settle), (x1, settle)], fill=(58, 74, 88), width=1)
    pts = [(x0 + i, bottom - v * scale) for i, v in enumerate(vs)]
    for w, col in ((11, (18, 47, 66)), (7, (26, 78, 108))):        # cheap glow
        d.line(pts, fill=col, width=w, joint="curve")
    d.line(pts, fill=SIGNAL, width=5, joint="curve")
    # labels sit above the band, never on the trace
    fl = font(MONO, 22)
    d.text((x0, 316), "1 V step into an unterminated line", font=fl, fill=MUTED)
    d.text((x1 - d.textlength("overshoot 67%", font=fl), 316), "overshoot 67%", font=fl, fill=REFLECT)

    fb = font(MONO, 24)
    by = "Things you can drag, not equations you have to trust"
    d.text(((W - d.textlength(by, font=fb)) / 2, H - 106), by, font=fb, fill=MUTED)
    dom = "sipi.work"
    d.text(((W - d.textlength(dom, font=fb)) / 2, H - 66), dom, font=fb, fill=SIGNAL)

    out = Path(__file__).parent / "assets" / "og.png"
    out.parent.mkdir(exist_ok=True)
    img.save(out, "PNG", optimize=True)
    print(f"wrote {out.relative_to(Path(__file__).parent)} "
          f"({out.stat().st_size / 1024:.0f} KB, {W}x{H})")


if __name__ == "__main__":
    main()
