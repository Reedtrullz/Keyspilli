# Constrained phrase arrangement

Use this optional path for source-supported musical edits. An already suitable symbolic source can go straight to the maintained preparation pipeline. The agent still owns source review, complete packaging and musical verification.

## Compact teaching cards

Newly authored symbolic exercises, not artist recordings, gold arrangements or pianist approval. Select one or two relevant examples; total examples <=12 KiB and packet/examples <=32 KiB, <=512 visible source events. Minified JSON preserves the exact context/decision hashes. Existing context/plan compiler can check/apply each transform; native media remain in the retained private teaching evidence, not this plugin.

| Example | Transfer |
| --- | --- |
| [voice separation](../examples/voice-separation.json) | Protect melody, edit only corroborated accompaniment |
| [rests and pickup](../examples/rests-and-pickup.json) | Preserve silence/offbeat entrances; uncertainty is not N.C. |
| [inversion and bass](../examples/inversion-and-bass.json) | Source-supported slash bass and compact voicing |

All three are `symbolic-only; unapproved for musical evaluation`. Never copy a progression into the requested song or use reserved evaluation answers as cards.

## Readiness

Cards and valid JSON do not certify pleasant music. Newly composed/changed passages require actual aligned audio review under the existing gate. Symbolic review can establish finite notes, source preservation and import compatibility while musical status remains provisional.

## Run the bounded edit loop

This first version consumes verified native MIDI, and `--harmonization` requires the compiled constant-clock MIDI with a matching duration/hash. Other source formats use the maintained intake/conversion path; do not claim this MIDI-only step ran on arbitrary audio or MusicXML. Run from the selected checkout with its Node runtime and dependencies. Set `KEYSPILLI_NODE` to the absolute `node_executable` returned by a passing preflight, and keep it for this run. If PATH selects an incompatible native-addon ABI, retry preflight with `--node /absolute/path/to/compatible/node` after verifying the checkout runtime; changing Node without rechecking is not a pass. If its files are absent, inspect `git worktree list --porcelain` and preflight an existing capable checkout; do not assume an unmerged feature lives in the default checkout. Use fresh child directories inside the private run; all apply/preparation destinations must be new.

1. Make an evidence file tied to the actual MIDI SHA256. Use `schemaVersion:2`. Verified references contain `id`, `location`, `status`, `artifactSha256`, `region:{unit:"beats"|"seconds",start,end}`, and `verificationReceiptSha256`. Provide a separate host-owned asset registry `[{id,artifactPath,receiptPath}]`; paths resolve relative to that file. Receipts bind actual source/artifact hashes, passage bounds, method (`score`, `tutorial`, `human-review`, `synthetic-author`) and explicit `{sourceNoteId,role}` corroboration. Read actual reference bytes; a model cannot invent verified status or supply the host registry. Roles contain `sourceNoteId`, `role` (`melody`, `accompaniment`, `unknown`) and `evidenceIds`. Spans contain `id`, `startBeat`, `endBeat`, `evidenceIds` in the native source beat clock. Verify roles separately from track/hand/color; omit unknown roles. Verify phrase bounds from the source. Preserve all evidence and source bytes.
2. Before model calls, prepare the **unchanged** source in a new source-preflight directory with the maintained `prepare-song.mts` command (without an override). If its six-level ingest fails, retain the evidence and select a compatible source/workflow; do not ask the model to delete protected ornaments or weaken learner gates. Build context: `"$KEYSPILLI_NODE" --import tsx apps/web/scripts/arrange-song.mts context SOURCE.mid EVIDENCE.json NEW_CONTEXT_DIR --reference-assets ASSETS.json`. Copy the actual source hash into evidence; the command rejects a mismatch. Context owns exact parser identities, normalized playback beats and native source seconds. MIDI IDs follow parser note-off order, not sorted onsets; inspect the pinned packet. Give the model only `phrase-ID.json` and the one/two relevant cards. Target 4-8 trustworthy bars or source-linked 15-30-second phrases. Above 512 visible events or 32 KiB, split source-supported spans and rebuild; never truncate.
3. Audit the source-preflight Advanced artifact with `"$KEYSPILLI_NODE" --import tsx apps/web/scripts/arrange-song.mts audit CONTEXT.json SOURCE_PREFLIGHT/bundle/artifacts/a/variant.mid` before asking for edits. Triplets and variable-tempo timing can change during learner import even when the notes/counts survive. A failing audit leaves the source review-required; stop this constrained edit path for that incompatible source. An unsupported audit command is a capability blocker. Use a supported source/workflow rather than claiming preservation. Ask for one phrase response in the format below. Preserve neighboring/sustaining events visible in the packet. An attack belongs to `[startBeat,endBeat)` of its owner span; another span cannot change it. Plans use absolute **normalized playback beats**, not seconds or native score beats.
4. Check: `"$KEYSPILLI_NODE" --import tsx apps/web/scripts/arrange-song.mts check CONTEXT.json PLAN.json`. Supply the concrete `code`, `jsonPath`, `spanId`, message and unchanged source packet on a failure. Allow one initial attempt plus **two repairs maximum per span**. Stop an unchanged failure, new evidence regression or unsupported inference. Keep rejected plans/findings. Do not fabricate evidence IDs, source origins or self-confidence scores.
5. Merge all plan paths in `PLAN_FILES.json` (paths relative to that file), then `"$KEYSPILLI_NODE" --import tsx apps/web/scripts/arrange-song.mts apply CONTEXT.json PLAN_FILES.json NEW_CANDIDATE_DIR`. Missing spans preserve Original; missing harmony stays explicitly unresolved and silent in a new candidate, not a claim of genuine N.C. Preserve any accepted existing backing instead of replacing it. Overlaps/conflicts/stale context reject before writes.
6. Prepare both modes: `"$KEYSPILLI_NODE" --import tsx apps/web/scripts/prepare-song.mts NEW_CANDIDATE_DIR/candidate.mid NEW_PREPARATION_DIR TITLE ARTIST --harmonization NEW_CANDIDATE_DIR/harmonization.json`. The override is tied to exact compiled input bytes. Use the maintained render/package/delivery commands afterward. Recheck all six tiers, rests, adjacent entrances, tempo/meter transitions, final release and melody leakage against source evidence. Then run `"$KEYSPILLI_NODE" --import tsx apps/web/scripts/arrange-song.mts audit CONTEXT.json NEW_PREPARATION_DIR/bundle/artifacts/a/variant.mid` and retain the JSON receipt and exit status. Repeat against the MIDI in the second installed catalog and any final exported alias; bind receipts to the delivered hash. Exit 1 means protected events are missing/altered: preserve the partial and keep it review-required. A compiled round trip or origin/count check cannot substitute for this final native-time audit. Use existing arrangement/harmony evaluation and Chords diagnosis for local defect intervals, not an aggregate musical score. The existing evaluator's sequential hand-span warning is not a simultaneous stretch test or keyboard acceptance.

After preparation, compare the actual `playback.json` snapshot and exported `chords.mid` with the checked harmonization: absolute pitches (including inversion), strike entrances, positive spacing and final releases must survive. Repeat the maintained bundle verification in the second empty catalog. A matching chord name or pitch class alone cannot prove that the requested voicing was delivered. Explicit checked overrides remain inferred and use `arrangement-voicing`; older preparation code may silently revoice them as learner harmony. If readback differs, preserve that package as review-required and use the capable checkout rather than accepting the substitution. Record this harmony replay check separately from Original source protection.

The source-to-compiled sidecar records edits and reparsed origin relationships. Identical simultaneous events may make lineage unverified; do not guess their assignment. The tutorial delivery check, when applicable, receives the **compiled MIDI actually ingested**. Its retention percentage is not the unedited acquisition source's retention. The delivery audit separately compares the acquisition context's protected events in native seconds, with event multiplicity and at most one 960-PPQ tick of encoding error. It is timing/pitch coverage, not uniquely recovered lineage or musical approval.

### Evidence shape

```json
{
  "schemaVersion": 2,
  "sourceSha256": "ACTUAL_64_HEX_DIGEST",
  "references": [{"id":"score","location":"actual score, bars 1-4","status":"verified","artifactSha256":"ACTUAL_REFERENCE_HASH","region":{"unit":"beats","start":0,"end":16},"verificationReceiptSha256":"ACTUAL_RECEIPT_HASH"}],
  "roles": [{"sourceNoteId":"ACTUAL_PARSER_ID","role":"melody","evidenceIds":["score"]}],
  "spans": [{"id":"opening","startBeat":0,"endBeat":16,"evidenceIds":["score"]}]
}
```

### Response shape

```json
{
  "schemaVersion": 2,
  "contextSha256": "COPY_PINNED_CONTEXT_DIGEST",
  "spans": [{
    "id": "opening",
    "originalEdits": [],
    "originalAdditions": [],
    "chords": [],
    "evidenceIds": ["score"],
    "rationale": "Preserve source melody; harmony still requires review.",
    "unresolved": ["Source-aligned harmony is unavailable."]
  }]
}
```

An edit is `{"sourceNoteId":"ACTUAL_ID","action":"update","changes":{"vel":80},"evidenceIds":["score"]}`. Remove uses `action:"remove"` without `changes`. Only separately verified accompaniment may lose/change pitch or timing; melody/unknown pitch, attack and duration are protected. Hand/velocity changes also need verified cited evidence. Addition is `{"note":{"midi":48,"start":0,"dur":1,"vel":75,"hand":"L"},"sourceKind":"generated","evidenceIds":["score"]}`; its identity is generated, never a source origin. Notes require finite starts, positive durations, integer piano pitches 21-108 and velocities 1-127.

A harmonic decision is `{"beat":0,"name":"C/E","notes":[40,48,55],"durationBeats":4,"strikeSpacingBeats":4,"maxStrikeDurationBeats":0.5,"sourceKind":"inferred","evidenceIds":["score"]}`. Supported chord names/voicings use the existing parser. Error messages identify the chord index/symbol and missing/extra pitch classes; correct against source evidence, not by guessing. For one attack, set positive `strikeSpacingBeats` equal to the harmonic span, never zero. Omit it only when accepting the maintained re-strike defaults. `maxStrikeDurationBeats` must also be positive. In model decisions, silent `name:"N.C."` must use `sourceKind:"unknown"`, `notes:[]` and its explicit span; compilation always reports this as unresolved. Independently authored genuine no-chord rests belong to the existing trusted chart path, not model authority. Citations justify decisions but do not turn an agent-arranged voicing into artist-authored truth. Chart inputs retain their documented grid; checked MIDI-derived timelines preserve precise attacks/releases and may merge repeated inferred labels: check validates the combined timeline including unknown gaps, allowing only the compiler's one MIDI tick (1/960 beat) of encoding rounding. Merge adjacent identical harmonic spans and specify repeated attacks with strike spacing/release; otherwise use the maintained workflow, never silently resample rubato. Missing harmony is not recovered automatically.

### Legal choices for smaller models

When `selection_supported` is true and a host-pinned reference corpus has source-confirmed harmony, use:

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/arrange-song.mts choices CONTEXT.json REFERENCES.json NEW_CHOICES --case CASE_ID --span SPAN_ID
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/arrange-song.mts select CONTEXT.json SELECTION.json NEW_PLAN --choices NEW_CHOICES/choices.json
```

Give only `packet.json` and relevant cards to the model. Selection schema is `{schemaVersion:1,contextSha256,spanId,choicesSha256,choiceId,rationale,unresolved}` copied from the packet; it cannot edit source notes. The finite set uses source/compact voicings and sparse/repeated strikes, preserving slash bass and rest boundaries. Unknown harmony blocks options; use the unchanged source or a structurally checked **host-generated** baseline only with explicit provenance and provisional taste status. Never report fallback as model composition. `NEW_PLAN/plan.json` feeds existing check/apply/preparation/audits. Free edits remain optional for a supported model and corroborated source roles; both paths enforce the same final gates.

### Delegated decision calls

When delegation is already authorized, send the source packet, relevant cards and response shape inline. Request JSON only and forbid tool calls, repository searches and other trials' results. The acting parent runs check, supplies its localized findings with unchanged source facts for at most two repairs, then compiles, prepares, imports and renders. Retain every response and check result. A JSON answer or model self-confidence never establishes source correctness or musical acceptance.

## Controlled comparisons

Freeze source families, code/plugin/card/prompt hashes and exact route/effort before the first trial. A uses current workflow, B adds cards, C adds this edit path. All arms get the same source facts/windows; exclude other runs' outputs. Audit actual tool calls: a decision-only trial that reads tools or an A/B trial that reads C's implementation is excluded from the controlled comparison. Preserve its usage and failure instead of counting it as a successful control. After using a case to repair the protocol, test a fresh composition family. Keep failures, missing outputs, usage/pricing gaps and workflow drift visible. Unknown money/audio/lineage is not zero cost or a pass. Use the same sampled acoustic piano bank/gain for clips and verify actual aligned audio consumption before a listening claim. Until paired source-confirmed defects/listening and complete imports support promotion, this workflow remains optional.

## Supported engineering scope (30 September 2026)

Explicit source preparation preserves native attacks and releases, including Advanced ornaments, and validates the resulting package. IOI floors apply per hand; total attack density and sounding limits still apply. A genuinely too-fast hand remains blocked; do not slow the source or delete protected ornaments to manufacture a pass. Source lower tiers require separately reviewed reduction/identity policies. MIDI and MusicXML serialize rounded absolute endpoints; audit actual final events rather than counts alone.

The earlier Max-only cohort and deadline-limited MiMo walkthrough remain historical. A separate frozen mixed-effort engineering study completed 18/18 verified candidates on three expanded authored exercises with Luna/Max and MiMo/High. Initial clean completion was A4/6 (facts), B5/6 (facts plus card), C6/6 (checked finite choices); three retained localized corrections completed the remaining cases. This supports offering finite choices for checked harmony, not a musical winner. The twelve reference cases and three examples still lack independent musical/keyboard qualification; actual bills and listening accuracy remain unknown. Preserve actual rollout hashes, first failures and completed-final-turn evidence.

Generated MusicXML now retains explicit pickup extent and the initial/changing meter timeline (the scalar meter retains the final declaration), basic complete triplet groups, flat-key spelling and cross-bar releases. The app's actual renderer is checked. MIDI-only input still supplies performed timing, not authenticated written tempo, enharmonic spelling, fingering or independent notation readability. Constant-clock playback equivalence must not be reported as recovered source notation.

Supported native MusicXML/MXL intake retains a separate `sourceNotation` clock: declared tempo positions, written bar boundaries/pickup and meter changes. Playback MIDI/notes stay on the constant practice clock; exported XML maps arranged attacks/releases back to written beats and scales declared tempi for explicit playback/calibration changes. Only explicitly printed tempo markings remain visible; playback-only/default tempi do not invent metronome marks. Retained pitches keep their explicit source spelling; changed or ambiguous merged pitches use generated spelling. Native/OMR canonical score adapters carry tempo timelines too. Notes provenance distinguishes the source clock from **arranged content**; generated tail bars are warned, not called source bars. Verify both clocks in the delivered bundle after import and tempo edits.

This is reconstruction on the supported source clock, not a source-score facsimile or notation approval. Repeats/navigation, conflicting tempo directives or display/playback offsets, non-quarter/dotted tempo units and fractional accidentals are explicitly unsupported by this intake. Missing fingering, pedal, engraving/voice intent and MIDI-only written information must not be invented. Keep independent reading, listening and keyboard gates open. The constrained edit compiler still starts from MIDI; it does not recover a MusicXML source clock lost during conversion.

Future controlled pilot prompts must contain exactly one host-written line `KEYSPILLI_TRIAL_V1 {"trial":["MODEL","EFFORT","SOURCE_SHA256","ARM",1,"CASE_ID"],"workflowSha256":"WORKFLOW_SHA256"}` with the actual manifest fields. The reporter verifies this user-message line in pinned rollout bytes, exact model/effort and completion; reuse of a session across trials disqualifies it. Older unbound rollouts remain historical, never upgraded by editing receipts. `knownCost:0` is an empty observed billing subtotal, not a known free song; `totalCost:null` remains the authoritative unknown total.
