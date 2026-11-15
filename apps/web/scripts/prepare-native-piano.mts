import { chmodSync, lstatSync, realpathSync, writeSync } from "node:fs";
import { join } from "node:path";
// Preparation metadata remains one JSON object on stdout; bounded phase records use stderr.
const phase = (name: string, state: "entry" | "exit" | "failure") => writeSync(2,
  JSON.stringify({ kind: "keyspilli-native-phase", phase: name, state }) + "\n");
phase("prepare-import", "entry");
const { prepareNativePianoBank } = await import("../src/lib/native-player-assets").catch(error => {
  phase("prepare-import", "failure"); throw error;
});
phase("prepare-import", "exit");

phase("prepare-input", "entry");
try {
if (!process.env.KEYSPILLI_SCRATCH) throw new Error("owned KEYSPILLI_SCRATCH is required");
const root = realpathSync(process.env.KEYSPILLI_SCRATCH);
const bank = join(root, "native-piano");
const prepared = await prepareNativePianoBank(bank);
// Only after full pin/hash validation: let the readonly container UID search the bank. Files stay 0444.
chmodSync(bank, 0o555);
const dir = lstatSync(bank), parent = lstatSync(root);
if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o777) !== 0o555) throw new Error("piano input directory handoff failed");
console.log(JSON.stringify({ ...prepared, inputDirectory: { mode: (dir.mode & 0o777).toString(8), uid: dir.uid, gid: dir.gid, parentMode: (parent.mode & 0o777).toString(8) } }));
phase("prepare-input", "exit");
} catch (error) { phase("prepare-input", "failure"); throw error; }
