/** Existing preparation -> portable exports and checked previews; never production installation. */
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { deliverSong, verifyDelivery } from "../src/lib/song-delivery.js";
const usage = `Usage: node --import tsx apps/web/scripts/deliver-song.mts RUN NEW_DELIVERY_DIR [options]
       node --import tsx apps/web/scripts/deliver-song.mts verify DELIVERY_DIR

  --soundfont FILE    Local SoundFont (or KEYSPILLI_SOUNDFONT).
  --executable FILE   FluidSynth executable (or KEYSPILLI_FLUIDSYNTH).
  --level LEVEL       Original preview: a, m, e, ve, b, vb (default a).
  --help, -h         Show help.

Retains all six Original exports and one shared Chords backing. Both previews must pass
structural checks for complete-provisional. Failed/warning evidence is retained; no
musical approval or publication. verify is read-only and works after relocation.`;
try {
  const { values, positionals, tokens } = parseArgs({ allowPositionals: true, tokens: true, options: {
    soundfont: {type: "string"}, executable: {type: "string"}, level: {type: "string"}, help: {type: "boolean", short: "h"},
  } });
  for (const name of ["soundfont", "executable", "level"]) {
    assert(tokens.filter(t => t.kind === "option" && t.name === name).length <= 1, `--${name} may appear only once`);
    assert(values[name as keyof typeof values] === undefined || String(values[name as keyof typeof values]).trim(), `--${name} must not be empty`);
  }
  if (values.help) console.log(usage);
  else {
    assert(positionals.length === 2 && positionals.every(s => s.trim()), usage);
    if (positionals[0] === "verify") assert(!values.soundfont && !values.executable && !values.level, "verify does not take renderer options");
    const result = positionals[0] === "verify" ? verifyDelivery(positionals[1]!) : await deliverSong(positionals[0]!, positionals[1]!, values);
    console.log(JSON.stringify({status: result.status, musicalAcceptance: result.musicalAcceptance, modes: result.modes}, null, 2));
    if (result.status !== "complete-provisional") process.exitCode = 1;
  }
} catch (error) { console.error(`deliver-song: ${(error as Error).message}`); process.exitCode = 1; }
