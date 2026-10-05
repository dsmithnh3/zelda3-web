# zelda3 — status

Date: 2026-10-05 · Host: Ubuntu 26.04, x86-64

## Upstream

| | |
|---|---|
| Project | https://github.com/snesrev/zelda3 |
| Pinned revision | `45a149d8b4bb8098f53d1009f76e76e7d8b79bbf` |
| Commit date / subject | 2026-10-03 — "Update Makefile" |
| Working tree | clean, no local patches to `src/`, `snes/` or `third_party/` |

The decompgames reference script `scripts/build-zelda3-browser.py` pinned
`fbbb3f967a51fafe642e6140d0753979e73b4090`. HEAD is four commits ahead. One of
those four, `ba4d5ec` "Fix C23 prototype errors", **removes the need for the two
function-signature fixes that script applied**: `ppu_init()` now takes no
arguments at the declaration and both call sites, so no `ppu_init` patching is
required at this revision. The only source patches this build applies are the
Asyncify yield and an IDBFS flush (both listed below).

## This repo's scope

zelda3 is a **reimplementation**, not a byte-matching decompilation. It produces
no ROM, so the fleet rule "the output byte-matches the staged ROM" has no
corresponding artifact here. What it offers instead is stronger, and was
exercised: upstream can run the **original 65816 machine code in its bundled
SNES emulator alongside the C code and compare RAM, SRAM and VRAM after every
frame.** Results below.

## Hashes

| Artifact | Size | SHA-1 | SHA-256 |
|---|---|---|---|
| `~/decompfleet/roms/zelda3.sfc` (input, read-only) | 1 048 576 | `6d4f10a8b10e10dbe624cb23cf03b88bb8252973` | `66871d66be19ad2c34c927d6b14cd8eb6fc3181965b6e517cb361f7316009cfb` |
| `zelda3_assets.dat` extracted **natively** | 683 888 | `d65587f9fe677909f3f5cac94a0248677594be26` | `0fe2e4bd75d70f06fb9a74cd3a9cb336c838149b831b56e8792114a89292c793` |
| `zelda3_assets.dat` extracted **in the browser** | 683 888 | `d65587f9fe677909f3f5cac94a0248677594be26` | — |
| `work/zelda3/zelda3` (upstream native binary) | 1 763 816 | — | `ef2e93910c9be6a2693996cb5c10de3d808cc57a56a6f9981daa8ce225902777` |
| `out/zelda3-headless` (test harness binary) | 1 756 576 | — | `93dcb525ccd0dd99c84341272ffeb1d081a29742f50eac3028b61e6faa5d42c0` |
| `out/web/zelda3.wasm` | 2 225 293 | — | `2ef9a0294030655e59c820c35a5b769453b54da388f7e84f9a1ee20a9fc5bffb` |
| `out/web/zelda3.js` | 202 619 | — | `a8ae94e03ecc84683dff48d089b760f259c9b1b8d2dcce59aaaa97f68c0519cc` |

The ROM's SHA-256 matches the one upstream's `BUILDING.md` requires for the US
region. **The browser extraction is byte-identical to the native extraction** —
same 683 888 bytes, same SHA-1 — which is the main thing worth taking from the
asset-import work.

Binary hashes are from this host's toolchain and are not expected to reproduce
elsewhere.

## Toolchain

| | |
|---|---|
| gcc | 15.2.0 (Ubuntu 15.2.0-16ubuntu1) |
| make | GNU Make 4.4.1 |
| Python | 3.14.4, with Pillow 12.1.1 and PyYAML 6.0.3 |
| SDL2 | 2.32.10 (see note) |
| emcc | 4.0.10 (`b7dc6e5747465580df5984e723b9d1f10d8e804b`), shared emsdk at `~/decompfleet/shared/emsdk` |
| node (from emsdk) | v24.19.0 |
| Pyodide (vendored into `out/web`) | 0.28.3, with `pillow-11.3.0` and `pyyaml-6.0.2` wasm wheels (sha256-checked against `pyodide-lock.json`) |
| Chrome (tests only) | Google Chrome 151.0.7922.108, `--headless=new`, `--enable-unsafe-swiftshader`, `--mute-audio` |

**SDL2 note.** This host has the SDL2 runtime (`libSDL2-2.0.so.0`, 2.32.10) but
no `libsdl2-dev`, and no root to install it. `scripts/bootstrap.sh` therefore
`apt-get download`s the matching `libsdl2-dev` 2.32.10 package, unpacks it into
`work/toolchain/sdl2`, and puts a `sdl2-config` shim on PATH that serves headers
and the static lib from that prefix while the `.so` resolves to the system
library. Versions match exactly, so this is a packaging workaround, not a
version skew. On a machine with `libsdl2-dev` installed, bootstrap uses the
system `sdl2-config` and the shim is never created.

## Builds

**Native** — `make -j` in the pinned tree, unmodified, with upstream's own
`CFLAGS` (`-O2 -Werror`). Clean: no warnings, no errors. Assets are extracted by
pointing `assets/restool.py -r <rom path>` at the read-only staged ROM, so no
ROM is copied anywhere.

**Browser** — `scripts/build-browser.py`, emcc 4.0.10, flags:

```
-O2 -sUSE_SDL=2 -DSYSTEM_VOLUME_MIXER_AVAILABLE=0 -sASYNCIFY=1
-sALLOW_MEMORY_GROWTH=1 -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0
-sMODULARIZE=1 -sEXPORT_NAME=createZelda3
-sEXPORTED_RUNTIME_METHODS=FS,IDBFS,callMain,ccall,cwrap,HEAPU8 -lidbfs.js
```

Two source files are copied and patched; the build asserts each substitution
applies exactly once and aborts if upstream moved:

1. `src/main.c` — `SDL_Delay(` → `emscripten_sleep(` (2 sites), plus one
   unconditional `emscripten_sleep(0)` at the top of the main loop. The extra
   yield is not cosmetic: with `DisableFrameDelay = 1` the loop contains no
   `SDL_Delay` at all and would otherwise lock the tab forever.
2. `src/zelda_rtl.c` — `ZeldaWriteSram()` calls back into JS so IDBFS is flushed
   the moment the game writes SRAM, rather than on a timer.

`web/browser_glue.c` adds read-only accessors (`z3_frame`, `z3_module`,
`z3_link_x`, `z3_sram_hash`, …) used only by the test harness.

## The browser page

- The user picks `zelda3.sfc` with a normal file input. It is read with
  `file.arrayBuffer()`, the 512-byte SMC copier header is stripped if present,
  and the SHA-1 is checked against the twelve hashes upstream's extractor knows.
  An unrecognised ROM is refused with its hash shown.
- **The upstream Python extractor runs unmodified in the tab**, under Pyodide,
  producing `zelda3_assets.dat` in about 12 s. That is the same `restool.py`
  the native build runs — not a reimplementation of it.
- The result is cached in IndexedDB keyed by ROM hash + revision, so the ROM is
  only needed once. The ROM buffer is zeroed and dropped afterwards.
- **Nothing is uploaded.** The page is served under
  `Content-Security-Policy: connect-src 'self'`, which is why Pyodide is
  vendored locally instead of pulled from a CDN: there is no third-party origin
  the page could reach. The page makes no POST of any kind.
- Saves: `/saves` is an IDBFS mount; `/saves/sram.dat` is flushed to IndexedDB
  on every engine SRAM write and on `pagehide`/`visibilitychange`.

Page weight: 2.2 MB wasm + 200 KB JS + 13 MB vendored Pyodide. The Pyodide half
is only fetched the first time a ROM is imported.

## What was actually tested

### Native, muted, no window, no audio device

`out/zelda3-headless` links every upstream object except `src/main.o` and
supplies the eight symbols `main.c` would have provided. It never calls
`SDL_Init`, never opens an audio device, and renders through
`ZeldaDrawPpuFrame` into a plain buffer, so every frame can be measured.

- **`tests/play-newgame.txt` — 4 213 frames, 0 failures.** Boot through the
  triforce intro and title; Start to the file select; pick the empty slot 1;
  type a character and confirm the name (this is where the engine first writes
  SRAM); start the file; mash B through Zelda's opening telepathy until Link is
  out of bed; walk to the door and leave the house; walk west until the
  overworld area index changes.
- Asserted along the way: `main_module_index` 0 → 1 → 4 → 1 → 7 → 9,
  `dungeon_room_index == 0x0104` (Link's House), `link_health == 24/24`,
  `overworld_area_index` 0x2C (Link's house exterior) → **0x2B** (one screen
  west), and on every checkpoint frame a mean-luma and distinct-colour floor —
  because a renderer that compiles and draws nothing still "boots".
- Final state: module 9 (overworld), area 0x2B, Link at (1760, 2944), in the
  rain, 3/3 hearts. Frames were dumped and **looked at**, not just measured:
  `out/shots/*.ppm` → the file select, the name entry, Link asleep in bed with
  "Help me… Please help me…", the lit house interior, the rainy overworld path
  with two castle guards, and the tree-lined screen to the west.

### Co-simulation against the original machine code

Same 4 213-frame script, with `--verify ~/decompfleet/roms/zelda3.sfc`:

```
verify: 4213 frames compared against the original machine code, 0 skipped
=== 0 failure(s), 4213 frames run ===
stderr: empty
```

Every one of those frames ran the original 65816 code in upstream's SNES
emulator and the C reimplementation side by side and compared the full 128 KiB
RAM, 8 KiB SRAM and 64 KiB VRAM. **Zero divergences.**

**Negative control** (because a comparison that never fires proves nothing):
poking a single byte into `g_ram[0x2000]` mid-run produced
`0x002000: 5A != 00` and tripped upstream's assert on the next frame. The
comparison is live. The `@poke` directive is kept in the harness for exactly
this purpose.

### Native, stock upstream binary

`work/zelda3/zelda3` (upstream's own `main`, untouched) ran for 10 s under
`SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy` with `OutputMethod = SDL-Software`
and `EnableAudio = 0`, no errors. That is a smoke test of the stock binary, not
a play-through.

### Browser, headless Chrome, muted

`scripts/run-browser-test.py`, clean Chrome profile, two stages, driving the
real page with **synthetic `KeyboardEvent`s on `window`** — i.e. through SDL2's
own input path, not an internal hook. The browser harness fetches and
interprets the *same* `tests/play-newgame.txt`.

Stage 1 (`out/browsercheck/result-stage1.json`), 0 failures:

- ROM accepted and identified as "A Link to the Past (USA)" from its SHA-1.
- `zelda3_assets.dat` extracted in-tab: 683 888 bytes, SHA-1
  `d65587f9…` — identical to the native extraction.
- The full play-through ran: **4 215 frames in 70.2 s wall clock**, reaching
  overworld area 0x2B exactly as the native run did.
- Canvas read back with `getImageData` at each checkpoint: 512×448, and the
  luma figures match the native renderer to two decimal places
  (91.22 / 73.37 / 71.73 in the browser against 91.22 / 73.41 / 71.78 natively;
  the small deltas are the one- to two-frame grain of frame-counter polling).
  PNGs of every checkpoint are in `out/browsercheck/`.
- `/saves/sram.dat`: 8 192 bytes on disk at the end of play.

Stage 2 — full page reload, same Chrome profile, 0 failures:

- `/saves/sram.dat` came back from IndexedDB **byte-identical** (8 192 bytes,
  FNV-1a `2322466173` both sides).
- Ran `tests/reload-loadsave.txt`: the file select now shows slot 1 named "G"
  with three hearts, and choosing it **loads the saved game** (module 0x0E,
  room 0x0104, 24/24 HP) rather than dropping into name entry. Screenshot:
  `out/browsercheck/reload-02-loaded.png`.
- The asset cache was reused — no re-extraction, so the ROM is genuinely needed
  only once.
- Finally `index.html` itself (not the harness page) was booted in an iframe
  from the same server: it reached a running engine on its own, 123 frames,
  canvas 479×419, aspect within 0.3 % of 256:224.

A bug this found, worth recording because a green suite hid it twice: Chrome
SIGTERMed between stages records a crash and **restores the previous tab on the
next launch**, so a stale stage-2 report was picked up as stage 1's result and
the run looked plausible. The page now closes its own tab after posting, the
orchestrator kills any Chrome still holding the profile, and a result whose
`stage` field disagrees with the stage requested is a hard failure.

## What was NOT tested

- **Audio, in any build.** Never enabled, per the fleet rules. The browser
  `?audio=1` path has never been run; treat it as unverified. Chrome ran with
  `--mute-audio` and no audio device was ever opened in the native harness.
- **Any gameplay beyond overworld area 0x2B.** No dungeon, no combat, no items,
  no sword, no in-game save point, no bosses, no ending. "Playable from start to
  end" is upstream's claim, not something checked here.
- Upstream's reference play-through snapshots (`saves/ref/Chapter *.sav`) were
  not replayed. That would be the obvious next step for deeper coverage.
- Firefox and Safari: not run at all. Chrome 151 headless only.
- Mobile, touch input, gamepad input: none of it exercised, in either build.
- Windowed native run on a real display, fullscreen, window resizing, the
  OpenGL and OpenGL-ES output methods, shaders, MSU-1 audio, widescreen /
  240-line modes, item switching and the other upstream extras.
- Non-US ROMs. The page accepts the other eleven hashes upstream knows, but only
  the US dump was ever imported or played.
- Page performance on a GPU: all browser figures are Chrome's SwiftShader
  software rasteriser. 70 s for 4 215 frames is ~60 fps, which is the frame
  delay doing its job rather than a measured ceiling.
- Long-session stability, memory growth, and what happens when IndexedDB quota
  is exhausted.
- `scripts/bootstrap.sh` end to end on a clean machine: its clone/checkout path
  and its SDL2 fallback were both exercised here piecewise, but the script as
  written has not been run from scratch on a host without `work/`.

## Proposed decompgames catalog fragment

Not merged — `src/data/games.json` is yours. `embedUrl` is a placeholder until
this is actually hosted.

```json
{
  "id": "zelda3",
  "title": "The Legend of Zelda: A Link to the Past",
  "aliases": ["alttp", "zelda3", "a-link-to-the-past"],
  "year": 1991,
  "genre": "Action-adventure",
  "kind": "Engine recreation",
  "mode": "embed",
  "engine": "snesrev/zelda3 C reimplementation built to WebAssembly with Emscripten + Asyncify",
  "description": "Rescue Zelda and break Ganon's hold on Hyrule across a light and dark world.",
  "overview": "The snesrev/zelda3 reimplementation compiled to WebAssembly. You supply your own US ROM; the page runs the project's own Python extractor in your browser under Pyodide to build zelda3_assets.dat, caches it, and never sends anything anywhere.",
  "source": "https://github.com/snesrev/zelda3",
  "engineLicense": "See snesrev/zelda3",
  "assetLicense": "None distributed; assets are extracted from your own ROM in your browser",
  "assetRequirements": "Your own US 'Legend of Zelda, The - A Link to the Past (USA)' ROM, 1 MiB, sha1 6d4f10a8b10e10dbe624cb23cf03b88bb8252973. Read in the tab and never uploaded; needed once, then cached.",
  "controls": [
    "Arrow keys — move",
    "Z — B, X — A",
    "A — Y, S — X",
    "C / V — L / R",
    "Enter — Start, Right Shift — Select"
  ],
  "saveInstructions": "The game's SRAM is stored in this browser via IndexedDB and survives a reload. Clearing site data erases it, along with the cached asset file.",
  "limitations": [
    "Audio is off by default and has not been tested; ?audio=1 enables it at your own risk.",
    "First run downloads a ~13 MB Python runtime to extract the game data from your ROM; later runs skip it.",
    "Verified in Chrome only. Keyboard only: no gamepad or touch support yet."
  ],
  "inputs": ["Keyboard"],
  "downloadMB": 15,
  "complete": false,
  "color": "#3f7d3a",
  "shelf": "classic",
  "platform": "SNES",
  "launch": "embed",
  "touch": false,
  "embedUrl": "https://andrewnakas.github.io/zelda3/",
  "verification": {
    "status": "played",
    "date": "2026-10-05",
    "browsers": ["Chrome 151 headless (SwiftShader)"],
    "scope": "New file created, opening cutscene cleared, Link walked out of his house and across an overworld screen boundary (area 0x2C to 0x2B), 4215 frames, muted. Save survives a page reload and reloads into the game. Nothing past that screen was played; audio untested.",
    "playthrough": false
  }
}
```
