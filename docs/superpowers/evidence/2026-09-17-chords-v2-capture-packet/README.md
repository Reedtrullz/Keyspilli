# Chords v2 reserved capture packet

This packet preserves the final browser capture from the frozen candidate
`ea68729045e82ef9ced14e0e0916c86991eeba4a` for four source-selected phrases.
Each phrase has separate Original, Automatic melody, and User-confirmed
right-hand outcomes captured with the same browser `AudioEngine synth`.

The JSON sidecars contain oscillator-event traces and sampled decoded mono PCM.
Distinctness is evaluated from canonical scheduled oscillator-event multisets
and aligned decoded PCM error with the recorded tolerance. WebM SHA-256 values
are integrity checks only; they are not audible-difference evidence.

Human ratings are pending. This packet does not establish recognizability,
harmony quality, playability, or musical usefulness.

Verify the packet from this directory with:

```sh
shasum -c SHA256SUMS.txt
```
