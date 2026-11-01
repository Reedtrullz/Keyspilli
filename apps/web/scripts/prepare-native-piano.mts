import { chmodSync, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { prepareNativePianoBank } from "../src/lib/native-player-assets";

if (!process.env.KEYSPILLI_SCRATCH) throw new Error("owned KEYSPILLI_SCRATCH is required");
const root = realpathSync(process.env.KEYSPILLI_SCRATCH);
const bank = join(root, "native-piano");
const prepared = await prepareNativePianoBank(bank);
// Only after full pin/hash validation: let the readonly container UID search the bank. Files stay 0444.
chmodSync(bank, 0o555);
const dir = lstatSync(bank), parent = lstatSync(root);
if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o777) !== 0o555) throw new Error("piano input directory handoff failed");
console.log(JSON.stringify({ ...prepared, inputDirectory: { mode: (dir.mode & 0o777).toString(8), uid: dir.uid, gid: dir.gid, parentMode: (parent.mode & 0o777).toString(8) } }));
