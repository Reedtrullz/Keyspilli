# Complete local song delivery

Use this path for a new song with completed, qualified symbolic piano input.
Keep the requested performance and source evidence separate from its generated
reductions. This does not acquire a song, invent source roles or grant musical
approval.

## Discover, then run

Use the supported checkout and absolute Node returned by preflight. Check that
`apps/web/scripts/prepare-song.mts --help` advertises `--previews` and that
`apps/web/scripts/deliver-song.mts --help` runs. On an older checkout, keep the
ordinary preparation route and existing separate rendering procedure; never
invent support for these flags.

For a complete provisional delivery in one invocation, run from the checkout:

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/prepare-song.mts \
  /absolute/source.mid output/song-prep/NEW-RUN 'TITLE' 'ARTIST' \
  --previews --soundfont /absolute/piano.sf2 --executable /absolute/fluidsynth
```

Ordinary input also supports MusicXML/MXL. The optional existing `--phrase-plan`
contract is unchanged. `--level a|m|e|ve|b|vb` chooses the Original preview and its
convenience exports; the package always retains all six Original variants.
Chords is explicitly one shared Advanced-derived backing, not six independent
accompaniment difficulty levels. No renderer flag is silently ignored without
`--previews`.

Select a licensed sampled acoustic piano bank and verify the selected MIDI
program. The new route has a fixed gain of 0.2 and a 22050 Hz render, a two-minute
backend timeout per mode and a 256 MiB WAV/bank read limit. A clipping or capacity
failure is an explicit blocker, not permission to relax the checks. The runtime
and bank are supplied locally; neither is downloaded or distributed by delivery.
These renders come from exported MIDI, not a capture of the app's sampler.

## Keep preparation when rendering fails

Preparation writes its own verified result before preview delivery. A missing
backend, truncated audio, silent PCM or raw clipping makes delivery incomplete;
the prepared bundle and any unaffected mode remain available. Do not rerun
transcription or preparation merely because a preview failed.

After resolving the reported renderer problem, make a new delivery from the
existing ordinary run. Its new destination must have an existing non-aliased
parent and cannot overlap the bundle, installed catalog, source data or plugin:

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/deliver-song.mts \
  output/song-prep/EXISTING-RUN /absolute/NEW-DELIVERY \
  --soundfont /absolute/piano.sf2 --executable /absolute/fluidsynth
```

Keep the failed attempt. There is no overwrite, hidden retry or automatic
publication. The separate deterministic preparation wrapper retains its current
checkpoint scope; it does not silently include this optional audio step.

## Verify and surface the result

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/deliver-song.mts \
  verify /absolute/DELIVERY
```

Verification works after the entire delivery directory is relocated. It checks
its exact inventory, mode exports, bundle hashes, actual PCM framing, native
MIDI duration and recorded warnings without rendering, catalog installation or
repair. Hashes establish integrity, not authenticity of an arbitrary replacement
manifest. Retain the producer revision and the manifest's hash in the handoff.

`complete-provisional` requires both structurally valid previews. A release-tail
warning remains visible. `incomplete` exits nonzero and identifies the blocked
mode; do not report MIDI-only output as complete. A successful process or file
existence alone is insufficient. The 10 ms shortfall rule and existing positive
tail policy come from the maintained renderer, including native tempo changes.

The directory contains `index.html`, `README.md`, `manifest.json`, Original and
Chords MIDI/MusicXML aliases, valid WAV previews, and the complete `bundle/` with
all six Original exports. The index uses relative links, labels each mode and
shows only previews that passed. Lead the chat handoff with the two labelled
previews, or an accessible batch index, then the downloadable directory/ZIP.
The ZIP is transport, not a raw Keyspilli song upload.

The README supplies the existing `song-bundle.mts install` command for a new
isolated catalog. That installation was already verified during preparation;
`deliver-song` rechecks it before copying. Live publication and installed-plugin
adoption remain separate authorized actions. `complete-provisional` does not
establish source correctness, independent listening or keyboard suitability.
