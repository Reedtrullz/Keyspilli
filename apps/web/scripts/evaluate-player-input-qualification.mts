/** Assemble already completed audio-only results; open answers only after receipts are validated. */
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { parsePlayerInputEvidence,type PlayerInputEvidenceReceiptV1 } from '@keyspilli/catalog/src/player-input-evidence.js';
import { readLocalEvidenceJson } from '../src/lib/local-audio-evidence.js';
import { scorePlayerQualification,type QualificationAnswer } from '../src/lib/music-qualification-score.js';
const args=process.argv.slice(2),arg=(n:string)=>args.includes(n)?args[args.indexOf(n)+1]:undefined;const results=arg('--receipts'),answers=arg('--answers'),output=arg('--output');if(!results||!answers||!output)throw Error('--receipts COMPLETED.json --answers FROZEN.json --output NEW_DIR');
const raw=await readLocalEvidenceJson(resolve(results));if(!Array.isArray(raw))throw Error('receipt inventory required');const receipts:Array<{id:string;receipt:PlayerInputEvidenceReceiptV1}>=raw.map(row=>({id:row.id,receipt:parsePlayerInputEvidence(row.receipt)}));
const key=await readLocalEvidenceJson(resolve(answers)) as QualificationAnswer[];const result=scorePlayerQualification(receipts,key);const dest=resolve(output);await mkdir(dest,{recursive:false});await writeFile(join(dest,'score.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({status:result.status,providerCalls:0,productionAdmission:false}));
