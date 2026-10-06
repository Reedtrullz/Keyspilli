import { assertMusic, finiteSeconds, isHash } from '@keyspilli/catalog/src/acoustic-receipt.js';
import type { SourceAnchors } from './music-correspondence.js';

export interface SourceValidationReceiptV1 {
  schemaVersion: 1;
  kind: 'keyspilli-source-validation';
  sourceSha256: string;
  selected: { phraseId: string; occurrenceId: string; role: 'melody' | 'bass' | 'harmony'; onsetSeconds: number };
  reviewer: { id: string; role: 'owner' | 'source-reviewer' | 'pianist'; assertion: 'validated' };
  scope: { mode: 'original' | 'chords'; difficulty: 'beginner' | 'medium' | 'advanced' };
  timingKnown: true;
}

export function validateSourceValidationReceipt(value: unknown, source: SourceAnchors): SourceValidationReceiptV1 {
  assertMusic(value && typeof value === 'object', 'source validation receipt required');
  const receipt = value as SourceValidationReceiptV1;
  assertMusic(receipt.schemaVersion === 1 && receipt.kind === 'keyspilli-source-validation', 'unsupported source validation receipt');
  assertMusic(source.authority === 'human-validated' && source.timingKnown === true && isHash(source.validationReceiptSha256), 'human source timing and receipt hash required');
  assertMusic(receipt.sourceSha256 === source.sha256 && receipt.timingKnown === true, 'stale source or unknown timing');
  assertMusic(receipt.selected && typeof receipt.selected.phraseId === 'string' && typeof receipt.selected.occurrenceId === 'string' && ['melody', 'bass', 'harmony'].includes(receipt.selected.role) && finiteSeconds(receipt.selected.onsetSeconds), 'invalid source selection');
  assertMusic(source.anchors.some((anchor) => anchor.phraseId === receipt.selected.phraseId && anchor.occurrenceId === receipt.selected.occurrenceId && anchor.role === receipt.selected.role && Math.abs(anchor.onsetSeconds - receipt.selected.onsetSeconds) < 1e-9), 'selected source anchor mismatch');
  assertMusic(receipt.reviewer && typeof receipt.reviewer.id === 'string' && receipt.reviewer.id.length > 0 && ['owner', 'source-reviewer', 'pianist'].includes(receipt.reviewer.role) && receipt.reviewer.assertion === 'validated', 'unsupported reviewer assertion');
  assertMusic(receipt.scope && ['original', 'chords'].includes(receipt.scope.mode) && ['beginner', 'medium', 'advanced'].includes(receipt.scope.difficulty), 'invalid validation scope');
  return JSON.parse(JSON.stringify(receipt)) as SourceValidationReceiptV1;
}
