# Music evidence release design — 6 October 2026

Status: proposed design for the owner's requested implementation/deployment plan.
Writing this document does not execute the plan, spend provider quota or authorize
production promotion. It extends the 5 October music-review design with the
completed Player input/output experiments.

## Intended outcome

An agent can capture controlled Keyspilli playback, compute defensible local
evidence, compare that evidence with an identified arrangement/source, obtain
optional compact Gemini interpretation through Anti, and deliver a reviewable
report and isolated repair preview. Release it through the actual GitHub pipelines
with exact artifact/version evidence, preserved production data and rollback.

Anti must remain usable with an eligible connected Google AI account alone.
Keyspilli owns DSP, transcription, sample/reference banks, arrangement rules,
comparison, preview, and non-Gemini research. No public Gemini API key, second
provider account, or Keyspilli installation becomes an Anti prerequisite.

Owner instructions: preserve primary WIP; avoid new ears/account authorization
during autonomous implementation; put unresolved decisions at final review.
Execution assumption: native parent agent, no subagents, separate small PRs.

## Evidence baseline and proposed scope

The current input-side prototype recovered 53/54 frozen history pitch sets,
with one below-level refusal and zero accepted wrong sets. It analyzes the first
1.2 seconds of authentic stereo compressor input. It is not a production command.
Final compressed-output correction recovered only four of six known pitch-set
proposals and omitted both quiet notes. That candidate remains rejected.
Local onset detection matched 345 distinct start groups within 100 ms across
110 synthetic Player clips. Compact Gemini interpretation was demonstrated;
independent listening and larger response reliability remain unqualified.

Release A supplies a repeatable, explicitly scoped evidence workflow and compact
advisory interpretation. Release B concerns broader acoustic/event coverage and
musical suitability; research results cannot silently enter A's defaults.
Both releases have implementation, qualification, review and deployment stages.
An unsuccessful B experiment ends with retained evidence and disabled admission,
not a forced pass or indefinite retry loop. A can reach GitHub prerelease independently;
production still obeys the existing four release gates.

## Selected architecture

Reuse the existing capture harness, `MusicReviewReport`, raw acoustic receipts,
source comparison, repair preview and Anti evidence-v1 interfaces. Add a dedicated
Player-input receipt instead of disguising Float32 input as a PCM16 listening clip
or as independent source transcription. Add one orchestration CLI that invokes
explicit local analyzers and assembles the existing report; reporting alone stays
free of inference and upload. There is no new public inference API, production
background worker or catalog-rebuild requirement.

The full-range reference bank is opt-in, locally generated from explicitly
permitted pinned assets. Code can ship; private WAVs, reference/cache assets,
model weights and evaluator keys cannot enter GitHub artifacts or default images.
The existing renderer is not replaced, normalized or retuned.

Anti adds an optional compact profile to its existing `review-music` command:
one supplied clip, one evidence claim and at most one advisory finding. Default
review behavior and all unrelated routes remain unchanged. Keyspilli prepares
individual packets; Anti does not gain a hidden multi-call batch/retry loop.

## New contracts

`PlayerSignalPinV1` is `{path, sha256, encoding, sampleRate, channels, frames}`.
`encoding` is `pcm-f32le` for stereo input and mono forward control, and
`pcm-s16le` for mono audible output. Paths are absolute locally and absent from portable exports.

`PairedPlayerCaptureV1` contains `schemaVersion:1`,
`kind:'keyspilli-player-paired-capture'`, `id`, `input`, `output`, `forwardOutput`,
`firstSampleContextSeconds`, `renderer`, `compressor`, and `sampleAssetPins`.
`renderer` contains module version/digest and browser version; `compressor`
contains threshold/knee/ratio/attack/release. All three signals share rate/frame
count and the recorded frame origin. Receipt labels assert provenance; hashes
bind bytes but do not authenticate the acoustic domain against a dishonest label.

`PlayerInputEvidenceReceiptV1` contains `schemaVersion:1`,
`kind:'keyspilli-player-input-evidence'`, `captureSha256`, `inputSha256`,
`analyzerSha256`, `referenceBankSha256`, `fitInterval`,
`status:'matched'|'uncertain'|'unavailable'|'failed'`,
`historyPitchCandidates:number[]|null`, `rawResidual:number|null`,
`currentPitchSetEstimate:null`, `completeness:'unknown'`,
`audibility:'not-established'`, `resources:{elapsedSeconds,peakRssBytes}`,
and `limitations:string[]`. Candidate velocities/releases are fit alternatives,
not measured physical velocities, note-offs or current key state.

`MusicReviewInput.clips[].playerInput` is an optional new channel. Existing v1
acoustic and renderer receipts remain valid. Player findings are renderer-informed
estimates, never independent-acoustic truth. An unsupported expected pitch is an
uncertain inspection item, never an established missing note or automatic repair.

`CompactReviewJobV1` contains `id`, `clipId`, `claimId`, `audioSha256`,
`evidenceSha256`, `objectiveSha256`, `packetPaths`, `status`, `resultSha256|null`.
Statuses are `prepared|completed|partial|failed|not-run`; no status means musical
approval. Identity includes exact route/model, helper/schema/config digests and
output/deadline/attempt bounds when dispatched. Altered inputs cannot resume.

## Global constraints

- Native Node 22.22.3; optional Player analyzer Python 3.11 with existing verified NumPy 1.26.4/SciPy 1.13.1 pins. Anti supports Python >=3.10.
- Require at least 30 GiB free on the Mac before long builds/tests; never build source on the VPS. Recheck GitHub runner and VPS pull/canary headroom separately.
- Paired capture: at most four seconds and 2 MiB per signal, exactly one compressor input; preserve Float32 values above unity.
- Player profile v1: 44,100 Hz stereo input, first 1.2 seconds, MIDI 21–108, five reference velocities 32/56/76/92/112; 440 references, 1,760 coarse atoms, 16-atom dictionary batches.
- Preserve the frozen search settings: eight events, 5% raw residual, -50 dBFS level floor, minimum amplitude 0.05, positive weaker activations withhold, minimum history 128 ms. Configuration changes create a new fingerprint and new qualification study.
- Dictionary/bank generation cap: 4 GiB combined output, measured fit RSS <=2 GiB, local analyzer process timeout 120 seconds. Construction refuses stale or partial cache; no implicit download.
- Anti existing limits: at most two PCM16 WAVs, 2 MiB each, 30 seconds each; one backend attempt, 90 seconds, default 2,048 output tokens, explicit maximum 4,096; no retry/fallback/rotation/source pre-reading.
- Compact profile additionally requires exactly one clip and one claim; at most one finding, <=500 characters each for description/uncertainty, <=4 limitations of <=240 characters. Model output remains advisory and acceptance not-established.
- Repair previews retain the existing limit of eight explicit edits in one phrase, source/evidence identities, unchanged neighbors and no catalog mutation.
- Provider dispatches and new uploads are zero during AFK implementation. Only explicitly reviewed final-stage experiments may use a separately approved total cap; no account-wide quota changes.
- Preserve stopped provider studies, private corpus keys, human observations, historical musical receipts and primary WIP. New studies/outputs use exclusive new directories.
- Do not contact another person, obtain paid assets, use another provider, sign, adopt installed helpers, merge, publish or deploy merely because implementation tests pass.

## Admission and non-goals

Software compatibility, acoustic qualification, musical approval and live runtime
health are separate receipts. The report must expose absent/failed channels.
Empty Gemini findings, a low residual, complete JSON or a clean GitHub PR is not
an acceptance receipt. Quiet-note completeness, acoustic absence, current key
state and full event timing remain unknown until independently qualified.

Release A does not advertise autonomous transcription of arbitrary recordings,
direct-audio AMT, real-time coaching, pedal detection, automatic musical approval
or automatic missing-note corrections. Previously rejected Basic Pitch/Transkun,
magnitude/decay/history fits and compressed-output correction remain diagnostic.
Optional external-model preparations remain Keyspilli-owned and dormant.

## Release boundaries

Keyspilli main currently runs checks, pushes SHA-tagged web/worker images to GHCR,
then deploys through Ansible to `https://keys.reidar.tech`. Merge is a production
operation. Add candidate build/smoke artifacts before this boundary; production
uses `deploy_only`, preserves catalog/volume/owner data, and requires ADR 0004's
source, structural, musical and runtime gates. If musical evidence is unavailable,
retain a GitHub prerelease and do not promote to production.

Anti tags matching `pyproject.toml` trigger quality/platform tests, wheel/sdist
checks and PyPI publication. Keep its release independent of Keyspilli promotion.
Create a GitHub release manifest binding commit, artifacts, tests and provider
qualification status; upload no credentials, media or evaluator keys.

The Keyspilli plugin presently has a local canonical directory without its own
Git repository. Snapshot the reviewed plugin source under Keyspilli's tracked
`plugins/keyspilli/` for reproducible release packaging. Explicit adoption updates
the local canonical/installed source only after comparing hashes and preserving
the prior package. Presence of a cache is not proof that a running chat selected it.

Rollback pins the pre-release web and worker digests, compose configuration,
catalog/owner backup and previous Anti/plugin artifacts. PyPI artifacts are
immutable: restore the last good installed wheel; fix a bad published release
with a new version, never overwrite a published version or rebuild old tags.

## User decisions reserved for the final packet

Exact candidate(s) to promote; any new bounded Gemini upload experiment and its
account/model/call cap; installed Anti/plugin adoption and signing; any new
musical/source/keyboard observations required by the release gates. Existing
listening input is retained and is not assigned back to the owner as a repeated
task. Qualified keyboard review cannot be delegated to a beginner or fabricated.

## Design review

Alternatives considered: keep extending blind Gemini prompts (failed controls),
make a universal compressor inverse the release prerequisite (failed quiet
controls), or deliver scoped local evidence with compact optional explanation.
Select the third, and isolate broader transcription research behind its own gate.
Reuse current comparison and preview contracts rather than build a second pipeline.

The accompanying plan defines the task interfaces, regression names, qualification
studies, PR ordering, CI additions, approval packet, promotion, runtime readback
and rollback. No product implementation is performed in this planning turn.
