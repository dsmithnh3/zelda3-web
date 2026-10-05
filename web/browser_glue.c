// Read-only taps into live game state so a browser test can assert on what the
// engine is actually doing, not just on "did it boot".  Nothing here changes
// game behaviour.
#include <emscripten.h>
#include <string.h>
#include "src/zelda_rtl.h"
#include "src/variables.h"

EMSCRIPTEN_KEEPALIVE int z3_frame(void)       { return frame_ctr_dbg; }
EMSCRIPTEN_KEEPALIVE int z3_module(void)      { return main_module_index; }
EMSCRIPTEN_KEEPALIVE int z3_submodule(void)   { return submodule_index; }
EMSCRIPTEN_KEEPALIVE int z3_link_x(void)      { return link_x_coord; }
EMSCRIPTEN_KEEPALIVE int z3_link_y(void)      { return link_y_coord; }
EMSCRIPTEN_KEEPALIVE int z3_ow_area(void)     { return overworld_area_index; }
EMSCRIPTEN_KEEPALIVE int z3_room(void)        { return dungeon_room_index; }
EMSCRIPTEN_KEEPALIVE int z3_health(void)      { return link_health_current; }
EMSCRIPTEN_KEEPALIVE int z3_health_cap(void)  { return link_health_capacity; }

// FNV-1a over the 8 KiB SRAM image.  Used to show a reloaded page came back
// with the same save data rather than a fresh one.
EMSCRIPTEN_KEEPALIVE unsigned z3_sram_hash(void) {
  unsigned h = 2166136261u;
  const unsigned char *p = (const unsigned char *)g_zenv.sram;
  if (!p) return 0;
  for (int i = 0; i < 8192; i++) { h ^= p[i]; h *= 16777619u; }
  return h;
}

// Non-zero once a save file exists in slot 1 (the 0x55AA marker the file
// select looks for).
EMSCRIPTEN_KEEPALIVE int z3_slot_used(int slot) {
  const unsigned char *p = (const unsigned char *)g_zenv.sram;
  if (!p || slot < 0 || slot > 2) return 0;
  const unsigned char *q = p + slot * 0x500 + 0x3E5;
  return (q[0] | (q[1] << 8)) == 0x55AA;
}
