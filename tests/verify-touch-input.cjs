#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('web/mobile.js', 'utf8');
class FakeKeyboardEvent {
  constructor(type, init) {
    this.type=type;
    Object.assign(this,init);
  }
}
const events=[];
function element(keys) {
  return {
    dataset:{keys},
    handlers:{},
    classList:{add(){},remove(){}},
    addEventListener(name, fn) { this.handlers[name]=fn; },
    dispatchEvent(e) {events.push({type:e.type,key:e.key,code:e.code,keyCode:e.keyCode,target:'canvas',bubbles:e.bubbles});},
    setPointerCapture(){},
    focus(){},
  };
}
const buttons=['up','down','left','right','a','b','x','y','start','select','l','r'].map(element);
const canvas=element('');
const debug={textContent:'',dataset:{}};
const nodes={'mobile-controls':{querySelectorAll:()=>buttons},canvas,
  'touch-debug':debug,'mobile-wake':null};
const ctx={
  window:{addEventListener() {},Z3:{}},
  document:{getElementById:id=>nodes[id],addEventListener(){}},
  KeyboardEvent:FakeKeyboardEvent,
  console,
  Date,
};
vm.runInNewContext(source,ctx);
function touch(key) {
  const btn=buttons.find(b=>b.dataset.keys===key);
  const e={pointerId:1,preventDefault(){}};
  btn.handlers.pointerdown(e);
  btn.handlers.pointerup(e);
}
touch('a');
touch('down');
touch('l');
touch('r');
touch('start');
assert.deepEqual(events.map(e=>e.key),['x','x','ArrowDown','ArrowDown','c','c','v','v','Enter','Enter']);
assert.deepEqual(events.map(e=>e.type),['keydown','keyup','keydown','keyup','keydown','keyup','keydown','keyup','keydown','keyup']);
assert.ok(events.every(e=>e.target==='canvas' && e.bubbles===true));
assert.ok(events.every(e=>e.keyCode>0));
assert.equal(debug.textContent,'Touch input: START');
assert.equal(debug.dataset.lastKey,'start');
console.log('PASS: touch buttons target canvas, bubble keyboard events, correct SDL key mapping, and update diagnostics');
