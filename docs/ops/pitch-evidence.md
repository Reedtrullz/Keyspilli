# Monophonic pitch and supplied-scale evidence

Keyspilli can estimate acoustic fundamental frequency locally and export the
measurements for Gemini's advisory interpretation through standalone Anti. This
optional command uses the same pinned offline dependencies as
`services/transcribe/requirements-onset-evidence.txt`; no weights, downloads,
provider requests, worker jobs or catalog changes occur.

```sh
/absolute/worktree/.venv-audio/bin/python services/transcribe/src/pitch_evidence.py \
  /absolute/captured-clip.wav ACTUAL_LOWERCASE_SHA256 /absolute/new-pitch-report \
  --texture monophonic --scale-pitch-classes 0,2,4,5,7,9,11
```

Use `--texture monophonic` only when the selected audio has one sounding pitch
at a time. This is a caller assertion, not a polyphony detector. Unknown and
declared polyphonic texture refuse locally. Piano tails, sustain pedal and reverb
can violate the assumption even when authored key strikes do not overlap.
Do not submit a full piano arrangement or mixed song to this tracker as though
it could transcribe all notes. Scale pitch classes are optional, unique integers
0..11 with C=0. Omit them when the intended scale is unknown. No key is inferred.

Inputs retain the onset tool's absolute-path, exact SHA256, regular mono PCM16
WAV,32/44.1kHz,2MiB and30second bounds. There can be at most60 estimated onsets.
The command refuses stale/missing/malformed/digital-zero input before pYIN.
Outputs are an exclusive new private directory with `receipt.json` and
`anti-evidence.json`; existing reports are never overwritten.

pYIN searches C2 through C7 using pinned librosa0.10.2.post1, a2048-sample frame
and256-sample hop at22.05kHz. Each spectral onset has a short80–280ms follow-up
window, cut off at the next estimated onset. A window requires at least six
voiced frames with probability≥0.8 and RMS≥−50dBFS. Accepted MIDI estimates must
span at most0.35semitones and have a median within35cents of the nearest MIDI
pitch. These fixed diagnostic guards are not calibrated probabilities of a
correct note. Rejected windows retain their statistics and a null pitch.

The receipt keeps the F0/voicing/level track, raw window statistics, absolute MIDI
pitch, pitch class, and membership in the supplied scale. Absolute octave stays
visible: MIDI60 and72 share pitch class0 but are different pitches. A chromatic
pitch outside the supplied set is a membership discrepancy, not proof of an
incorrect musical note. Unknown pitches and absent scales remain null.

The portable bundle separates measured onset/pitch windows from caller-authored
texture and scale assertions. It binds the audio hash, duration, detector settings
and both source scripts, includes uncertainty, and excludes local paths and
evaluator answers. Claims fit Anti's existing bounded schema; no DSP moves into
Anti and no additional Google/provider account is required.

Prepare the advisory handoff without uploading:

```sh
/absolute/python /absolute/anti/scripts/anti.py review-music \
  --model gemini-3.1-pro --audio /absolute/captured-clip.wav \
  --evidence-json /absolute/new-pitch-report/anti-evidence.json \
  --prompt 'Explain supplied pitch-window estimates and scale membership, citing claim IDs. Keep texture and scale assertions separate from measurements. Preserve nulls, octave uncertainty and unknown source authority. Do not infer a key, approve music or recommend automatic repairs.' \
  --max-output-tokens 4096 --probe-unverified-audio --dry-run
```

Any authorized live handoff is assisted interpretation. Reading correct
measurements does not qualify Gemini's independent hearing. Neither a stable
pitch nor scale membership establishes source fidelity, pianist suitability,
note releases or musical acceptance.

Keep each Gemini objective small. In a fresh bounded trial, Pro used3930 of its
4096 output tokens for reasoning about an eight-note evidence packet and returned
truncated JSON. That study stopped without its second call. A separate single
pitch packet with exactly one concise finding succeeded within the same cap:
Pro cited the measured MIDI61 and supplied scale, correctly identified outside-set
membership, and retained octave/source uncertainty without repair or approval.
This demonstrates one assisted interpretation, not reliable blind hearing or
an automatic batch-review loop. An incomplete response remains a failed review.

## Frozen synthetic screen

The diagnostic settings above were frozen before scoring. Exact rounded MIDI
was compared against private authored events, with onsets matched within100ms;
uncertain estimates were not counted as correct. These events were used only
for grading, not as inputs to acoustic estimation or Gemini.

| Audio group | Clips | Authored notes | Correct | Wrong | Uncertain |
|---|---:|---:|---:|---:|---:|
| Splendid Player development | 14 | 53 | 46 | 1 | 6 |
| Splendid Player heldout | 54 | 208 | 183 | 4 | 21 |
| Fresh TimGM6mb second-bank diagnostic | 15 | 36 | 35 | 0 | 1 |

Three of the five wrong estimates were octave errors. No expected onset was
missing or unmatched in these83 analyzed clips. Five missing and five
digital-silence controls refused locally;42 known polyphonic Player clips were
excluded, and one declared second-bank chord refused. Refusing a caller-declared
chord does not demonstrate automatic polyphony detection. All83 portable bundles
passed Anti's unchanged strict evidence parser without provider calls.

The second bank used an existing cached TimGM6mb SoundFont, acoustic piano
program0, FluidSynth2.6.0, disabled reverb/chorus/pedal, and pinned MIDI/WAV/bank
hashes. It is a distinct sampled bank, not a sine-wave substitute or pristine
blind benchmark. Short synthetic single-note sequences and overlapping decay
do not qualify full arrangements, real songs or calibrated pitch confidence.
Both banks retain diagnostic status; no note repair or musical acceptance follows.

References: [pinned librosa pYIN documentation](https://librosa.org/doc/0.10.2/generated/librosa.pyin.html)
defines F0, voicing flags and voicing probability.
[The original pYIN project](https://code.soundsoftware.ac.uk/projects/pyin)
describes its monophonic scope and failure cases involving accompaniment,
reverb and ringing strings. Synthetic and sampled-bank evaluation evidence
belongs in the private run report; it does not establish real-song coverage.
