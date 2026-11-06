/* Preserve the displayed game's pixels for the menu-edge compositor.
 * WebGL's default drawing buffer is ephemeral after frame presentation.
 * Only the game canvas is affected, and only when asking for WebGL.
 */
(() => {
  'use strict';
  if (typeof HTMLCanvasElement === 'undefined') return;
  const original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(type,options) {
    if (this.id==='canvas' && /^webgl2?$|^experimental-webgl$/.test(String(type))) {
      options={...(options||{}),preserveDrawingBuffer:true};
    }
    return original.call(this,type,options);
  };
})();
