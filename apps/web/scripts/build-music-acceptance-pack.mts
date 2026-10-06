import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readLocalEvidenceJson } from '../src/lib/local-audio-evidence.js';
import { buildMusicAcceptancePack, type AcceptanceFormsInput } from '../src/lib/music-acceptance-pack.js';

const args = process.argv.slice(2);
const arg = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const inputPath = arg('--input');
const outputPath = arg('--output');
if (!inputPath || !outputPath) throw Error('--input ACCEPTANCE_FORMS.json --output NEW_DIR required');
const input = await readLocalEvidenceJson(resolve(inputPath)) as AcceptanceFormsInput;
const pack = buildMusicAcceptancePack(input);
const output = resolve(outputPath);
await mkdir(output, { recursive: false });
await writeFile(`${output}/acceptance-pack.json`, JSON.stringify(pack, null, 2) + '\n', { flag: 'wx' });
await writeFile(`${output}/observations.json`, JSON.stringify(pack.observations, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, pieces: pack.pieces.length, observations: pack.observations.length, autoplay: pack.autoplay, musicalAcceptance: pack.musicalAcceptance, providerCalls: pack.providerCalls }));
