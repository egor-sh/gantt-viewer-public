#!/usr/bin/env python3
"""Generate app icon PNGs at standard macOS sizes.

Output: build/icon.iconset/icon_<size>x<size>.png (and @2x variants)
Then on macOS run: iconutil -c icns build/icon.iconset -o build/icon.icns
"""
import os
import math
import struct
import zlib

OUT_DIR = "/home/z/my-project/build/icon.iconset"
os.makedirs(OUT_DIR, exist_ok=True)

# Brand colors
BG = (5, 150, 105)      # emerald-600
BG_DARK = (4, 120, 87)  # emerald-700
BAR = (255, 255, 255)
CRITICAL = (254, 226, 226)  # rose-100


def write_png(path: str, width: int, height: int, pixels: bytes):
    """Write raw RGBA pixels as PNG."""
    def chunk(typ: bytes, data: bytes) -> bytes:
        c = struct.pack(">I", len(data)) + typ + data
        crc = zlib.crc32(typ + data) & 0xFFFFFFFF
        return c + struct.pack(">I", crc)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    raw = b""
    for y in range(height):
        raw += b"\x00" + pixels[y * width * 4 : (y + 1) * width * 4]
    idat = zlib.compress(raw, 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


def render(size: int) -> bytes:
    """Render the icon at given size, return RGBA bytes."""
    # Render at 2x then downscale via box sampling for basic anti-aliasing.
    S = size * 2
    pixels = bytearray(S * S * 4)
    radius = S * 0.22
    margin = S * 0.05

    def in_rounded_rect(x, y):
        x0, y0 = margin, margin
        x1, y1 = S - margin, S - margin
        if x < x0 or x > x1 or y < y0 or y > y1:
            return False
        for (cx0, cy0) in [(x0 + radius, y0 + radius), (x1 - radius, y0 + radius),
                            (x0 + radius, y1 - radius), (x1 - radius, y1 - radius)]:
            if (x < x0 + radius or x > x1 - radius) and (y < y0 + radius or y > y1 - radius):
                if (x - cx0) ** 2 + (y - cy0) ** 2 > radius * radius:
                    return False
        return True

    bars = [
        (0.18, 0.30, 0.20, 0.70, False),
        (0.34, 0.46, 0.32, 0.85, False),
        (0.50, 0.62, 0.18, 0.60, True),
        (0.66, 0.78, 0.40, 0.78, False),
    ]
    diamond = (0.68, 0.24)

    for y in range(S):
        for x in range(S):
            idx = (y * S + x) * 4
            if not in_rounded_rect(x, y):
                pixels[idx : idx + 4] = b"\x00\x00\x00\x00"
                continue
            t = (x + y) / (2 * S)
            r = int(BG[0] * (1 - t * 0.25) + BG_DARK[0] * t * 0.25)
            g = int(BG[1] * (1 - t * 0.25) + BG_DARK[1] * t * 0.25)
            b = int(BG[2] * (1 - t * 0.25) + BG_DARK[2] * t * 0.25)
            pixels[idx : idx + 3] = bytes([r, g, b])
            pixels[idx + 3] = 255

            nx, ny = x / S, y / S
            for (ys, ye, xs, xe, crit) in bars:
                if ys <= ny <= ye and xs <= nx <= xe:
                    if crit:
                        pixels[idx : idx + 3] = bytes(CRITICAL)
                    else:
                        pixels[idx : idx + 3] = bytes(BAR)
                    break
            dx = nx - diamond[0]
            dy = ny - diamond[1]
            if abs(dx) + abs(dy) < 0.04:
                pixels[idx : idx + 3] = bytes(BAR)

    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            r_sum = g_sum = b_sum = a_sum = 0
            for dy in range(2):
                for dx in range(2):
                    sx, sy = x * 2 + dx, y * 2 + dy
                    i = (sy * S + sx) * 4
                    a = pixels[i + 3]
                    a_sum += a
                    if a > 0:
                        r_sum += pixels[i] * a
                        g_sum += pixels[i + 1] * a
                        b_sum += pixels[i + 2] * a
            o = (y * size + x) * 4
            if a_sum > 0:
                out[o] = r_sum // a_sum
                out[o + 1] = g_sum // a_sum
                out[o + 2] = b_sum // a_sum
                out[o + 3] = a_sum // 4
            else:
                out[o : o + 4] = b"\x00\x00\x00\x00"
    return bytes(out)


SIZES = [
    (16, "icon_16x16.png"),
    (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"),
    (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"),
    (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"),
    (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"),
    (1024, "icon_512x512@2x.png"),
]

for sz, name in SIZES:
    path = os.path.join(OUT_DIR, name)
    print(f"Rendering {name} ({sz}x{sz})…")
    px = render(sz)
    write_png(path, sz, sz, px)
    print(f"  wrote {path} ({os.path.getsize(path)} bytes)")

print("\nDone. Now on macOS run:")
print("  iconutil -c icns build/icon.iconset -o build/icon.icns")
