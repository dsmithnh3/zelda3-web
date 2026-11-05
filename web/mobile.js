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
    l: ['q', 'KeyQ', 81],
    r: ['w', 'KeyW', 87]
  };
  const pressed = new Map();
  const byKey = new Map();
  const controls = document.getElementById('mobile-controls');
  const canvas = document.getElementById('canvas');
  if (!controls || !canvas) return;

  function send(name, down) {
    const [key, code, keyCode] = bindings[name] || [];
    if (!key) return;
    const ev = new KeyboardEvent(down ? 'keydown' : 'keyup', {
      key, code, bubbles: true, cancelable: true, composed: true
    });
    // SDL/Emscripten may inspect legacy keyboard codes.
    try {
      Object.defineProperties(ev, {
        keyCode: {get: () => keyCode},
        which: {get: () => keyCode}
      });
    } catch (_) {}
    window.dispatchEvent(ev);
    document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {
      key, code, bubbles: false, cancelable: true
    }));
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
  window.Z3Mobile = {releaseAll, bindings};
})();
