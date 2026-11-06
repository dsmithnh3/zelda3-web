#!/usr/bin/env python3
"""Patch a clean, pinned snesrev/zelda3 checkout for native 19.5:9 rendering.
This is a source-only patch, never distributes ROM-derived data.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
UP = ROOT / "work" / "zelda3"
TARGET_W, TARGET_H, MAX_EXTRA = 484, 224, 116

def replace_once(path, needle, replacement):
    src = path.read_text()
    matches = src.count(needle)
    if matches == 0 and replacement in src:
        print(f"already patched: {path}")
        return
    if matches != 1:
        sys.exit(f"{path}: expected exactly one occurrence of {needle!r}, got {matches}")
    path.write_text(src.replace(needle, replacement))
    print(f"patched: {path}")

def main():
    replace_once(
        UP / "src/types.h",
        "kPpuExtraLeftRight = kEnableLargeScreen ? 96 : 0,",
        f"kPpuExtraLeftRight = kEnableLargeScreen ? {MAX_EXTRA} : 0,"
    )
    replace_once(
        UP / "src/config.c",
        'else if (strcmp(s, "18:9") == 0)\n          g_config.extended_aspect_ratio = (h * 18 / 9 - 256) / 2;',
        'else if (strcmp(s, "18:9") == 0)\n          g_config.extended_aspect_ratio = (h * 18 / 9 - 256) / 2;\n'
        '        else if (strcmp(s, "19.5:9") == 0)\n'
        '          g_config.extended_aspect_ratio = (h * 39 / 18 - 256) / 2;'
    )
    computed = (TARGET_H * 39 // 18 - 256) // 2
    assert computed == 114 and 256 + 2 * computed == TARGET_W
    assert MAX_EXTRA >= computed
    assert "19.5:9" in (UP / "src/config.c").read_text()
    print(f"PASS: 19.5:9 produces {TARGET_W}x{TARGET_H}, PPU limit {MAX_EXTRA} pixels per side")

if __name__ == "__main__":
    main()
