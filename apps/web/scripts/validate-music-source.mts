import { resolve } from 'node:path';
import { readLocalEvidenceJson } from '../src/lib/local-audio-evidence.js';
import { validateSourceValidationReceipt } from '../src/lib/music-source-validation.js';
import type { SourceAnchors } from '../src/lib/music-correspondence.js';

const args = process.argv.slice(2);
const arg = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const receiptPath = arg('--receipt');
const sourcePath = arg('--source');
if (!receiptPath || !sourcePath) throw Error('--receipt RECEIPT.json --source SOURCE.json required');
const receipt = await readLocalEvidenceJson(resolve(receiptPath));
const source = await readLocalEvidenceJson(resolve(sourcePath)) as SourceAnchors;
const validated = validateSourceValidationReceipt(receipt, source);
console.log(JSON.stringify({status:'validated',sourceSha256:validated.sourceSha256,phraseId:selectedPhraseId(validated),timingKnown:validated.timingKnown,assertionWritten:false},null,2));

function selectedPhraseId(value: {selected:{phraseId:string}}): string { return value.selected.phraseId; }
