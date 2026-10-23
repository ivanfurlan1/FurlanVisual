"""
Extrae fotogramas puntuales como "stills" para la galería.

Uso:
    python tools/build_stills.py <carpeta_frames_origen> <slug> <n1> <n2> ...
Ejemplo:
    python tools/build_stills.py parapagina1_frames residencia-los-robles 1 70 110 150 185
"""
import sys
from pathlib import Path
from PIL import Image

src = Path(sys.argv[1]); slug = sys.argv[2]; nums = [int(n) for n in sys.argv[3:]]
root = Path(__file__).resolve().parent.parent
out = root / "assets" / "stills" / slug
out.mkdir(parents=True, exist_ok=True)
files = sorted([p for p in src.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")])
for n in nums:
    im = Image.open(files[n - 1]).convert("RGB")
    w, h = im.size
    im.resize((1600, round(1600 * h / w)), Image.LANCZOS).save(out / f"{n:04d}.webp", "WEBP", quality=78, method=5)
    pw = round(h * 4 / 5); left = (w - pw) // 2
    im.crop((left, 0, left + pw, h)).resize((864, 1080), Image.LANCZOS).save(out / f"{n:04d}-v.webp", "WEBP", quality=78, method=5)
    print("still", n)
