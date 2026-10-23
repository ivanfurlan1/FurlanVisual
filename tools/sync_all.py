"""
Sincroniza automáticamente todas las carpetas de frames_origen con assets/seq.
Detecta si hubo cambios de cantidad de frames o de timestamp y los recompila.

Uso:
    py tools/sync_all.py
    py tools/sync_all.py --force
"""
import sys
import os
import subprocess
from pathlib import Path
import json

MAPPING = {
    "ENTRADA CASA ESTRENAR": "residencia-los-robles",
    "CASA AL LAGO": "casa-del-lago",
    "CASA HUDSON": "casa-hudson",
    "SALIDA BALCON HUDSON": "salida-balcon-hudson"
}

def main():
    root = Path(__file__).resolve().parent.parent
    src_root = root / "frames_origen"
    seq_root = root / "assets" / "seq"
    force = "--force" in sys.argv

    if not src_root.exists():
        print(f"No existe {src_root}")
        return

    print("=== Sincronizador de secuencias de frames ===")
    for folder_name, slug in MAPPING.items():
        src_dir = src_root / folder_name
        if not src_dir.exists():
            continue

        files = [p for p in src_dir.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
        count_src = len(files)

        manifest_file = seq_root / slug / "manifest.json"
        needs_build = force or not manifest_file.exists()

        if not needs_build and manifest_file.exists():
            try:
                with open(manifest_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("count") != count_src:
                        needs_build = True
            except Exception:
                needs_build = True

        if needs_build:
            print(f"\n[ACTUALIZANDO] {folder_name} -> {slug} ({count_src} frames)")
            cmd = [sys.executable, str(root / "tools" / "build_frames.py"), str(src_dir), slug]
            subprocess.run(cmd, check=True)
        else:
            print(f"[OK AL DÍA] {folder_name} -> {slug} ({count_src} frames)")

    print("\nSincronización completa.")

if __name__ == "__main__":
    main()
