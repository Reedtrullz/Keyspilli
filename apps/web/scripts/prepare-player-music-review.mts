import { resolve } from 'node:path';
import { readLocalEvidenceJson } from '../src/lib/local-audio-evidence.js';
import { parsePairedPlayerCapture } from '@keyspilli/catalog/src/player-input-evidence.js';
import { preparePlayerMusicReview } from '../src/lib/player-music-review.js';
const args=process.argv.slice(2),arg=(n:string)=>args.includes(n)?args[args.indexOf(n)+1]:undefined;
const manifest=arg('--capture'),output=arg('--output');if(!manifest || !output)throw Error('--capture PAIRED.json --output NEW_DIR [--execute --python ABS_PATH --reference-manifest ABS_PATH --dictionary ABS_PATH]');
const result=await preparePlayerMusicReview(parsePairedPlayerCapture(await readLocalEvidenceJson(resolve(manifest))),{execute:args.includes('--execute'),python:arg('--python')??'/unavailable/python',referenceManifestPath:arg('--reference-manifest')??'/unavailable/reference',dictionaryDir:arg('--dictionary')??'/unavailable/dictionary'},resolve(output));console.log(JSON.stringify({status:result.status,providerCalls:0,output:resolve(output)}));
