---
name: keyspilli-song
description: Use when preparing, reviewing, improving or publishing Keyspilli songs from names, YouTube links, supplied scores/media or existing catalog requests.
---

# Keyspilli Song

Prepare a recognizable piano Original and backing-only Chords, with verified
local import and playable previews. Original means the chosen performance's
piano reduction; Chords leaves room for singing. Honor the requested version.
Preserve accepted Original/backing when improving an existing catalog entry.

## Default workflow

1. **Select a supported Git checkout.** Read its instructions and preserve WIP. From
   this skill directory run `python3 scripts/check_checkout.py CHECKOUT --node
   /absolute/compatible/node --discover`. Require `preparation.status: compatible`.
   Use its returned checkout, absolute `node_executable` and ordinary
   `preparation.command`. Missing experimental drivers or optional reviewers do
   not block that route. For a planned large job, pass an estimated
   `--minimum-free-gib`; read-only preflight alone does not budget a render batch.
2. **Qualify actual source bytes.** Verify identity, performance, hashes and
   source clocks. Names/URLs are leads, not musical evidence. Follow the
   [source and delivery contracts](references/source-and-delivery-contracts.md).
   Keep unknown roles, harmony and authority unresolved. Use the
   [implementation map](references/keyspilli-workflow.md) for acquisition.
3. **Prepare ordinarily.** Follow [intake and preparation](references/evaluation-and-repair.md#intake-and-preparation):
   `prepare-song.mts INPUT NEW_RUN_DIR TITLE ARTIST`, invoked with the returned
   Node and `--import tsx`. Use a fresh local run and isolated catalogs. Inspect
   all six variants, the second import and actual resolved Original/Chords
   events. The command returns provisional artifacts, not musical approval.
4. **Diagnose and correct.** When `score_review.status: compatible`, use the
   [offline score review](references/score-review-workflow.md). Repair only an
   exact authorized event with unchanged evidence pins. Preserve protected
   neighbors and retain failed candidates. Stop an unsupported repair method;
   obtain missing evidence or keep the result provisional.
5. **Render and verify delivery.** Follow [delivery requirements](references/evaluation-and-repair.md#deliver-a-usable-package)
   and the [musical gate](references/musical-quality-gate.md). Verify actual
   exports, hands, timing, full-duration sampled-piano previews and hashes.
   Surface two labeled players for a song, or a verified playback index for a
   batch. State each mode's readiness and exact remaining blockers. Do not
   assign the owner another listening pass or invent independent approval.
6. **Apply existing authorization.** Follow [approval and publication](references/approval-and-publication.md).
   Bind approval to the identified versions. Preparation, a test pass, favorable
   feedback or advisory model output does not grant publication authorization.

## Load only the needed procedure

| Task | Reference |
| --- | --- |
| Optional bounded driver/arranger, only when compatible | [Experimental workflow](references/experimental-host-workflow.md), [phrase recipe](references/constrained-arrangement.md) |
| Score/tab or vocal acquisition | [Authorized score intake](references/ultimate-guitar.md), [vocal recovery](references/vocal-recovery.md) |
| Optional captured audio or model triage | [Music review](references/music-review-workflow.md), [audio review](references/audio-listening-review.md) |
| Later controlled model comparison | [Evaluation protocol](references/workflow-evaluation.md), [bounded calibration](references/dataset-calibration.md) |

Optional model results remain advisory; absent providers never become invented
capabilities. Host checks establish their declared software scope. Source truth,
audible quality and independent musical acceptance require their own evidence.
