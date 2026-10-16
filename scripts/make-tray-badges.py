"""Draws the Windows tray icons for Switcheroo.

Windows tray icons cannot carry text, so the active network is drawn into the icon:
a brand blue tile with the label on it (5G, 2.4, A or B). With no label (before the first
switch) the plain Wi-Fi icon is used, grey when paused. No white square, transparent
corners, drawn directly at each size so 16 px stays sharp.

Electron picks the right size by file name: tray-on-5G.png (100%), @1.5x (150%), @2x (200%).
The app asks for tray-on-<label>.png, tray-on.png and tray-off.png.

Run:  python3 scripts/make-tray-badges.py   (needs Pillow and a bold font, see FONTS)
"""

import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
LABELS = {"5G": "5G", "2.4G": "2.4", "A": "A", "B": "B"}  # file label -> text on the tile
SIZES = [(16, ""), (24, "@1.5x"), (32, "@2x")]
FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]
SS = 16  # supersampling
TILE = (0, 85, 164, 255)  # brand blue
RED, BLUE, GREY = (239, 65, 53, 255), (61, 135, 214, 255), (139, 142, 150, 255)


def font(px):
    for f in FONTS:
        if os.path.exists(f):
            return ImageFont.truetype(f, px)
    raise SystemExit("No bold font found, edit FONTS in this script.")


def tile(size, text):
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=TILE)
    # the text fills the tile: one character is bigger than a short word
    fpx = int(n * (0.78 if len(text) == 1 else 0.58 if len(text) == 2 else 0.5))
    f = font(fpx)
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    d.text(((n - (r - l)) / 2 - l, (n - (b - t)) / 2 - t), text, font=f, fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


def wifi(size, grey=False):
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = n / 2, n * 0.88
    stroke = n * 0.115
    for r in (n * 0.28, n * 0.52, n * 0.76):
        box = [cx - r, cy - r, cx + r, cy + r]
        if grey:
            d.arc(box, 225, 315, fill=GREY, width=int(stroke))
        else:
            d.arc(box, 225, 269, fill=RED, width=int(stroke))
            d.arc(box, 271, 315, fill=BLUE, width=int(stroke))
    dot = n * 0.085
    d.ellipse([cx - dot, cy - dot, cx + dot, cy + dot], fill=GREY if grey else BLUE)
    return img.resize((size, size), Image.LANCZOS)


def save(name, draw):
    for size, suffix in SIZES:
        draw(size).save(os.path.join(ROOT, f"{name}{suffix}.png"))


if __name__ == "__main__":
    save("tray-on", lambda s: wifi(s))
    save("tray-off", lambda s: wifi(s, grey=True))
    for lab, text in LABELS.items():
        save(f"tray-on-{lab}", lambda s, t=text: tile(s, t))
