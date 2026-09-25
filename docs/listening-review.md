# Listening review

This log records human listening separately from structural and runtime checks.

## 2026-09-23 — The Winner Takes It All, Advanced-derived Chords pilot

- Candidate: `codex/chords-winner-pilot` at `ba86f544a105aeca8f08a4854a27248a7dd8db06`, exact-source `reviewedSourceBacking()`; source MusicXML SHA-256 `54fdc6dfba535308b19583a24ca6cb284813bb2ae84e42abe4cac8b062a57eb2`, Advanced notes SHA-256 `9d9ae9b17b3bd10ebc973d549b12d1102606e66a9342a4702d449e7f73afd664`.
- Listening artifact: local gitignored `output/chords-winner-pilot/verified-product-full-experimental.mp3`, SHA-256 `3f42becad88740af0396ceb0f48b7fbab1e5e0bc5d262c319e929f04d345df78`, 290.716 seconds. Its MIDI uses the same product helper as the branch. Three earlier clip windows match the candidate MIDI byte-for-byte.
- Listener: the user sang along with the full-song candidate and answered **“Yes, it works”** when asked if it functions as recognizable piano backing. Earlier, the user preferred the Advanced-derived accompaniment to the generated Chords track and accepted the revised final refrain as recognizable with bar endings restored.
- Scope of acceptance: this candidate for this song as a sing-along backing. The user previously could not tell whether the revised final refrain fully omitted the sung line; that remains unconfirmed. No real-keyboard fingering, hand independence, note-release, or sustained practice session was tested. Blackbird, Oops, Queen, and a representative 10-song sample remain unreviewed for this candidate.
- Evidence and reconstruction details: local `output/chords-winner-pilot/README.md`; the audio and source files stay out of Git.

### Beginner practice correction — 23 September

The user clarified that they do not know how to play piano and cannot provide a physical-piano test. The app is meant to teach them, so keyboard ergonomics must be assessed by an independent player or teacher rather than assigned to the learner. Their sing-along acceptance of Winner remains valid within its stated scope.

In the updated local Winner pilot, Chords practice opens on the current four bars in Wait mode using computer or on-screen keys; a selected loop is used when present. At bar 16, a scripted computer-key run of the right-hand four-bar passage completed 13 notes and produced a 100% grading result. This verifies note guidance, input routing and the four-bar stop in that fixture. It does not show that a novice can find the keys unaided, that both hands are comfortable, or that the backing is playable on a physical piano. The original 10-song musical gate and unresolved final-refrain vocal-role question remain open.

## 2026-09-25 — Working Chords golden corpus

The owner accepted these **Advanced-derived Chords backing** candidates as useful references at their current quality level. The machine-readable index is [`catalog/chord-golden-corpus.json`](../catalog/chord-golden-corpus.json); it pins each local preview's production Advanced notes hash, authored timeline hash, and source-map ID. The source artifacts remain outside Git. This is a calibration set for future chordification work, with further musical polish welcome, not a claim that the mode's ten-song release gate passed.

| Song | Owner listening decision | Known follow-up |
| --- | --- | --- |
| Skyfall — Adele | Happy keeping this Chords preview at its current level. | Further voicing/rhythm polish can wait; full matched listening and keyboard review remain open. |
| My Way — Frank Sinatra | After the repeated-strike fix near 0:36, sounds pretty good and is fine for the corpus. | The final coda has no specific listening verdict; further polish can wait. |
| Kings & Queens — Pianella Piano's Ava Max cover | After rhythm revisions, “starting to get somewhere”; explicitly add to the golden corpus and polish later. | Review remaining rhythmic rough spots later; the explicit N.C. opening/tail still triggers the structural dead-air diagnostic. |
| Imagine — John Lennon | After the higher-resolution lead-ins and attack changes, the owner said “Good work on both!” and explicitly added Imagine to the corpus. | Further polish and a matched full-song/keyboard review remain open. |
| Let It Be — The Beatles | After the short chord ladders and repeated-attack changes, the owner said “Good work on both!” and explicitly added Let It Be to the corpus. | The 70% one-beat-or-shorter event share still triggers the structural density diagnostic; revisit feel during later polish. |
| Clocks — Coldplay | The first preview missed the already-played chord stacks. After the source-stack correction, the owner said “Clocks sound much better now!” and explicitly asked to add it to the corpus. | Full-song listening, especially the middle and right-hand-only ending, and keyboard review remain open. |

All six decisions concern the local draft-PR previews, not a deployed player. The Kings & Queens decision applies to the version with the revised 1:19–1:26 attacks; Imagine and Let It Be apply to the higher-resolution charts at `94cced0f`; Clocks applies to the source-stack and chord-display revision at `c3705af8`. These owner judgments do not replace independent pianist/teacher assessment, beginner practice observation, or the separate release gates in [ADR 0004](decisions/0004-release-gates.md). The earlier `catalog/learner-review.json` verdict for the **original** Kings & Queens arrangement remains separate from this Chords backing review.

The six-song evidence and proposed next improvements are in the [golden-corpus review](research/keyspilli-evidence/chords-golden-corpus-review-2026-09-25.md).
