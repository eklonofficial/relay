"""Builds fonts/minecraft-{regular,bold}.woff2 from the public-domain "Minecraft" font by Jacob Debono
(https://www.fontspace.com/minecraft-font-f28180), adding the few characters the UI uses that it lacks.

    pip install fonttools brotli
    python docs/games/blockhaven/tools/font.py <folder with MinecraftRegular-*.otf and MinecraftBold-*.otf>

The font is drawn on a 100-unit pixel grid (1000-unit em, 7-px caps, 1-px descender), so the added
glyphs are pixel bitmaps on the same grid. Bold is the regular glyph drawn twice, 1 px apart, like
the font's own bold.
"""
import sys
from pathlib import Path

from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.ttLib import TTFont

PX = 100
OUT = Path(__file__).resolve().parent.parent / "fonts"

# Rows top to bottom: rows 0-6 above the baseline, row 7 below it.
EXTRA = {
    "…": ["", "", "", "", "", "#.#.#", "#.#.#"],  # … (three of the font's 1x2 full stops)
    "→": ["", "....#..", ".....#.", "#######", ".....#.", "....#.."],  # →
    "←": ["", "..#....", ".#.....", "#######", ".#.....", "..#...."],  # ←
    "↑": ["..#..", ".###.", "#.#.#", "..#..", "..#..", "..#..", "..#.."],  # ↑
    "↓": ["..#..", "..#..", "..#..", "..#..", "#.#.#", ".###.", "..#.."],  # ↓
    "×": ["", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],  # ×
    "°": [".##.", "#..#", "#..#", ".##."],  # °
}
# Characters that reuse an existing glyph.
ALIAS = {"–": "-", "‘": "'", "’": "'", "“": '"', "”": '"'}


def embolden(rows):
    w = max((len(r) for r in rows), default=0) + 1
    return ["".join("#" if (r + ".")[x : x + 1] == "#" or (x > 0 and r[x - 1 : x] == "#") else "." for x in range(w)) for r in rows]


def add_glyphs(font, bold):
    cff = font["CFF "].cff
    top = cff.topDictIndex[0]
    cs = top.CharStrings
    cmaps = [t for t in font["cmap"].tables if t.isUnicode()]
    best = font.getBestCmap()
    for ch, rows in EXTRA.items():
        name = f"uni{ord(ch):04X}"
        if name in cs:
            continue
        rows = embolden(rows) if bold else rows
        width = max(len(r) for r in rows)
        adv = (width + 1) * PX
        pen = T2CharStringPen(adv, None)
        for r, row in enumerate(rows):
            y0 = (6 - r) * PX
            x = 0
            while x < len(row):
                if row[x] != "#":
                    x += 1
                    continue
                end = x
                while end < len(row) and row[end] == "#":
                    end += 1
                # One rectangle per run, anticlockwise like CFF outlines.
                pen.moveTo((x * PX, y0))
                pen.lineTo((end * PX, y0))
                pen.lineTo((end * PX, y0 + PX))
                pen.lineTo((x * PX, y0 + PX))
                pen.closePath()
                x = end
        cs.charStringsIndex.append(pen.getCharString(private=top.Private, globalSubrs=cff.GlobalSubrs))
        cs.charStrings[name] = len(cs.charStringsIndex) - 1
        top.charset.append(name)  # the CFF charset is the font's glyph order
        font["hmtx"].metrics[name] = (adv, 0)
        for t in cmaps:
            t.cmap[ord(ch)] = name
    for ch, src in ALIAS.items():
        for t in cmaps:
            t.cmap.setdefault(ord(ch), best[ord(src)])
    font.setGlyphOrder(top.charset)
    font["maxp"].numGlyphs = len(top.charset)


def main(src):
    src = Path(src)
    for style, pattern in (("regular", "MinecraftRegular-*.otf"), ("bold", "MinecraftBold-*.otf")):
        path = next(src.glob(pattern))
        font = TTFont(path)
        add_glyphs(font, style == "bold")
        font.flavor = "woff2"
        out = OUT / f"minecraft-{style}.woff2"
        font.save(out)
        print(f"{path.name} -> {out.relative_to(OUT.parent)} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
