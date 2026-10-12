import { assertMusic, finiteSeconds, isHash, identityHash } from '@keyspilli/catalog/src/acoustic-receipt.js';
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

export interface SourceValidationReceiptV2 extends Omit<SourceValidationReceiptV1, 'schemaVersion'> {
  schemaVersion: 2;
  semanticBinding: {
    schemaVersion: 1;
    timebase: 'source-native-seconds';
    clockSha256: string;
    reviewedAnchorIds: string[];
    reviewedIntervals: Array<{ phraseId: string; occurrenceId: string; startSeconds: number; endSeconds: number }>;
    sha256: string;
  };
}
export type SourceValidationReceipt = SourceValidationReceiptV1 | SourceValidationReceiptV2;

/** Content binding, not a reviewer attestation. Never upgrades an existing V1 receipt. */
export function sourceValidationSemanticHash(source: SourceAnchors, receipt: Omit<SourceValidationReceiptV2, 'semanticBinding'> & { semanticBinding: Omit<SourceValidationReceiptV2['semanticBinding'], 'sha256'> }): string {
  const binding = receipt.semanticBinding;
  return identityHash({
    schemaVersion: 1, sourceSha256: source.sha256, timingKnown: source.timingKnown,
    timebase: source.timebase, selected: receipt.selected, scope: receipt.scope,
    clockSha256: binding.clockSha256, bindingTimebase: binding.timebase,
    reviewedAnchorIds: [...binding.reviewedAnchorIds].sort(),
    reviewedIntervals: [...binding.reviewedIntervals].sort((a, b) => identityHash(a).localeCompare(identityHash(b))),
    labels: source.anchors.map(a => ({ id: a.id, phraseId: a.phraseId, occurrenceId: a.occurrenceId, role: a.role,
      hand: a.hand ?? null, midi: a.midi, onsetSeconds: a.onsetSeconds, durationSeconds: a.durationSeconds,
      required: a.required, ambiguous: a.ambiguous ?? false })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  });
}

/** V1 remains readable historical evidence; callers must require V2 for source authority. */
export function validateSourceValidationReceipt(value: unknown, source: SourceAnchors): SourceValidationReceipt {
  assertMusic(value && typeof value === 'object', 'source validation receipt required');
  const receipt = value as SourceValidationReceipt;
  assertMusic([1, 2].includes(receipt.schemaVersion) && receipt.kind === 'keyspilli-source-validation', 'unsupported source validation receipt');
  assertMusic(source.authority === 'human-validated' && source.timingKnown === true && isHash(source.validationReceiptSha256), 'human source timing and receipt hash required');
  assertMusic(receipt.sourceSha256 === source.sha256 && receipt.timingKnown === true, 'stale source or unknown timing');
  assertMusic(receipt.selected && typeof receipt.selected.phraseId === 'string' && typeof receipt.selected.occurrenceId === 'string' && ['melody', 'bass', 'harmony'].includes(receipt.selected.role) && finiteSeconds(receipt.selected.onsetSeconds), 'invalid source selection');
  assertMusic(source.anchors.some((anchor) => anchor.phraseId === receipt.selected.phraseId && anchor.occurrenceId === receipt.selected.occurrenceId && anchor.role === receipt.selected.role && Math.abs(anchor.onsetSeconds - receipt.selected.onsetSeconds) < 1e-9), 'selected source anchor mismatch');
  assertMusic(receipt.reviewer && typeof receipt.reviewer.id === 'string' && receipt.reviewer.id.length > 0 && ['owner', 'source-reviewer', 'pianist'].includes(receipt.reviewer.role) && receipt.reviewer.assertion === 'validated', 'unsupported reviewer assertion');
  assertMusic(receipt.scope && ['original', 'chords'].includes(receipt.scope.mode) && ['beginner', 'medium', 'advanced'].includes(receipt.scope.difficulty), 'invalid validation scope');
  if (receipt.schemaVersion === 2) {
    const b = receipt.semanticBinding;
    assertMusic(b?.schemaVersion === 1 && b.timebase === 'source-native-seconds' && source.timebase === b.timebase && isHash(b.clockSha256), 'explicit source-native timebase and clock pin required');
    assertMusic(Array.isArray(source.anchors) && source.anchors.length > 0 && source.anchors.length <= 20000, 'bounded nonempty source labels required');
    const ids = new Set<string>();
    for (const a of source.anchors) {
      assertMusic(a && typeof a.id === 'string' && a.id.length > 0 && !ids.has(a.id) && typeof a.phraseId === 'string' && a.phraseId.length > 0 && typeof a.occurrenceId === 'string' && a.occurrenceId.length > 0 && ['melody', 'bass', 'harmony'].includes(a.role) && Number.isInteger(a.midi) && a.midi >= 0 && a.midi <= 127 && finiteSeconds(a.onsetSeconds) && finiteSeconds(a.durationSeconds) && a.durationSeconds > 0 && typeof a.required === 'boolean' && (a.ambiguous === undefined || typeof a.ambiguous === 'boolean') && (a.hand === undefined || ['L', 'R'].includes(a.hand)), 'invalid or duplicate source label');
      ids.add(a.id);
    }
    assertMusic(Array.isArray(b.reviewedAnchorIds) && b.reviewedAnchorIds.length > 0 && b.reviewedAnchorIds.length <= ids.size && new Set(b.reviewedAnchorIds).size === b.reviewedAnchorIds.length && b.reviewedAnchorIds.every(id => ids.has(id)), 'exact reviewed anchor IDs required');
    assertMusic(Array.isArray(b.reviewedIntervals) && b.reviewedIntervals.length > 0 && b.reviewedIntervals.length <= 20000 && b.reviewedIntervals.every(i => i && i.phraseId === receipt.selected.phraseId && i.occurrenceId === receipt.selected.occurrenceId && finiteSeconds(i.startSeconds) && finiteSeconds(i.endSeconds) && i.endSeconds > i.startSeconds), 'invalid reviewed intervals');
    const reviewed = source.anchors.filter(a => b.reviewedAnchorIds.includes(a.id));
    assertMusic(reviewed.every(a => a.phraseId === receipt.selected.phraseId && a.occurrenceId === receipt.selected.occurrenceId && a.role === receipt.selected.role && b.reviewedIntervals.some(i => a.onsetSeconds >= i.startSeconds && a.onsetSeconds + a.durationSeconds <= i.endSeconds)), 'reviewed labels escape selected role, occurrence or interval');
    assertMusic(reviewed.some(a => a.onsetSeconds === receipt.selected.onsetSeconds), 'selected anchor is not reviewed');
    assertMusic(isHash(b.sha256) && b.sha256 === sourceValidationSemanticHash(source, receipt), 'stale semantic source labels, coverage or clock');
  }
  return JSON.parse(JSON.stringify(receipt)) as SourceValidationReceipt;
}
