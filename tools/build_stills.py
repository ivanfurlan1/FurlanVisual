"""
Extrae fotogramas puntuales como "stills" para la galería.

Uso:
    py tools/build_stills.py <carpeta_frames_origen> <slug> <n1> <n2> ...
Ejemplo:
    py tools/build_stills.py frames_origen/01_residencia_los_robles residencia-los-robles 1 40 92 118 152 240
"""
import sys
from pathlib import Path
from PIL import Image

if len(sys.argv) < 4:
    print(__doc__)
    sys.exit(1)

src = Path(sys.argv[1])
slug = sys.argv[2]
nums = [int(n) for n in sys.argv[3:]]
root = Path(__file__).resolve().parent.parent
out = root / "assets" / "stills" / slug
out.mkdir(parents=True, exist_ok=True)
files = sorted([p for p in src.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")])

for n in nums:
    idx = max(0, min(len(files) - 1, n - 1))
    with Image.open(files[idx]) as raw:
        im = raw.convert("RGB")
        w, h = im.size
        # horizontal
        im.resize((1600, round(1600 * h / w)), Image.LANCZOS).save(out / f"{n:04d}.webp", "WEBP", quality=78, method=4)
        # vertical 9:16 nativo para móvil
        pw = round(h * 9 / 16)
        left = max(0, (w - pw) // 2)
        im.crop((left, 0, left + pw, h)).resize((720, 1280), Image.LANCZOS).save(out / f"{n:04d}-v.webp", "WEBP", quality=78, method=4)
    print("still", n, f"({n:04d}.webp)")
