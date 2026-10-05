#!/usr/bin/env python3
"""Vendor the Pyodide runtime + the two wheels the upstream extractor needs.

Vendoring (rather than hot-linking a CDN) is what lets the page run under
Content-Security-Policy `connect-src 'self'`: with no third-party origin
reachable, the ROM the user picks physically cannot be sent anywhere.
"""
import hashlib
import json
import pathlib
import sys
import urllib.request

VERSION = '0.28.3'
BASE = f'https://cdn.jsdelivr.net/pyodide/v{VERSION}/full/'
CORE = ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip',
        'pyodide-lock.json']
WANT_PACKAGES = ['pillow', 'pyyaml']

ROOT = pathlib.Path(__file__).resolve().parent.parent


def fetch(name, dest):
    if dest.exists() and dest.stat().st_size > 0:
        print(f'  have {name} ({dest.stat().st_size} bytes)')
        return dest.read_bytes()
    print(f'  get  {name} ...', flush=True)
    with urllib.request.urlopen(BASE + name) as r:
        data = r.read()
    dest.write_bytes(data)
    print(f'       {len(data)} bytes')
    return data


def main():
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'out' / 'web' / 'pyodide')
    out.mkdir(parents=True, exist_ok=True)
    lock = None
    for name in CORE:
        data = fetch(name, out / name)
        if name == 'pyodide-lock.json':
            lock = json.loads(data)
    for pkg in WANT_PACKAGES:
        meta = lock['packages'][pkg]
        data = fetch(meta['file_name'], out / meta['file_name'])
        got = hashlib.sha256(data).hexdigest()
        if got != meta['sha256']:
            sys.exit(f'{pkg}: sha256 mismatch {got} != {meta["sha256"]}')
        print(f'       sha256 ok for {pkg}')
    print(f'pyodide {VERSION} staged in {out}')


if __name__ == '__main__':
    main()
