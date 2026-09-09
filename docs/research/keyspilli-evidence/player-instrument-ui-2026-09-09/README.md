# Player instrument UI — implementation evidence

The A–C implementation keeps tools outside the stage, adds saved label/theme choices and middle-C/key-binding landmarks, exposes session octave and opt-in MIDI controls, and makes the existing piano playable with mouse, touch and keyboard navigation. Bar progress uses the existing engine clock and imported measure boundaries.

Input owners share a note until the final physical owner releases it. Blur, hidden documents, pointer cancellation, input-mode changes, instrument replacement and MIDI disconnect release input voices. Sampled piano now uses smplr input stop IDs, so a key release does not stop an arrangement note at the same pitch; releases also clear voices started before sample loading completed. The scheduler and grading authority remain in PlaybackEngine.

## Review scope

- Base: main `f3a2b1085ba6b8c8299a6472cd9c44ad5eede9fa` (PR #91).
- Worktree: `player-instrument-ui`; branch `codex/player-instrument-ui`. Original `codex/organ` WIP was preserved.
- Preview uses an isolated copy of local fixture data, on port 3002. Before captures use the existing PR #91 build in `player-polish` on temporary port 3003; its source matches the base for the player paths.
- A–C are delivered together in one review branch, rather than three partially integrated releases. No merge or deployment was performed.
- Native nonmodal dialogs on desktop and modal dialogs on phones replace the old wrapper. Panels disappear immediately rather than animating out. Key bevels use static rectangles rather than gradients. No dependencies were added.

## Checks

- Full workspace unit run: **1,898 passed** (179 web, 1,094 catalog, 8 engrave, 380 MIDI, 142 player-core, 95 transcribe).
- Production browser subset: **59 passed**, using the new production build and isolated data on port 3002.
- Workspace typecheck, production build, and `git diff --check`: passed.
- Paused canvas/label checks were rerun after the final short-key hint adjustment: **3 passed**.
- Frame profile: median **8.3 ms** before/after, p95 **9.0/9.2 ms**. The new build had one interval above 50 ms in the five-second sample, versus zero in the baseline; this small sample is not a general performance guarantee. See `frame-profile.json`.

The local browser subset covers the player, instrument interactions and application smoke/export flows; it is not the complete CI suite. Remote CI status is tracked on the PR.

Meaningful regressions cover preference migration; label modes; paused/DPR resizing; key geometry and black-key precedence; shared/rejected input ownership; MIDI permission deduplication, late completion, hotplug and disconnect; sampled voice isolation; pickup/compound-meter progress; exact speed-position preservation; panel geometry/focus; MIDI opt-in; keyboard/mouse overlap; drag/outside release; multi-touch cancellation; and count-in gating.

Visual captures use the same advanced Nocturne at 1440×900, 1740×1370, 1024×768, 390×844 and 844×390. Phone/landscape tool and charcoal captures use Focus. Full-page before/after captures include below-fold content; their image height is not the viewport height. Finite entrance animations are finished for screenshots. Browser assertions separately check that Focus keeps the keyboard in the viewport.

## Verification limits

- Multi-touch and MIDI lifecycle checks are browser/core simulations. Physical MIDI devices, real touch feel and listening acceptance remain a user/hardware check.
- Frame sampling measures browser frame cadence on this machine, not perceived audio latency or mobile hardware performance.
- Readability and focus were reviewed for this player; this is not a whole-site WCAG certification.
- Recording/replay is intentionally outside this implementation. No catalogue regeneration, production data migration or production release was performed.
