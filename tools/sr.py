"""KI-Hochskalieren (Real-ESRGAN „realesr-animevideov3“, Anime-Modell) auf der CPU mit ncnn. Für flache Anime-/Cel-Bilder gemacht.
Benötigt: pip install ncnn numpy pillow; die Modelldateien realesr-animevideov3-x4.param/.bin (liegen im PyPI-Paket realesrgan-ncnn-py unter models/).
Modellordner: Umgebungsvariable SR_MODELS (Standard /tmp/rwheel/x/realesrgan_ncnn_py/models)."""
import os, time
import numpy as np
import ncnn
from PIL import Image

MODELS = os.environ.get("SR_MODELS", "/tmp/rwheel/x/realesrgan_ncnn_py/models")
_net = None

def net():
    global _net
    if _net is None:
        n = ncnn.Net(); n.opt.use_vulkan_compute = False; n.opt.num_threads = max(1, os.cpu_count() or 1)
        n.load_param(os.path.join(MODELS, "realesr-animevideov3-x4.param")); n.load_model(os.path.join(MODELS, "realesr-animevideov3-x4.bin"))
        _net = n
    return _net

def _run(tile):                       # tile: H×W×3 uint8 -> 4H×4W×3 uint8
    h, w, _ = tile.shape
    m = ncnn.Mat.from_pixels(np.ascontiguousarray(tile), ncnn.Mat.PixelType.PIXEL_RGB, w, h)
    m.substract_mean_normalize([0, 0, 0], [1 / 255.0] * 3)
    ex = net().create_extractor(); ex.input("data", m)
    _, out = ex.extract("output")
    a = np.array(out).transpose(1, 2, 0)
    return (a * 255.0).clip(0, 255).round().astype(np.uint8)

def upscale4(rgb, tile=192, pad=16, log=None):
    """rgb: H×W×3 uint8. Gibt 4H×4W×3 zurück (Kachelweise mit Überlappung, damit keine Nähte entstehen)."""
    H, W, _ = rgb.shape
    out = np.zeros((H * 4, W * 4, 3), np.uint8)
    p = np.pad(rgb, ((pad, pad), (pad, pad), (0, 0)), mode="edge")
    ys = list(range(0, H, tile)); xs = list(range(0, W, tile)); total = len(ys) * len(xs); k = 0; t0 = time.time()
    for y in ys:
        for x in xs:
            y1, x1 = min(y + tile, H), min(x + tile, W)
            t = p[y: y1 + 2 * pad, x: x1 + 2 * pad]
            r = _run(t)
            out[y * 4: y1 * 4, x * 4: x1 * 4] = r[pad * 4: pad * 4 + (y1 - y) * 4, pad * 4: pad * 4 + (x1 - x) * 4]
            k += 1
            if log and (k % 6 == 0 or k == total): log(f"    Kachel {k}/{total} ({time.time() - t0:.0f} s)")
    return out

def upscale_rgba(im, log=None):
    """RGBA-Bild: Farben und Deckkraft getrennt hochskalieren (die Deckkraft als Graubild, so bleiben die Kanten scharf)."""
    rgba = np.asarray(im.convert("RGBA"))
    a = rgba[..., 3]
    rgb = rgba[..., :3].copy()
    # Farben unter transparenten Stellen mit den nächsten sichtbaren Farben füllen (verhindert dunkle/grüne Ränder)
    from PIL import ImageFilter
    solid = Image.fromarray(rgb); mask = Image.fromarray(((a > 8) * 255).astype("uint8"))
    for _ in range(6):
        blurred = solid.filter(ImageFilter.MaxFilter(5)); solid = Image.composite(solid, blurred, mask); mask = mask.filter(ImageFilter.MaxFilter(5))
    rgb = np.asarray(solid)
    big = upscale4(rgb, log=log)
    alpha3 = np.stack([a, a, a], -1)
    abig = upscale4(alpha3, log=None)[..., 0]
    return Image.fromarray(np.dstack([big, abig]), "RGBA")
