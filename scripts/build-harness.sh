#!/usr/bin/env bash
# Builds the headless muted gameplay driver against the pinned upstream tree.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UP="$ROOT/work/zelda3"
export PATH="$ROOT/work/toolchain/bin:$PATH"

[ -d "$UP" ] || { echo "upstream missing: run scripts/bootstrap.sh" >&2; exit 1; }

# The harness replaces src/main.o, so build everything else first via the
# upstream Makefile (keeps upstream's exact flags), then link our driver in.
make -C "$UP" -j"$(nproc)" >/dev/null
CFLAGS="-O2 -Werror -I $UP $(sdl2-config --cflags) -DSYSTEM_VOLUME_MIXER_AVAILABLE=0"
mkdir -p "$ROOT/out"
# shellcheck disable=SC2086
cc -c $CFLAGS "$ROOT/harness/headless_play.c" -o "$ROOT/out/headless_play.o"
OBJS=$(ls "$UP"/src/*.o "$UP"/snes/*.o "$UP"/third_party/gl_core/*.o "$UP"/third_party/opus-1.3.1-stripped/*.o | grep -v '/src/main\.o$')
# shellcheck disable=SC2086
cc $OBJS "$ROOT/out/headless_play.o" -o "$ROOT/out/zelda3-headless" $(sdl2-config --libs) -lm
echo "built $ROOT/out/zelda3-headless"
