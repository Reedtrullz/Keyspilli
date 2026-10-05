import {
  assertMusic,
  finiteSeconds,
  identityHash,
  isHash,
} from "@keyspilli/catalog/src/acoustic-receipt.js";
import {
  validateReplay,
  type MusicalEvent,
  type ReplaySnapshot,
} from "./music-correspondence.js";
export type RepairOperation =
  | { kind: "replace-pitch"; eventId: string; midi: number }
  | { kind: "shift-onset"; eventId: string; onsetSeconds: number }
  | { kind: "delete"; eventId: string }
  | { kind: "insert"; event: MusicalEvent };
export interface RepairProposal {
  sourceSha256: string;
  findingId: string;
  findingKind: "authored-discrepancy" | "playback-realization" | "qualitative";
  phrase: { id: string; startSeconds: number; endSeconds: number };
  targetEventIds: string[];
  operations: RepairOperation[];
  evidenceRefs: string[];
  sourceAuthority:
    | "unknown"
    | "model-estimate"
    | "self-authored"
    | "human-validated";
  validationReceiptSha256?: string;
  preservePhraseIds: string[];
}
export interface RepairPreview {
  schemaVersion: 1;
  kind: "keyspilli-music-repair-preview";
  proposalSha256: string;
  originalSha256: string;
  snapshot: ReplaySnapshot;
  diff: Array<{
    eventId: string;
    before: MusicalEvent | null;
    after: MusicalEvent | null;
  }>;
  preservedSha256: string;
  requiredRechecks: string[];
  catalogMutations: 0;
  musicalAcceptance: "not-established";
}
export function previewMusicRepair(
  source: ReplaySnapshot,
  proposal: RepairProposal,
): RepairPreview {
  const snapshot = validateReplay(source);
  assertMusic(
    proposal.sourceSha256 === snapshot.sourceSha256,
    "stale repair source",
  );
  assertMusic(
    typeof proposal.findingId === "string" &&
      proposal.findingId.length > 0 &&
      proposal.findingKind === "authored-discrepancy",
    "Playback faults require software reproducers; qualitative changes remain text proposals",
  );
  assertMusic(
    proposal.sourceAuthority === "self-authored" ||
      (proposal.sourceAuthority === "human-validated" &&
        isHash(proposal.validationReceiptSha256)),
    "source authority must be validated before event edits",
  );
  assertMusic(
    proposal.phrase &&
      typeof proposal.phrase.id === "string" &&
      finiteSeconds(proposal.phrase.startSeconds) &&
      finiteSeconds(proposal.phrase.endSeconds) &&
      proposal.phrase.startSeconds < proposal.phrase.endSeconds,
    "invalid bounded phrase",
  );
  assertMusic(
    Array.isArray(proposal.evidenceRefs) &&
      proposal.evidenceRefs.length > 0 &&
      proposal.evidenceRefs.every(isHash),
    "pinned evidence required",
  );
  assertMusic(
    Array.isArray(proposal.operations) &&
      proposal.operations.length > 0 &&
      proposal.operations.length <= 8,
    "one to eight event edits required",
  );
  assertMusic(
    Array.isArray(proposal.targetEventIds) &&
      new Set(proposal.targetEventIds).size === proposal.targetEventIds.length,
    "duplicate target IDs",
  );
  const events = new Map(snapshot.events.map((e) => [e.id, e]));
  for (const id of proposal.targetEventIds)
    assertMusic(
      events.get(id)?.phraseId === proposal.phrase.id,
      "unknown or neighboring target event",
    );
  const untouched = source.events.filter(
    (e) => e.phraseId !== proposal.phrase.id,
  );
  const untouchedHash = identityHash(untouched);
  const edited = new Set<string>();
  for (const op of proposal.operations) {
    assertMusic(
      ["replace-pitch", "shift-onset", "delete", "insert"].includes(op.kind),
      "unsupported repair operation",
    );
    const id = op.kind === "insert" ? op.event.id : op.eventId;
    assertMusic(!edited.has(id), "duplicate edit target");
    edited.add(id);
    if (op.kind === "insert") {
      assertMusic(
        !events.has(id) && op.event.phraseId === proposal.phrase.id,
        "duplicate or neighboring insertion",
      );
      events.set(id, { ...op.event });
      continue;
    }
    assertMusic(
      proposal.targetEventIds.includes(id) && events.has(id),
      "unapproved operation target",
    );
    const original = events.get(id)!;
    if (op.kind === "delete") {
      events.delete(id);
      continue;
    }
    if (op.kind === "replace-pitch") {
      assertMusic(
        Number.isInteger(op.midi) && op.midi >= 0 && op.midi <= 127,
        "invalid repair pitch",
      );
      events.set(id, { ...original, midi: op.midi });
    } else {
      assertMusic(finiteSeconds(op.onsetSeconds), "invalid repair onset");
      events.set(id, { ...original, onsetSeconds: op.onsetSeconds });
    }
  }
  assertMusic(
    proposal.targetEventIds.every((id) => edited.has(id)),
    "declared target must be accounted for",
  );
  const changed = [...events.values()].sort(
    (a, b) =>
      a.onsetSeconds - b.onsetSeconds ||
      a.midi - b.midi ||
      a.id.localeCompare(b.id),
  );
  for (const e of changed.filter((e) => e.phraseId === proposal.phrase.id))
    assertMusic(
      e.onsetSeconds >= proposal.phrase.startSeconds &&
        e.onsetSeconds + e.durationSeconds <= proposal.phrase.endSeconds,
      "edit escapes phrase window",
    );
  const neighbor = changed.filter((e) => e.phraseId !== proposal.phrase.id);
  assertMusic(
    identityHash(neighbor) === untouchedHash,
    "neighboring phrase changed",
  );
  assertMusic(
    proposal.preservePhraseIds.every(
      (id) =>
        id !== proposal.phrase.id &&
        source.events.some((e) => e.phraseId === id),
    ),
    "invalid preservation target",
  );
  const candidate = validateReplay({
    schemaVersion: 1,
    sourceSha256: identityHash(changed),
    events: changed,
  });
  const diff = [...edited].map((eventId) => ({
    eventId,
    before: source.events.find((e) => e.id === eventId) ?? null,
    after: candidate.events.find((e) => e.id === eventId) ?? null,
  }));
  return {
    schemaVersion: 1,
    kind: "keyspilli-music-repair-preview",
    proposalSha256: identityHash(proposal),
    originalSha256: source.sourceSha256,
    snapshot: candidate,
    diff,
    preservedSha256: untouchedHash,
    requiredRechecks: [
      "fresh-audio-capture",
      "target-event-comparison",
      "neighbor-and-ending-preservation",
      "source-correspondence",
      "human-listening-and-keyboard-review",
    ],
    catalogMutations: 0,
    musicalAcceptance: "not-established",
  };
}
