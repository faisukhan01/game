#!/usr/bin/env python3
"""Build the VOIDSTRIKE Android launcher icons from the generated 1024px art.

Produces:
- legacy ic_launcher.png mipmaps (full-bleed dark square with the soldier art)
- adaptive-icon foreground PNGs (108dp basis, full-bleed art)
and removes the old vector foreground (name collision with the PNGs).
"""
from PIL import Image, ImageFilter
from collections import deque
import os

SRC = "/home/z/my-project/icon-raw.png"
RES = "/home/z/my-project/mobile/flutter_app/android/app/src/main/res"

img = Image.open(SRC).convert("RGBA")
if img.size != (1024, 1024):
    img = img.resize((1024, 1024), Image.LANCZOS)

# ---- 1. Kill the white rounded-corner backdrop -----------------------------
# Flood-fill the corners: anything near-white connected to the corners
# becomes transparent.
px = img.load()
W, H = img.size


def near_white(p):
    r, g, b, a = p
    return r >= 242 and g >= 242 and b >= 242


seen = [[False] * W for _ in range(H)]
q = deque()
for sx, sy in [
    (0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1),
    (W // 2, 0), (W // 2, H - 1), (0, H // 2), (W - 1, H // 2),
]:
    if near_white(px[sx, sy]):
        q.append((sx, sy))
        seen[sy][sx] = True
while q:
    x, y = q.popleft()
    px[x, y] = (0, 0, 0, 0)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < W and 0 <= ny < H and not seen[ny][nx] and near_white(px[nx, ny]):
            seen[ny][nx] = True
            q.append((nx, ny))

# Slight blur on the alpha edge to smooth the cut.
alpha = img.getchannel("A").filter(ImageFilter.GaussianBlur(1.2))
img.putalpha(alpha)

# ---- 2. Full-bleed dark background behind the art --------------------------
BG_TOP = (38, 40, 46)
BG_BOT = (46, 26, 32)
bg = Image.new("RGBA", (W, H))
bpx = bg.load()
for y in range(H):
    t = y / (H - 1)
    r = int(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t)
    g = int(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t)
    b = int(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t)
    for x in range(W):
        bpx[x, y] = (r, g, b, 255)
full = Image.alpha_composite(bg, img)

# ---- 3. Emit densities ------------------------------------------------------
# Legacy launcher icons (dp: 48 base).
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
# Adaptive foreground (dp: 108 base).
FOREG = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

for dpi, size in LEGACY.items():
    d = os.path.join(RES, f"mipmap-{dpi}")
    os.makedirs(d, exist_ok=True)
    full.resize((size, size), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))

for dpi, size in FOREG.items():
    d = os.path.join(RES, f"drawable-{dpi}")
    os.makedirs(d, exist_ok=True)
    full.resize((size, size), Image.LANCZOS).save(os.path.join(d, "ic_launcher_foreground.png"))

# Remove the old vector foreground (resource name collision with the PNGs).
old_xml = os.path.join(RES, "drawable", "ic_launcher_foreground.xml")
if os.path.exists(old_xml):
    os.remove(old_xml)

# Store icon for the repo / release notes.
full.resize((512, 512), Image.LANCZOS).save("/home/z/my-project/icon-store.png")

print("icons written")
