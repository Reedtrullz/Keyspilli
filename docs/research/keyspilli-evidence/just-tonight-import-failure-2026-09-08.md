# Just Tonight import failure — 8 September 2026

User links: Y7VGOnV2QhU (recording), Hm4F_Eq_4tw (live), znVhY3G14Ow (tutorial).

The previous resolver treated tutorial/broadcast uploaders as artists and required a literal artist substring. It never attempted a submitted tutorial directly. Updated identity handling prefers recording metadata, then Artist - Song title segments; removes parenthetical performer decoration; never falls back to uploader. Direct tutorials are ranked first. Discovery omits the unnecessary Synthesia query restriction and accepts a missing leading “The” in artist names.

A fresh real resolver run of the recording found and attempted Psq5H1_Ehv4, znVhY3G14Ow and gCcAjUdFpko. All three failed full-keyboard calibration. Frame inspection confirms cropped keyboards, rather than a networking or job-queue failure. One shows octave labels, so this is a concrete future extraction route, not proof that the recording is unusable. No note mapping was guessed and no arrangement published. Advertised MIDI archives in the first two descriptions are paid; no purchases made.

Private evidence: output/tutorial-recovery/just-tonight-retry/receipt.json and candidate videos; just-tonight-frame.png, just-tonight-alt.png, just-tonight-third.png.

Validation: 65 worker tests and worker typecheck passed; 5 public-error tests passed. Worker restarted with updated code in isolated development preview. Production unchanged. This song still does not convert successfully: cropped-keyboard calibration with verified octave mapping remains necessary.

Live local API verification: job-b97acc3e-ac3d-43fc-94a4-44bbddfc46e4 submitted through port3103 import endpoint, attempted the submitted tutorial first and both alternatives, then returned the specific extraction failure message with songId null. This verifies failure handling, not successful conversion.

## Resolved for gCcAjUdFpko — 8 September, 00:46

The partial keyboard now uses visual geometry plus an acoustic octave check against the same tutorial audio. The check compares candidate octave offsets on the top voice (to avoid counting accompaniment harmonics twice), requires at least24 samples and4 pitch classes, a clear winner, and matching winners in both halves. Silence and equally strong octave alternatives are rejected. This is a bounded piano-tutorial heuristic, not general audio transcription or a guarantee for every keyboard layout.

This video selected +12 semitones from143 top-voice samples across8 pitch classes. Winner median normalized fundamental energy1.0; next octave0.4034; agreement70.6%. The original hardcoded88-key requirement had blocked otherwise usable relative geometry. Muted purple black-key lights also needed detection; those notes are now retained, while the existing dim-purple background regression remains rejected. No song-specific pitch offset or video-ID exception was added.

Fresh live API job job-1826f712-ffb1-42e8-86f2-3132de179aa1 completed in10.198s, selected the exact requested tutorial, and extracted915 notes. All four HTTP exports match the candidate reductions: Beginner210, Easy569, Medium844, Advanced871 notes. A second submission through the user's visible browser form completed as job-9d057eeb-8eb7-4b86-94bd-041e68d304ac; lesson opened with correct artist/title, all four levels and source notice; playback advanced to0:37 and was paused. No manual MIDI seeding or DB insertion.

Validation:11 Python tests,66 worker tests and worker typecheck passed. Fresh Queen extraction retained all2374 previously accepted note events exactly. No production deployment, independent listening acceptance, or universal conversion claim. Available local disk dropped to29.359GiB after verification; further extraction runs stopped under the30GiB guard. Existing completed lesson remains available.

Private machine-readable proof: output/tutorial-recovery/just-tonight-pipeline-proof.json. Browser lesson: http://127.0.0.1:3103/player/preview-job-9d057eeb-8eb7-4b86-94bd-041e68d304ac-e .
