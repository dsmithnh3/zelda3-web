#!/usr/bin/env bash
# Native build, exactly as upstream expects: `make` in the upstream tree.
# The only addition is pointing the asset extraction at a ROM path you give,
# so no ROM is ever copied into this tree.
#
#   scripts/build-native.sh [/path/to/zelda3.sfc]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UP="$ROOT/work/zelda3"
ROM="${1:-$HOME/decompfleet/roms/zelda3.sfc}"
# shellcheck disable=SC1091
source "$ROOT/scripts/env.sh"

[ -d "$UP" ] || { echo "run scripts/bootstrap.sh first" >&2; exit 1; }
[ -f "$ROM" ] || { echo "no ROM at $ROM" >&2; exit 1; }

if [ ! -f "$UP/zelda3_assets.dat" ]; then
  echo "extracting assets from $ROM (nothing is copied into the repo)"
  ( cd "$UP" && python3 assets/restool.py -r "$ROM" --extract-from-rom )
fi
make -C "$UP" -j"$(nproc)"
echo
echo "built $UP/zelda3"
sha1sum "$UP/zelda3_assets.dat"
