#!/usr/bin/env python3
"""Draws the sidebar's static art into assets/ui/: the lens, the status lights and the
headings set in the PxPlus IBM VGA pixel font. The terminal shows them with kitty graphics.

    python3 tools/make_art.py        (needs Pillow)

A glyph of this font is 8x16, the shape of a terminal cell, so a heading of n letters
drawn at 1x covers n cells by 1 row and at 2x covers 2n cells by 2 rows.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "ui"
FONT = ROOT / "assets" / "fonts" / "PxPlus_IBM_VGA_8x16.ttf"
CREAM, INK, ROSE = "#f7eed7", "#17251f", "#f3bfba"
SS = 4  # supersampling for round shapes


def circle(draw, cx, cy, r, fill):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def lens(size=256):
    """The Pokedex camera: dark bezel, cream ring, blue ring, cyan glass, a glint."""
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = n / 2
    circle(d, c, c, n * 0.50, "#641b2b")
    circle(d, c, c, n * 0.46, CREAM)
    circle(d, c, c, n * 0.38, "#298eaa")
    circle(d, c, c, n * 0.32, "#71d5df")
    # A soft lighter crescent toward the top left, then the glint.
    glow = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    circle(g, c - n * 0.05, c - n * 0.05, n * 0.24, (160, 232, 240, 150))
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img)
    circle(d, c - n * 0.13, c - n * 0.13, n * 0.07, "#edffff")
    img.resize((size, size), Image.LANCZOS).save(OUT / "lens.png")


def dot(name, color, size=64):
    """A round light, one cell tall on a two-cell box (so it is drawn square)."""
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    circle(d, n / 2, n / 2, n * 0.30, "#641b2b")
    circle(d, n / 2, n / 2, n * 0.25, color)
    circle(d, n / 2 - n * 0.08, n / 2 - n * 0.08, n * 0.06, (255, 255, 255, 110))
    img.resize((size, size), Image.LANCZOS).save(OUT / f"{name}.png")


def text(name, value, color, scale=4):
    """A heading in the pixel font, with hard edges, on a transparent ground."""
    font = ImageFont.truetype(str(FONT), 16 * scale)
    w, h = 8 * scale * len(value), 16 * scale
    mask = Image.new("1", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.fontmode = "1"
    ascent, descent = font.getmetrics()
    d.text((0, (h - ascent - descent) // 2), value, font=font, fill=1)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    img.paste(Image.new("RGBA", (w, h), color), (0, 0), mask)
    img.save(OUT / f"{name}.png")


# Every letter the dialogs may write, in one strip per ink: glyph i sits at x = 32 * i. The
# terminal crops one glyph out per cell, so any text can be set in the pixel font.
GLYPHS = "".join(chr(c) for c in range(32, 127)) + "Éé·"
INKS = {
    "cream": "#f7eed7", "ink": "#17251f", "rose": "#f3bfba", "lcd": "#d9e8bc", "mute": "#819788",
    "band": "#355746", "flame": "#b4472f", "cyan": "#71d5df", "amber": "#ffd07a", "soft": "#b6c6b8",
}


def atlas():
    for name, color in INKS.items():
        text("font-" + name, GLYPHS, color)
    (OUT / "font.json").write_text('{"glyphs": %s, "w": 32, "h": 64}\n' % __import__("json").dumps(GLYPHS, ensure_ascii=False))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    lens()
    for name, color in {"light-yellow": "#ffcc67", "light-cyan": "#71d5df", "light-lcd": "#d9e8bc", "light-off": "#6e2930"}.items():
        dot(name, color)
    text("title", "POKEDEX", CREAM)
    text("projects", "PROJECTS / SESSIONS", CREAM)
    text("agents", "POKÉMON / AGENTS", CREAM)
    text("kanto", "KANTO DEX", INK)
    for word in ["NEEDS YOU", "DONE", "WORKING", "IDLE"]:
        text("group-" + word.lower().replace(" ", "-"), word, ROSE)
    atlas()
    for digit in "0123456789":
        text("digit-" + digit, digit, ROSE)
    print("wrote", ", ".join(sorted(p.name for p in OUT.glob("*.png"))))
