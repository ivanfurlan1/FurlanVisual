"""
Prepara secuencias de frames para la web, adaptando tanto 16:9 como 8:7
a versiones horizontal (lg, md) y vertical nativa para celulares (pt, 9:16).

Uso:
    py tools/build_frames.py <carpeta_frames_origen> <slug>
"""
import sys
import os
import time
import json
import shutil
from pathlib import Path
from PIL import Image
from concurrent.futures import ProcessPoolExecutor

def process_single_frame(args):
    f_path, i, out_dir, is_squareish = args
    name = f"{i:04d}.webp"
    is_source_webp = f_path.suffix.lower() == ".webp"

    with Image.open(f_path) as raw_im:
        im = raw_im.convert("RGB")
        w, h = im.size

        # lg: horizontal alta definición cinematográfica
        # Si el origen ya es WebP y tiene ancho 1920, conservamos los bytes exactos originales
        if is_source_webp and w == 1920:
            shutil.copy2(f_path, out_dir / "lg" / name)
            im_lg = im
        else:
            if is_squareish:
                im_lg = im if w == 1920 else im.resize((1920, round(1920 * h / w)), Image.LANCZOS)
            else:
                im_lg = im if w == 1920 else im.resize((1920, round(1920 * h / w)), Image.LANCZOS)
            q_lg = 80 if is_source_webp else 88
            im_lg.save(out_dir / "lg" / name, "WEBP", quality=q_lg, method=5)

        # md: tablets / intermedias
        mw = 1440 if is_squareish else 1440
        im_md = im.resize((mw, round(mw * h / w)), Image.LANCZOS)
        q_md = 70 if is_source_webp else 84
        im_md.save(out_dir / "md" / name, "WEBP", quality=q_md, method=5)

        # pt: vertical nativo para celulares (relación 9:16 completa)
        pw = round(h * 9 / 16)
        left = max(0, (w - pw) // 2)
        crop_pt = im.crop((left, 0, left + pw, h))
        target_pt = (900, 1600) if is_squareish else (720, 1280)
        crop_pt = crop_pt.resize(target_pt, Image.LANCZOS)
        q_pt = 74 if is_source_webp else 84
        crop_pt.save(out_dir / "pt" / name, "WEBP", quality=q_pt, method=5)

        if i == 1:
            im_lg.save(out_dir / "poster.jpg", "JPEG", quality=88, optimize=True, progressive=True)
            crop_pt.save(out_dir / "poster-pt.jpg", "JPEG", quality=88, optimize=True, progressive=True)

    return i

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

    for sub in ("lg", "md", "pt"):
        target_dir = out / sub
        target_dir.mkdir(parents=True, exist_ok=True)
        for existing in target_dir.glob("*.webp"):
            try:
                existing.unlink()
            except Exception:
                pass

    total = len(files)
    print(f"Procesando {total} frames de {src} para {slug}...")

    with Image.open(files[0]) as first_im:
        w0, h0 = first_im.size
        ratio = w0 / h0

    is_squareish = ratio < 1.35

    tasks = [(f, i, out, is_squareish) for i, f in enumerate(files, start=1)]
    workers = min(os.cpu_count() or 4, 8)
    completed = 0
    with ProcessPoolExecutor(max_workers=workers) as executor:
        for _ in executor.map(process_single_frame, tasks):
            completed += 1
            if completed % 10 == 0 or completed == total:
                print(f"\r{completed}/{total} frames procesados...", end="", flush=True)

    version_ts = int(time.time())
    manifest = {
        "slug": slug,
        "count": total,
        "version": str(version_ts),
        "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(version_ts))
    }
    with open(out / "manifest.json", "w", encoding="utf-8") as mf:
        json.dump(manifest, mf, indent=2)

    print(f"\nListo: {total} frames generados en {out} (versión {version_ts})")

if __name__ == "__main__":
    main()
