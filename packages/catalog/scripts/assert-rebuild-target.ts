/**
 * Fail closed when a targeted production rebuild names a base that is not
 * present in the catalog and has no curated seed waiting to be restored.
 *
 * The remote workflow otherwise treats an all-skipped targeted run as a
 * successful rebuild because each stage exits zero and verify-catalog quite
 * correctly verifies an empty selection.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getSongsByBase } from "../src/db.js";
import { seedMidiDir } from "../src/paths.js";

const baseId = process.argv[2];
if (!baseId || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(baseId)) {
  console.error("usage: assert-rebuild-target.ts <baseId>");
  process.exit(2);
}

const hasRows = getSongsByBase(baseId).length > 0;
const hasCuratedSeed = existsSync(join(seedMidiDir(), `${baseId}.mid`));
if (!hasRows && !hasCuratedSeed) {
  console.error(`rebuild target not found in songs or seed-midi: ${baseId}`);
  process.exit(1);
}

console.log(`rebuild target present: ${baseId}${hasCuratedSeed ? " (curated seed available)" : ""}`);
