import { resolve } from 'node:path';
import { readLocalEvidenceJson } from '../src/lib/local-audio-evidence.js';
import { prepareCompactReviewJobs,type CompactReviewConfiguration } from '../src/lib/music-review-jobs.js';
import type { MusicReviewReport } from '../src/lib/music-review.js';
const args=process.argv.slice(2),arg=(n:string)=>args.includes(n)?args[args.indexOf(n)+1]:undefined;const report=arg('--report'),output=arg('--output'),config=arg('--configuration');if(!report || !output)throw Error('--report REPORT.json --output NEW_DIR [--configuration PINNED.json]');const jobs=await prepareCompactReviewJobs(await readLocalEvidenceJson(resolve(report)) as MusicReviewReport,resolve(output),config?await readLocalEvidenceJson(resolve(config)) as CompactReviewConfiguration:null);console.log(JSON.stringify({jobs:jobs.length,status:'prepared',providerCalls:0}));
