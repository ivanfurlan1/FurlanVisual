"""
Sincroniza automáticamente todas las carpetas de frames_origen con assets/seq.
Detecta si hubo cambios de cantidad de frames o de timestamp, los recompila
y actualiza automáticamente index.html con la nueva cantidad de fotogramas
y el version hash para romper caché al instante.

Uso:
    py tools/sync_all.py
    py tools/sync_all.py --force
"""
import sys
import os
import subprocess
import re
from pathlib import Path
import json

MAPPING = {
    "ENTRADA CASA ESTRENAR 2.0": "test-3",
    "TEST3": "test-3",
    "ENTRADA CASA ESTRENAR": "residencia-los-robles",
    "CASA AL LAGO": "casa-del-lago",
    "CASA JUAN": "casa-hudson",
    "SALIDA BALCON HUDSON": "salida-balcon-hudson",
    "CASA GREENVILLE": "casa-greenville",
    "ANACLETO": "anacleto",
    "EPECUEN": "epecuen",
    "CAMPO": "campo",
    "BETINA": "betina",
    "FINCAS": "fincas",
    "VONHARV": "vonharv",
    "RANDA1": "randa1",
    "RANDA2": "randa2"
}

def update_index_html(root: Path, slug: str, count: int, version: str):
    index_path = root / "index.html"
    if not index_path.exists():
        return

    content = index_path.read_text(encoding="utf-8")
    original = content

    # 1. Actualizar elementos con data-src="assets/seq/{slug}"
    # data-count="..." data-version="..."
    pattern_section = rf'(data-src="assets/seq/{re.escape(slug)}"[^>]*?data-count=")\d+(")'
    content = re.sub(pattern_section, rf'\g<1>{count}\2', content)

    # Actualizar o insertar data-version en cualquier tag con data-src="assets/seq/{slug}"
    def add_or_update_version(match):
        tag_str = match.group(0)
        if 'data-version="' in tag_str:
            return re.sub(r'data-version="[^"]*"', f'data-version="{version}"', tag_str)
        else:
            return tag_str.replace(f'data-count="{count}"', f'data-count="{count}"\n             data-version="{version}"')

    content = re.sub(rf'<section[^>]*?data-src="assets/seq/{re.escape(slug)}"[^>]*?>', add_or_update_version, content, flags=re.DOTALL)

    # Actualizar posters y posters-pt con la nueva versión para romper caché
    pattern_poster = rf'(assets/seq/{re.escape(slug)}/poster(?:-pt)?\.jpg)(?:\?v=[^"\'\s&>]+)?'
    content = re.sub(pattern_poster, rf'\g<1>?v={version}', content)

    # 2. Actualizar HUD de fotogramas para cada sección correspondiente
    def update_sec_hud(match):
        sec_str = match.group(0)
        return re.sub(r'(<span class="seq__fr"><span data-hud-fr>\d+</span>\s*/\s*)\d+(</span>)', rf'\g<1>{count}\2', sec_str)

    content = re.sub(rf'<section[^>]*?data-src="assets/seq/{re.escape(slug)}"[^>]*?>.*?</section>', update_sec_hud, content, flags=re.DOTALL)

    if slug in ("residencia-los-robles", "test-3", "epecuen", "campo"):
        content = re.sub(r'(<span class="format-showcase__counter">Fotograma <strong data-format-fr>\d+</strong>\s*/\s*)\d+(</span>)', rf'\g<1>{count}\2', content)
    if slug in ("residencia-los-robles", "test-3", "epecuen"):
        content = re.sub(r'(<strong data-choreo-fr>\d+</strong>\s*/\s*)\d+(\s*FR)', rf'\g<1>{count}\2', content)

    if content != original:
        index_path.write_text(content, encoding="utf-8")
        print(f"  -> index.html actualizado para {slug}: count={count}, v={version}")

def update_css_height(root: Path, slug: str, count: int):
    css_path = root / "css" / "styles.css"
    if not css_path.exists():
        return
    css = css_path.read_text(encoding="utf-8")
    orig = css
    target_vh = round(100 + count * 1.15)
    if slug == "anacleto":
        css = re.sub(r'#film-04\s*\{\s*height:\s*\d+vh;\s*\}', f'#film-04 {{ height: {target_vh}vh; }}', css)
    elif slug == "casa-hudson":
        target_vh = round(100 + count * 1.25)
        css = re.sub(r'#film-03\s*\{\s*height:\s*\d+vh;\s*\}', f'#film-03 {{ height: {target_vh}vh; }}', css)
    elif slug == "casa-greenville":
        css = re.sub(r'#trazado\s*\{\s*height:\s*\d+vh;\s*\}', f'#trazado {{ height: {target_vh}vh; }}', css)
    elif slug == "campo":
        css = re.sub(r'\.format-showcase\s*\{\s*position:\s*relative;\s*height:\s*\d+vh;', f'.format-showcase {{\n  position: relative;\n  height: {target_vh}vh;', css)
    elif slug in ("betina", "vonharv", "randa1", "randa2"):
        # film-02 alberga la toma de apertura Vonharv + la extensión de rodaje dual Randa I & II
        target_vh = 420
        css = re.sub(r'#film-02\s*\{\s*height:\s*\d+vh;\s*\}', f'#film-02 {{ height: {target_vh}vh; }}', css)
    elif slug == "fincas":
        css = re.sub(r'#nocturno\s*\{\s*height:\s*\d+vh;\s*\}', f'#nocturno {{ height: {target_vh}vh; }}', css)
    if css != orig:
        css_path.write_text(css, encoding="utf-8")
        print(f"  -> styles.css calibrado para {slug} a 24fps: height={target_vh}vh")

def main():
    root = Path(__file__).resolve().parent.parent
    src_root = root / "frames_origen"
    seq_root = root / "assets" / "seq"
    force = "--force" in sys.argv

    if not src_root.exists():
        print(f"No existe {src_root}")
        return

    print("=== Sincronizador de secuencias de frames y anti-caché ===")
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
                    else:
                        manifest_ver = int(data.get("version", 0))
                        max_mtime = max((int(p.stat().st_mtime) for p in files), default=0)
                        if max_mtime > manifest_ver:
                            needs_build = True
            except Exception:
                needs_build = True

        if needs_build:
            print(f"\n[ACTUALIZANDO] {folder_name} -> {slug} ({count_src} frames)")
            cmd = [sys.executable, str(root / "tools" / "build_frames.py"), str(src_dir), slug]
            subprocess.run(cmd, check=True)
            
            # Leer version del nuevo manifest
            version = str(count_src)
            if manifest_file.exists():
                try:
                    with open(manifest_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        version = data.get("version", str(count_src))
                except Exception:
                    pass
            update_index_html(root, slug, count_src, version)
            update_css_height(root, slug, count_src)
        else:
            print(f"[OK AL DÍA] {folder_name} -> {slug} ({count_src} frames)")

    print("\nSincronización completa.")

if __name__ == "__main__":
    main()
