#!/usr/bin/env python3
"""Assemble out/web: page + wasm + the upstream Python extractor.

Deliberately copies no ROM and no extracted assets.  The extractor files are
upstream source (plus one 1 KiB lookup table); the ROM-derived
zelda3_assets.dat is produced in the user's browser at run time.
"""
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
UPSTREAM = ROOT / 'work' / 'zelda3'
OUT = ROOT / 'out' / 'web'

PAGE_FILES = ['index.html', 'app.js', 'browsercheck.html', 'mobile.js', 'mobile.css', 'immersive.js', 'immersive.css', 'menu-wide.js', 'diagnostics.js', 'canvas-readback.js', 'manifest.webmanifest']
EXTRACTOR_FILES = [
    'restool.py', 'util.py', 'tables.py', 'text_compression.py',
    'extract_resources.py', 'compile_resources.py',
    'extract_music.py', 'compile_music.py', 'decode_music.py',
    'sprite_sheets.py', 'sprite_sheet_info.py', 'palette_usage.bin',
]
OTHER_FILES = ['3x5_font.png']   # upstream's 3x5 debug font, used to label sheets
BANNED_SUFFIXES = {'.sfc', '.smc', '.dat', '.png'}
ALLOWED_PNG = {'extractor/other/3x5_font.png'}


def main():
    if not (OUT / 'zelda3.wasm').exists():
        sys.exit('run scripts/build-browser.py first (out/web/zelda3.wasm missing)')
    OUT.mkdir(parents=True, exist_ok=True)
    for name in PAGE_FILES:
        shutil.copy2(ROOT / 'web' / name, OUT / name)
    ex = OUT / 'extractor'
    ex.mkdir(exist_ok=True)
    for name in EXTRACTOR_FILES:
        shutil.copy2(UPSTREAM / 'assets' / name, ex / name)
    (ex / 'other').mkdir(exist_ok=True)
    for name in OTHER_FILES:
        shutil.copy2(UPSTREAM / 'other' / name, ex / 'other' / name)

    # Belt and braces: nothing ROM-shaped may end up in the served tree.
    offenders = [p for p in OUT.rglob('*')
                 if p.is_file() and p.suffix.lower() in BANNED_SUFFIXES
                 and 'pyodide' not in p.parts
                 and p.relative_to(OUT).as_posix() not in ALLOWED_PNG]
    if offenders:
        sys.exit('refusing to stage ROM-derived files: ' +
                 ', '.join(str(p.relative_to(OUT)) for p in offenders))
    print(f'staged {OUT}')
    for p in sorted(OUT.iterdir()):
        print('  ', p.name)


if __name__ == '__main__':
    main()
