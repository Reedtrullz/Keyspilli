---
name: keyspilli-song
description: Use when preparing, reviewing, improving or publishing Keyspilli songs from names, YouTube links, supplied scores/media or existing catalog requests.
---

# Keyspilli Song

Deliver a recognizable piano Original and backing-only Chords with playable previews and verified local import. The agent owns source review, repairs and verification. Source search, valid JSON, rendering and audio token accounting alone cannot establish musical acceptance.

## Defaults

Original preserves the chosen performance's melody, form, meaningful bass, rests, pickup, tempo/meter changes and ending in a playable piano reduction. It is an app mode, not an authenticated artist score. Chords leaves room for singing: useful bass/voicings, no copied vocal line or decorative runs. Melody plus accompaniment needs an explicit request. Honor the supplied URL/performance; record alternate sources and timing differences. Resolve a clear song name without routine preference questions.

Prepare locally. Publication uses actual authorization for the identified versions; follow [approval and publication](references/approval-and-publication.md). Ready songs offer **Approve and add to Keyspilli** after previews. Provisional songs state the agent's remaining gates. Neither positive feedback nor a script pass silently grants publication or independent pianist approval. Do not assign Reidar another listening pass.

## Workflow

For correctness diagnosis, prefer the [automatic score review workflow](references/score-review-workflow.md)
when `score_review.status: compatible`. Its offline command computes located
conformance/structural findings without Anti, listening forms or a pianist. Unknown
authority and optional provider interpretation remain separate evidence limits.

1. **Preflight.** Read checkout instructions and preserve WIP. From this loaded skill's directory run `python3 scripts/check_checkout.py CHECKOUT --node /absolute/compatible/node --discover`. It prefers the requested capable checkout or selects one verified candidate from its existing Git worktrees; zero/ambiguous candidates gives actionable paths. Use the returned `checkout` as cwd and absolute `node_executable` as `KEYSPILLI_NODE`. Every TypeScript command uses `"$KEYSPILLI_NODE" --import tsx`; PATH/shebang may select the wrong SQLite ABI. Stop long runs below 30 GiB unless the specific run is authorized. Never read credential files. Read [implementation map](references/keyspilli-workflow.md).
2. **Source.** Make a private `output/song-prep/SONG-RUN` directory. Acquire actual authorized score/MIDI/media bytes through existing tools; verify identity, performance, duration and hashes. A title match is insufficient. For Ultimate Guitar, read [authorized score intake and manual fallback](references/ultimate-guitar.md): Official downloads are unavailable; landing pages are not score evidence, and tab sounding pitch needs per-track tuning/capo and octave verification. Scan tutorial tempo/meter across the whole piece. Preserve native seconds and write a source-linked phrase map with separate recording/symbolic/output clocks. Unknown roles/harmony stay unknown; track/hand/highest pitch does not prove melody. Retaining a prior transcription's events does not establish complete or correct source melody. For sung melody, follow [vocal recovery and instrumental fallback](references/vocal-recovery.md) before piano arrangement.
3. **Host preparation.** With `host_workflow.status: compatible`, use [the resumable driver](references/evaluation-and-repair.md#resumable-host-preparation). Pin actual MIDI/instructions and the sampled acoustic bank; start `baseline` without a model. Prefer `selection` for bounded backing choices when source harmony is checked; use `plan` for source-supported edits outside those options. Submit only the emitted bounded decision packets and their exact pending IDs; the host handles source binding, compile, six tiers, second import, audit and both previews. One response plus two repairs per phrase. Confirmed silent phrases need no model; unknown harmony stays unresolved. Text-only models receive symbolic facts, never binary media.
4. **Audit delivery.** Run the driver's `verify`; inspect actual final protected pitch/attack/release, checked Chords replay and retained receipts. If host capabilities are absent/incompatible, run preflight without `--discover` on an explicitly capable ordinary checkout and follow [maintained commands](references/evaluation-and-repair.md) plus [bounded phrase recipe](references/constrained-arrangement.md). Exercise Player timing, notation, practice/wait, transpose, loops and final release. Keep failures and source-specific limitations.
5. **Render and review.** Render delivered modes with the sampled acoustic piano, verify raw clipping, decode, duration/non-silence and hashes. Apply [musical gate](references/musical-quality-gate.md). Before interpreting saved model claims or inferring a repair from timing evidence, optionally run the selected checkout's `docs/ops/local-audio-evidence.md` command against already pinned captured clips. It recomputes PCM measures and can compare them with authored render events and a saved single-clip Anti observation; it makes no provider request or upload. Keep authored note intent, measured energy-onset estimates and model claims separate. Acoustic pitch remains unavailable, missing evidence stays unknown, and saved Anti interpretation is advisory rather than independent hearing. The report does not propose repairs or establish musical acceptance. Optional pairwise listening uses the [Anti triage adapter](references/audio-listening-review.md): explicit endpoint/model, manifest v2 and bounded single-attempt jobs. Its [local captured-byte preflight](references/audio-listening-review.md#local-captured-byte-waveform-preflight) measures PCM level, exact/near silence, clipping, bounded energy onsets and low-level spans; silence and onsets are measurements, not automatic musical defects or rest judgments. Missing/corrupt/all-digital-zero clips stop locally as not-reviewed render input before route lookup or provider dispatch. The legacy review profile remains the default. `--review-profile evidence-v2` opts into a separate evidence schema and neutral prompt; its validated result and provider self-report still do not prove audio grounding or hearing. Resume only with the matching profile/schema, measured-byte receipt, inputs, route and request cap. A failed mandatory no-audio gate stops that frozen study immediately: make no remaining calls, retries, paired-comparison claim or default-prompt change. It remains unqualified triage; partial coverage, empty findings or absent independent musical/keyboard evidence cannot establish acceptance. Keep evidence and rejected candidates.
6. **Package and surface.** Use the [delivery and playback requirements](references/evaluation-and-repair.md#deliver-a-usable-package): Original/Chords MIDI/MusicXML, hashes/provenance, source inputs, tested import command, per-mode status and two playable previews. Lead a single-song response with labeled absolute-path audio embeds. Surface a verified playback index for batches. Keep useful partial packages when a real gate is blocked. Publishing approved files uses the existing private target contract and live readback.

## Existing catalog and comparisons

For Chords-only requests preserve Original and accepted backing. Freeze grouped visible base IDs; six rows are one song. Reconcile accepted/prepared/unresolved/unavailable entries in a resumable ledger using the implementation map's batch procedure; no silent skips.

For model comparisons freeze source/code/plugin/prompt hashes and exact route/effort. Exclude other trials' outputs; verify actual rollout and final delivered files. Unsupported effort is a named block in controlled comparisons, not silent substitution. Unknown cost is unknown; model strength and valid artifacts do not imply musical success.

Use [bounded calibration](references/dataset-calibration.md) only when improving reasoning/reviewer selection; synthetic examples are not source truth or aesthetic gold. Three authored [JSON examples](references/constrained-arrangement.md#compact-teaching-cards) demonstrate symbolic transformations with explicit unapproved status. No universal guarantee for arbitrary models, sources or styles.

## Local music review and optional models

Use [music review support](references/music-review-workflow.md) for raw acoustic
receipts, controlled Player capture, model benchmarks, source/learner comparison,
local listening packs and bounded repair previews. These host commands work with
Anti and optional models absent. Keep non-Google music capabilities here; Anti's
optional `review-music` bridge supplies only the connected Gemini advisory route.
Read-only preflight exposes `music_review`; compatible means software contract,
not model availability, provider hearing or musical acceptance.
