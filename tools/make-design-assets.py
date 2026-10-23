#!/usr/bin/env python3
"""Erzeugt die Design-Dateien (ab 0.7.0) aus den Gemini-Originalen und skaliert die Figuren auf 4K hoch.
Aufruf: python3 tools/make-design-assets.py <Ordner mit den Originaldateien> [figuren] [bg] [video]
Benötigt: Pillow, numpy, ncnn, ffmpeg und die Modelle (siehe tools/sr.py). Die Originale (JPG/MP4) gehören NICHT ins Projekt.
- figuren: Mizu (nami_*.webp) aus den Gemini-Bögen; alle anderen Figuren (chars/*, katze_*, prof_*) werden auf 2160 px Höhe (4K) hochskaliert.
- bg: sieben Hintergründe (sechs Seiten + Nacht) auf 3840×2160.
- video: Wasser-Schleife (nur der Wasserteil, ohne Figur).
- ui: Bilder für leere Seiten (Kiste mit Blasen, Ordner, Zettel mit Pin)."""
import sys, os, glob, subprocess, time
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sr

args = [a for a in sys.argv[1:]]
SRC = args[0] if args and os.path.isdir(args[0]) else "."
parts = [a for a in args if a in ("figuren", "bg", "video", "ui")] or ["figuren", "bg", "video", "ui"]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "assets")
f = lambda n: os.path.join(SRC, n)
log = lambda *a: print(*a, flush=True)
T4K = 2160

def key(im):
    a = np.asarray(im.convert("RGB")).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    spill = g - np.maximum(r, b)
    alpha = np.clip(1 - (spill - 30) / 90, 0, 1)
    g2 = np.minimum(g, np.maximum(r, b) + 8)
    return Image.fromarray(np.dstack([r, g2, b, alpha * 255]).clip(0, 255).astype("uint8"), "RGBA")

def trim(im, pad=6):
    x0, y0, x1, y1 = im.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))

def to_height(im, h):
    w = round(im.width * h / im.height)
    return im.convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA")   # vormultipliziert: keine hellen Ränder

def save_webp(im, path, q=86):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, "WEBP", quality=q, method=4, alpha_quality=92)
    log("   ", os.path.relpath(path, OUT), im.size, os.path.getsize(path) // 1024, "KB")

def poses(sheet_path):
    sheet = Image.open(sheet_path).convert("RGB")
    m = np.asarray(sheet).astype(int); m = (m[..., 1] - np.maximum(m[..., 0], m[..., 2])) < 60
    cols = m[40:640, 780:].any(0); segs = []; s = None
    for i, v in enumerate(cols):
        if v and s is None: s = i
        if not v and s is not None:
            if i - s > 25: segs.append((s + 780, i + 780))
            s = None
    if s is not None: segs.append((s + 780, len(cols) + 780))
    assert len(segs) == 6, ("Posen nicht getrennt", segs)
    return [trim(key(sheet.crop((x0 - 4, 40, x1 + 4, 650)))) for x0, x1 in segs]

if "figuren" in parts:
    log("Mizu (Begleiter, ersetzt Nami)")
    Y = poses(f("Gemini_Generated_Image_8s01u58s01u58s01_1.jpg"))   # winkt, denkt, liest, jubelt, Ordner, müde
    X = poses(f("Gemini_Generated_Image_c2vj1lc2vj1lc2vj_1.jpg"))   # schreibt, zeigt, denkt, jubelt, Tipp, müde
    mizu = {"gruss": Y[0], "denkt": Y[1], "jubelt": Y[3], "schreibt": X[0], "pinnt": X[1], "erklaert": X[4]}
    for k, im in mizu.items():
        save_webp(to_height(sr.upscale_rgba(im), T4K), os.path.join(OUT, "figuren", f"nami_{k}.webp"))   # Dateiname bleibt, der Code verweist darauf
    log("Übrige Figuren auf 4K")
    todo = sorted(glob.glob(os.path.join(OUT, "figuren", "chars", "*", "*.webp")) + glob.glob(os.path.join(OUT, "figuren", "katze_*.webp")) + glob.glob(os.path.join(OUT, "figuren", "prof_*.webp")))
    for i, p in enumerate(todo, 1):
        im = Image.open(p)
        if im.height >= T4K: continue          # schon groß genug (nochmal laufen lassen schadet nicht)
        t = time.time()
        save_webp(to_height(sr.upscale_rgba(im), T4K), p)
        log(f"    ({i}/{len(todo)}, {time.time() - t:.0f} s)")

if "bg" in parts:
    log("Hintergründe auf 4K")
    xs = [(3, 842), (867, 1709), (1734, 2573)]; ys = [(3, 464), (487, 952), (974, 1435)]
    names = ["menue", "notizen", "kontakte", "projekte", "bericht", "dateien", "system", "start", "nacht"]
    tiles = {}
    for sheet, k in (("Gemini_Generated_Image_usi37cusi37cusi3.jpg", "A"), ("Gemini_Generated_Image_cv3q86cv3q86cv3q.jpg", "B"), ("Gemini_Generated_Image_p92xb3p92xb3p92x.jpg", "C")):
        im = Image.open(f(sheet)).convert("RGB")
        for i, n in enumerate(names):
            r, c = divmod(i, 3); tiles[(k, n)] = im.crop((xs[c][0], ys[r][0], xs[c][1], ys[r][1]))
    pick = {"notizen": "C", "kontakte": "A", "projekte": "A", "berichtsheft": "C", "dateien": "A", "system": "B", "nacht": "C"}
    for name, sh in pick.items():
        t = time.time()
        big = Image.fromarray(sr.upscale4(np.asarray(tiles[(sh, "bericht" if name == "berichtsheft" else name)])))
        big = big.resize((3840, 2160), Image.LANCZOS)
        p = os.path.join(OUT, "bg", name + ".webp"); os.makedirs(os.path.dirname(p), exist_ok=True)
        big.save(p, "WEBP", quality=80, method=4); log("   ", name, "←", sh, os.path.getsize(p) // 1024, "KB", f"({time.time() - t:.0f} s)")

if "video" in parts:
    log("Wasser-Schleife (Bild für Bild hochskaliert)")
    import shutil, tempfile
    MEDIA = os.path.join(OUT, "media"); os.makedirs(MEDIA, exist_ok=True)
    v = f("gemini_generated_video_5555f550.mp4")
    work = os.path.join(tempfile.gettempdir(), "wasser-work")   # fester Ordner: ein abgebrochener Lauf macht beim nächsten Mal dort weiter
    fr, up = os.path.join(work, "fr"), os.path.join(work, "up"); os.makedirs(fr, exist_ok=True); os.makedirs(up, exist_ok=True)
    # Nur der Wasserteil (rechte Bildhälfte ab x=720, dort ist nirgends die Figur), obere 543 Zeilen (Wasseroberfläche), zweite Hälfte (viele Blasen),
    # Ende in den Anfang geblendet = nahtlose Schleife (4 s, 24 Bilder pro Sekunde)
    crop = "crop=560:543:720:0,setpts=PTS-STARTPTS"
    if len(os.listdir(fr)) < 96:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", v, "-i", v, "-filter_complex",
            f"[0:v]trim=6:10,{crop}[a];[1:v]trim=5:6,{crop}[b];[a][b]xfade=transition=fade:duration=1:offset=3[o]",
            "-map", "[o]", "-r", "24", os.path.join(fr, "%04d.png")], check=True)
    files = sorted(os.listdir(fr)); t0 = time.time()
    for i, n in enumerate(files, 1):
        if os.path.exists(os.path.join(up, n)): continue      # schon hochskaliert
        Image.fromarray(sr.upscale4(np.asarray(Image.open(os.path.join(fr, n)).convert("RGB")))).save(os.path.join(up, n))
        if i % 8 == 0 or i == len(files): log(f"    Bild {i}/{len(files)} ({time.time() - t0:.0f} s)")
    out = os.path.join(MEDIA, "water-loop.webm")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "24", "-i", os.path.join(up, "%04d.png"), "-an", "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-row-mt", "1", "-cpu-used", "4", "-pix_fmt", "yuv420p", out], check=True)
    Image.open(os.path.join(up, files[len(files) // 2])).save(os.path.join(MEDIA, "water-poster.webp"), "WEBP", quality=84, method=4)   # Standbild
    shutil.rmtree(work, ignore_errors=True)
    log("   water-loop.webm", os.path.getsize(out) // 1024, "KB;", "water-poster.webp", os.path.getsize(os.path.join(MEDIA, "water-poster.webp")) // 1024, "KB")

if "ui" in parts:
    log("Bilder für leere Seiten")
    sheet = Image.open(f("Gemini_Generated_Image_8s01u58s01u58s01_1.jpg")).convert("RGB")
    m = np.asarray(sheet).astype(int); m = (m[..., 1] - np.maximum(m[..., 0], m[..., 2])) < 60
    band = m[1020:1430, 780:].any(0); segs = []; st = None
    for i, v in enumerate(band):
        if v and st is None: st = i
        if not v and st is not None:
            if i - st > 20: segs.append((st + 780, i + 780))
            st = None
    if st is not None: segs.append((st + 780, len(band) + 780))
    assert len(segs) == 6, ("Requisiten nicht getrennt", segs)
    parts6 = [trim(key(sheet.crop((x0 - 4, 1020, x1 + 4, 1430)))) for x0, x1 in segs]   # Zettel creme, Zettel blau, Klebeband, Pin, Kiste, Ordner
    UI = os.path.join(OUT, "ui")
    save_webp(to_height(sr.upscale_rgba(parts6[4]), 900), os.path.join(UI, "leer-kiste.webp"))
    save_webp(to_height(sr.upscale_rgba(parts6[5]), 800), os.path.join(UI, "leer-ordner.webp"))
    paper = sr.upscale_rgba(parts6[1]); pin = sr.upscale_rgba(parts6[3])
    pin = to_height(pin, round(paper.height * 0.34))
    card = Image.new("RGBA", (paper.width, paper.height + pin.height // 3), (0, 0, 0, 0))
    card.paste(paper, (0, pin.height // 3), paper); card.alpha_composite(pin, ((paper.width - pin.width) // 2, 0))   # Pin steckt oben im Zettel
    save_webp(to_height(card, 800), os.path.join(UI, "leer-zettel.webp"))
