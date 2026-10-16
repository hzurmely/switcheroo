"""Draws the macOS menu bar icons (template images) for Switcheroo.

macOS menu bar icons are "template" images: black shapes on a transparent
background. The system recolors them to match the menu bar (white in dark mode,
black in light mode, highlighted when clicked), the same way it treats the
Wi-Fi, Bluetooth and volume icons. Electron treats any file whose name ends in
"Template" as a template image and picks up the @2x file on Retina screens.

Run:  python3 scripts/make-tray-icons.py   (needs Pillow)
"""

import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SS = 32  # supersampling factor per point
PT = 18  # icon size in points, same as the system status icons


def draw(alpha):
    size = PT * SS
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    a = int(255 * alpha)
    ink = (0, 0, 0, a)

    def p(v):
        return v * SS

    # Wi-Fi fan: three arcs over the swap arrows.
    cx, cy = p(9), p(11.2)
    stroke = p(1.6)
    for r in (p(2.9), p(5.7), p(8.5)):
        d.arc([cx - r, cy - r, cx + r, cy + r], 225, 315, fill=ink, width=int(stroke))
        # round the arc ends
        for ang in (225, 315):
            t = math.radians(ang)
            rr = r - stroke / 2
            ex, ey = cx + rr * math.cos(t), cy + rr * math.sin(t)
            d.ellipse([ex - stroke / 2, ey - stroke / 2, ex + stroke / 2, ey + stroke / 2], fill=ink)

    # Swap arrows under the fan: one pointing right on top, one pointing left below.
    def arrow(y, left_to_right):
        x0, x1 = p(4.6), p(13.4)
        w = p(1.3)
        head = p(1.6)
        if left_to_right:
            d.rounded_rectangle([x0, y - w / 2, x1 - head * 0.6, y + w / 2], radius=w / 2, fill=ink)
            d.polygon([(x1 + p(0.4), y), (x1 - head, y - head), (x1 - head, y + head)], fill=ink)
        else:
            d.rounded_rectangle([x0 + head * 0.6, y - w / 2, x1, y + w / 2], radius=w / 2, fill=ink)
            d.polygon([(x0 - p(0.4), y), (x0 + head, y - head), (x0 + head, y + head)], fill=ink)

    arrow(p(13.3), True)
    arrow(p(16.2), False)
    return img


def save(state, alpha):
    big = draw(alpha)
    for scale, suffix in ((1, ""), (2, "@2x")):
        px = PT * scale
        out = big.resize((px, px), Image.LANCZOS)
        out.save(os.path.join(ROOT, f"tray-{state}Template{suffix}.png"))


if __name__ == "__main__":
    save("on", 1.0)
    # Paused: dimmed, like the system dims the Wi-Fi icon when it is off.
    save("off", 0.4)
