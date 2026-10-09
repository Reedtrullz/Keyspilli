import { expect,it } from 'vitest';
import { comparePlayerHistory } from './player-music-review.js';
import { identityHash } from '@keyspilli/catalog/src/acoustic-receipt.js';
import { receipt,replay } from './player-review-fixtures.js';
it('unsupported quiet pitch yields uncertain inspection without missing-note assertion',()=>{const result=comparePlayerHistory(receipt(),replay());expect(result.supportedPitches).toEqual([60]);expect(result.unsupportedExpectedPitches).toEqual([48]);expect(result.disposition).toBe('uncertain');expect(result.limitations.join(' ')).toMatch(/absence.*unknown/);});
it('expected pitches never change the immutable history receipt',()=>{const r=receipt(),before=JSON.stringify(r),s=replay();s.events=[];s.sourceSha256='bad';expect(()=>comparePlayerHistory(r,s)).toThrow(/replay/);expect(JSON.stringify(r)).toBe(before);});
it('later held windows remain uncovered',()=>{const s=replay();s.events=s.events.map(e=>({...e,onsetSeconds:2}));s.sourceSha256=identityHash(s.events);expect(comparePlayerHistory(receipt(),s).supportedPitches).toEqual([]);});

it('clip/source clock mismatch refuses',()=>{const s=replay();s.playerCapture!.captureSha256='f'.repeat(64);expect(()=>comparePlayerHistory(receipt(),s)).toThrow(/clock binding/);});
