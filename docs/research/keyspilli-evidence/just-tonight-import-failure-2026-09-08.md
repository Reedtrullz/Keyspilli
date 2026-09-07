# Just Tonight import failure — 8 September 2026

User links: Y7VGOnV2QhU (recording), Hm4F_Eq_4tw (live), znVhY3G14Ow (tutorial).

The previous resolver treated tutorial/broadcast uploaders as artists and required a literal artist substring. It never attempted a submitted tutorial directly. Updated identity handling prefers recording metadata, then Artist - Song title segments; removes parenthetical performer decoration; never falls back to uploader. Direct tutorials are ranked first. Discovery omits the unnecessary Synthesia query restriction and accepts a missing leading “The” in artist names.

A fresh real resolver run of the recording found and attempted Psq5H1_Ehv4, znVhY3G14Ow and gCcAjUdFpko. All three failed full-keyboard calibration. Frame inspection confirms cropped keyboards, rather than a networking or job-queue failure. One shows octave labels, so this is a concrete future extraction route, not proof that the recording is unusable. No note mapping was guessed and no arrangement published. Advertised MIDI archives in the first two descriptions are paid; no purchases made.

Private evidence: output/tutorial-recovery/just-tonight-retry/receipt.json and candidate videos; just-tonight-frame.png, just-tonight-alt.png, just-tonight-third.png.

Validation: 65 worker tests and worker typecheck passed; 5 public-error tests passed. Worker restarted with updated code in isolated development preview. Production unchanged. This song still does not convert successfully: cropped-keyboard calibration with verified octave mapping remains necessary.

Live local API verification: job-b97acc3e-ac3d-43fc-94a4-44bbddfc46e4 submitted through port3103 import endpoint, attempted the submitted tutorial first and both alternatives, then returned the specific extraction failure message with songId null. This verifies failure handling, not successful conversion.
