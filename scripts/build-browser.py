#!/usr/bin/env python3
"""Build the zelda3 engine to WebAssembly.

Data-free: no ROM bytes and no extracted assets are compiled in.  The page asks
the user for their own ROM at runtime and extracts zelda3_assets.dat in the
browser.

Usage: scripts/build-browser.py [--out DIR]
Requires the shared emsdk to be sourced (scripts/env.sh does that).
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
UPSTREAM = ROOT / 'work' / 'zelda3'
REVISION = '45a149d8b4bb8098f53d1009f76e76e7d8b79bbf'
EMCC_VERSION = '4.0.10'


def check_output(*cmd):
    return subprocess.check_output(cmd, text=True).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(ROOT / 'out' / 'web'))
    ap.add_argument('--allow-dirty', action='store_true',
                    help='skip the pinned-revision check (for local experiments)')
    args = ap.parse_args()

    if not args.allow_dirty:
        head = check_output('git', '-C', str(UPSTREAM), 'rev-parse', 'HEAD')
        if head != REVISION:
            sys.exit(f'upstream is at {head}, expected pinned {REVISION}')
        subprocess.run(['git', '-C', str(UPSTREAM), 'diff', '--exit-code', 'HEAD',
                        '--', 'src', 'snes', 'third_party'], check=True)

    version = check_output('emcc', '--version').splitlines()[0]
    if EMCC_VERSION not in version:
        sys.exit(f'need emcc {EMCC_VERSION}, got: {version}')

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    # Patched sources live outside the served tree so they are not shipped.
    patched_dir = ROOT / 'out' / 'patched-sources'
    patched_dir.mkdir(parents=True, exist_ok=True)

    sources = [p for p in sorted((UPSTREAM / 'src').glob('*.c'))]
    sources += sorted((UPSTREAM / 'snes').glob('*.c'))

    def patch(relative, edits, header=''):
        """Copy a source file with literal substitutions, asserting each applied."""
        src = UPSTREAM / relative
        text = src.read_text()
        for before, after, count in edits:
            found = text.count(before)
            if found != count:
                sys.exit(f'{relative}: expected {count}x {before!r}, found {found} '
                         '(upstream changed - re-check the patch)')
            text = text.replace(before, after)
        dst = patched_dir / (src.stem + '-browser.c')
        dst.write_text(header + text)
        sources[sources.index(src)] = dst
        return dst.name

    applied = []
    # 1. The main loop blocks.  Asyncify turns each SDL_Delay into a yield back
    #    to the browser event loop.  The extra unconditional yield is a safety
    #    net: with DisableFrameDelay=1 the loop contains no SDL_Delay at all and
    #    would otherwise hang the tab forever.
    applied.append(patch('src/main.c', [
        ('SDL_Delay(', 'emscripten_sleep(', 2),
        ('  while(running) {', '  while(running) {\n    emscripten_sleep(0);', 1),
    ], header='#include <emscripten.h>\n'))
    # 2. Persist SRAM to IndexedDB the moment the game writes it.
    applied.append(patch('src/zelda_rtl.c', [
        ('    fprintf(stderr, "Unable to write saves/sram.dat\\n");\n  }\n}',
         '    fprintf(stderr, "Unable to write saves/sram.dat\\n");\n  }\n'
         '  EM_ASM({ if (Module.onSramWritten) Module.onSramWritten(); });\n}', 1),
    ], header='#include <emscripten.h>\n'))
    # NOTE: the ppu_init() signature patches the older decompgames script needed
    # are gone: upstream ba4d5ec "Fix C23 prototype errors" fixed them at source.

    sources += [UPSTREAM / 'third_party/gl_core/gl_core_3_1.c',
                UPSTREAM / 'third_party/opus-1.3.1-stripped/opus_decoder_amalgam.c',
                ROOT / 'web' / 'browser_glue.c']

    flags = [
        '-O2',
        '-I', str(UPSTREAM),
        '-iquote', str(UPSTREAM / 'src'),
        '-iquote', str(UPSTREAM / 'snes'),
        '-sUSE_SDL=2',
        '-DSYSTEM_VOLUME_MIXER_AVAILABLE=0',
        '-sASYNCIFY=1',
        '-sALLOW_MEMORY_GROWTH=1',
        '-sEXIT_RUNTIME=1',
        '-sFORCE_FILESYSTEM=1',
        '-sINVOKE_RUN=0',
        '-sMODULARIZE=1',
        '-sEXPORT_NAME=createZelda3',
        '-sEXPORTED_RUNTIME_METHODS=FS,IDBFS,callMain,ccall,cwrap,HEAPU8',
        '-lidbfs.js',
    ]

    subprocess.run(['emcc', *map(str, sources), *flags, '-o', str(out / 'zelda3.js')],
                   check=True)

    files = []
    for name in ['zelda3.js', 'zelda3.wasm']:
        data = (out / name).read_bytes()
        files.append({'path': name, 'bytes': len(data),
                      'sha256': hashlib.sha256(data).hexdigest()})
    record = {
        'revision': REVISION,
        'toolchain': version,
        'flags': flags,
        'patchedSources': applied,
        'assetsBundled': False,
        'romBundled': False,
        'files': files,
    }
    (out / 'build-record.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record['files'], indent=2))


if __name__ == '__main__':
    main()
