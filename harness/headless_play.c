// Headless, muted gameplay driver for the snesrev/zelda3 reimplementation.
//
// Links every upstream translation unit EXCEPT src/main.c and supplies the eight
// symbols main.c would have provided.  No SDL window, no SDL audio device, no
// renderer: frames are rendered straight into a malloc'd buffer with
// ZeldaDrawPpuFrame so the test can measure what is actually on screen.
//
// Input comes from a text script so the play-through can be edited without a
// rebuild.  Each line is:  <frames> <buttons>
//   buttons: '-' for none, or a '+'-separated list of
//            up down left right a b x y l r start select
// Lines may also be directives:
//   @ppm <name>       dump the current frame as out/<name>.ppm
//   @expect <var> <op> <value>     assert on game state
//   @print <label>    log a state line
//   @mash <n> <p> <r> <buttons>    n times: hold for p frames, release for r
//   @sram             call ZeldaWriteSram()
// '#' starts a comment.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdint.h>
#include <unistd.h>

#include "src/zelda_rtl.h"
#include "src/variables.h"
#include "src/config.h"
#include "src/assets.h"
#include "src/util.h"
#include "snes/ppu.h"
#include "src/audio.h"
#include "src/zelda_cpu_infra.h"

// ---------------------------------------------------------------- main.c stubs

const uint8 *g_asset_ptrs[kNumberOfAssets];
uint32 g_asset_sizes[kNumberOfAssets];

void Die(const char *error) {
  fprintf(stderr, "FATAL: %s\n", error);
  exit(1);
}

void ChangeWindowScale(int scale_step) {}
void ZeldaApuLock(void) {}
void ZeldaApuUnlock(void) {}

MemBlk FindInAssetArray(int asset, int idx) {
  return FindIndexInMemblk((MemBlk) { g_asset_ptrs[asset], g_asset_sizes[asset] }, idx);
}

static void LoadAssets(void) {
  size_t length = 0;
  uint8 *data = ReadWholeFile("zelda3_assets.dat", &length);
  if (!data)
    Die("zelda3_assets.dat not found - run the extraction step first");

  static const char kAssetsSig[] = { kAssets_Sig };
  if (length < 16 + 32 + 32 + 8 + kNumberOfAssets * 4 ||
      memcmp(data, kAssetsSig, 48) != 0 ||
      *(uint32 *)(data + 80) != kNumberOfAssets)
    Die("zelda3_assets.dat signature/asset-count mismatch (rebuilt against a different revision?)");

  uint32 offset = 88 + kNumberOfAssets * 4 + *(uint32 *)(data + 84);
  for (size_t i = 0; i < kNumberOfAssets; i++) {
    uint32 size = *(uint32 *)(data + 88 + i * 4);
    offset = (offset + 3) & ~3;
    if ((uint64)offset + size > length)
      Die("zelda3_assets.dat truncated");
    g_asset_sizes[i] = size;
    g_asset_ptrs[i] = data + offset;
    offset += size;
  }
  printf("assets: %zu bytes, %d entries\n", length, (int)kNumberOfAssets);
}

// ----------------------------------------------------------------- frame store

static int g_render_flags;
static int g_snes_width, g_snes_height;
static uint8 *g_framebuf;
static int g_pitch;
static int g_fb_w, g_fb_h;
static const char *g_outdir = "out";

static void AllocFrameBuffer(void) {
  int scale = PpuGetCurrentRenderScale(g_zenv.ppu, g_render_flags);
  g_fb_w = g_snes_width * scale;
  g_fb_h = g_snes_height * scale;
  g_pitch = g_fb_w * 4;
  g_framebuf = calloc(1, (size_t)g_pitch * g_fb_h);
  if (!g_framebuf) Die("out of memory for framebuffer");
  printf("framebuffer: %dx%d (scale %d)\n", g_fb_w, g_fb_h, scale);
}

static void RenderFrame(void) {
  ZeldaDrawPpuFrame(g_framebuf, g_pitch, g_render_flags);
}

// Mean luma over the frame, plus the count of distinct 16-bit colour buckets.
// A compiling-but-blank renderer scores ~0 luma / 1 bucket, which is exactly the
// failure a "did it boot?" test cannot see.
static void FrameStats(double *luma_out, int *buckets_out) {
  double sum = 0;
  static uint8 seen[1 << 15];
  memset(seen, 0, sizeof(seen));
  int buckets = 0;
  for (int y = 0; y < g_fb_h; y++) {
    const uint8 *row = g_framebuf + (size_t)y * g_pitch;
    for (int x = 0; x < g_fb_w; x++) {
      int b = row[x * 4 + 0], g = row[x * 4 + 1], r = row[x * 4 + 2];
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
      int key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      if (!seen[key]) { seen[key] = 1; buckets++; }
    }
  }
  *luma_out = sum / ((double)g_fb_w * g_fb_h);
  *buckets_out = buckets;
}

static void DumpPpm(const char *name) {
  char path[1024];
  snprintf(path, sizeof(path), "%s/%s.ppm", g_outdir, name);
  FILE *f = fopen(path, "wb");
  if (!f) { fprintf(stderr, "cannot write %s\n", path); return; }
  fprintf(f, "P6\n%d %d\n255\n", g_fb_w, g_fb_h);
  for (int y = 0; y < g_fb_h; y++) {
    const uint8 *row = g_framebuf + (size_t)y * g_pitch;
    for (int x = 0; x < g_fb_w; x++) {
      uint8 rgb[3] = { row[x * 4 + 2], row[x * 4 + 1], row[x * 4 + 0] };
      fwrite(rgb, 1, 3, f);
    }
  }
  fclose(f);
  printf("ppm: %s (%dx%d)\n", path, g_fb_w, g_fb_h);
}

// --------------------------------------------------------------- state reading

typedef struct { const char *name; uint32 value; } StateVar;

static bool ReadStateVar(const char *name, uint32 *out) {
  if (!strcmp(name, "module"))        { *out = main_module_index; return true; }
  if (!strcmp(name, "submodule"))     { *out = submodule_index; return true; }
  if (!strcmp(name, "subsub"))        { *out = subsubmodule_index; return true; }
  if (!strcmp(name, "link_x"))        { *out = link_x_coord; return true; }
  if (!strcmp(name, "link_y"))        { *out = link_y_coord; return true; }
  if (!strcmp(name, "ow_area"))       { *out = overworld_area_index; return true; }
  if (!strcmp(name, "room"))          { *out = dungeon_room_index; return true; }
  if (!strcmp(name, "health"))        { *out = link_health_current; return true; }
  if (!strcmp(name, "health_cap"))    { *out = link_health_capacity; return true; }
  if (!strcmp(name, "frame"))         { *out = (uint32)frame_ctr_dbg; return true; }
  return false;
}

static void PrintState(const char *label) {
  double luma; int buckets;
  FrameStats(&luma, &buckets);
  printf("state %-22s frame=%-6d module=%02X sub=%02X subsub=%02X room=%04X ow=%04X "
         "link=(%u,%u) hp=%u/%u luma=%.2f colors=%d\n",
         label, frame_ctr_dbg, main_module_index, submodule_index, subsubmodule_index,
         dungeon_room_index, overworld_area_index, link_x_coord, link_y_coord,
         link_health_current, link_health_capacity, luma, buckets);
}

static int g_failures;

static void Expect(const char *var, const char *op, long want) {
  uint32 got;
  if (!ReadStateVar(var, &got)) {
    printf("FAIL expect: unknown state var '%s'\n", var);
    g_failures++;
    return;
  }
  bool ok;
  if (!strcmp(op, "==")) ok = ((long)got == want);
  else if (!strcmp(op, "!=")) ok = ((long)got != want);
  else if (!strcmp(op, ">")) ok = ((long)got > want);
  else if (!strcmp(op, "<")) ok = ((long)got < want);
  else if (!strcmp(op, ">=")) ok = ((long)got >= want);
  else if (!strcmp(op, "<=")) ok = ((long)got <= want);
  else { printf("FAIL expect: bad operator '%s'\n", op); g_failures++; return; }
  printf("%s expect %s %s %ld   (actual %u / 0x%X)\n",
         ok ? "PASS" : "FAIL", var, op, want, got, got);
  if (!ok) g_failures++;
}

static void ExpectFrame(double min_luma, int min_colors) {
  double luma; int buckets;
  FrameStats(&luma, &buckets);
  bool ok = luma >= min_luma && buckets >= min_colors;
  printf("%s frame luma=%.2f (>= %.2f) colors=%d (>= %d)\n",
         ok ? "PASS" : "FAIL", luma, min_luma, buckets, min_colors);
  if (!ok) g_failures++;
}

// -------------------------------------------------------------- input decoding

static int ParseButtons(char *s) {
  static const struct { const char *name; int bit; } kButtons[] = {
    { "b", 0 }, { "y", 1 }, { "select", 2 }, { "start", 3 },
    { "up", 4 }, { "down", 5 }, { "left", 6 }, { "right", 7 },
    { "a", 8 }, { "x", 9 }, { "l", 10 }, { "r", 11 },
  };
  int mask = 0;
  if (!strcmp(s, "-") || !strcmp(s, "none")) return 0;
  for (char *tok = strtok(s, "+"); tok; tok = strtok(NULL, "+")) {
    bool found = false;
    for (size_t i = 0; i < sizeof(kButtons) / sizeof(*kButtons); i++) {
      if (!strcmp(tok, kButtons[i].name)) { mask |= 1 << kButtons[i].bit; found = true; break; }
    }
    if (!found) { fprintf(stderr, "unknown button '%s'\n", tok); exit(1); }
  }
  return mask;
}

static bool g_verify_mode;
static long g_cosim_frames, g_cosim_skipped;

static void StepFrames(int n, int input) {
  for (int i = 0; i < n; i++) {
    if (g_verify_mode) {
      // Mirror the dispatch condition in ZeldaRunFrame so the harness can
      // report how many frames were genuinely co-simulated rather than
      // assuming the comparison ran.
      if (enhanced_features0 != 0 || g_zenv.dialogue_flags) g_cosim_skipped++;
      else g_cosim_frames++;
    }
    ZeldaRunFrame(input);
  }
  RenderFrame();
}

// ---------------------------------------------------------------------- driver

static void MakeAbsolute(char *dst, size_t n, const char *cwd, const char *path) {
  if (path[0] == '/') snprintf(dst, n, "%s", path);
  else snprintf(dst, n, "%s/%s", cwd, path);
}

int main(int argc, char **argv) {
  const char *upstream = NULL, *script = NULL, *ini = NULL, *verify_rom = NULL;
  bool load_sram = false;
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--upstream") && i + 1 < argc) upstream = argv[++i];
    else if (!strcmp(argv[i], "--script") && i + 1 < argc) script = argv[++i];
    else if (!strcmp(argv[i], "--out") && i + 1 < argc) g_outdir = argv[++i];
    else if (!strcmp(argv[i], "--ini") && i + 1 < argc) ini = argv[++i];
    else if (!strcmp(argv[i], "--verify") && i + 1 < argc) verify_rom = argv[++i];
    else if (!strcmp(argv[i], "--load-sram")) load_sram = true;
    else { fprintf(stderr, "usage: %s --upstream DIR --script FILE [--ini FILE] [--out DIR] [--verify ROM] [--load-sram]\n", argv[0]); return 2; }
  }
  if (!upstream || !script) { fprintf(stderr, "need --upstream and --script\n"); return 2; }
  char verify_abs[4096];

  // Resolve the script/out paths before chdir.
  char cwd[2048];
  if (!getcwd(cwd, sizeof cwd)) { perror("getcwd"); return 1; }
  char script_abs[4096], out_abs[4096], ini_abs[4096];
  MakeAbsolute(script_abs, sizeof script_abs, cwd, script);
  MakeAbsolute(out_abs, sizeof out_abs, cwd, g_outdir);
  g_outdir = out_abs;
  if (ini) MakeAbsolute(ini_abs, sizeof ini_abs, cwd, ini);
  if (verify_rom) { MakeAbsolute(verify_abs, sizeof verify_abs, cwd, verify_rom); verify_rom = verify_abs; }

  if (chdir(upstream) != 0) { perror("chdir upstream"); return 1; }

  ParseConfigFile(ini ? ini_abs : NULL);
  // Hard-muted regardless of what the ini said: no audio device is ever opened,
  // and the config flag keeps the SPC player off the clock too.
  g_config.enable_audio = false;
  g_config.enable_msu = 0;
  printf("config: audio=%d msu=%d new_renderer=%d mode7=%d aspect=%d extend_y=%d\n",
         g_config.enable_audio, g_config.enable_msu, g_config.new_renderer,
         g_config.enhanced_mode7, g_config.extended_aspect_ratio, g_config.extend_y);

  LoadAssets();
  ZeldaInitialize();

  // Co-simulation: with a ROM supplied, upstream runs the original 65816 code
  // in its SNES emulator alongside the C reimplementation and compares RAM,
  // SRAM and VRAM after every frame.  Divergences are printed to stderr; this
  // harness just has to not get in the way.
  if (verify_rom) {
    size_t rom_len = 0;
    uint8 *rom = ReadWholeFile(verify_rom, &rom_len);
    if (!rom) Die("--verify: cannot read the ROM");
    if (!EmuInitialize(rom, rom_len)) Die("--verify: EmuInitialize failed");
    free(rom);
    g_verify_mode = true;
    printf("verify: co-simulating against %s (%zu bytes)\n", verify_rom, rom_len);
  }
  g_zenv.ppu->extraLeftRight = UintMin(g_config.extended_aspect_ratio, kPpuExtraLeftRight);
  g_snes_width = g_config.extended_aspect_ratio * 2 + 256;
  g_snes_height = g_config.extend_y ? 240 : 224;
  g_wanted_zelda_features = g_config.features0;
  g_render_flags = g_config.new_renderer * kPpuRenderFlags_NewRenderer |
                   g_config.enhanced_mode7 * kPpuRenderFlags_4x4Mode7 |
                   g_config.extend_y * kPpuRenderFlags_Height240 |
                   g_config.no_sprite_limits * kPpuRenderFlags_NoSpriteLimits;
  ZeldaEnableMsu(false);
  ZeldaSetLanguage(g_config.language);
  // Off by default so a play-through always starts from a blank cartridge and
  // stays reproducible; --load-sram reproduces what upstream's main() does.
  if (load_sram) {
    ZeldaReadSram();
    printf("sram: loaded saves/sram.dat\n");
  }
  AllocFrameBuffer();

  FILE *f = fopen(script_abs, "r");
  if (!f) { perror(script_abs); return 1; }
  char line[1024];
  int lineno = 0;
  while (fgets(line, sizeof line, f)) {
    lineno++;
    char *hash = strchr(line, '#');
    if (hash) *hash = 0;
    char *p = line;
    while (*p == ' ' || *p == '\t') p++;
    char *end = p + strlen(p);
    while (end > p && (end[-1] == '\n' || end[-1] == '\r' || end[-1] == ' ' || end[-1] == '\t')) *--end = 0;
    if (!*p) continue;

    if (p[0] == '@') {
      char cmd[64] = {0}, a[128] = {0}, b[16] = {0};
      long v = 0;
      if (sscanf(p, "%63s", cmd) != 1) continue;
      if (!strcmp(cmd, "@ppm")) {
        if (sscanf(p, "%63s %127s", cmd, a) == 2) DumpPpm(a);
      } else if (!strcmp(cmd, "@print")) {
        if (sscanf(p, "%63s %127s", cmd, a) == 2) PrintState(a); else PrintState("-");
      } else if (!strcmp(cmd, "@expect")) {
        if (sscanf(p, "%63s %127s %15s %li", cmd, a, b, &v) == 4) Expect(a, b, v);
        else { printf("FAIL bad @expect on line %d\n", lineno); g_failures++; }
      } else if (!strcmp(cmd, "@expectframe")) {
        double ml = 1.0; int mc = 8;
        sscanf(p, "%63s %lf %d", cmd, &ml, &mc);
        ExpectFrame(ml, mc);
      } else if (!strcmp(cmd, "@mash")) {
        int iter = 0, press = 0, rel = 0; char btn[128] = {0};
        if (sscanf(p, "%63s %d %d %d %127s", cmd, &iter, &press, &rel, btn) != 5) {
          printf("FAIL bad @mash on line %d\n", lineno); g_failures++;
        } else {
          int mask = ParseButtons(btn);
          for (int i = 0; i < iter; i++) { StepFrames(press, mask); StepFrames(rel, 0); }
        }
      } else if (!strcmp(cmd, "@poke")) {
        unsigned addr = 0, val = 0;
        if (sscanf(p, "%63s %x %x", cmd, &addr, &val) == 3) {
          g_ram[addr] = (uint8)val;
          printf("poke: g_ram[0x%X] = 0x%02X\n", addr, val);
        }
      } else if (!strcmp(cmd, "@sram")) {
        ZeldaWriteSram();
        printf("sram: wrote saves/sram.dat\n");
      } else if (!strcmp(cmd, "@echo")) {
        printf("--- %s\n", p + 6);
      } else {
        fprintf(stderr, "unknown directive on line %d: %s\n", lineno, p);
        return 2;
      }
      continue;
    }

    int frames = 0;
    char buttons[256] = {0};
    if (sscanf(p, "%d %255s", &frames, buttons) != 2) {
      fprintf(stderr, "bad script line %d: %s\n", lineno, p);
      return 2;
    }
    StepFrames(frames, ParseButtons(buttons));
  }
  fclose(f);

  if (g_verify_mode)
    printf("verify: %ld frames compared against the original machine code, "
           "%ld skipped (features/dialogue active)\n", g_cosim_frames, g_cosim_skipped);
  printf("\n=== %d failure(s), %d frames run ===\n", g_failures, frame_ctr_dbg);
  return g_failures ? 1 : 0;
}
