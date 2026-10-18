import { realpathSync } from "node:fs";
import { join } from "node:path";
import { prepareNativePianoBank } from "../src/lib/native-player-assets";

if (!process.env.KEYSPILLI_SCRATCH) throw new Error("owned KEYSPILLI_SCRATCH is required");
const root = realpathSync(process.env.KEYSPILLI_SCRATCH);
console.log(JSON.stringify(await prepareNativePianoBank(join(root, "native-piano"))));
