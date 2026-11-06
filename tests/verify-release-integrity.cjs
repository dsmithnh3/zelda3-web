#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../web');
const record = JSON.parse(fs.readFileSync(path.join(root,'build-record.json'),'utf8'));
assert.equal(record.iphoneWidePpu,true);
assert.equal(record.iphoneWideWidth,484);
assert.equal(record.iphoneWideHeight,224);
assert.equal(record.maxPpuExtra,116);
for(const file of record.files){
  assert.ok(['zelda3.js','zelda3.wasm'].includes(file.path),'unexpected compiled artifact');
  const data=fs.readFileSync(path.join(root,file.path));
  assert.equal(data.length,file.bytes,file.path+' byte size differs from build manifest');
  const digest=crypto.createHash('sha256').update(data).digest('hex');
  assert.equal(digest,file.sha256,file.path+' sha256 differs from build manifest');
}
const wasm=fs.readFileSync(path.join(root,'zelda3.wasm'));
assert.ok(wasm.subarray(0,4).equals(Buffer.from([0,97,115,109])),'WASM magic mismatch');
const required=['index.html','app.js','mobile.js','mobile.css','immersive.js','immersive.css','menu-wide.js','canvas-readback.js','diagnostics.js','manifest.webmanifest','pyodide/pyodide.js','pyodide/pyodide.asm.wasm','extractor/restool.py'];
for(const name of required)assert.ok(fs.statSync(path.join(root,name)).size>0,'missing '+name);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const idx=html.indexOf('<script src="canvas-readback.js"></script>');
assert.ok(idx>0 && idx<html.indexOf('<script src="app.js"></script>'),'WebGL readback must load before game startup');
for(const name of ['canvas-readback.js','menu-wide.js','diagnostics.js'])assert.ok(html.includes('src="'+name+'"'));
const forbidden=['.sfc','.smc','.cia','zelda3_assets.dat'];
function walk(dir){
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,entry.name);
  if(entry.isDirectory())walk(p);
  else assert.ok(!forbidden.some(ext=>entry.name.toLowerCase().endsWith(ext)), 'ROM or assets bundled: '+p);
 }
}
walk(root);
console.log('PASS: pinned WASM SHA256, sizes, source capabilities, required files, load order and ROM-free distribution');
