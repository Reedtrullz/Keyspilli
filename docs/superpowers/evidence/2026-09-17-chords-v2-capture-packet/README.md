# Chords v2 reserved capture packet

This packet preserves the final browser capture from the frozen candidate
`ea68729045e82ef9ced14e0e0916c86991eeba4a` for four source-selected phrases.
Each phrase has separate Original, Automatic melody, and User-confirmed
right-hand outcomes captured with the same browser `AudioEngine synth`.
`controls/` contains two complete Original Blackbird repeat captures used as a
negative control.

The JSON sidecars contain deterministic producer event-multiset results,
oscillator-event traces, sampled decoded mono PCM, and decoded-duration checks.
Producer comparison uses overlap-clipped `[midi,start,dur,vel]` multisets for
the reserved phrase and Player-equivalent arrangement options. Oscillator and
PCM metrics are observed capture diagnostics only: the repeat control varied,
so they are not arrangement-change proof. WebM SHA-256 values are integrity
checks only; they are not audible-difference evidence.

Every accepted capture decoded for at least its requested duration within a
250 ms recorder tolerance. An incomplete capture is rejected before it is
written to the packet.

Human ratings are pending. This packet does not establish recognizability,
harmony quality, playability, or musical usefulness.

Verify the packet from this directory with:

```sh
shasum -c SHA256SUMS.txt
```
