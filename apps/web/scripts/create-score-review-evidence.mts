import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { parseMidi, midiBeatToNativeSeconds, type Note } from "@keyspilli/midi";
import { identityHash } from "@keyspilli/catalog/src/acoustic-receipt.js";
import { scoreFixture } from "../src/lib/score-review-test-fixture.js";
import { validateScoreReviewInput, loadSymbolicReviewInput, scoreReviewCodeIdentity } from "../src/lib/symbolic-review-input.js";
import { buildSymbolicReviewReceipt } from "../src/lib/symbolic-review.js";
import { buildScoreReviewReport, writeScoreReviewReport } from "../src/lib/score-review.js";
import { buildScoreReviewRepairActions, createScoreReviewRepairPreview } from "../src/lib/score-review-repair.js";
import { resolveReviewPlayback } from "../src/lib/music-event-comparison.js";
import type { ReplaySnapshot } from "../src/lib/music-correspondence.js";
const root = resolve(process.argv[2] ?? "output/music-review/score-review-completion-20261008-native-01");
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const write = async (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const code = await scoreReviewCodeIdentity();
await mkdir(join(root, "controls"), { recursive: false, mode: 0o700 });
const correct: Note[] = [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }, { midi: 67, start: 6, dur: 1, vel: 90, hand: "R" }];
const bad = correct.map((n, i) => ({ ...n, midi: i === 0 ? 61 : n.midi }));
async function control(name: string, actual: Note[]) {
    const f = await scoreFixture(correct, actual, join(root, "controls", name));
    const roles = await f.pin("roles.json", { ...f.scope, kind: "keyspilli-score-roles", assignments: { "delivery-0": { value: "melody", origin: "authored" }, "replay-0": { value: "melody", origin: "authored" } } });
    const hands = await f.pin("hands.json", { ...f.scope, kind: "keyspilli-score-hands", assignments: { "delivery-0": { value: "R", origin: "authored" }, "replay-0": { value: "R", origin: "authored" } } });
    const anchors = await f.pin("anchors.json", { sha256: f.delivery.sha256, authority: "self-authored", timingKnown: true, anchors: [{ id: "author-c4", phraseId: "phrase", occurrenceId: "occ-1", role: "melody", hand: "R", midi: 60, onsetSeconds: 0, durationSeconds: 0.5, required: true }] });
    const raw = { ...f.input, source: { authority: "self-authored", relationship: "independent-reference", anchors, validationReceipt: null }, modes: { original: { ...f.input.modes.original, roles, hands } } };
    await write(join(f.root, "input.json"), raw);
    const n = await loadSymbolicReviewInput(validateScoreReviewInput(raw));
    const report = buildScoreReviewReport({ input: n, symbolic: buildSymbolicReviewReceipt(n, code) });
    await writeScoreReviewReport(report, join(f.root, "report"));
    return { f, n, report };
}
const before = await control("before", bad);
const action = buildScoreReviewRepairActions(before.report).find(a => a.kind === "bounded-preview");
if (!action)
    throw Error("No trusted automatic preview action");
const events = bad.map((n, i) => ({ id: `replay-${i}`, phraseId: i === 0 ? "phrase" : "neighbor", occurrenceId: "occ-1", role: "melody" as const, hand: "R" as const, midi: n.midi, onsetSeconds: n.start / 2, durationSeconds: n.dur / 2 }));
const snapshot: ReplaySnapshot = { schemaVersion: 1, sourceSha256: identityHash(events), events };
const proposal = { sourceSha256: snapshot.sourceSha256, findingId: action.findingId, findingKind: "authored-discrepancy" as const, phrase: { id: "phrase", startSeconds: 0, endSeconds: 2 }, targetEventIds: ["replay-0"], operations: [{ kind: "replace-pitch" as const, eventId: "replay-0", midi: 60 }], evidenceRefs: action.evidenceHashes, sourceAuthority: "self-authored" as const, preservePhraseIds: ["neighbor"] };
const preview = createScoreReviewRepairPreview({ snapshot, proposal }, action);
await write(join(root, "controls", "preview.json"), preview);
const repaired = preview.snapshot.events.map(e => ({ midi: e.midi, start: e.onsetSeconds * 2, dur: e.durationSeconds * 2, vel: 90, hand: e.hand }));
const after = await control("after", repaired);
const song = { notes: repaired, chords: [], measures: [{ index: 0, startBeat: 0, endBeat: 4 }, { index: 1, startBeat: 4, endBeat: 8 }], key: "C", tempoBpm: 120, timeSig: [4, 4] as [
        number,
        number
    ] };
const resolved = resolveReviewPlayback(song, 1, 0, "occ-1");
await write(join(root, "controls", "fresh-player-events.json"), { kind: "fresh-player-resolver-software-proof", events: resolved, providerCalls: 0 });
if (after.report.findings.length || after.report.symbolic.modes.original?.scoreConformance.status !== "passed" || identityHash(preview.snapshot.events.filter(e => e.phraseId === "neighbor")) !== preview.preservedSha256)
    throw Error("Repair software proof failed");
await write(join(root, "controls", "REPAIR_PROOF.json"), { status: "passed", beforeFindings: before.report.findings.length, afterFindings: after.report.findings.length, preservedSha256: preview.preservedSha256, freshMidiSha256: after.f.replay.sha256, resolvedEventsSha256: identityHash(resolved), catalogMutations: 0, providerCalls: 0, musicalAcceptance: "not-established" });
const captureRoot = join(root, "controls", "capture");
await mkdir(captureRoot);
for (const dir of ["capture-fixtures", "capture-receipts", "media"])
    await mkdir(join(captureRoot, dir));
await write(join(captureRoot, "capture-fixtures", "bundle.json"), { schemaVersion: 1, fixtures: [{ id: "repair-before", title: "Repair control before", data: { ...song, notes: bad } }, { id: "repair-after", title: "Repair control after", data: song }], captures: { "repair-before": { songId: "repair-before-m", mode: "original", durationMs: 1500, expectedAttackSeconds: [0], capturePreCompressor: true }, "repair-after": { songId: "repair-after-m", mode: "original", durationMs: 1500, expectedAttackSeconds: [0], capturePreCompressor: true } }, provenance: { type: "two self-authored software repair controls; not a qualification study", providerCalls: 0 } });
const oldPath = resolve("output/music-review/r2-next-20261007/pairwise-queen-20261007/manifest-original-smoke.json");
const manifest = JSON.parse(await readFile(oldPath, "utf8"));
manifest.jobs[0].id = "queen-original-replay-completion-20261008-native-01";
manifest.jobs[0].scoreContext += " Fresh software diagnosis; no provider hearing or source fidelity claim.";
await mkdir(join(root, "queen"));
await write(join(root, "queen", "manifest.json"), manifest);
const manifestBytes = await readFile(join(root, "queen", "manifest.json"));
const source = parseMidi(await readFile(manifest.source.path)), replay = parseMidi(await readFile(manifest.replays.original.noteEvents.path));
const origins = { sourceStartBeat: 18, sourceStartSeconds: midiBeatToNativeSeconds(source, 18), candidateStartSeconds: 0, speed: 1, transpose: 0 };
const clockPath = join(root, "queen", "clock.json");
await write(clockPath, { schemaVersion: 1, kind: "keyspilli-score-clock", mode: "original", occurrenceId: "diagnostic-18-30-declared", sourceSha256: manifest.source.sha256, deliverySha256: manifest.source.sha256, replaySha256: manifest.replays.original.noteEvents.sha256, ...origins, tempoEvents: { source: source.tempoEvents ?? [], delivery: source.tempoEvents ?? [], replay: replay.tempoEvents ?? [] }, basis: "Declared symbolic excerpt origin, not audio alignment", audioAlignment: "unverified" });
const input = { schemaVersion: 1, kind: "keyspilli-score-review-input", manifest: { path: join(root, "queen", "manifest.json"), sha256: hash(manifestBytes) }, source: { authority: "unknown", relationship: "derived-from-candidate", anchors: null, validationReceipt: null }, modes: { original: { deliveredScore: manifest.source, replayEventFormat: "midi", replayBasis: "supplied-symbolic-files", intent: { mode: "original", difficulty: "advanced", approvedTransformations: [], maximumHandSpan: 12 }, occurrenceId: "diagnostic-18-30-declared", coverage: "full-phrase", clock: { ...origins, timingKnown: true, evidence: { path: clockPath, sha256: hash(await readFile(clockPath)) } }, roles: null, hands: null, playerEvidence: null } } };
await write(join(root, "queen", "input.json"), input);
const normalized = await loadSymbolicReviewInput(validateScoreReviewInput(input));
const report = buildScoreReviewReport({ input: normalized, symbolic: buildSymbolicReviewReceipt(normalized, code) });
await writeScoreReviewReport(report, join(root, "queen", "offline"));
console.log(JSON.stringify({ root, repairProof: "passed", queenFindings: report.findings.length, sourceFidelity: report.symbolic.modes.original?.sourceFidelity.status }));
