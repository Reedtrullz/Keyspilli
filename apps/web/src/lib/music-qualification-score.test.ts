import { it,expect } from 'vitest';
import { makePlayerInputQualification } from './player-input-qualification.js';
import { scorePlayerQualification } from './music-qualification-score.js';
import { receipt } from './player-review-fixtures.js';
it('unrun cases cannot pass and wrong accepted sets fail',()=>{const answers=makePlayerInputQualification(610672).answers;expect(scorePlayerQualification([],answers).status).toBe('incomplete');const r=scorePlayerQualification([{id:answers[0]!.id,receipt:receipt()}],answers);expect(r.rows[0]!.acceptedWrong).toBe(true);expect(r.productionAdmission).toBe(false);});
it('rejects duplicate and foreign receipts before scoring',()=>{const answers=makePlayerInputQualification(610672).answers;expect(()=>scorePlayerQualification([{id:'foreign',receipt:receipt()}],answers)).toThrow();});
