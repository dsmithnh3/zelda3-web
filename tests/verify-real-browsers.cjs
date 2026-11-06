#!/usr/bin/env node
'use strict';
// Real browser integration tests. No SNES ROM or copyrighted game data required.
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const URL = process.env.Z3_TEST_URL || 'http://127.0.0.1:8765/';
const out = process.env.Z3_TEST_OUT || 'out/browser-audit';
fs.mkdirSync(out, {recursive:true});
const results = [];
const errors = [];
function check(condition, label) {
  assert.ok(condition, label);
  results.push('PASS ' + label);
}
async function testBrowser(name, engine) {
  const browser = await engine.launch({headless:true});
  const context = await browser.newContext({
    viewport:{width:956,height:440}, isMobile:true, hasTouch:true,
    deviceScaleFactor:2
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => {if(m.type()==='error') errors.push(name+': '+m.text())});
  try {
    const response = await page.goto(URL, {waitUntil:'load',timeout:30000});
    check(response.status()===200, name+' HTTP site loading');
    check(await page.locator('#rom').count()===1,name+' user ROM import control');
    check(await page.locator('#menu-edge-left').count()===1,name+' menu overlay installed');
    check(await page.locator('#hud-settings').count()===1,name+' settings installed');
    const manifest = await page.evaluate(async()=>{
      const res=await fetch('build-record.json',{cache:'no-store'});
      return res.json();
    });
    check(manifest.iphoneWidePpu===true && manifest.iphoneWideWidth===484 &&
      manifest.maxPpuExtra>=114,name+' 19.5:9 published capabilities');
    const wasm = await page.evaluate(async()=>{
      const res=await fetch('zelda3.wasm');
      if(!res.ok) throw new Error('WASM HTTP '+res.status);
      const bytes=await res.arrayBuffer();
      const m=await WebAssembly.compile(bytes);
      return {valid:WebAssembly.validate(bytes),size:bytes.byteLength,
        exports:WebAssembly.Module.exports(m).map(x=>x.name)};
    });
    check(wasm.valid && wasm.size>1000000,name+' real browser WASM compile');
    check(wasm.exports.some(x=>x.includes('z3_module')),name+' game state instrumentation exported');
    const initial=await page.evaluate(()=>{
      const stage=document.getElementById('stage');
      const c=document.getElementById('canvas');
      c.width=484;c.height=224;
      const ctx=c.getContext('2d');
      ctx.fillStyle='#070707';ctx.fillRect(0,0,484,224);
      ctx.fillStyle='#457a58';ctx.fillRect(114,0,256,224);
      // Fake pixels to exercise menu-extension geometry, NOT Zelda artwork.
      ctx.fillStyle='#93be7a';ctx.fillRect(120,0,18,224);
      ctx.fillStyle='#93be7a';ctx.fillRect(346,0,18,224);
      window.Z3={module:{ccall:(name)=>name==='z3_module'?1:0}};
      window.__synthKeys=[];
      c.addEventListener('keydown',e=>window.__synthKeys.push(e.code));
      stage.hidden=false;
      return {stageHidden:stage.hidden};
    });
    try {
      await page.waitForFunction(() => {
        const l=document.getElementById('menu-edge-left');
        const r=document.getElementById('menu-edge-right');
        return !l.hidden && !r.hidden && l.width>0 && r.width>0;
      },null,{timeout:3000});
    } catch (_) {
      // Capture actual WebKit failure geometry below, not a generic timeout.
    }
    const layout=await page.evaluate(()=>{
      const stage=document.getElementById('stage');
      const src=document.getElementById('canvas');
      const controls=document.getElementById('mobile-controls');
      const left=document.getElementById('menu-edge-left');
      const right=document.getElementById('menu-edge-right');
      const r=src.getBoundingClientRect();
      const cr=controls.getBoundingClientRect();
      return {stageHidden:stage.hidden,gameRunning:document.body.classList.contains('game-running'),
        objectFit:getComputedStyle(src).objectFit,canvasWidth:src.width,canvasHeight:src.height,
        sourceRect:[r.x,r.y,r.width,r.height],controlsRect:[cr.x,cr.y,cr.width,cr.height],
        leftVisible:!left.hidden,rightVisible:!right.hidden,
        leftWidth:left.width,rightWidth:right.width,
        screenMode:document.body.dataset.screen};
    });
    check(layout.gameRunning && !layout.stageHidden,name+' immersive game stage activation');
    check(layout.objectFit==='contain' && layout.screenMode==='fit',
      name+' aspect preserving fit');
    check(layout.canvasWidth===484 && layout.canvasHeight===224,name+' engine frame size');
    console.log(name+' MENU_GEOMETRY '+JSON.stringify(layout));
    check(layout.leftVisible && layout.rightVisible &&
      layout.leftWidth===114 && layout.rightWidth===114,name+' extended file-select side bands');
    const controls=await page.locator('#mobile-controls [data-keys="down"]');
    await controls.tap({timeout:10000});
    const input=await page.evaluate(()=>({
      keys:window.__synthKeys,
      last:window.Z3.lastTouchInput,
      label:document.getElementById('touch-debug').textContent
    }));
    check(input.keys.includes('ArrowDown') && input.last?.name==='down' &&
      input.label.includes('DOWN'),name+' actual touch-to-canvas keyboard delivery');
    await page.locator('#hud-menu').tap();
    check(!(await page.locator('#hud-settings').evaluate(el=>el.hidden)),
      name+' settings open');
    await page.locator('#hud-close').tap();
    check(await page.locator('#hud-settings').evaluate(el=>el.hidden),
      name+' settings close');
    await page.screenshot({path:path.join(out,name+'-mobile.png')});
    check(pageErrors.length===0,name+' no JS page exceptions in screen simulation: '+pageErrors.join('; '));
    // Instantiate the actual WASM glue in a separate page to ensure the
    // module initializes without copyrighted asset data. Never call main.
    const loader=await context.newPage();
    try{
      await loader.goto(URL,{waitUntil:'load'});
      await loader.addScriptTag({url:'zelda3.js'});
      const boot=await loader.evaluate(async()=>{
        const canvas=document.getElementById('canvas');
        try{
          const m=await createZelda3({canvas,noInitialRun:true,
            print:()=>{},printErr:()=>{}});
          return {ok:!!m.FS && !!m.IDBFS && typeof m.callMain==='function',
            error:null};
        }catch(e){return {ok:false,error:String(e)};}
      });
      check(boot.ok,name+' actual Emscripten runtime initializes: '+boot.error);
    }finally{await loader.close();}
  }finally{await context.close();await browser.close();}
}
(async()=>{
  for(const [name,b] of [['chromium',chromium],['webkit',webkit]]){
    try{await testBrowser(name,b);}catch(e){
      errors.push(name+' TEST FAILED: '+String(e.stack||e));
    }
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors},null,2));
  console.log(results.join('\n'));
  if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
})().catch(e=>{console.error(e);process.exitCode=1;});
