import { it, expect } from 'vitest';
import { identityHash } from '@keyspilli/catalog/src/acoustic-receipt.js';
import { validateSourceValidationReceipt, type SourceValidationReceiptV1 } from './music-source-validation.js';
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

it('binds a human source receipt to bytes, occurrence, role, timing and scope', () => {
  expect(validateSourceValidationReceipt(receipt(), source())).toEqual(receipt());
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
