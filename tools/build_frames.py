"""
Prepara una secuencia de frames para la web a partir de frames 8:7 o 16:9.

Uso:
    python tools/build_frames.py <carpeta_frames_origen> <slug>

Ejemplo:
    python tools/build_frames.py parapagina2_frames residencia-los-robles
"""
import sys
from pathlib import Path
from PIL import Image

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    src = Path(sys.argv[1])
    slug = sys.argv[2]
    root = Path(__file__).resolve().parent.parent
    out = root / "assets" / "seq" / slug
    files = sorted([p for p in src.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")])
    if not files:
        print("No se encontraron frames en", src)
        sys.exit(1)

    # Limpiar frames anteriores si hay más archivos de los que se van a generar
    for sub in ("lg", "md", "pt"):
        target_dir = out / sub
        target_dir.mkdir(parents=True, exist_ok=True)
        for existing in target_dir.glob("*.webp"):
            existing.unlink()

    total = len(files)
    print(f"Procesando {total} frames de {src} para {slug}...")

    for i, f in enumerate(files, start=1):
        im = Image.open(f).convert("RGB")
        w, h = im.size
        name = f"{i:04d}.webp"

        # lg: Mantener resolución nativa 1920 de ancho (o nativa si es menor)
        # Para 8:7 (1920x1680) se guarda en 1920x1680 a calidad 80
        im_lg = im if w == 1920 else im.resize((1920, round(1920 * h / w)), Image.LANCZOS)
        im_lg.save(out / "lg" / name, "WEBP", quality=80, method=5)

        # md: 1372px ancho (tablets y pantallas intermedias)
        mw = min(1372, w)
        im_md = im.resize((mw, round(mw * h / w)), Image.LANCZOS)
        im_md.save(out / "md" / name, "WEBP", quality=75, method=5)

        # pt: Recorte vertical 9:16 centrado a altura completa
        # Con 8:7 (1920x1680), el recorte 9:16 es de 945x1680 -> nitidez pura vertical
        pw = round(h * 9 / 16)
        if pw <= w:
            left = (w - pw) // 2
            crop_pt = im.crop((left, 0, left + pw, h))
        else:
            crop_pt = im

        # Para celulares, 900x1600 da calidad retina cristalina
        crop_pt = crop_pt.resize((900, 1600), Image.LANCZOS)
        crop_pt.save(out / "pt" / name, "WEBP", quality=76, method=5)

        if i == 1:
            im_lg.save(out / "poster.jpg", "JPEG", quality=82, optimize=True, progressive=True)
            crop_pt.save(out / "poster-pt.jpg", "JPEG", quality=82, optimize=True, progressive=True)

        if i % 5 == 0 or i == total:
            print(f"\r{i}/{total} frames procesados...", end="", flush=True)

    print(f"\nListo: {total} frames generados en {out}")

if __name__ == "__main__":
    main()
