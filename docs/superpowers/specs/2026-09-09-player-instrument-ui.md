# Player instrument UI specification

Status: proposed implementation scope, 9 September 2026. No implementation authorized by this planning document itself.

Goal: improve piano learning through stable controls, readable keyboard orientation, tactile-looking keys and direct input. Preserve the existing song timeline and fixed Fit Passage range.

Reference research: https://www.onlinepianist.com/virtual-piano, inspected live on 9 September. Reference settings replace the existing toolbar content. Keyspilli's Adjust panel instead consumes stage height. The reference uses visible key bindings, octave controls and clear instrument affordances. Adopt those interaction principles within Keyspilli's current styling; do not clone its assets, huge empty stage or sound catalogue.

## Required behavior

- Keep the note stage and keyboard geometry unchanged when opening or switching tool panels.
- Preserve Play, Practice, Hands, Speed, Loop and existing view selection.
- Group secondary controls as Display, Sound and Input; eliminate Adjust → Settings nesting.
- Keep full-arrangement Fit Passage fixed through seeking, speed and hand changes. Only an explicit display-range choice, arrangement change or transpose may change its range.
- Distinguish arrangement transpose, computer-keyboard input octave and displayed range.
- Expose middle C, octave landmarks, optional computer-key hints and current input status.
- Offer Light and Charcoal stage appearance; preserve Light for existing users.
- Make on-screen keys playable with mouse and multitouch, including simultaneous notes and sliding, without hijacking stage pause or document scrolling outside the keys.
- Release held input on cancellation, blur, hiding, unmount, input-mode changes and device loss. One source releasing a shared pitch must not cut another source's held pitch or scheduled song audio.
- Reuse current sustain, audio preview, hand gains, MIDI, keyboard mapping, count-in and metronome functionality.
- Provide beat/count-in feedback using the existing musical clock; do not introduce a second audio clock or change tempo semantics.
- Preserve inferred-chord provenance and distinct actual-note, upcoming-note and chord-guide cues.
- Keep essential controls accessible with keyboard navigation, text labels, reduced motion, 200% zoom, phones and short landscape screens.

## Explicit scope limits

No new UI/audio dependencies, catalogue changes, transcription changes, grading redesign, automatic range tracking, custom keybinding editor, broad new instrument library or recording in the initial releases. A bounded single-take recorder is a separate later release, described in the plan but not a dependency of the UI upgrade.

## Evidence

Five accepted screenshots and the detailed comparison are in the Obsidian project note:
`/Users/reidar/Obsidian/Hermes/Hermes/Personal/Projects/Keyspilli/OnlinePianist inspiration - 09-09-2026.md`.
This spec is self-contained; the screenshots add visual context. Reference audio latency, hardware MIDI and recording/export were not verified. No full accessibility compliance claim.
