#!/usr/bin/env python3
"""Neuer Leo (ab 0.9.0): sechs Posen aus Canva (grüner Hintergrund) freistellen, mit KI hochskalieren und auf 2160 px Höhe bringen.
Aufruf: python3 tools/make-leo.py <Ordner mit den sechs PNG-Dateien>
Zuordnung (Dateiname → Menüpunkt) steht unten in POSEN. Ergebnisse: src/assets/figuren/chars/leo/<menüpunkt>.webp. Wiederaufnehmbar (Zwischenstand in /tmp/leo-work)."""
import sys, os, shutil, time
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sr

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "assets", "figuren", "chars", "leo")
WORK = "/tmp/leo-work"; os.makedirs(WORK, exist_ok=True)
POSEN = {"notizen": "width_1024__1_.png", "kontakte": "width_1024__6_.png", "berichtsheft": "width_1024__5_.png",
         "projekte": "width_1024__4_.png", "dateien": "width_1024__2_.png", "system": "width_1024__3_.png"}
H4K = 2160
log = lambda *a: print(*a, flush=True)

def key(im):
    a = np.asarray(im.convert("RGB")).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    spill = g - np.maximum(r, b)
    alpha = np.clip(1 - (spill - 30) / 90, 0, 1)
    g2 = np.minimum(g, np.maximum(r, b) + 8)                       # grünen Rand entfernen
    return np.dstack([r, g2, b]).clip(0, 255).astype("uint8"), (alpha * 255).astype("uint8")

for name, f in POSEN.items():
    dst = os.path.join(WORK, name + ".webp")
    if os.path.exists(dst): log("schon fertig:", name); continue
    t0 = time.time()
    rgb, a = key(Image.open(os.path.join(SRC, f)))
    # Farben unter transparenten Stellen mit den nächsten sichtbaren Farben füllen (keine grünen oder dunklen Ränder)
    solid = Image.fromarray(rgb); mask = Image.fromarray(((a > 8) * 255).astype("uint8"))
    for _ in range(6):
        solid = Image.composite(solid, solid.filter(ImageFilter.MaxFilter(5)), mask); mask = mask.filter(ImageFilter.MaxFilter(5))
    big = sr.upscale4(np.asarray(solid))                            # 4096×6144 mit Real-ESRGAN
    abig = np.asarray(Image.fromarray(a).resize((big.shape[1], big.shape[0]), Image.LANCZOS))
    im = Image.fromarray(np.dstack([big, abig]), "RGBA")
    x0, y0, x1, y1 = im.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    im = im.crop((max(0, x0 - 24), max(0, y0 - 24), min(im.width, x1 + 24), im.height))      # unten bleibt der Bildrand (Figur ist dort abgeschnitten)
    w = round(im.width * H4K / im.height)
    im = im.convert("RGBa").resize((w, H4K), Image.LANCZOS).convert("RGBA")
    im.save(dst, "WEBP", quality=88, method=4, alpha_quality=92)
    log(f"{name}: {im.size}, {os.path.getsize(dst) // 1024} KB, {time.time() - t0:.0f} s")
os.makedirs(OUT, exist_ok=True)
for name in POSEN: shutil.copy(os.path.join(WORK, name + ".webp"), os.path.join(OUT, name + ".webp"))
log("fertig: 6 Posen nach", os.path.relpath(OUT))
