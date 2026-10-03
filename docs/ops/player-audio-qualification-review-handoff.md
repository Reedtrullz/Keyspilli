# Player audio qualification review handoff

## Source pins and CI evidence

The capture source was the isolated worktree at `6318906565d782879391a3e8b4baffbe881116d5`, with the Player sample-readiness fix from `46e7b666799de4f7b18ba714ea12d44549b7ad29` in its ancestry. The generated fixture bundle pins the Player source-file tree hashes; each capture receipt pins both commit IDs, sample responses, and PCM output.

The 40-clip Playwright capture passed locally on this worktree after validating the sorted fixture handoff, sampled-piano readiness, Original/Chords mode, one-to-one bus-specific source onsets, PCM signal, and hashes. This is local E2E evidence for the generated capture harness.

GitHub has no Actions run for local source commit `6318906565d782879391a3e8b4baffbe881116d5`. The nearest completed CI / Deploy run is [run 37126245753](https://github.com/Reedtrullz/Keyspilli/actions/runs/37126245753), on commit `46e7b666799de4f7b18ba714ea12d44549b7ad29`. Its Automatic checks, production build, and deploy jobs succeeded. That run does not prove CI for the local corpus harness or the later capture-source additions. An exact-head CI claim requires a reviewable commit/PR and a run on its precise SHA.

## User-test preview

The preview manifest is `output/song-prep/player-qualification-20261003/model-facing/cases.json`; its WAVs are in the adjacent `media/` directory and the final PCM receipts are indexed at `capture-receipts/index.json`. It contains 24 pairwise tasks: eight clean comparisons, eight known faults, and eight controls. The mandatory controls are MISSING AUDIO, PIANO versus SILENCE, UNRELATED SPEECH, and SWAPPED ORDER. The source labels, answer key, mutation windows, and resolver event audits remain under `evaluator-only/`.

This is a human-reviewable synthetic pilot preview, not a result or approval. For convenient offline playback of all pairs, open the [user playback package](/Users/reidar/Projectos/anti-keyspilli-player-study-20261003/README.md); its local browser preview plays actual Player captures and makes no model calls. The package includes the construction key, and its page can reveal it, so the preview is not blind.

The frozen provider study stopped at its first mandatory no-audio control. The single response claimed melody, harmony, rhythm, articulation, and timbre matches despite zero audio attachments; the native grade rejected those claims. No later task was sent, no paired-comparison claim is supported, and the route remains unqualified. The default prompt is unchanged. See the [study-stop receipts](player-audio-qualification-study-stop.md). The saved browser receipt covers successful Original q09 and Chords q13 playback on both sides, with no media errors. Offline listening does not change the provider gate result or establish musical approval.
