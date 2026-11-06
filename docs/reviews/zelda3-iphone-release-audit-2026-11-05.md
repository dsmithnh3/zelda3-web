# Zelda3 iPhone release review — 2026-11-05

Repository: [dsmithnh3/zelda3-web](https://github.com/dsmithnh3/zelda3-web)

## Review method and independence

Four separate review tracks were performed in one ChatGPT session, using source inspection, upstream engine inspection, real Chromium/WebKit GitHub Actions tests, and GitHub Pages deployment evidence. **No independent AI subagents or external human reviewers were launched.** The tracks are separate technical checks, not independent agent endorsements.

## Findings

| Track | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| Engine/WASM | Engine is rebuilt with 19.5:9 parser and 116-pixel PPU side capacity; release metadata identifies the 484×224 output. Source/binary build and runtime initialization verified, **not gameplay frames**. | Medium residual risk | Compiled and smoke tested |
| iOS/WebKit rendering | Menu side-fill copied from the game canvas. WebGL drawing buffers may be transient after presentation; preserving the game canvas's WebGL drawing buffer makes the source readable for this compositor. | High | Added `web/canvas-readback.js` and Chromium/WebKit test |
| iPhone input/UI | Synthetic touch buttons dispatch bubbling keyboard events on the game canvas; tests confirm event delivery to a canvas listener, **not input consumption by the running Zelda engine**. Landscape layout, fit scaling and settings are browser-tested. | High residual risk | Integration smoke tests pass; gameplay not proven |
| Storage | Emscripten IDBFS persists an independent test file across a page reload in Chromium and WebKit; **actual in-game SRAM save/load not proven**. | Medium residual risk | Browser storage verified |
| CI/release | Two independent workflows could force-push `gh-pages` and browser verification was not a release prerequisite. | High | Serialize both workflows; SHA-256 build integrity and Chromium/WebKit tests now gate publication |
| Security & distribution | Release checks explicitly refuse raw `.sfc`, `.smc`, `.cia` and `zelda3_assets.dat` files; build metadata hashes are validated. | Medium | Added `verify-release-integrity.cjs` |
| Audio | Audio is disabled by default and still untested on a real device. | Medium residual risk | Open |
| Performance | No direct frame-time, memory, battery or gesture testing on a physical iPhone. WebGL preserved drawing buffer incurs possible overhead. | Medium residual risk | Open |
| Game compatibility | Menu/dungeon/overworld/camera-boundary behavior not validated with a real compatible ROM; menu extension currently targets only `main_module_index === 1`. | High residual risk | Open |

## Release verification gates

- `tests/verify-release-integrity.cjs`: verifies SHA-256 and sizes of `zelda3.js` and `zelda3.wasm`, target capabilities, required files, safe script ordering and absence of bundled ROM data.
- `tests/verify-mobile-widescreen.cjs`: checks engine configuration, viewport preferences and translucent controls.
- `tests/verify-touch-input.cjs`: checks synthetic pointer-to-keyboard event behavior.
- `tests/verify-real-browsers.cjs`: launches Chromium and WebKit with 956×440 mobile viewport; verifies actual WASM compile/init, landscape layout, WebGL buffer availability, menu bands using synthetic pixels, touch event delivery, diagnostics and persistent IDBFS readback.

**Scope limitation:** Browser tests use synthetic menu graphics and no copyrighted ROM; 20+ passing checks do not certify gameplay correctness. Playable engine execution needs a legally obtained supported ROM and device-based observation.

## Mandatory release acceptance criteria still open

1. A user-supplied, compatible original SNES ROM completes in-browser extraction and enters the running game without error.
2. Physical iPhone Safari: touch buttons select a file slot, enter the world, move Link, and act, with correct key-up/release handling.
3. Genuine widescreen: observe overworld and dungeon frame content at 484×224, including camera boundaries and sprites, with no blank/doubled tiles or overlays.
4. Save/load: create an in-game save, close Safari, reload, and confirm slot/position persisted.
5. Audio: verify activation after user interaction and output device switching, with no browser autoplay failure.
6. Measure 30–60 minutes of iPhone play: fps, frame pacing, thermal throttling, memory pressure, orientation and Home Screen PWA resume.

## Decision

**Release status: browser-integration verified, not gameplay-certified.** It is not appropriate to claim “everything works” until the remaining user-ROM and physical-device tests pass.
