import { expect, it } from "vitest";
import { identityHash } from "@keyspilli/catalog/src/acoustic-receipt.js";
import type { SourceAnchors, ReplaySnapshot } from "./music-correspondence.js";
import { sourceValidationSemanticHash, type SourceValidationReceiptV2 } from "./music-source-validation.js";
import { readFile } from "node:fs/promises";
import { writeMidi, type Note } from "@keyspilli/midi";
import { scoreFixture } from "./score-review-test-fixture.js";
import { loadSymbolicReviewInput, validateScoreReviewInput } from "./symbolic-review-input.js";
import { buildSymbolicReviewReceipt } from "./symbolic-review.js";
import { buildScoreReviewReport } from "./score-review.js";
import { buildScoreReviewRepairActions, createScoreReviewRepairPreview } from "./score-review-repair.js";

// Authored software controls only. These fixtures are not human musical approvals.
async function authorityFixture(options: { unrelated?: boolean; version?: 1 | 2; validDelivery?: boolean; delivered?: Note[]; replayed?: Note[]; replayHand?: "L" | "R" } = {}) {
  const { unrelated = false, version = 1, validDelivery = false } = options;
  const note = (midi: number, start: number) => ({ midi, start, dur: 1, vel: 90 });
  const deliveredNotes = options.delivered ?? (unrelated ? [note(60, 0), note(61, 2)] : [note(validDelivery ? 60 : 61, 0)]);
  const replayedNotes = options.replayed ?? (unrelated ? [note(60, 0), note(62, 2)] : [note(62, 0)]);
  const f = await scoreFixture(unrelated ? [note(60, 0), note(64, 2)] : [note(60, 0)], replayedNotes);
  const delivered = await f.pin("changed-delivery.mid", writeMidi(deliveredNotes, { tempoBpm: 120 }));
  const clockValue = JSON.parse(await readFile(f.input.modes.original.clock.evidence.path, "utf8"));
  const clock = await f.pin("changed-clock.json", { ...clockValue, deliverySha256: delivered.sha256 });
  const receiptValue = {
    schemaVersion: 1, kind: "keyspilli-source-validation", sourceSha256: f.delivery.sha256,
    selected: { phraseId: "phrase", occurrenceId: "occ-1", role: "melody", onsetSeconds: 0 },
    reviewer: { id: "SYNTHETIC-CONTROL-NOT-A-HUMAN-REVIEW", role: "source-reviewer", assertion: "validated" },
    scope: { mode: "original", difficulty: "medium" }, timingKnown: true,
  };
  const source: SourceAnchors = {
    sha256: f.delivery.sha256, authority: "human-validated", timingKnown: true, timebase: "source-native-seconds",
    anchors: [{ id: "reviewed-first-note", phraseId: "phrase", occurrenceId: "occ-1", role: "melody", ...(options.replayHand ? { hand: "R" as const } : {}), midi: 60, onsetSeconds: 0, durationSeconds: 0.5, required: true }],
  };
  const v2: SourceValidationReceiptV2 = {
    ...receiptValue, schemaVersion: 2, kind: "keyspilli-source-validation", timingKnown: true,
    selected: { phraseId: "phrase", occurrenceId: "occ-1", role: "melody", onsetSeconds: 0 },
    reviewer: { id: "SYNTHETIC-CONTROL-NOT-A-HUMAN-REVIEW", role: "source-reviewer", assertion: "validated" },
    scope: { mode: "original", difficulty: "medium" },
    semanticBinding: { schemaVersion: 1, timebase: "source-native-seconds", clockSha256: clock.sha256, reviewedAnchorIds: ["reviewed-first-note"], reviewedIntervals: [{ phraseId: "phrase", occurrenceId: "occ-1", startSeconds: 0, endSeconds: 0.5 }], sha256: "" },
  };
  v2.semanticBinding.sha256 = sourceValidationSemanticHash(source, v2);
  const receipt = await f.pin("reviewer.json", version === 2 ? v2 : receiptValue);
  source.validationReceiptSha256 = receipt.sha256;
  const eventIds = [...deliveredNotes.map((_, i) => `delivery-${i}`), ...replayedNotes.map((_, i) => `replay-${i}`)];
  const roles = await f.pin("changed-roles.json", {
    ...f.scope, deliverySha256: delivered.sha256, kind: "keyspilli-score-roles",
    assignments: Object.fromEntries(eventIds.map(id => [id, { value: "melody", origin: "authored" }])),
  });
  const hands = options.replayHand ? await f.pin("changed-hands.json", {
    ...f.scope, deliverySha256: delivered.sha256, kind: "keyspilli-score-hands",
    assignments: Object.fromEntries(eventIds.map(id => [id, { value: id.startsWith("replay-") ? options.replayHand : "R", origin: "authored" }])),
  }) : null;
  const review = async (changed = source) => {
    const anchors = await f.pin("anchors.json", changed);
    const raw = { ...f.input, source: { authority: "human-validated", relationship: "independent-reference", anchors, validationReceipt: receipt }, modes: { original: { ...f.input.modes.original, deliveredScore: { ...delivered, format: "midi" }, clock: { ...f.input.modes.original.clock, evidence: clock }, roles, hands } } };
    const input = await loadSymbolicReviewInput(validateScoreReviewInput(raw));
    const symbolic = buildSymbolicReviewReceipt(input);
    return { input, symbolic, actions: buildScoreReviewRepairActions(buildScoreReviewReport({ input, symbolic })) };
  };
  return { ...f, source, review };
}

it("rehashing an edited label cannot reuse a historical review as source authority", async () => {
  const f = await authorityFixture();
  try {
    const result = await f.review({ ...f.source, anchors: f.source.anchors.map(a => ({ ...a, midi: 61 })) });
    expect(result.symbolic.modes.original?.sourceFidelity.status).toBe("authority-unknown");
    expect(result.actions.some(a => a.kind === "bounded-preview")).toBe(false);
    expect(result.symbolic.musicalAcceptance).toBe("not-established");
    expect(result.symbolic.productionAdmission).toBe(false);
  } finally { await f.cleanup(); }
});

it("a reviewed note at zero seconds never authorizes a different note at one second", async () => {
  const f = await authorityFixture({ unrelated: true });
  try {
    const result = await f.review();
    const action = result.actions.find(a => a.startSeconds === 1 && a.targetEventId !== null);
    expect(action).toBeDefined();
    expect(action?.kind).toBe("software-reproducer");
    expect(result.actions.some(a => a.kind === "bounded-preview")).toBe(false);
  } finally { await f.cleanup(); }
});

it("a valid V2 landmark pass is still scoped to the reviewed event", async () => {
  const f = await authorityFixture({ unrelated: true, version: 2 });
  try {
    const result = await f.review();
    expect(result.symbolic.modes.original?.sourceFidelity.status).toBe("passed");
    expect(result.symbolic.modes.original?.sourceAuthorizations?.map(a => a.expectedEventId)).toEqual(["delivery-0"]);
    expect(result.actions.find(a => a.startSeconds === 1)?.kind).toBe("software-reproducer");
  } finally { await f.cleanup(); }
});

it.each([
  ["pitch", { midi: 61 }], ["duration", { durationSeconds: 0.25 }], ["role", { role: "bass" }],
  ["required", { required: false }], ["ambiguous", { ambiguous: true }], ["onset", { onsetSeconds: 0.1 }],
  ["occurrence", { occurrenceId: "other" }], ["phrase", { phraseId: "other" }], ["hand", { hand: "L" }],
] as const)("rejects changed %s even when the edited V2 anchors file is repinned", async (_, change) => {
  const f = await authorityFixture({ version: 2, validDelivery: true });
  try {
    const result = await f.review({ ...f.source, anchors: f.source.anchors.map(a => ({ ...a, ...change })) });
    expect(result.symbolic.modes.original?.sourceFidelity.status).toBe("authority-unknown");
    expect(result.actions.some(a => a.kind === "bounded-preview")).toBe(false);
  } finally { await f.cleanup(); }
});

it("refuses changed clock evidence and ambiguous duplicate event correspondence", async () => {
  const f = await authorityFixture({ version: 2, validDelivery: true });
  try {
    const { input } = await f.review();
    const mode = input.modes.original!;
    const clock = mode.pins.clock;
    mode.pins.clock = "f".repeat(64);
    expect(buildSymbolicReviewReceipt(input).modes.original?.sourceFidelity.status).toBe("authority-unknown");
    mode.pins.clock = clock;
    mode.expected.push({ ...mode.expected[0]!, id: "duplicate" });
    expect(buildSymbolicReviewReceipt(input).modes.original?.sourceAuthorizations).toEqual([]);
  } finally { await f.cleanup(); }
});

it("permits the exact pinned pitch repair and preserves neighbors; changed target semantics refuse", async () => {
  const f = await authorityFixture({ version: 2, validDelivery: true });
  try {
    const result = await f.review();
    const action = result.actions.find(a => a.kind === "bounded-preview")!;
    expect(action?.expectedPitch).toBe(60);
    const events = [action.targetEvent!, { ...action.targetEvent!, id: "neighbor", phraseId: "next", onsetSeconds: 2 }];
    const snapshot: ReplaySnapshot = { schemaVersion: 1, sourceSha256: identityHash(events), events };
    const proposal = { sourceSha256: snapshot.sourceSha256, findingId: action.findingId, findingKind: "authored-discrepancy" as const, phrase: { id: "phrase", startSeconds: 0, endSeconds: 0.5 }, targetEventIds: [action.targetEventId!], operations: [{ kind: "replace-pitch" as const, eventId: action.targetEventId!, midi: 60 }], evidenceRefs: action.evidenceHashes, sourceAuthority: "human-validated" as const, validationReceiptSha256: action.validationReceiptSha256!, preservePhraseIds: ["next"] };
    const preview = createScoreReviewRepairPreview({ snapshot, proposal }, action);
    expect(preview.snapshot.events.map(e => e.midi)).toEqual([60, 62]);
    expect(preview.snapshot.events[1]).toEqual(events[1]);
    expect(preview.catalogMutations).toBe(0);
    expect(preview.musicalAcceptance).toBe("not-established");
    for (const change of [{ durationSeconds: 0.4 }, { role: "bass" as const }, { onsetSeconds: 0.1 }, { occurrenceId: "other" }, { hand: "L" as const }]) {
      const changed = { ...snapshot, events: [{ ...events[0]!, ...change }, events[1]!] };
      changed.sourceSha256 = identityHash(changed.events);
      expect(() => createScoreReviewRepairPreview({ snapshot: changed, proposal: { ...proposal, sourceSha256: changed.sourceSha256 } }, action)).toThrow(/stale target/);
    }
    expect(() => createScoreReviewRepairPreview({ snapshot, proposal: { ...proposal, evidenceRefs: [action.evidenceHashes[0]!] } }, action)).toThrow(/evidence required/);
  } finally { await f.cleanup(); }
});

const candidate = (midi: number, start = 0, dur = 1): Note => ({ midi, start, dur, vel: 90 });
it.each([
  { name: "multiple replay counterparts", replayed: [candidate(62), candidate(65)] },
  { name: "ambiguous polyphonic pairing", delivered: [candidate(60), candidate(64)], replayed: [candidate(62), candidate(65)] },
  { name: "two possible delivery counterparts for one replay note", delivered: [candidate(60), candidate(64)], replayed: [candidate(62)] },
  { name: "different declared hand", replayHand: "L" as const },
  { name: "approximate onset outside reviewed interval", replayed: [candidate(62, 0.008)] },
  { name: "approximate release outside reviewed interval", replayed: [candidate(62, 0, 1.008)] },
])("does not turn $name into exact repair authority", async ({ name: _, ...options }) => {
  const f = await authorityFixture({ version: 2, validDelivery: true, ...options });
  try {
    const result = await f.review();
    expect(result.symbolic.modes.original?.sourceFidelity.status).toBe("passed");
    expect(result.actions.some(a => a.kind === "software-reproducer")).toBe(true);
    expect(result.actions.some(a => a.kind === "bounded-preview")).toBe(false);
    expect(result.symbolic.modes.original?.sourceAuthorizations).toEqual([]);
  } finally { await f.cleanup(); }
});

it("binds the unique replay counterpart as well as the reviewed delivery event", async () => {
  const f = await authorityFixture({ version: 2, validDelivery: true, replayHand: "R" });
  try {
    const result = await f.review();
    const action = result.actions.find(a => a.kind === "bounded-preview")!;
    expect(action).toBeDefined();
    expect(action.sourceAuthorization).toMatchObject({ targetEventId: "replay-0", targetEventSha256: identityHash(result.input.modes.original!.replayed[0]) });
  } finally { await f.cleanup(); }
});
