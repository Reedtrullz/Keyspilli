import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePlayerMusicReview } from './player-music-review.js';
import { paired, receipt } from './player-review-fixtures.js';
import { buildMusicReview } from './music-review.js';
it('prepare_only_spawns_nothing and preserves explicit unavailable channel',async()=>{const dir=mkdtempSync(join(tmpdir(),'keyspilli-prepare-test-'));try{const result=await preparePlayerMusicReview(paired(),{execute:false,python:'/never-execute',referenceManifestPath:'/not-present',dictionaryDir:'/not-present'},join(dir,'pack'));expect(result.status).toBe('unavailable');expect(result.historyPitchCandidates).toBeNull();expect(JSON.parse(readFileSync(join(dir,'pack/request.json'),'utf8')).providerCalls).toBe(0);await expect(preparePlayerMusicReview(paired(),{execute:false,python:'/never',referenceManifestPath:'/absent',dictionaryDir:'/absent'},join(dir,'pack'))).rejects.toThrow();}finally{rmSync(dir,{recursive:true,force:true});}});
it('input_pitch_channel_keeps_output_audibility_unknown and binds paired output',()=>{const c=paired();const input={clips:[{id:c.id,audio:{...c.output,durationSeconds:1.2,derivativeSha256:null},eventsSha256:null,analyzerSha256:null,playerInput:receipt(),pairedCapture:c,pairedCaptureSha256:receipt().captureSha256}]};expect(buildMusicReview(input).clips[0]!.channels.playerInput).toBe('matched');input.clips[0]!.audio.sha256='f'.repeat(64);expect(()=>buildMusicReview(input)).toThrow(/paired output/);});
