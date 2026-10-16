"""Draws the Windows tray icons that show which network is active.

Windows tray icons cannot carry text, so the active network is drawn into the icon
itself: the colour Wi-Fi icon with a small label badge (5G, 2.4G, A or B) at the bottom.
The app picks the file from the label: tray-on-<label>.png

Run:  python3 scripts/make-tray-badges.py   (needs Pillow)
"""

import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
LABELS = ["5G", "2.4G", "A", "B"]
FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]
SS = 8  # supersampling
SIZE = 32


def font(px):
    for f in FONTS:
        if os.path.exists(f):
            return ImageFont.truetype(f, px)
    raise SystemExit("No bold font found, edit FONTS in this script.")


def make(label):
    base = Image.open(os.path.join(ROOT, "tray-on.png")).convert("RGBA")
    big = base.resize((SIZE * SS, SIZE * SS), Image.LANCZOS)
    # lift the Wi-Fi icon up and make room for the badge underneath
    scaled = big.resize((int(SIZE * SS * 0.78), int(SIZE * SS * 0.78)), Image.LANCZOS)
    # same white square as the plain tray-on.png, so the badge icons sit in the tray like it does
    canvas = Image.new("RGBA", big.size, base.getpixel((0, 0)))
    canvas.paste(scaled, ((big.width - scaled.width) // 2, 0), scaled)
    d = ImageDraw.Draw(canvas)
    f = font(int(SIZE * SS * (0.40 if len(label) > 2 else 0.46)))
    l, t, r, b = d.textbbox((0, 0), label, font=f)
    tw, th = r - l, b - t
    pad = int(SIZE * SS * 0.07)
    h = th + pad * 2
    w = max(tw + pad * 2, h)
    x0 = (big.width - w) // 2
    y0 = big.height - h
    d.rounded_rectangle([x0, y0, x0 + w, big.height - 1], radius=h // 2, fill=(30, 31, 34, 255), outline=(88, 101, 242, 255), width=SS)
    d.text((x0 + (w - tw) // 2 - l, y0 + (h - th) // 2 - t), label, font=f, fill=(255, 255, 255, 255))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


if __name__ == "__main__":
    for lab in LABELS:
        make(lab).save(os.path.join(ROOT, f"tray-on-{lab}.png"))
