/* Immersive landscape HUD for iOS Safari/PWA; no ROM/network access. */
(() => {
  'use strict';
  const stage = document.getElementById('stage');
  const settings = document.getElementById('hud-settings');
  const toggle = document.getElementById('hud-menu');
  const close = document.getElementById('hud-close');
  const hint = document.getElementById('turn-hint');
  const opacity = document.getElementById('hud-opacity');
  const size = document.getElementById('hud-size');
  const screen = document.getElementById('hud-screen');
  const fullscreen = document.getElementById('hud-fullscreen');
  const canvas = document.getElementById('canvas');
  if (!stage || !settings || !canvas) return;
  const key = 'zelda3-hud-v2';
  let preferences = {opacity:55,size:100,screen:'fit'};
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '{}');
    if (typeof stored === 'object' && stored) Object.assign(preferences, stored);
  } catch (_) {}
  function clamp(n, lo, hi) {return Math.min(hi,Math.max(lo,Number(n)||lo));}
  function apply() {
    preferences.opacity = clamp(preferences.opacity,20,95);
    preferences.size = clamp(preferences.size,70,125);
    if (!['fit','fill','crop'].includes(preferences.screen)) preferences.screen='fit';
    document.documentElement.style.setProperty('--hud-alpha',String(preferences.opacity/100));
    document.documentElement.style.setProperty('--hud-scale',String(preferences.size/100));
    document.body.dataset.screen = preferences.screen;
    opacity.value=String(preferences.opacity);
    size.value=String(preferences.size);
    screen.value=preferences.screen;
    try {localStorage.setItem(key,JSON.stringify(preferences));} catch (_) {}
  }
  apply();
  function sync() {
    const active = !stage.hidden;
    document.body.classList.toggle('game-running',active);
    if (hint) hint.hidden = !active || matchMedia('(orientation:landscape)').matches;
  }
  new MutationObserver(sync).observe(stage,{attributes:true,attributeFilter:['hidden']});
  window.addEventListener('orientationchange',sync);
  window.addEventListener('resize',sync);
  sync();
  toggle?.addEventListener('click',() => {
    window.Z3Mobile?.releaseAll?.();
    settings.hidden = !settings.hidden;
  });
  close?.addEventListener('click',() => {settings.hidden=true;canvas.focus({preventScroll:true});});
  opacity?.addEventListener('input',() => {preferences.opacity=opacity.value;apply();});
  size?.addEventListener('input',() => {preferences.size=size.value;apply();});
  screen?.addEventListener('change',() => {preferences.screen=screen.value;apply();});
  fullscreen?.addEventListener('click',async() => {
    // iPhone Safari generally does NOT support arbitrary-element fullscreen.
    // In a home-screen PWA, standalone display removes browser chrome.
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.requestFullscreen) await stage.requestFullscreen();
    } catch (_) {}
    if (screen.orientation?.lock) {
      try { await screen.orientation.lock('landscape'); } catch (_) {}
    }
  });
})();
