# Native zoom and keyboard check — 3 October 2026

Issue: [#157](https://github.com/Reedtrullz/Keyspilli/issues/157). Build: isolated integration `11c2393cea75b0136857a627d09762fe8fe5edd5`, served on loopback port 3150. No production deployment or catalogue import was performed.

Chrome's native menu started at 100% and its native accessibility interface subsequently reported **Zoom: 200%**. This is separate from the existing automated CSS-zoom fixture. The local Nocturne Easy route was used; this check does not establish musical suitability.

Observed browser keyboard interactions:

- Tab/Enter opened Songs, searched for Nocturne and opened the selected result.
- Practice setup remained scrollable. Tab reached Start practice below the initial viewport. Select type-ahead chose Current 4 bars, with the summary confirming bars 1–4.
- A four-bar play-along run completed with a textual result: 0 hits, 107 missed, 0 wrong, 0 late. No notes were intentionally played; this checks result availability, not performance accuracy.
- Tab/Enter opened Download and activated MIDI. Chrome downloaded an 8,932-byte file with the `MThd` header. Escape returned focus to the download trigger.
- The view menu's arrow keys and Enter reached Note letters, Lead Sheet and Sheet Music. Note letters exposed its interval table; Lead Sheet wait practice exposed `A#3 (left hand), D#4 (left hand), A#4 (right hand)` as text.
- Practice Escape dismissal returned focus to Practice in Fall Down, Note letters and Sheet Music. The early body-focus snapshot preceded the existing animation-frame restoration and did not reproduce a settled focus defect. The automated four-view fixture now also checks Escape, focus restoration and Enter reopening.

VoiceOver's switch was observed off, enabled with explicit owner permission, then restored and observed off. Its caption-panel preference was already enabled and was left unchanged. Native VoiceOver key dispatch and caption-window inspection timed out; DOM/accessibility snapshots are **not** substituted for a completed manual screen-reader walkthrough. Backgrounding wait practice produced the existing focus-loss interruption message and Ready state, rather than a completed attempt.

Chrome entered fullscreen during the session; native restoration commands then timed out. The owner reset localhost zoom with Command-0 and replied “reset”; this restoration is owner-confirmed. The initial empty automation tab was rejected for an invalid URL; work resumed only after the owner opened the valid localhost page in another Chrome profile.

Remaining acceptance: a retained manual screen-reader walkthrough of target inspection, passage setup, practice/result and download. Native zoom findings complement the existing automated long-title, narrow-screen, reduced-motion and forced-color coverage; they do not certify every layout or WCAG conformance. No new product blocker was established by this check.
