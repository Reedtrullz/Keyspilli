import { it, expect } from 'vitest';
import { identityHash } from '@keyspilli/catalog/src/acoustic-receipt.js';
import { validateSourceValidationReceipt, sourceValidationSemanticHash, type SourceValidationReceiptV1, type SourceValidationReceiptV2 } from './music-source-validation.js';
import type { SourceAnchors } from './music-correspondence.js';

const source = (): SourceAnchors => ({
  sha256: 'a'.repeat(64),
  authority: 'human-validated',
  timingKnown: true,
  validationReceiptSha256: 'b'.repeat(64),
  anchors: [{ id: 'anchor', phraseId: 'phrase', occurrenceId: 'occurrence', role: 'melody', midi: 60, onsetSeconds: 0.2, durationSeconds: 0.3, required: true }],
});
const receipt = (): SourceValidationReceiptV1 => ({
  schemaVersion: 1,
  kind: 'keyspilli-source-validation',
  sourceSha256: 'a'.repeat(64),
  selected: { phraseId: 'phrase', occurrenceId: 'occurrence', role: 'melody', onsetSeconds: 0.2 },
  reviewer: { id: 'reviewer', role: 'source-reviewer', assertion: 'validated' },
  scope: { mode: 'original', difficulty: 'beginner' },
  timingKnown: true,
});

it('keeps V1 historical receipt structure readable without upgrading its schema', () => {
  expect(validateSourceValidationReceipt(receipt(), source())).toEqual(receipt());
});

it('binds V2 labels, reviewed intervals and clock independently of array/object ordering', () => {
  const s: SourceAnchors = { ...source(), timebase: 'source-native-seconds' };
  s.anchors.push({ ...s.anchors[0]!, id: 'second', onsetSeconds: 1 });
  const r: SourceValidationReceiptV2 = { ...receipt(), schemaVersion: 2, semanticBinding: { schemaVersion: 1, timebase: 'source-native-seconds', clockSha256: 'c'.repeat(64), reviewedAnchorIds: ['anchor', 'second'], reviewedIntervals: [{ phraseId: 'phrase', occurrenceId: 'occurrence', startSeconds: 0, endSeconds: 2 }], sha256: '' } };
  r.semanticBinding.sha256 = sourceValidationSemanticHash(s, r);
  expect(validateSourceValidationReceipt(r, s)).toEqual(r);
  expect(sourceValidationSemanticHash({ ...s, anchors: [...s.anchors].reverse() }, { ...r, semanticBinding: { ...r.semanticBinding, reviewedAnchorIds: ['second', 'anchor'] } })).toBe(r.semanticBinding.sha256);
  for (const change of [
    { clockSha256: 'd'.repeat(64) }, { reviewedAnchorIds: ['anchor'] },
    { reviewedIntervals: [{ phraseId: 'phrase', occurrenceId: 'occurrence', startSeconds: 0, endSeconds: 3 }] },
    { timebase: 'output-seconds' },
  ]) expect(() => validateSourceValidationReceipt({ ...r, semanticBinding: { ...r.semanticBinding, ...change } }, s)).toThrow();
  expect(() => validateSourceValidationReceipt(r, { ...s, timebase: undefined })).toThrow(/timebase/);
});

it('rejects stale source, missing timing, wrong occurrence and unsupported assertions', () => {
  for (const change of [
    { sourceSha256: '0'.repeat(64) },
    { timingKnown: false },
    { selected: { phraseId: 'other', occurrenceId: 'occurrence', role: 'melody', onsetSeconds: 0.2 } },
    { selected: { phraseId: 'phrase', occurrenceId: 'occurrence', role: 'bass', onsetSeconds: 0.2 } },
    { reviewer: { id: 'reviewer', role: 'source-reviewer', assertion: 'unknown' } },
  ]) {
    expect(() => validateSourceValidationReceipt({ ...receipt(), ...change }, source())).toThrow();
  }
});

it('never writes a human assertion from an unknown source', () => {
  expect(() => validateSourceValidationReceipt(receipt(), { ...source(), authority: 'unknown', validationReceiptSha256: undefined })).toThrow();
});
