#!/usr/bin/env python3
"""Ergänzt einen oben angeschnittenen Kopf (z. B. bei Leo): Wo die Figur am oberen Bildrand abgeschnitten ist, wird der Scheitel als Stück eines Kreises
nachgezeichnet, der die Kontur fortsetzt (Haarstruktur von den Zeilen darunter, nach oben gespiegelt; der Rand folgt dem Farbverlauf der echten Umrandung). Es ist nur eine kleine Rundung von wenigen Pixeln; die Quelle war schon so.
Aufruf: python3 tools/fix-heads.py [--dry] [--alle]   (ändert die Dateien unter src/assets/figuren/chars/*/; mit --alle auch katze_*, prof_*, nami_*)"""
import sys, os, glob
import numpy as np
from PIL import Image, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "assets", "figuren")
dry = "--dry" in sys.argv

def runs(mask):
    r, s = [], None
    for i, v in enumerate(mask):
        if v and s is None: s = i
        if not v and s is not None: r.append((s, i - 1)); s = None
    if s is not None: r.append((s, len(mask) - 1))
    return r

def fix(im):
    rgba = np.asarray(im.convert("RGBA")).copy()
    a = rgba[..., 3]
    H, W = a.shape
    if (a[0] > 40).mean() < 0.012: return None                     # oben nicht angeschnitten
    x0, x1 = max(runs(a[0] > 40), key=lambda r: r[1] - r[0]); w0 = x1 - x0 + 1
    if w0 < 16: return None
    cx = (x0 + x1) / 2
    # Die Kopfform ist ungefähr ein Kreis: Aus der Breite am Schnitt (w0) und der Breite y1 Zeilen tiefer (w1) folgt, wo der Scheitel wäre (Kreis durch beide Konturen)
    y1 = min(60, H // 30)
    rr = [r for r in runs(a[y1] > 40) if r[0] <= cx <= r[1]]
    w1 = (rr[0][1] - rr[0][0] + 1) if rr else w0
    if w1 > w0 + 2:
        cy = ((w1 ** 2 - w0 ** 2) / 4 + y1 ** 2) / (2 * y1)       # Kreismittelpunkt (Zeile, unterhalb des Schnitts)
        R = float(np.sqrt((w0 / 2) ** 2 + cy ** 2))
        b = int(np.ceil(R - cy)) + 2                                # Höhe des fehlenden Scheitels über Zeile 0
    else:
        cy, R, b = None, None, 6
    b = int(max(4, min(60, b)))
    pad = b + 10
    out = np.zeros((H + pad, W, 4), np.uint8); out[pad:] = rgba
    top = rgba[0]
    for k in range(1, b + 1):                                       # k Zeilen über dem Schnitt
        y = pad - k
        if R is not None:
            inner = R * R - (cy + k) ** 2
            hw = float(np.sqrt(inner)) if inner > 0 else 0.0
        else:
            hw = (w0 / 2) * float(np.sqrt(max(0.0, 1 - (k / (b + 0.5)) ** 2)))
        if hw < 1: continue
        xs = np.arange(W)
        cov = np.clip(hw + 0.5 - np.abs(xs - cx), 0, 1)             # weicher Rand (1 Pixel)
        src = rgba[min(H - 1, k - 1)]                               # Haarstruktur von den Zeilen darunter, gespiegelt
        keep = cov > 0
        out[y, keep, :3] = src[keep, :3]
        out[y, keep, 3] = (cov[keep] * src[keep, 3].astype(float) / 255.0 * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA"), pad

files = sorted(glob.glob(os.path.join(OUT, "chars", "*", "*.webp")))
if "--alle" in sys.argv:    # auch Caramella (katze_*), Eda (prof_*) und Mizu (nami_*): Standard nur die wählbaren Hauptfiguren
    files += sorted(glob.glob(os.path.join(OUT, "katze_*.webp")) + glob.glob(os.path.join(OUT, "prof_*.webp")) + glob.glob(os.path.join(OUT, "nami_*.webp")))
n = 0
for f in files:
    r = fix(Image.open(f))
    if r:
        n += 1; print("angeschnitten:", os.path.relpath(f, OUT), "→ +", r[1], "px")
        if not dry: r[0].save(f, "WEBP", quality=86, method=4, alpha_quality=92)
print(n, "von", len(files), "Dateien", "(nichts geändert)" if dry else "ergänzt")
