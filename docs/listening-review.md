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

The owner accepted these **Advanced-derived Chords backing** candidates as useful references at their current quality level. The machine-readable index is [`catalog/chord-golden-corpus.json`](../catalog/chord-golden-corpus.json); it pins each local preview's production Advanced notes hash, authored timeline hash, source-map ID, and accepted realized backing digest. The source artifacts remain outside Git. This is a calibration set for future chordification work, with further musical polish welcome, not a claim that the mode's ten-song release gate passed.

| Song | Owner listening decision | Known follow-up |
| --- | --- | --- |
| Skyfall — Adele | Happy keeping this Chords preview at its current level. | Further voicing/rhythm polish can wait; full matched listening and keyboard review remain open. |
| My Way — Frank Sinatra | After the repeated-strike fix near 0:36, sounds pretty good and is fine for the corpus. | The final coda has no specific listening verdict; further polish can wait. |
| Imagine — John Lennon | After the higher-resolution lead-ins and attack changes, the owner said “Good work on both!” and explicitly added Imagine to the corpus. | Further polish and a matched full-song/keyboard review remain open. |
| Let It Be — The Beatles | After the short chord ladders and repeated-attack changes, the owner added it to the corpus and now says the current local phrasing “really sounds great.” | The 70% one-beat-or-shorter event share still triggers the structural density diagnostic; keyboard review remains open. |
| Clocks — Coldplay | The first preview missed the already-played chord stacks. After the source-stack correction, the owner said “Clocks sound much better now!” and explicitly asked to add it to the corpus. | Full-song listening, especially the middle and right-hand-only ending, and keyboard review remain open. |

These five decisions concern the local draft-PR previews, not a deployed player. Imagine and Let It Be apply to the higher-resolution charts at `94cced0f`; Clocks applies to the source-stack and chord-display revision at `c3705af8`. These owner judgments do not replace independent pianist/teacher assessment, beginner practice observation, or the separate release gates in [ADR 0004](decisions/0004-release-gates.md).

**Kings & Queens is outside the golden corpus.** The owner had accepted an earlier working version, but after hearing the later 0:20/0:47 timing edits said it is somewhat better yet still imperfect and explicitly asked to keep it outside the corpus. Its authored Chords preview remains available for later polish. The earlier `catalog/learner-review.json` verdict concerns the original arrangement, separately from Chords backing.

The [next-ten Chords shortlist](research/keyspilli-evidence/chords-next-ten-2026-09-25.md) proposes other active repertoire songs for future work. It is a research queue, not a listening verdict.

The [earlier six-song review](research/keyspilli-evidence/chords-golden-corpus-review-2026-09-25.md) remains a historical analysis of the prior candidate set; its Kings & Queens inclusion has been superseded.

### Source-informed phrasing candidate — listening follow-up

The draft PR's shared Chords phrasing candidate skips some bass-arpeggio full-chord re-strikes, follows simultaneous harmonic attacks, and gives authored chords a short release when the source harmony ends before the next strike. At commit `1e6d1337`, the replay audit reported `DRIFT` against all six previously accepted backings. The local preview at `127.0.0.1:3102` runs this draft worktree. Comparison passages include My Way near 0:36, Kings & Queens at 1:19–1:26, Imagine's opening eight beats, Let It Be around beats 18–22, and Clocks' beat-64 repeated chords. Have You Ever Seen the Rain is an additional holdout because its sounded coverage drops below 80% with the shorter releases. The structural evaluation and exact counts are in the [review follow-up](research/keyspilli-evidence/chords-golden-corpus-review-2026-09-25.md#source-informed-phrasing-follow-up).

After listening to this local candidate, the owner said **“Clocks seems great now!”** and that **“Have you ever seen the rain too sounds better and more controlled.”** Clocks' `acceptedBackingSha256` pins the heard phrasing at `1e6d1337`, with its chart and source notes unchanged. The owner subsequently said **“Let it Be really sounds great now!”**, so its accepted digest now pins the same local phrasing candidate. Skyfall, My Way, and Imagine still pin their earlier accepted backings. Rain has positive directional feedback, but was not explicitly added to the golden corpus. These comments do not establish matched full-song or independent keyboard acceptance.

The Kings & Queens bass-arpeggio filter removed full-chord hits at beats 50.25, 97.875, and 161.375 (about 0:23, 0:45, and 1:15). Later chart edits removed the weak C♯m re-strike near 0:20 and moved two A attacks onto the preceding E–A–E source figure near 0:47 and 1:17. The current replay has 183 strikes. The owner hears some improvement but does not consider this candidate ready for the golden corpus.
