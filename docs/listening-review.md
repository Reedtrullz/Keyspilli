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

The owner accepted these five **Advanced-derived Chords backing** candidates as useful full-song references at their current quality level. The machine-readable index is [`catalog/chord-golden-corpus.json`](../catalog/chord-golden-corpus.json); it pins each accepted source, authored timeline, and realized backing digest. The source artifacts remain outside Git. This is a calibration set for future chordification work, with further musical polish welcome, not a claim that the mode's ten-song release gate passed.

| Song | Owner listening decision | Known follow-up |
| --- | --- | --- |
| Skyfall — Adele | Happy keeping this Chords preview at its current level. | Further voicing/rhythm polish can wait; full matched listening and keyboard review remain open. |
| My Way — Frank Sinatra | After the repeated-strike fix near 0:36, sounds pretty good and is fine for the corpus. | The final coda has no specific listening verdict; further polish can wait. |
| Imagine — John Lennon | After the higher-resolution lead-ins and attack changes, the owner said “Good work on both!” and explicitly added Imagine to the corpus. | Further polish and a matched full-song/keyboard review remain open. |
| Let It Be — The Beatles | After the short chord ladders and repeated-attack changes, the owner added it to the corpus and now says the current local phrasing “really sounds great.” | The 70% one-beat-or-shorter event share still triggers the structural density diagnostic; keyboard review remains open. |
| Clocks — Coldplay | The first preview missed the already-played chord stacks. After the source-stack correction, the owner said “Clocks sound much better now!” and explicitly asked to add it to the corpus. | Full-song listening, especially the middle and right-hand-only ending, and keyboard review remain open. |

These five decisions concern the local draft-PR previews, not a deployed player. Imagine and Let It Be apply to the higher-resolution charts at `94cced0f`; Clocks applies to the source-stack and chord-display revision at `c3705af8`. These owner judgments do not replace independent pianist/teacher assessment, beginner practice observation, or the separate release gates in [ADR 0004](decisions/0004-release-gates.md).

**Kings & Queens is outside the golden corpus.** The owner had accepted an earlier working version, but after hearing the later 0:20/0:47 timing edits said it is somewhat better yet still imperfect and explicitly asked to keep it outside the corpus. Its authored Chords preview remains available for later polish. The earlier `catalog/learner-review.json` verdict concerns the original arrangement, separately from Chords backing.

## 2026-09-26 — Fix You opening excerpt

The owner listened to the local Fix You Chords variant and called it “perfect.” They selected the opening, described as 0:00–2:35, for the golden corpus and excluded the changed 2:36–4:26 section as an automation example. The exact source-grid boundary is beat 177.875 at 68 BPM (2:36.95): the last Bb notes end and the next Eb section begins there. The corpus pins only backing events before that beat, 422 notes from the green chord and blue rhythm lanes, with no later onsets or sounding tails. The full Chords variant is owner-accepted for this song; only the opening excerpt is an automation reference.

Its Advanced notes, chart, and realized excerpt have separate SHA-256 pins in the [corpus index](../catalog/chord-golden-corpus.json). The replacement source MIDI and preview artifact are private ignored files; another host needs their verified transfer before it can replay this entry. This listening verdict does not establish release readiness or acceptance of the later section as an automation pattern.

## 2026-09-26 — I Will Survive full-song golden reference

After hearing the 117 BPM chord-only local preview with the introduction and ending re-strikes reduced, the owner said **“I Will Survive sounds decent!”** and explicitly asked to add it to the golden corpus. This accepts the current **full-song** Chords backing as a working automation reference, with later polish welcome. It does not resolve every possible syncopation or establish a matched-recording or keyboard review.

The [corpus index](../catalog/chord-golden-corpus.json) pins the exact local Advanced artifact, authored chart, and 165 realized chord attacks; there are no added short-key notes and no excerpt cutoff. The seed MIDI is private and ignored by Git, so another host needs an exact source/artifact identity readback before using this reference. Draft PR #109 remains unmerged and undeployed.

## 2026-09-26 — Those Were the Days full-song golden reference

After listening to the simplified local Chords preview, the owner said **“Good job! Add it to the golden corpus!”** This accepts the current backing as a full-song working reference at this quality level, including the repeated “Those, Were, The, Days, My, Friend” phrases. The previous Advanced bassline overlay has been removed; each refrain now uses six chord attacks with one bass note and a three-note right-hand shape.

The [corpus index](../catalog/chord-golden-corpus.json) pins the exact local Advanced artifact, authored timeline, and 166 realized chord attacks with zero copied source notes and no excerpt cutoff. The owner's verdict followed review of the targeted refrain; it is not a separate matched full-song or physical-keyboard assessment. The source MIDI remains private and ignored by Git. Draft PR #109 is not merged or deployed.

## 2026-09-26 — The Winner Takes It All full-song golden reference

The owner reported that the previous Winner Chords mode played the original arrangement. Exact local replay confirmed the problem: its special source reduction retained 1,201 of 1,533 Advanced notes and returned **no chord attacks or chord display labels**. The corrected preview uses the authored chart throughout: zero copied source notes, 156 voiced chord attacks, and 27 source-timed chord strikes in the requested 2:22–2:49 passage. Full source chord stacks inform the compact voicings where present; generated voicings are lowered from the source's high melody register.

After hearing this distinct chord-only replacement, the owner said **“The Winner Takes It All sounds great! Add it to the golden corpus!”** This accepts the current full-song backing as a working automation reference. The [corpus index](../catalog/chord-golden-corpus.json) pins its exact local Advanced notes, authored timeline, and realized 156-strike backing without an excerpt cutoff. The earlier pilot sing-along verdict above applies to the earlier source reduction; neither verdict establishes independent keyboard review or deployment.

## 2026-09-27 — All of Me full-song golden reference

The owner found the earlier All of Me backing hard to recognize, then asked for the harmony from [UG chart #2469556](https://tabs.ultimate-guitar.com/tab/john-legend/all-of-me-chords-2469556) and timing against John Legend's official recording. The accepted local Chords preview has its own 126 BPM, 4:34 timeline while Rousseau Original stays at 129 BPM. It has 179 authored chord attacks, no copied Advanced notes, and corrected pre-chorus, chorus, refrain, and second-verse entries on the recording's four-beat pulse. After the 0:45 timing correction, the owner said **“I'm pretty happy with the result now! Add it to the golden corpus.”**

This accepts the current full-song Chords backing as a working automation reference. The [corpus index](../catalog/chord-golden-corpus.json) pins its Advanced source artifact, authored chart, and realized 179-strike output. This example teaches that the Chords reference and Original arrangement can require separate clocks; the source artifact pin identifies the catalog song, while the approved backing follows the official recording. The Advanced notes are a private ignored artifact, so another host must verify their hash before replaying this pin. [Timing evidence and automation notes](research/keyspilli-evidence/chords-next-ten-candidate-review-2026-09-25.md#official-recording-barline-correction--27-sep) record the earlier rejected versions and the accepted correction. Draft PR #109 remains unmerged and undeployed.

## 2026-09-27 — Help full-song golden reference

After the official-recording sync revision, the owner said **“Help sounds good! Add it to the golden corpus!”** This accepts the current full-song, chord-only backing as a working automation reference. Chords plays the authored chart's 190 strikes at 190 BPM with no copied Advanced notes; Original/Advanced remains at 173 BPM. The [corpus index](../catalog/chord-golden-corpus.json) pins the exact Advanced notes, authored timeline, and Player replay digest without an excerpt cutoff. It is the eleventh working reference. The source artifact remains private and ignored by Git; this verdict does not establish independent keyboard review or deployment. Draft PR #109 remains unmerged and undeployed.

## 2026-09-27 — Your Song full-song golden reference

After the linked-recording timing review, the owner listened to the unchanged Your Song Chords preview, said **“It sounds alright!”**, and explicitly asked to add it to the golden corpus. This accepts the current full-song backing as the twelfth working reference, with later attack-timing polish welcome. The [corpus index](../catalog/chord-golden-corpus.json) pins the Theorist Advanced notes, the owner-linked authored chart, and the exact 101-strike Player backing at 129 BPM (about 64.5 BPM felt pulse), with zero copied source notes and no excerpt cutoff. The [timing review](research/keyspilli-evidence/chords-next-ten-candidate-review-2026-09-25.md#your-song-linked-recording-sync-review--27-sep) found section-dependent offsets against Elton John's recording; that measured limitation remains, and the owner's acceptance does not establish exact recording sync or independent keyboard review. The source artifact remains private and ignored by Git. Draft PR #109 remains unmerged and undeployed.

The [next-ten Chords shortlist](research/keyspilli-evidence/chords-next-ten-2026-09-25.md) proposes other active repertoire songs for future work. It is a research queue, not a listening verdict.

## 2026-09-27 — Dreamer set aside

After the latest chord-only Dreamer revision, the owner asked to stop work on it for this round and explicitly keep it outside the golden corpus. This is a scope decision, not a listening acceptance of that revision. In the Army Now remains the active listening candidate from the ten-song round; Help and Your Song were subsequently accepted.

The [earlier six-song review](research/keyspilli-evidence/chords-golden-corpus-review-2026-09-25.md) remains a historical analysis of the prior candidate set; its Kings & Queens inclusion has been superseded.

### Source-informed phrasing candidate — listening follow-up

The draft PR's shared Chords phrasing candidate skips some bass-arpeggio full-chord re-strikes, follows simultaneous harmonic attacks, and gives authored chords a short release when the source harmony ends before the next strike. At commit `1e6d1337`, the replay audit reported `DRIFT` against all six previously accepted backings. The local preview at `127.0.0.1:3102` runs this draft worktree. Comparison passages include My Way near 0:36, Kings & Queens at 1:19–1:26, Imagine's opening eight beats, Let It Be around beats 18–22, and Clocks' beat-64 repeated chords. Have You Ever Seen the Rain is an additional holdout because its sounded coverage drops below 80% with the shorter releases. The structural evaluation and exact counts are in the [review follow-up](research/keyspilli-evidence/chords-golden-corpus-review-2026-09-25.md#source-informed-phrasing-follow-up).

After listening to this local candidate, the owner said **“Clocks seems great now!”** and that **“Have you ever seen the rain too sounds better and more controlled.”** Clocks' `acceptedBackingSha256` pins the heard phrasing at `1e6d1337`, with its chart and source notes unchanged. The owner subsequently said **“Let it Be really sounds great now!”**, so its accepted digest now pins the same local phrasing candidate. Skyfall, My Way, and Imagine still pin their earlier accepted backings. Rain has positive directional feedback, but was not explicitly added to the golden corpus. These comments do not establish matched full-song or independent keyboard acceptance.

The Kings & Queens bass-arpeggio filter removed full-chord hits at beats 50.25, 97.875, and 161.375 (about 0:23, 0:45, and 1:15). Later chart edits removed the weak C♯m re-strike near 0:20 and moved two A attacks onto the preceding E–A–E source figure near 0:47 and 1:17. The current replay has 183 strikes. The owner hears some improvement but does not consider this candidate ready for the golden corpus.
