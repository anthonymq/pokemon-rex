#!/usr/bin/env python3
"""Turns a frame dumped by a view into a PNG, to look at a layout without a terminal.

    POKEDEX_DUMP=/tmp/frame.json POKEDEX_SIZE=100x34 bun bin/pokedex.js collection
    python3 tools/preview.py /tmp/frame.json /tmp/frame.png

Cells are drawn 20x40 px with Menlo standing in for the terminal's font; pictures are placed
on their cell boxes the way kitty graphics scales them.
"""
import json
import sys
from PIL import Image, ImageDraw, ImageFont

CW, CH = 20, 40
frame = json.load(open(sys.argv[1]))
img = Image.new("RGBA", (frame["cols"] * CW, frame["rows"] * CH), "#000000")
draw = ImageDraw.Draw(img)
fonts = {}
for bold in (0, 1):
    try:
        fonts[bold] = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 30, index=1 if bold else 0)
    except OSError:
        fonts[bold] = ImageFont.load_default()
for y, row in enumerate(frame["cells"]):
    for x, (ch, fg, bg, bold) in enumerate(row):
        draw.rectangle([x * CW, y * CH, (x + 1) * CW - 1, (y + 1) * CH - 1], fill=bg)
for im in frame["images"]:
    pic = Image.open(im["file"]).convert("RGBA")
    c = im.get("crop")
    if c:
        pic = pic.crop((c["x"], c["y"], c["x"] + c["w"], c["y"] + c["h"]))
    pic = pic.resize((im["cols"] * CW, im["rows"] * CH), Image.NEAREST)
    img.alpha_composite(pic, (im["x"] * CW, im["y"] * CH + im.get("dy", 0)))
draw = ImageDraw.Draw(img)
for y, row in enumerate(frame["cells"]):
    for x, (ch, fg, bg, bold) in enumerate(row):
        if ch != " ":
            draw.text((x * CW + 1, y * CH + 2), ch, font=fonts[bold], fill=fg)
img.save(sys.argv[2])
print(sys.argv[2], img.size)
