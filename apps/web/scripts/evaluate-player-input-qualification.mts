/** Assemble already completed audio-only results; open answers only after receipts are validated. */
import { mkdir,writeFile,readFile,lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve,join } from 'node:path';
import { parsePlayerInputEvidence,type PlayerInputEvidenceReceiptV1 } from '@keyspilli/catalog/src/player-input-evidence.js';
import { readLocalEvidenceJson } from '../src/lib/local-audio-evidence.js';
import { scorePlayerQualification,validateQualificationResultBindings,validateQualificationResources,PLAYER_QUALIFICATION_FILES,type QualificationAnswer,type QualificationResources } from '../src/lib/music-qualification-score.js';
const args=process.argv.slice(2),arg=(n:string)=>args.includes(n)?args[args.indexOf(n)+1]:undefined;const results=arg('--receipts'),answers=arg('--answers'),output=arg('--output'),resourcesPath=arg('--resources');if(!results||!answers||!output||!resourcesPath)throw Error('--receipts COMPLETED.json --resources RESOURCES.json --answers FROZEN.json --output NEW_DIR');
const raw=await readLocalEvidenceJson(resolve(results));if(!Array.isArray(raw))throw Error('receipt inventory required');const receipts:Array<{id:string;receipt:PlayerInputEvidenceReceiptV1}>=raw.map(row=>({id:row.id,receipt:parsePlayerInputEvidence(row.receipt)}));
async function boundedFile(path:string){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error('bounded qualification metadata required');const data=await readFile(path);if(data.length>1024*1024)throw Error('qualification metadata exceeds bound');return data;}
const frozen=arg('--freeze'),captures=arg('--captures');if(!frozen||!captures)throw Error('--freeze PINNED.json --captures ANALYZED_MANIFEST_DIR required before answers');
const freeze=await readLocalEvidenceJson(resolve(frozen)) as {schemaVersion:number;kind:string;fingerprints:Record<string,string>;analyzerSha256:string;referenceBankSha256:string;referenceManifestPath:string;dictionaryDir:string;dictionaryIdentitySha256:string};if(freeze.schemaVersion!==3||freeze.kind!=='controlled-player-input-qualification')throw Error('complete version3 qualification freeze required');
if(JSON.stringify(Object.keys(freeze.fingerprints??{}).sort())!==JSON.stringify([...PLAYER_QUALIFICATION_FILES].sort()))throw Error('qualification source inventory changed');
const current=Object.fromEntries(await Promise.all(PLAYER_QUALIFICATION_FILES.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
for(const path of PLAYER_QUALIFICATION_FILES)if(current[path]!==freeze.fingerprints[path])throw Error('qualification source changed');
if(createHash('sha256').update(await boundedFile(freeze.referenceManifestPath)).digest('hex')!==freeze.referenceBankSha256||createHash('sha256').update(await boundedFile(join(freeze.dictionaryDir,'identity.json'))).digest('hex')!==freeze.dictionaryIdentitySha256)throw Error('qualification bank/dictionary changed');
const pins=Object.fromEntries(await Promise.all(receipts.map(async row=>{if(!/^[a-z0-9-]+$/.test(row.id))throw Error('invalid qualification case ID');const path=join(resolve(captures),row.id+'-paired.json'),bytes=await boundedFile(path),capture=JSON.parse(bytes.toString());return [row.id,{captureSha256:createHash('sha256').update(bytes).digest('hex'),inputSha256:capture.input.sha256}];})));
validateQualificationResultBindings(freeze,current,receipts,pins);
const resources=await readLocalEvidenceJson(resolve(resourcesPath)) as QualificationResources;validateQualificationResources(resources);
const key=await readLocalEvidenceJson(resolve(answers)) as QualificationAnswer[];const result=scorePlayerQualification(receipts,key,resources);const dest=resolve(output);await mkdir(dest,{recursive:false});await writeFile(join(dest,'score.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({status:result.status,providerCalls:0,productionAdmission:false}));
