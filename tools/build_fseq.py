"""
Empaqueta las secuencias WebP en bundles binarios .fseq para carga por streaming
en un solo request HTTP por secuencia, y genera la variante compacta `sm` (960px)
para las tarjetas 3D del Archivo en Movimiento.

Formato .fseq (little-endian):
  - 4 bytes: b"FSEQ"
  - 4 bytes: uint32 version (1)
  - 4 bytes: uint32 frame_count (N)
  - 4*N bytes: uint32[N] longitudes en bytes de cada frame WebP
  - resto: bytes WebP concatenados del frame 0 al N-1

Uso:
  py tools/build_fseq.py
"""
import json
import struct
import os
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SEQ_DIR = ROOT / "assets" / "seq"

# Secuencias activas en index.html y sets que requieren .fseq
ACTIVE_TARGETS = {
    "estrenar": ["lg", "md", "pt"],
    "casa-mauro": ["lg", "md"],
    "casa-greenville": ["lg", "md", "pt"],
    "casona-lago": ["md", "sm"],
    "casa-fincas": ["sm", "md"],
    "campo": ["sm", "md"],
    "casa-negra": ["sm", "md"],
    "vonharv3": ["sm", "md"],
    "casona": ["sm", "md"],
    "barrio": ["sm", "md"],
    "casa-violeta": ["sm", "md"],
    "casa-hudson": ["lg", "md"],
    "anacleto": ["lg", "md", "pt"],
}

REEL_SM_CARDS = [
    "casona-lago",
    "casa-fincas",
    "campo",
    "casa-negra",
    "vonharv3",
    "casona",
    "barrio",
    "casa-violeta",
]


def _make_sm_frame(args):
    src_path, dst_path = args
    with Image.open(src_path) as im:
        im = im.convert("RGB")
        w, h = im.size
        target_w = 960
        target_h = max(2, round(target_w * h / w))
        if w != target_w:
            im = im.resize((target_w, target_h), Image.LANCZOS)
        im.save(dst_path, "WEBP", quality=74, method=5)
    return True


def ensure_sm_set(slug: str):
    seq_path = SEQ_DIR / slug
    md_dir = seq_path / "md"
    sm_dir = seq_path / "sm"
    if not md_dir.exists():
        return
    sm_dir.mkdir(parents=True, exist_ok=True)
    md_files = sorted(md_dir.glob("*.webp"))
    tasks = []
    for f in md_files:
        out_f = sm_dir / f.name
        if not out_f.exists() or out_f.stat().st_mtime < f.stat().st_mtime:
            tasks.append((f, out_f))
    if not tasks:
        return
    print(f"  Generando {len(tasks)} frames sm (960px) para {slug}...")
    workers = min(os.cpu_count() or 4, 8)
    with ProcessPoolExecutor(max_workers=workers) as ex:
        list(ex.map(_make_sm_frame, tasks))


def pack_fseq(slug: str, set_name: str) -> int:
    seq_path = SEQ_DIR / slug
    src_dir = seq_path / set_name
    if not src_dir.exists():
        return 0
    files = sorted(src_dir.glob("*.webp"))
    if not files:
        return 0

    out_file = seq_path / f"{set_name}.fseq"
    chunks = []
    lengths = []
    for f in files:
        data = f.read_bytes()
        lengths.append(len(data))
        chunks.append(data)

    n = len(files)
    header = bytearray()
    header.extend(b"FSEQ")
    header.extend(struct.pack("<II", 1, n))
    header.extend(struct.pack(f"<{n}I", *lengths))

    with open(out_file, "wb") as fp:
        fp.write(header)
        for c in chunks:
            fp.write(c)

    size_bytes = out_file.stat().st_size
    print(f"  [OK] {slug}/{set_name}.fseq -> {n} frames, {size_bytes / 1024 / 1024:.2f} MB")
    return size_bytes


def main():
    print("=== Generando set sm para tarjetas del Reel ===")
    for slug in REEL_SM_CARDS:
        ensure_sm_set(slug)

    print("\n=== Empaquetando bundles .fseq ===")
    sizes_manifest = {}
    for slug, sets in ACTIVE_TARGETS.items():
        sizes_manifest[slug] = {}
        for st in sets:
            sz = pack_fseq(slug, st)
            if sz > 0:
                sizes_manifest[slug][st] = sz

    out_manifest = SEQ_DIR / "bundles.json"
    out_manifest.write_text(json.dumps(sizes_manifest, indent=2), encoding="utf-8")
    print(f"\nManifest de tamanos guardado en {out_manifest}")


if __name__ == "__main__":
    main()
