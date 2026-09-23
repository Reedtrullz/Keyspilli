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
