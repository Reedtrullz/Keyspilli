# Input timing validation on a real device

This protocol accompanies #146. It checks the recorded event clock and manual
calibration on one device setup; it does not measure hardware latency or musical
skill. No physical trial has been completed by adding this document.

## Record the setup

Keep a local receipt with date, app commit, browser/version, OS, keyboard or MIDI
device/channel, USB/Bluetooth connection, selected sound and its actual readiness,
audio output, sample count, raw/adjusted results and observed failures. Use the
same short, rights-cleared, single-note passage for each run. Keep source media,
device identifiers and exported owner state private.

Select one MIDI device and channel in **Input**. Computer keys use their separate
calibration. Wait for the chosen sound to become ready; sampled and fallback
sound have different bindings. Reset timing calibration after changing headphones,
speakers or output routing. A blank field means unknown, not measured zero delay.

## Run the checks

1. Reset calibration. Use play-along at 100% speed with a count-in, then play at
   least 20 isolated attacks. Retain the run's raw timing and context through the
   existing local history/owner-state export. Human timing variation is part of
   this observation; do not infer device latency from the average playing error.
2. Repeat with a manually entered **+50 ms**, then **−50 ms**, using the same
   device/channel/sound. For each accepted event, verify `playedSec = rawSec -
   offsetMs / 1000`: positive subtracts time, negative adds it, exactly once.
   Compare each event with its own raw value, not attacks from another run.
   The field supports −250 through +250 ms. This test offset is not a calibration
   recommendation. Keep raw and adjusted evidence together.
3. Repeat after seek/loop, at 50% speed, after pause/resume, and after a cancelled
   count-in. The musical position must use the new clock boundary; an event from
   before it must not become a new hit. Cancelled count-ins must not appear as
   completed practice. In wait mode an accepted target uses the target clock and
   an applied offset of zero; do not use wait-mode errors to estimate delay.
4. Change the selected MIDI device/channel and sound, then reload. Check that a
   saved offset follows only the matching input/sound binding, and that another
   device is not graded as the selected one. When returning to a sampled sound,
   distinguish Ready samples from fallback. Unplug during practice: the attempt
   must interrupt and held keys/pedal must release. A media-device change resets
   stored calibration; output-route changes without a browser event require a
   manual reset.
5. Reset calibration and reload. Both the field and retained evidence must still
   distinguish unknown from an explicit zero. A failed storage save must be
   reported; it must not break playback.

Record pass/fail per step, counts and variability, including missing timestamps
or interrupted attempts. Mark unobservable browser timestamp/dispatch behavior
**not observed**; never substitute a guessed timestamp. A physical latency claim
requires an independent synchronized reference for key action and audible output,
with its measurement uncertainty and repeated samples. This UI does not provide
that reference or automatically choose an offset.

## Source and automated coverage

The browser normalizes input timestamps in
[`input.ts`](../packages/player-core/src/input.ts). The engine projects them onto
the current monotonic playback clock, rejects stale/future events and retains
`rawSec`/`offsetMs` in
[`engine.ts`](../packages/player-core/src/engine.ts). Calibration bounds and storage
are in [`prefs.ts`](../packages/player-core/src/prefs.ts); input/device/sound binding
and invalidation are in
[`Player.tsx`](../apps/web/src/components/player/Player.tsx). Existing
[`input.test.ts`](../packages/player-core/src/input.test.ts) covers dispatch delay,
positive/negative offsets and seek/pause boundaries. These automated checks are
separate from the physical receipt above.
