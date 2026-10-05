# source this: puts the SDL2 shim and the shared emsdk on PATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$ROOT/work/toolchain/bin:$PATH"
# shellcheck disable=SC1090
source "$HOME/decompfleet/shared/emsdk/emsdk_env.sh" >/dev/null 2>&1 || true
