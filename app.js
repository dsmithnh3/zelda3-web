/* zelda3 in the browser.
 *
 * Model: the user supplies their own ROM; this page extracts the game's data
 * tables from it in-tab (by running the upstream Python extractor under
 * Pyodide) and feeds the result to the WebAssembly build of the engine.  No ROM
 * bytes and no extracted bytes are shipped with the page, and none leave the
 * tab -- see the CSP in index.html.
 */
'use strict';

// Mirrors ZELDA3_SHA1 in the upstream assets/util.py.  Hash is over the ROM
// with any 512-byte SMC copier header removed, same as the extractor does.
const KNOWN_ROMS = {
  '6d4f10a8b10e10dbe624cb23cf03b88bb8252973': ['us', 'A Link to the Past (USA)'],
  '2e62494967fb0afdf5da1635607f9641df7c6559': ['de', 'A Link to the Past (Germany)'],
  '229364a1b92a05167cd38609b1aa98f7041987cc': ['fr', 'A Link to the Past (France)'],
  'c1c6c7f76fff936c534ff11f87a54162fc0aa100': ['fr-c', 'A Link to the Past (Canada)'],
  '7c073a222569b9b8e8ca5fcb5dfec3b5e31da895': ['en', 'A Link to the Past (Europe)'],
  '461fcbd700d1332009c0e85a7a136e2a8e4b111e': ['es', 'Spanish translation'],
  '3c4d605eefda1d76f101965138f238476655b11d': ['pl', 'Polish translation'],
  'd0d09ed41f9c373fe6afdccafbf0da8c88d3d90d': ['pt', 'Portuguese translation'],
  'b2a07a59e64c498bc1b2f28728f9bf4014c8d582': ['redux', 'English Redux'],
  '9325c22eb0a2a1f0017157c8b620bc3a605cede1': ['redux', 'English Redux'],
  'fa8adfdba2697c9a54d583a1284a22ac764c7637': ['nl', 'Dutch translation'],
  '43cd3438469b2c3fe879ea2f410b3ef3cb3f1ca4': ['sv', 'Swedish translation'],
};

// Every checked-in file the upstream extractor needs.  Pure Python plus one
// 1 KiB lookup table; no ROM-derived bytes.
const EXTRACTOR_FILES = [
  'restool.py', 'util.py', 'tables.py', 'text_compression.py',
  'extract_resources.py', 'compile_resources.py',
  'extract_music.py', 'compile_music.py', 'decode_music.py',
  'sprite_sheets.py', 'sprite_sheet_info.py', 'palette_usage.bin',
];

// Lives one level up from assets/ in the upstream tree; the sprite-sheet dumper
// opens it as '../other/3x5_font.png'.  It is upstream's own 3x5 debug font,
// not anything taken from a ROM.
const EXTRACTOR_OTHER = ['3x5_font.png'];

// Bump when the extractor or the pinned upstream revision changes, so a stale
// cached zelda3_assets.dat is never handed to a newer engine.
const ASSET_CACHE_VERSION = 'zelda3@45a149d8';

const params = new URLSearchParams(location.search);
const WANT_AUDIO = params.get('audio') === '1';
const TURBO = params.get('turbo') === '1';

const el = (id) => document.getElementById(id);
const logEl = el('log');
const barEl = el('bar');

const Z3 = window.Z3 = {
  lines: [],
  phase: 'idle',
  rom: null,          // {sha1, size, lang, label}
  assetsBytes: 0,
  assetsFromCache: false,
  module: null,
  error: null,
  ready: null,        // resolves once callMain has been issued
};

function log(msg) {
  const line = String(msg);
  Z3.lines.push(line);
  if (logEl) {
    logEl.textContent += line + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }
  console.log('[z3]', line);
}

function phase(name, pct) {
  Z3.phase = name;
  if (barEl && pct != null) barEl.style.width = Math.round(pct * 100) + '%';
}

// ---------------------------------------------------------------- SHA-1

/* crypto.subtle only exists in a secure context; this keeps the page honest on
 * plain http too.  Small enough that pulling in a library would be worse. */
function sha1Fallback(bytes) {
  const ml = bytes.length;
  const withPad = new Uint8Array(((ml + 8) >> 6 << 6) + 64);
  withPad.set(bytes);
  withPad[ml] = 0x80;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 4, (ml << 3) >>> 0, false);
  dv.setUint32(withPad.length - 8, Math.floor(ml / 536870912), false);
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  const w = new Int32Array(80);
  const rol = (n, s) => (n << s) | (n >>> (32 - s));
  for (let i = 0; i < withPad.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getInt32(i + j * 4, false);
    for (let j = 16; j < 80; j++) w[j] = rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f, k;
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const t = (rol(a, 5) + f + e + k + w[j]) | 0;
      e = d; d = c; c = rol(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('');
}

async function sha1Hex(bytes) {
  if (globalThis.crypto && crypto.subtle) {
    try {
      const d = await crypto.subtle.digest('SHA-1', bytes);
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { /* fall through */ }
  }
  return sha1Fallback(bytes);
}

// ---------------------------------------------------- asset cache (IndexedDB)

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('zelda3-assets', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('dat');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function cacheGet(key) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const t = db.transaction('dat', 'readonly').objectStore('dat').get(key);
      t.onsuccess = () => res(t.result || null);
      t.onerror = () => rej(t.error);
    });
  } catch (e) { log('asset cache unavailable: ' + e); return null; }
}

async function cachePut(key, value) {
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const t = db.transaction('dat', 'readwrite').objectStore('dat').put(value, key);
      t.onsuccess = () => res();
      t.onerror = () => rej(t.error);
    });
  } catch (e) { log('could not cache assets: ' + e); }
}

// ------------------------------------------------------------- extraction

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function extractAssets(romBytes) {
  phase('loading-python', 0.15);
  log('loading Python runtime (one time, ~13 MB from this server)...');
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'pyodide/pyodide.js';
    s.onload = res; s.onerror = () => rej(new Error('failed to load pyodide/pyodide.js'));
    document.head.appendChild(s);
  });
  const py = await loadPyodide({
    indexURL: 'pyodide/',
    stdout: (s) => log('py: ' + s),
    stderr: (s) => log('py! ' + s),
  });
  phase('loading-python-packages', 0.3);
  await py.loadPackage(['pillow', 'pyyaml']);

  phase('staging-extractor', 0.4);
  py.FS.mkdir('/work');
  py.FS.mkdir('/work/assets');
  for (const name of EXTRACTOR_FILES) {
    py.FS.writeFile('/work/assets/' + name, await fetchBytes('extractor/' + name));
  }
  // The extractor makes img/ overworld/ dungeon/ sound/ itself but assumes
  // sprites/ already exists (it is a checked-in directory upstream).
  py.FS.mkdir('/work/assets/sprites');
  py.FS.mkdir('/work/other');
  for (const name of EXTRACTOR_OTHER) {
    py.FS.writeFile('/work/other/' + name, await fetchBytes('extractor/other/' + name));
  }
  py.FS.writeFile('/work/zelda3.sfc', romBytes);

  phase('extracting', 0.5);
  log('extracting game data from your ROM (this takes a few seconds)...');
  const t0 = performance.now();
  await py.runPythonAsync(`
import sys
sys.argv = ['restool.py', '-r', '/work/zelda3.sfc', '--extract-from-rom']
sys.path.insert(0, '/work/assets')
src = open('/work/assets/restool.py').read()
exec(compile(src, '/work/assets/restool.py', 'exec'),
     {'__file__': '/work/assets/restool.py', '__name__': '__main__'})
`);
  const dat = py.FS.readFile('/work/zelda3_assets.dat');
  log(`extracted zelda3_assets.dat: ${dat.length} bytes in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  // Drop the ROM from the Python heap too, not just ours.
  try { py.FS.unlink('/work/zelda3.sfc'); } catch (e) { /* ignore */ }
  return new Uint8Array(dat);
}

// ------------------------------------------------------------------- boot

function makeIni(iphoneWide = false) {
  // Only the handful of settings that matter here; everything else keeps the
  // upstream default.
  return [
    '[General]',
    'Autosave = 0',
    `DisableFrameDelay = ${TURBO ? 1 : 0}`,
    // ExtendedAspectRatio belongs to [General]; the parser is section-aware and
    // warns if it turns up under [Graphics].
    `ExtendedAspectRatio = ${iphoneWide ? '19.5:9' : '16:9'}, unchanged_sprites`,
    '',
    '[Graphics]',
    'OutputMethod = SDL',
    'NewRenderer = 1',
    'EnhancedMode7 = 1',
    'WindowScale = 1',
    'IgnoreAspectRatio = 0',
    '',
    '[Sound]',
    // Off by default: audio in this build is untested. ?audio=1 opts in.
    `EnableAudio = ${WANT_AUDIO ? 1 : 0}`,
    'EnableMSU = false',
    '',
  ].join('\n');
}

async function boot(datBytes) {
  phase('loading-engine', 0.8);
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'zelda3.js';
    s.onload = res; s.onerror = () => rej(new Error('failed to load zelda3.js'));
    document.head.appendChild(s);
  });

  // Feature gate: only request 19.5:9 with a freshly rebuilt and verified
  // C/WASM engine. An older published bundle continues using known-good 16:9.
  let iphoneWide = false;
  try {
    const response = await fetch('build-record.json', {cache:'no-store'});
    if (response.ok) {
      const meta = await response.json();
      iphoneWide = meta.iphoneWidePpu === true && meta.maxPpuExtra >= 114 &&
        meta.iphoneWideWidth === 484;
    }
  } catch (e) { log('wide-engine capability check unavailable; using 16:9'); }
  const canvas = el('canvas');
  const expectedWidth = iphoneWide ? 484 : 398;
  canvas.width = expectedWidth;
  canvas.height = 224;
  Z3.iphoneWide = iphoneWide;
  log(iphoneWide ? '19.5:9 C/WASM engine verified by build metadata' :
    '16:9 compatibility renderer (no 19.5:9 WASM capability)');
  const mod = await createZelda3({
    canvas,
    noInitialRun: true,
    print: (s) => log(s),
    printErr: (s) => log(s),
  });
  Z3.module = mod;

  const engineIni = makeIni(iphoneWide);
  mod.FS.writeFile('/zelda3.ini', engineIni);
  // Widescreen config is parsed by the compiled C engine at startup.
  // The browser canvas starts at 484x224 for wide engine, 398x224 for fallback.
  Z3.requestedVideo = {aspect: iphoneWide ? '19.5:9' : '16:9', preserveSprites: true,
    width: expectedWidth, height: 224, ini: engineIni};
  mod.FS.writeFile('/zelda3_assets.dat', datBytes);

  // Saves live in IndexedDB via IDBFS so they survive a reload.
  mod.FS.mkdir('/saves');
  mod.FS.mount(mod.IDBFS, {}, '/saves');
  await new Promise((res) => mod.FS.syncfs(true, (err) => {
    if (err) log('save load warning: ' + err);
    res();
  }));
  let had = false;
  try { had = mod.FS.stat('/saves/sram.dat').size > 0; } catch (e) { /* none yet */ }
  log(had ? 'restored saved game from this browser' : 'no previous save in this browser');
  updateSaveLine(had);

  let syncing = false, again = false;
  const sync = () => {
    if (syncing) { again = true; return; }
    syncing = true;
    mod.FS.syncfs(false, (err) => {
      syncing = false;
      if (err) log('save write warning: ' + err);
      else { Z3.lastSaveAt = Date.now(); updateSaveLine(true); }
      if (again) { again = false; sync(); }
    });
  };
  mod.onSramWritten = sync;
  addEventListener('pagehide', sync);
  addEventListener('visibilitychange', () => { if (document.hidden) sync(); });

  phase('running', 1);
  el('stage').hidden = false;
  el('picker').querySelector('.row').style.display = 'none';
  el('audiostate').textContent = WANT_AUDIO
    ? 'enabled via ?audio=1 (untested)' : 'off (add ?audio=1 to enable)';
  canvas.focus();

  // callMain unwinds almost immediately: Asyncify turns the engine's frame
  // delay into a yield back to the browser, and the game resumes from there.
  mod.callMain(['--config', '/zelda3.ini']);
  log(`engine started (${iphoneWide ? '19.5:9' : '16:9'}, unchanged_sprites)`);
  // SDL/Emscripten can reset the canvas dimensions after initialization.
  // Record observed dimensions; never claim verified widescreen from CSS alone.
  const reportCanvas = () => {
    Z3.observedVideo = {width: canvas.width, height: canvas.height};
    Z3.widescreenDimensionsMatch = canvas.width === expectedWidth && canvas.height === 224;
    log(`canvas framebuffer: ${canvas.width}x${canvas.height}; ` +
      (Z3.widescreenDimensionsMatch ? 'matches widescreen dimensions' : 'WARNING: differs from expected widescreen dimensions'));
  };
  setTimeout(reportCanvas, 1000);
}

function updateSaveLine(exists) {
  const node = el('savestate');
  if (!node) return;
  node.textContent = exists
    ? 'stored in this browser (IndexedDB) - survives reload'
    : 'no save yet';
  node.className = exists ? 'ok' : 'muted';
}

// ------------------------------------------------------------------ entry

async function start(file) {
  try {
    Z3.error = null;
    phase('reading-rom', 0.05);
    let bytes = new Uint8Array(await file.arrayBuffer());
    if ((bytes.length & 0xfffff) === 0x200) {
      log('stripping 512-byte SMC copier header');
      bytes = bytes.subarray(0x200);
    }
    const sha1 = await sha1Hex(bytes);
    const known = KNOWN_ROMS[sha1];
    log(`${file.name}: ${bytes.length} bytes, sha1 ${sha1}`);
    if (!known) {
      throw new Error('that ROM is not one the extractor knows (sha1 ' + sha1 +
        '). A US "Legend of Zelda, The - A Link to the Past (USA)" dump is the one to use.');
    }
    Z3.rom = { sha1, size: bytes.length, lang: known[0], label: known[1] };
    log(`recognised: ${known[1]} [${known[0]}]`);
    el('romhint').textContent = known[1];

    const key = `${ASSET_CACHE_VERSION}:${sha1}`;
    let dat = await cacheGet(key);
    if (dat) {
      dat = new Uint8Array(dat);
      Z3.assetsFromCache = true;
      log(`reusing cached zelda3_assets.dat (${dat.length} bytes)`);
      phase('cached', 0.7);
    } else {
      dat = await extractAssets(bytes);
      await cachePut(key, dat);
    }
    Z3.assetsBytes = dat.length;
    Z3.assetsSha1 = await sha1Hex(dat);
    log(`zelda3_assets.dat sha1 ${Z3.assetsSha1}`);

    // The ROM has done its job; let it go.
    bytes.fill(0);
    bytes = null;

    await boot(dat);
  } catch (e) {
    Z3.error = String(e && e.stack || e);
    phase('error');
    log('ERROR: ' + (e && e.message || e));
    console.error(e);
  }
}

Z3.start = start;

addEventListener('DOMContentLoaded', () => {
  el('rom').addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (f) start(f);
  });
  el('focus').addEventListener('click', () => el('canvas').focus());
  updateSaveLine(false);
});
