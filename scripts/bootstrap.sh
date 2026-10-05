#!/usr/bin/env bash
# One-time setup: fetch the pinned upstream tree and make sure SDL2 headers are
# reachable.  Never touches your ROM.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_URL="https://github.com/snesrev/zelda3"
UPSTREAM_REV="45a149d8b4bb8098f53d1009f76e76e7d8b79bbf"
UP="$ROOT/work/zelda3"

mkdir -p "$ROOT/work"
if [ ! -d "$UP/.git" ]; then
  echo "cloning $UPSTREAM_URL"
  git clone "$UPSTREAM_URL" "$UP"
fi
git -C "$UP" fetch --quiet origin
git -C "$UP" checkout --quiet "$UPSTREAM_REV"
echo "upstream pinned at $(git -C "$UP" rev-parse HEAD)"

python3 - <<'PY'
import importlib.util, sys
missing = [m for m in ('PIL', 'yaml') if importlib.util.find_spec(m) is None]
if missing:
    sys.exit('missing Python modules: %s  (pip install Pillow PyYAML)' % ', '.join(missing))
print('python deps ok (Pillow, PyYAML)')
PY

if command -v sdl2-config >/dev/null 2>&1; then
  echo "system sdl2-config: $(sdl2-config --version)"
  exit 0
fi

# No SDL2 development files and (on the fleet host) no root to install them.
# Unpack the matching Debian/Ubuntu -dev package into work/toolchain and put a
# shim on PATH that points at it; the .so still resolves to the system library.
echo "no sdl2-config on PATH; unpacking a local SDL2 dev prefix"
command -v dpkg-deb >/dev/null || { echo "need dpkg-deb, or install libsdl2-dev yourself" >&2; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
( cd "$TMP" && apt-get download libsdl2-dev )
PREFIX="$ROOT/work/toolchain/sdl2"
mkdir -p "$PREFIX" "$ROOT/work/toolchain/bin"
dpkg-deb -x "$TMP"/libsdl2-dev_*.deb "$PREFIX"
LIBDIR="$PREFIX/usr/lib/x86_64-linux-gnu"
SOFILE="$(ls /usr/lib/x86_64-linux-gnu/libSDL2-2.0.so.0 2>/dev/null || true)"
[ -n "$SOFILE" ] || { echo "libSDL2-2.0.so.0 is not installed either; install libsdl2-2.0-0" >&2; exit 1; }
ln -sf "$SOFILE" "$LIBDIR/libSDL2.so"
ln -sf "$SOFILE" "$LIBDIR/libSDL2-2.0.so"
cat > "$ROOT/work/toolchain/bin/sdl2-config" <<'SHIM'
#!/bin/sh
# Shim over a locally unpacked libsdl2-dev: headers and .a from the prefix, the
# shared library from the system install.
PREFIX="$(cd -P -- "$(dirname -- "$0")/../sdl2/usr" && pwd -P)"
LIBDIR="$PREFIX/lib/x86_64-linux-gnu"
for arg in "$@"; do
  case "$arg" in
    --version) echo 2.32.10 ;;
    --prefix) echo "$PREFIX" ;;
    --cflags) echo "-I$PREFIX/include/SDL2 -I$PREFIX/include/x86_64-linux-gnu -D_REENTRANT" ;;
    --libs) echo "-L$LIBDIR -lSDL2" ;;
    --static-libs) echo "$LIBDIR/libSDL2.a -lm -ldl -lpthread -lrt" ;;
    *) echo "usage: sdl2-config [--version|--prefix|--cflags|--libs|--static-libs]" >&2; exit 1 ;;
  esac
done
SHIM
chmod +x "$ROOT/work/toolchain/bin/sdl2-config"
echo "local SDL2 prefix ready; source scripts/env.sh to put it on PATH"
