/* Opt-in, ROM-free diagnostics. Enable with ?diagnostics=1.
 * Reports metadata and game counters; NEVER reads or exports ROM/game assets.
 */
(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('diagnostics') !== '1') return;
  const panel = document.createElement('section');
  panel.id = 'z3-diagnostics';
  panel.setAttribute('aria-label','Zelda3 runtime diagnostics');
  panel.innerHTML = '<div class="diag-head"><strong>Engine diagnostics</strong><button id="diag-hide" type="button" aria-label="Hide diagnostics">×</button></div><pre id="diag-output">Initializing…</pre><button id="diag-copy" type="button">Copy diagnostic report</button>';
  document.body.appendChild(panel);
  const output = document.getElementById('diag-output');
  let previousFrame = null;
  let previousTime = null;
  let latest = {};
  function getCounter(mod, name) {
    if (!mod || typeof mod.ccall !== 'function') return null;
    try {return mod.ccall(name,'number',[],[]);} catch (_) {return null;}
  }
  function getSaveSize(mod) {
    try {return mod.FS.stat('/saves/sram.dat').size;} catch (_) {return null;}
  }
  function update() {
    const z=window.Z3||{};
    const mod=z.module;
    const canvas=document.getElementById('canvas');
    const now=performance.now();
    const frame=getCounter(mod,'z3_frame');
    const fps=previousFrame!==null && frame!==null && now>previousTime
      ? (frame-previousFrame)*1000/(now-previousTime) : null;
    if (frame!==null) {previousFrame=frame;previousTime=now;}
    latest={
      timestamp:new Date().toISOString(),
      phase:z.phase||'unknown',
      engineAspect:z.requestedVideo?.aspect||'not started',
      framebuffer:canvas ? canvas.width+'x'+canvas.height : 'unavailable',
      expectedFramebuffer:z.requestedVideo ? z.requestedVideo.width+'x'+z.requestedVideo.height : 'unavailable',
      dimensionsMatch:z.widescreenDimensionsMatch??null,
      engineWideBuild:z.iphoneWide??null,
      frames:frame,
      fps:fps===null?null:Math.round(fps*10)/10,
      mainModule:getCounter(mod,'z3_module'),
      subModule:getCounter(mod,'z3_submodule'),
      lastTouch:z.lastTouchInput?.name||null,
      saveFileBytes:getSaveSize(mod),
      lastBrowserSaveSync:z.lastSaveAt ? new Date(z.lastSaveAt).toISOString():null,
      audioRequested:new URLSearchParams(location.search).get('audio')==='1',
      audioPlaybackVerified:false,
      lastError:z.error ? String(z.error).slice(0,300):null
    };
    if(!output) return;
    output.textContent=[
      'Engine: '+latest.engineAspect+'  Canvas: '+latest.framebuffer,
      'Canvas matches: '+latest.dimensionsMatch+'  WebAssembly wide: '+latest.engineWideBuild,
      'Frame: '+(frame??'-')+'  FPS: '+(latest.fps??'-'),
      'Module: '+(latest.mainModule??'-')+' / '+(latest.subModule??'-'),
      'Last touch: '+(latest.lastTouch??'-')+'  Save bytes: '+(latest.saveFileBytes??'-'),
      'Audio requested: '+latest.audioRequested+' (playback unverified)',
      latest.lastError ? 'ERROR: '+latest.lastError:''
    ].filter(Boolean).join('\n');
    window.Z3Diagnostics = latest;
  }
  document.getElementById('diag-hide')?.addEventListener('click',()=>{panel.hidden=true;});
  document.getElementById('diag-copy')?.addEventListener('click',async()=>{
    try {
      await navigator.clipboard.writeText(JSON.stringify(latest,null,2));
      document.getElementById('diag-copy').textContent='Copied';
    }catch(_){
      document.getElementById('diag-copy').textContent='Copy unavailable: take screenshot';
    }
  });
  update();
  setInterval(update,1000);
})();
