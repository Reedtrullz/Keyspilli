# Anti and Keyspilli score review completion design

Status: implementation design, reviewed against local source on 2026-10-08. This
document accompanies the revised 2026-10-07 verification plan; it does not record
implementation, a successful provider run, or musical approval.

## Outcome and scope

Deliver a usable, agent-operated workflow which takes pinned Keyspilli scores,
resolved playback evidence and audio, runs automatic checks, optionally obtains
one bound Gemini observation, and returns located findings and repair actions.
Reidar need not identify voices, recognize unfamiliar songs, judge chords, listen
to snippets, or find a pianist to complete this software.

This design supersedes the qualification, source-review assignment and owner
listening steps in `2026-10-06-music-evidence-qualification-design.md` for this
implementation. That document remains historical context. Its failed studies,
experimental releases and production controls remain intact. This scope ends at
a verified local candidate and concrete integration/adoption handoff. Production
promotion and universal musical correctness are separate outcomes.

## Observed gaps

- Keyspilli's pairwise adapter invokes `listen`. Anti exposes
  `--account-binding-json` only on `review-music`, and publishes its binding
  metadata only in that profile. Pairwise exact account binding needs wiring.
- `compareMusicalIntent` verifies selected landmarks with 100 ms onset tolerance.
  It does not compare every extra note or release. A landmark result cannot serve
  as an exact-note checker receipt.
- The Queen manifest's `noteEvents` pins are MIDI files and its `replaySnapshot`
  pin is a historical artifact manifest. Neither is the `ReplaySnapshot` event
  object used by `music-correspondence.ts`; explicit adapters are required.
- The existing plugin inventory pins the pre-edit documentation. Packaging will
  reject changed members until the inventory is regenerated and checked.
- The original plan accepts an HTTP 200 listening page as closeout. That neither
  verifies the new workflow nor removes the user's review burden.

## Ownership and limits

Anti owns reusable native Gemini transport, private account binding and generic
advisory envelopes. It has no Keyspilli dependency. Keyspilli owns score parsing,
roles, clocks, comparison policy, structural playability, reports and repairs.
Reuse existing parsers and measurement libraries; add no transcription weights,
provider accounts, orchestration framework or mandatory model dependency.

- Native parent execution; zero subagents is the default.
- Node `>=22.22.3 <23`, selected by checkout preflight and used by absolute path.
- At least 30 GiB free before long build/test runs.
- At most two PCM16 WAV attachments, 2 MiB each, 4 MiB combined, 30 seconds each.
- The new live smoke has exactly one job, at most one reserved attempt and one
  backend attempt, a 90 second deadline, and a 4096 token output ceiling.
- No refresh, retry, fallback, rotation, alternate account/model, study resumption
  or extra provider call following failure. The old `queen-original-replay` job
  and all frozen study artifacts remain immutable.
- Offline mode is the default and performs no HTTP request, provider invocation,
  credential read or catalog mutation. Invalid media refuses before route lookup.
- The legacy prompt remains byte-stable. New schema/binding requirements are
  explicit opt-in contracts; existing legacy runs are never rewritten.
- No merge, publication, installed adoption or deployment during this scope.

## Evidence model

Report software correctness and musical authority separately. A direct comparison
can establish equality to a supplied score without establishing that score's
fidelity to an artist's performance. A generated score compared with its own
export is a self-roundtrip, not an independent source check.

| Lane | Evidence it consumes | Allowed conclusion |
| --- | --- | --- |
| Input integrity | Re-read byte pins and bounded parsers | Inputs match pins or input is invalid |
| Score to replay | Independently parsed delivery score and pinned replay events | Measured conformance within declared scope/tolerances |
| Source fidelity | Source authority, role/occurrence anchors and verified timing | Scoped landmark preservation, violation, or unresolved authority |
| Player realization | Actual resolver/scheduler and paired capture receipts | Supported scheduling diagnosis, with acoustic limits retained |
| Structural playability | Explicit tempo, hands, difficulty and current policy | Mechanical screen passes/fails or is not assessable |
| Provider interpretation | Ordered audio receipt and validated advisory output | Compared, abstained, unavailable or ambiguous observation |
| Human musical/keyboard judgment | An independently supplied attestation | Remains unestablished when absent; never a software prerequisite |

Top-level `musicalAcceptance` is always `not-established` and
`productionAdmission` is always false. `listeningAttestation` and
`providerListeningAttestation` remain `unverified`; `listeningCalibration` remains
`unqualified`. No empty finding list, count of tokens, or model agreement changes
these fields. An authority-dependent check with unknown authority/timing cannot
pass. Internal file conformance may be measured, with that narrower basis named.

## Contracts

The plan defines these new version-1 interfaces. Shared types live in
`apps/web/src/lib/symbolic-review-input.ts`; existing ReviewManifest stays v2.

```ts
type FilePin = { path: string; sha256: string };
type CheckStatus = "passed" | "failed" | "not-run" | "authority-unknown";
type SourceAuthority = "unknown" | "model-estimate" | "self-authored" | "human-validated";
type EvidenceBasis = "supplied-symbolic-files" | "resolved-player-events";
interface ScoreReviewModeInput {
  deliveredScore: FilePin & { format: "midi" | "musicxml" | "mxl" };
  replayEventFormat: "midi" | "resolved-events-v1";
  replayBasis: EvidenceBasis;
  intent: ArrangementIntent;
  occurrenceId: string;
  coverage: "full-phrase" | "partial";
  clock: {
    sourceStartBeat: number; sourceStartSeconds: number;
    candidateStartSeconds: number; speed: number; transpose: number;
    timingKnown: boolean; evidence: FilePin | null;
  };
  roles: FilePin | null;
  hands: FilePin | null;
  playerEvidence: FilePin | null;
}
interface ScoreReviewInputV1 {
  schemaVersion: 1;
  kind: "keyspilli-score-review-input";
  manifest: FilePin;
  source: {
    authority: SourceAuthority;
    relationship: "independent-reference" | "derived-from-candidate" | "unknown";
    anchors: FilePin | null;
    validationReceipt: FilePin | null;
  };
  modes: Partial<Record<"original" | "chords", ScoreReviewModeInput>>;
}
```

`ArrangementIntent` is the existing type in `music-correspondence.ts`; import it
as a type in the shared input module. The sketch is a contract, not a standalone
compilable file. Each pin is
verified against actual bytes. Modes must be nonempty and match manifest modes.
Each mode operates on the manifest's selected phrase and explicit occurrence;
full-song coverage is never inferred from one excerpt. Sidecars bind their
contents to the source/delivery/replay hashes, mode and occurrence. Supplied role
and hand mappings have provenance; unknown entries remain unknown. Do not assign
melody from the highest pitch, right hand, track index or model certainty.

Clock sidecars use `kind: keyspilli-score-clock`, schemaVersion 1, mode,
occurrenceId, source/delivery/replay byte hashes, native tempo events and the
input's origin/speed/transpose fields. Validate monotone tempo events and
recompute their mapping from parsed source bytes. Role/hand sidecars use
`kind: keyspilli-score-roles` / `keyspilli-score-hands`, schemaVersion 1, the same
scope/hash pins and assignments keyed by unique normalized event IDs. Each
assignment carries its value and origin (`authored`, `declared`, `model-estimate`
or `unknown`). Source authority still comes from scoped anchors and validation,
not sidecar existence. Player evidence reuses existing resolver/paired-capture
contracts rather than adding an acoustic attestation field.

Normalize source and replay to a common, declared seconds clock with native tempo
changes, speed and transpose accounted for. Reuse `parseMidi`,
`midiBeatToNativeSeconds` and `adaptNativeSymbolicBytes` for MIDI/XML/MXL parsing.
Ambiguous repeats, unsupported controls or unresolved XML timing make the affected
check partial/not-run. They do not trigger inference, silent defaults or imports.
Validate the entire bounded file before selecting phrase events.

Normalized inventories retain duplicate pitches, event IDs, occurrences, attack,
key release, original beat and role/hand provenance. Event budget is 20,000; file
input limit is 16 MiB. Use half-open phrase onset selection, retain notes crossing
either boundary as context, and state release coverage explicitly. Sustain tails
are distinct from key releases.

`SymbolicReviewReceiptV1` binds manifest/input/code/policy/source/delivery/replay
hashes. It contains per-mode `scoreConformance`, `sourceFidelity`,
`structuralPlayability`, findings, coverage and limitations. `scoreConformance`
uses a fixed 5 ms attack and 5 ms key-release tolerance, named as a software
comparison policy rather than perceptual thresholds. It checks pitch,
multiplicity, missing/extra events and duration; iteration order cannot change
the result. Boundary-censored releases are unresolved, never silently passed.

Code identity hashes the sorted inventory of owned checker/adapter source files
plus the dependency lockfile; retain that inventory. Comparison policy is
versioned `score-conformance-v1`, onsetSeconds=0.005 and releaseSeconds=0.005;
its digest covers the full policy. Git HEAD cannot pin uncommitted code. A copied
export on both sides is a self-roundtrip even when every event matches.

No authority is gained by parsing a file. Existing source validation receipts
must be hash-verified and scope-checked before use. Trusted source fidelity
requires `timingKnown === true`. Chords permits validated melody omission;
alternate voicing requires validated harmonic anchors and otherwise stays
unresolved. Record approved transformations separately from literal conformance.

Structural playability reuses `measurePlayability`, `assessPlayability`,
`PLAYABILITY_AUDIT_CONFIG` and `PLAYABILITY_LIMITS`. Check MIDI piano range 21-108,
invalid notes, simultaneous/sounding spans, density, rapid attacks and explicit
maximum hand span. Missing hands or tempo blocks the affected measurements. For
variable tempo, evaluate elapsed-time metrics per declared constant-tempo segment
and cross-boundary attacks; never flatten to an average BPM. If existing helpers
cannot assess a boundary, report that component not-run. These metrics do not
prove fingering, hand size suitability or pianist approval.

## Bound audio and response schema

Extend Anti's existing `listen` command with the same private binding machinery
as `review-music`; do not switch the pairwise adapter to the incompatible music
response profile. Verify inventory immediately before generation and keep gateway
lease acquisition authoritative. Metadata records canonical binding digest,
gateway instance and whether pre-attempt verification occurred, never the raw
account reference/inventory. Binding goes only in `X-Anti-Account-Binding`, never
into Google payloads, prompts, audio captions or public artifacts.

Keyspilli's evidence-v2 live path requires the binding and validates returned
identity. Its schema is Keyspilli-owned and passed to Anti's existing
`--response-schema` as serialized JSON, not a filename. Provider-supported schema
constraints are a formatting aid; strict local validation remains decisive.
`limitations` must contain 1-20 nonempty strings of at most 500 characters. A
string, empty array, wrong field type, truncation or surrounding prose is rejected
without coercion or another call. Pin the schema in the run fingerprint; verify
the helper's assembled dry-run prompt including its exact schema appendix.

## User workflow and repair policy

One `review-score.mts` entrypoint validates input, creates symbolic receipts,
joins any supplied saved Anti result and emits JSON/Markdown/HTML plus a repair
queue. Default `--offline` works when Anti is absent. `--send-audio` requires an
explicit endpoint/model/binding and request cap; the smoke is one job only.
Existing evidence is immutable; every new output directory is exclusive.

The page opens on the results and next actions. It shows severity, evidence
origin, phrase/occurrence/time, scope and status, with optional audio/score links.
There are no required listening fields or requests to label melody/chords. Avoid
an overall green "correct" badge. Display unavailable expert judgments as limits
of the evidence, not owner tasks. Escape source/provider text and restrict links
to retained local evidence.

Confirmed playback faults lead to a software reproducer. Source-supported event
repairs use existing `previewMusicRepair`, at most eight edits in one phrase,
with neighboring events protected. Provider-only or authority-unknown claims are
suggestions and cannot alter notes. An offline preview is followed by fresh
symbolic/render/capture checks and a before/after evidence report. It consumes no
additional provider call and does not publish catalog changes.

## Completion and stop conditions

Complete implementation means: documented interfaces, automatic local controls,
usable offline CLI and report, bounded supported repairs, deterministic packages,
current-head tests/typechecks/build, and an evidence packet. The one live smoke
has a retained success, abstention, pre-dispatch block or immutable failure
receipt. A failed live gate does not stop independent offline/package work; it
does prevent claiming live readiness. A pending software task is never relabeled
complete to obtain a handoff.

Future adoption/merge/release/deployment uses exact candidate hashes and refreshed
repository/CI/runtime gates. This design prepares the concrete artifacts and
instructions for that decision; it grants no production authority and creates no
monitor, new qualification study or human-review assignment.
