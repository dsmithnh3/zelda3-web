# zelda3 — native and browser builds

Build tooling for [snesrev/zelda3](https://github.com/snesrev/zelda3), a C
reimplementation of *The Legend of Zelda: A Link to the Past*, pinned at
`45a149d8b4bb8098f53d1009f76e76e7d8b79bbf`.

**You supply your own ROM.** Nothing here contains a ROM, and nothing here
contains bytes extracted from one. The game's data tables (`zelda3_assets.dat`)
are produced on your machine — at build time natively, and in your own browser
tab for the web build.

## Native

```sh
scripts/bootstrap.sh                      # clone upstream at the pinned revision
scripts/build-native.sh /path/to/zelda3.sfc
./work/zelda3/zelda3                      # upstream's own binary
```

`build-native.sh` runs upstream's `make` unmodified; the only thing it adds is
pointing `assets/restool.py` at a ROM path you give, so no ROM is copied into
the tree.

## Browser

```sh
source scripts/env.sh                     # shared emsdk + the SDL2 shim
python3 scripts/build-browser.py          # -> out/web/zelda3.{js,wasm}
python3 scripts/fetch-pyodide.py          # vendor the Python runtime
python3 scripts/stage-web.py              # assemble out/web
python3 scripts/serve.py --port 8080      # then open http://127.0.0.1:8080/
```

Open the page, pick your `zelda3.sfc`, and it:

1. hashes it and checks the SHA-1 against the list upstream's extractor knows;
2. runs **the upstream Python extractor itself**, unmodified, under Pyodide in
   the tab, producing `zelda3_assets.dat` (about 12 s);
3. caches that in IndexedDB so the ROM is only needed once;
4. boots the WebAssembly engine with it.

The page is served under `Content-Security-Policy: connect-src 'self'`. That is
why Pyodide is vendored rather than loaded from a CDN: with no third-party
origin reachable, the ROM you picked cannot leave the tab even in principle.

Saves go to `/saves/sram.dat` on an IDBFS mount, flushed to IndexedDB the moment
the engine writes SRAM, so they survive a reload.

`?audio=1` enables sound (untested — see STATUS.md). `?turbo=1` removes the
frame delay.

## Testing

```sh
scripts/build-harness.sh
./out/zelda3-headless --upstream work/zelda3 --script tests/play-newgame.txt \
    --ini tests/muted.ini --out out/shots

# ...and the same input script against the original machine code:
./out/zelda3-headless ... --verify /path/to/zelda3.sfc

python3 scripts/run-browser-test.py       # headless Chrome, both stages
```

`harness/headless_play.c` links every upstream object except `src/main.o` and
supplies the handful of symbols `main.c` would have provided. There is no
window, no renderer and no audio device: frames go straight into a buffer via
`ZeldaDrawPpuFrame`, so the test can measure what is actually on screen instead
of assuming a clean boot means a working picture.

`tests/play-newgame.txt` is a plain text input script (`<frames> <buttons>` plus
a few `@` directives). The browser harness fetches and interprets the same file,
so native and web run an identical play-through.

## Layout

```
harness/          headless gameplay driver (native)
web/              the page, its glue, and the browser test harness
scripts/          bootstrap, build, stage, serve, test
tests/            input scripts and the muted config
work/             gitignored: upstream checkout, SDL2 prefix
out/              gitignored: binaries, wasm, screenshots, test results
```
