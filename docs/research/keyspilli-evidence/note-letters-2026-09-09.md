# Note-letter readability refresh — 2026-09-09

Continuation of the player refresh, based on merged main `5c02508`, branch `codex/player-readability`. Original checkout and unrelated work preserved.

Observed locally: dense Advanced Chopin notes overlapped in the pitch-position SVG; scaling the entire diagram reduced label sizes on narrow screens. Replaced it with native table semantics: chronological note-start columns, separate RH/LH rows, stacked simultaneous notes, fixed readable labels, and a keyboard-focusable horizontal scroll region. Active starts and sounding notes are highlighted; following time only scrolls the panel. Preserves transposed pitches, chord provenance, lyrics, and the next-bar preview. Beat labels account for the time-signature denominator. This is an onset view, not proportional notation or note-duration engraving; copy states that limit.

Validation: 175 web unit tests; production build including type validation; 45 player/navigation Playwright checks against the built app. Added mobile/desktop geometric checks for non-overlapping labels, minimum14px label size, internal follow scrolling, rewind, and no page-width overflow. Transpose regression failed before implementation and passed afterward. Existing practice/speed/source selection checks pass.

Screenshots captured with reduced motion and reopened for inspection:

![Phone](note-letters-2026-09-09/note-letters-after-390.png)

![Desktop](note-letters-2026-09-09/note-letters-after-1280.png)

Local preview: http://127.0.0.1:3000/player/f-f-chopin-nocturne-a/beginner . No production deployment, real hardware, acoustic, or complete accessibility certification claimed for this follow-up.
