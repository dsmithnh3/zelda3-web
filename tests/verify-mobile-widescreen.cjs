#!/usr/bin/env node
// ROM-free regression checks for the browser engine configuration and iPhone UI.
// For full gameplay proof, the project still needs a user-supplied compatible ROM.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('web/app.js');
const html = read('web/index.html');
const css = read('web/immersive.css');
const js = read('web/immersive.js');
const mobile = read('web/mobile.js');

const engineContext = {
  window: {}, location: {search: ''}, URLSearchParams,
  document: {getElementById: () => null},
  addEventListener: () => {}, console,
};
const ini = vm.runInNewContext(app + '\nmakeIni()', engineContext);
assert.match(ini, /\[General\][\s\S]*ExtendedAspectRatio = 16:9, unchanged_sprites/);
assert.match(ini, /\[Graphics\][\s\S]*IgnoreAspectRatio = 0/);
assert.match(ini, /NewRenderer = 1/);
assert.doesNotMatch(ini, /ExtendedAspectRatio = 4:3/);
assert.match(html, /<canvas id="canvas" width="398" height="224"/);
assert.match(html, /<option value="fit">/);
assert.match(css, /object-fit:contain/);
assert.match(css, /background:rgba\(23,30,43,var\(--hud-alpha\)\)/);
assert.match(mobile, /pointerdown/);
assert.match(app, /Z3\.widescreenDimensionsMatch = canvas\.width === 398 && canvas\.height === 224/);

// Execute real immersive preferences setup with a minimal browser surface.
const nodes = Object.create(null);
for (const id of ['stage','hud-settings','hud-menu','hud-close','turn-hint',
  'hud-opacity','hud-size','hud-screen','hud-fullscreen','canvas']) {
  nodes[id] = {hidden: true, value: null, events: {}, addEventListener(type,fn){this.events[type]=fn;}};
}
const props = Object.create(null);
const state = {dataset:{}, classList:{toggle(){}}};
const saved = Object.create(null);
const uiContext = {
  document: {
    getElementById:id => nodes[id],
    documentElement:{style:{setProperty:(name,value)=>{props[name]=value;}}},
    body:state,
  },
  localStorage:{getItem:key=>saved[key]||null, setItem:(key,val)=>{saved[key]=val;}},
  MutationObserver:class {observe(){}},
  matchMedia:()=>({matches:true}),
  window:{addEventListener(){}},
  globalThis:{screen:{}},
  console,
};
vm.runInNewContext(js,uiContext);
assert.equal(nodes['hud-screen'].value,'fit','fit must be the default on fresh installs');
assert.equal(nodes['hud-opacity'].value,'55','controls should remain translucent');
assert.equal(props['--hud-alpha'],'0.55');
assert.equal(state.dataset.screen,'fit');
nodes['hud-screen'].value='crop';
nodes['hud-screen'].events.change();
assert.equal(state.dataset.screen,'crop');
assert.match(saved['zelda3-hud-v3'],/"screen":"crop"/);
console.log('PASS: C engine configuration, 398x224 canvas, aspect-safe fit, translucent touch controls and preferences');
