/* Non-destructive file-select widescreen extension.
 * The SNES file-select screen is fixed to 256 pixels. The real game canvas
 * stays unchanged; only its unused side columns receive repeated edge tiles.
 * It is intentionally disabled during gameplay (main_module_index != 1).
 */
(() => {
  'use strict';
  const stage = document.getElementById('stage');
  const src = document.getElementById('canvas');
  const left = document.getElementById('menu-edge-left');
  const right = document.getElementById('menu-edge-right');
  if (!stage || !src || !left || !right) return;
  let nextFrame = 0;
  const hide = () => {left.hidden = right.hidden = true;};
  function paintBand(dest, origin, width) {
    const ctx = dest.getContext('2d', {alpha:false});
    if (!ctx) return false;
    dest.width = width;
    dest.height = src.height;
    ctx.imageSmoothingEnabled = false;
    // Repeated side tiles maintain the original pixels and text proportions.
    for (let x=0; x<width; x+=24) {
      const w = Math.min(24,width-x);
      try { ctx.drawImage(src,origin,0,w,src.height,x,0,w,src.height); }
      catch (_) {return false;}
    }
    return true;
  }
  function tick(t) {
    requestAnimationFrame(tick);
    if (t < nextFrame) return;
    nextFrame = t+130;
    const engine = window.Z3?.module;
    if (stage.hidden || !engine?.ccall || src.width <= 256) {hide();return;}
    let mode;
    try {mode=engine.ccall('z3_module','number',[],[]);} catch(_){hide();return;}
    if (mode !== 1) {hide();return;} // Module01_FileSelect
    const pad = Math.floor((src.width-256)/2);
    if (pad <= 0) {hide();return;}
    const sw = stage.clientWidth, sh=stage.clientHeight;
    const ratio = Math.min(sw/src.width,sh/src.height);
    const x0 = (sw-src.width*ratio)/2;
    const y0 = (sh-src.height*ratio)/2;
    // Preserve original 256px image. Only cover the PPU's black side columns.
    const anchors = [
      {node:left,x:x0,origin:pad+3},
      {node:right,x:x0+(src.width-pad)*ratio,origin:pad+256-27}
    ];
    for (const {node,x,origin} of anchors) {
      node.style.left=x+'px';
      node.style.top=y0+'px';
      node.style.width=(pad*ratio)+'px';
      node.style.height=(src.height*ratio)+'px';
      node.hidden=!paintBand(node,origin,pad);
    }
  }
  requestAnimationFrame(tick);
})();
