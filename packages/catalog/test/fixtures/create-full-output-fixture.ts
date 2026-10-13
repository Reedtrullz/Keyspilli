/** Deterministic, self-authored fixture generator. Makes no Player or provider request. */
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createFullOutputFixture } from "../helpers/full-output-fixture.js";

const output = process.argv[2];
if (!output || !isAbsolute(output) || process.argv.length !== 3) throw new Error("One new absolute output directory required");
await mkdir(output, { recursive: false, mode: 0o700 });
const { registry, request } = await createFullOutputFixture(output);
for (const [name, value] of Object.entries({ "registry.json": registry, "review-request.json": request })) {
  await writeFile(join(output, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
await writeFile(join(output, "README.txt"), "Self-authored distributable software fixture. One four-beat composition with separate Original and Chords MIDI, MusicXML and simulated capture evidence. The WAV is a generated sine wave; it is not a sampled Player capture. No human source, listening or keyboard review has occurred. Musical acceptance is not established. This fixture must never be relabeled as real music or used to pin accepted catalog playback.\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ output, assets: registry.assets.length, classification: "synthetic", actualPlayerCapture: false, providerCalls: 0, musicalAcceptance: "not-established" }));
