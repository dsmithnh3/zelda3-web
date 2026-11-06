/* Mobile game controls for the existing Zelda3 SDL/WebAssembly build.
 * Synthetic keyboard events use the same layout as desktop controls.
 * No game data or ROM bytes are transmitted by this module.
 */
(() => {
  'use strict';
  const bindings = {
    up: ['ArrowUp', 'ArrowUp', 38],
    down: ['ArrowDown', 'ArrowDown', 40],
    left: ['ArrowLeft', 'ArrowLeft', 37],
    right: ['ArrowRight', 'ArrowRight', 39],
    a: ['x', 'KeyX', 88],
    b: ['z', 'KeyZ', 90],
    x: ['s', 'KeyS', 83],
    y: ['a', 'KeyA', 65],
    start: ['Enter', 'Enter', 13],
    select: ['Shift', 'ShiftRight', 16],
    l: ['c', 'KeyC', 67],
    r: ['v', 'KeyV', 86]
  };
  const pressed = new Map();
  const byKey = new Map();
  const controls = document.getElementById('mobile-controls');
  const canvas = document.getElementById('canvas');
  if (!controls || !canvas) return;

  // SDL/Emscripten registers keyboard listeners on an event target such as
  // canvas, document, or window depending on its runtime configuration.
  // Dispatch ONE event from the canvas with bubbling so every ancestor sees
  // the same event; sending separately to document/window missed canvas input.
  const debug = document.getElementById('touch-debug');
  function send(name, down) {
    const [key, code, keyCode] = bindings[name] || [];
    if (!key) return;
    const ev = new KeyboardEvent(down ? 'keydown' : 'keyup', {
      key, code, bubbles: true, cancelable: true, composed: true,
      location: code === 'ShiftRight' ? 2 : 0
    });
    try {
      Object.defineProperties(ev, {
        keyCode: {get: () => keyCode},
        which: {get: () => keyCode}
      });
    } catch (_) {}
    canvas.dispatchEvent(ev);
    if (debug && down) {
      debug.textContent = 'Touch input: ' + name.toUpperCase();
      debug.dataset.lastKey = name;
    }
    if (window.Z3) {
      window.Z3.lastTouchInput = {name, down, timestamp: Date.now(), target: 'canvas'};
    }
  }
  function down(name) {
    const count = byKey.get(name) || 0;
    byKey.set(name, count + 1);
    if (!count) send(name, true);
  }
  function up(name) {
    const count = byKey.get(name) || 0;
    if (count <= 1) {
      byKey.delete(name);
      if (count) send(name, false);
    } else byKey.set(name, count - 1);
  }
  function release(id) {
    const names = pressed.get(id);
    if (!names) return;
    pressed.delete(id);
    names.forEach(up);
  }
  function releaseAll() {
    for (const id of [...pressed.keys()]) release(id);
  }
  for (const btn of controls.querySelectorAll('[data-keys]')) {
    const names = btn.dataset.keys.split(',').filter(Boolean);
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (pressed.has(e.pointerId)) release(e.pointerId);
      pressed.set(e.pointerId, names);
      // Keep focus on the canvas without scrolling or opening a keyboard.
      try { canvas.focus({preventScroll:true}); } catch (_) { canvas.focus(); }
      names.forEach(down);
      btn.classList.add('pressed');
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      btn.addEventListener(type, e => {
        e.preventDefault();
        release(e.pointerId);
        btn.classList.remove('pressed');
      });
    }
    btn.addEventListener('contextmenu', e => e.preventDefault());
  }
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });
  document.addEventListener('touchmove', e => {
    if (e.target.closest('#mobile-controls')) e.preventDefault();
  }, {passive: false});
  canvas.addEventListener('touchstart', e => e.preventDefault(), {passive: false});
  const wake = document.getElementById('mobile-wake');
  if (wake) wake.addEventListener('click', () => {
    canvas.focus({preventScroll: true});
    const audio = window.Z3?.module?.SDL?.audioContext;
    if (audio?.state === 'suspended') audio.resume().catch(() => {});
    wake.hidden = true;
  });
  window.Z3Mobile = {releaseAll, bindings, send};
})();
