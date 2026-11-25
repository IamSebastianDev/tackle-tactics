#!/usr/bin/env python3
"""
Builds src/ui/coin.woff: a one-glyph colour font with the game's money sign, a pixel-art coin.

The coin sits on the private-use code point U+E000. money() (src/meta/player.ts) writes it after
every amount, and the 'TT Coin' face is first in every font stack (unicode-range U+E000 only), so
the coin shows up wherever an amount is printed: tables, buttons, news, letters, toasts.

It's a COLR/CPAL (v0) colour font: one layer per colour, each layer the union of its pixels.
Browsers without colour-font support fall back to the base glyph (the whole coin, in text colour).

Needs fontTools (pip install fonttools). Run: python3 scripts/gen-coin-font.py
"""
from pathlib import Path

from fontTools.colorLib.builder import buildCOLR, buildCPAL
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

# 10x10 pixel art, top row first.  # outline · y gold · Y highlight · d shade
COIN = [
    "...####...",
    "..#YYyy#..",
    ".#YYyyyd#.",
    "#YYyyyyyd#",
    "#Yyyyyyyd#",
    "#Yyyyyydd#",
    "#yyyyyydd#",
    ".#yyyydd#.",
    "..#dddd#..",
    "...####...",
]
COLOURS = {  # layer order: drawn bottom to top
    "#": (0x6b, 0x47, 0x12),
    "y": (0xe0, 0xb0, 0x46),
    "d": (0xb0, 0x7e, 0x28),
    "Y": (0xf7, 0xe2, 0xa8),
}

UPM = 1000
PX = 70  # font units per art pixel: the coin is 700 units, a little taller than a capital
LSB = 70  # breathing room before and after the coin
BASE = -60  # sits a touch below the baseline, like a round glyph


def pixels(char: str) -> list[tuple[int, int]]:
    return [(x, y) for y, row in enumerate(COIN) for x, c in enumerate(row) if c == char]


def glyph(cells: list[tuple[int, int]]):
    pen = TTGlyphPen(None)
    top = BASE + len(COIN) * PX
    for x, y in cells:
        x0, y1 = LSB + x * PX, top - y * PX
        x1, y0 = x0 + PX, y1 - PX
        # clockwise outer contour (TrueType)
        pen.moveTo((x0, y0))
        pen.lineTo((x0, y1))
        pen.lineTo((x1, y1))
        pen.lineTo((x1, y0))
        pen.closePath()
    return pen.glyph()


def main():
    every = [cell for ch in COLOURS for cell in pixels(ch)]
    layers = {f"coin.{i}": pixels(ch) for i, ch in enumerate(COLOURS)}
    glyph_order = [".notdef", "coin", *layers]
    advance = LSB * 2 + len(COIN[0]) * PX

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap({0xE000: "coin"})
    fb.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "coin": glyph(every), **{n: glyph(c) for n, c in layers.items()}})
    # each glyph's left side-bearing must be its real left edge, or renderers shift the layers apart
    cells = {"coin": every, **layers}
    fb.setupHorizontalMetrics(
        {n: (advance, LSB + min(x for x, _ in cells[n]) * PX) if n in cells else (500, 0) for n in glyph_order}
    )
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": "TT Coin", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost()
    font = fb.font
    font["CPAL"] = buildCPAL([[(r / 255, g / 255, b / 255, 1.0) for r, g, b in COLOURS.values()]])
    font["COLR"] = buildCOLR({"coin": [(name, i) for i, name in enumerate(layers)]})

    out = Path(__file__).resolve().parent.parent / "src" / "ui" / "coin.woff"
    font.flavor = "woff"
    font.save(out)
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
