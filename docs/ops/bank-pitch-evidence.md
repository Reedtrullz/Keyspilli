# Bank-informed chord-window evidence

This optional Keyspilli command fits one selected128ms audio window against
an explicitly registered piano template dictionary. It supplements monophonic
pYIN with a renderer-informed pitch-set estimate. Anti still consumes only a
generic evidence bundle and owns connected-account Gemini access; it does not
install this tool, DSP dependencies or a piano bank.

For a separately opted-in waveform-history diagnostic that preserves phase,
see [phase-pattern-evidence.md](phase-pattern-evidence.md). It requires longer
held references and an explicit renderer profile; default detection is unchanged.

Use the pinned optional environment in
`services/transcribe/requirements-onset-evidence.txt`. No model weights, network
requests, runtime downloads, worker jobs or catalog changes occur.

```sh
/absolute/worktree/.venv-audio/bin/python services/transcribe/src/bank_pitch_evidence.py \
  --request /absolute/window-request.json --output /absolute/new-bank-report
```

The request contains:

```json
{
  "bank": {"path": "/absolute/existing-bank.sf2", "sha256": "ACTUAL_BANK_SHA256"},
  "audio": {
    "path": "/absolute/captured-chord.wav",
    "sha256": "ACTUAL_AUDIO_SHA256",
    "bankSha256": "ACTUAL_BANK_SHA256"
  },
  "templates": [
    {
      "midi": 60,
      "path": "/absolute/captured-C4-template.wav",
      "sha256": "ACTUAL_TEMPLATE_SHA256",
      "bankSha256": "ACTUAL_BANK_SHA256",
      "attackSeconds": 0.28
    }
  ],
  "window": {"startSeconds": 0.28, "endSeconds": 0.408},
  "expectedPitches": null
}
```

The example contains one template for compactness. Register every pitch that
the chosen dictionary can actually search; a chord diagnostic should cover
potential unexpected pitches, not just expected chord tones. At most88 unique
MIDI pitches21..108 are supported. Templates are isolated-note captures with
caller-supplied pitch labels and a clip-local start for the reference spectrum.
`attackSeconds` must leave128ms of complete audio. Leading silence is preserved
in the WAV and bypassed only by this explicit alignment. The older continuous
renderer command now optionally accepts the same field; its legacy unaligned
three-tuple/8kHz analysis remains compatible.

Each WAV must satisfy the onset decoder's absolute-path, regular-file, SHA256,
mono PCM16,32/44.1kHz,2MiB and30second limits. Missing/stale/malformed/digital-zero
audio refuses locally. The bank asset must be a pinned regular file of at most
64MiB; its bytes are checked but not executed or interpreted. Bank assertions
must match for audio and all templates. The request is bounded to64KiB. Output
is a new private directory containing `receipt.json` and `anti-evidence.json`;
existing evidence is never overwritten.

Hashes verify selected bytes. They do not verify that a WAV came from that bank
or that its MIDI label is correct. Retain original render/capture receipts and
asset provenance. Unknown or mismatched bank assertions refuse; deliberately
false matching assertions cannot be reliably detected from metadata alone.

The new window fitter uses16kHz/2048samples so the highest piano fundamentals
are below Nyquist, with normalized magnitude templates and nonnegative least
squares. It searches all registered pitches independently of `expectedPitches`.
The fixed relative coefficient threshold is0.25. Windows below−50dBFS or with
residual ratio above0.25 remain uncertain, with a null pitch set. Raw coefficient
and residual statistics are retained; they are not calibrated pitch confidence.
Low residuals can still accompany wrong or incomplete pitch sets.

`pitchSetCompleteness` always remains `unknown`. The receipt also exposes
`belowThresholdCandidates`: coefficients from0.04 up to the unchanged0.25
selection threshold, sorted by strength. This reporting floor does not promote
any candidate into `pitchSetEstimate`. The portable bundle includes at most12
of these candidates and an omitted count. They are unresolved spectral fits;
harmonics and template mismatch can produce false candidates. Below-level or
poor-fit windows retain null candidates and no weak-candidate claim.

The legacy comparison field `missingExpectedPitches` means registered expected
pitches that were **not detected**, not established acoustic absence.
`absenceEstablished` is always false. Candidate reporting searches the same
full dictionary and remains independent of the supplied expected score.

With `expectedPitches: null`, comparison stays unknown. An explicit expected
set is compared after fitting; it never changes the dictionary or coefficients.
Unregistered expected pitches are `unsearchedExpectedPitches`, not acoustically
missing notes. The portable bundle separates measured renderer-informed fit
results from authored bank/expected-set assumptions and preserves unknown source
authority. It excludes local paths and evaluator answers.

For an authorized Gemini handoff, use the identical full WAV and bundle in
Anti `review-music --evidence-json`, first with `--dry-run`. Ask for one concise
claim-linked interpretation of this selected window. Keep provenance, quiet-note
and harmonic-overlap uncertainty. Successful interpretation remains advisory;
it does not establish independent hearing, musical acceptance or repair authority.
The local command itself makes zero provider calls.

## Recorded diagnostic scope

One exact cached TimGM6mb acoustic piano bank provided88 isolated templates.
All settings and cases were frozen before scoring. The fresh heldout screen
recovered18/20 exact pitch sets (72 matched pitches, no false pitches, two
missed pitches). Development recovered4/5 exact sets (13 matched, one false,
one missed). Overlapping decay recovered1/3 exact sets; each later window
missed two quieter bass pitches even with a low residual. No settings were
tuned after these failures.

Two wrong-score controls preserved the same fitted pitch sets and reported
the supplied score discrepancy. Two declared wrong-bank controls refused;
two deliberately false matching bank assertions using Splendid audio had
high residuals and remained uncertain. Those two examples do not qualify a
general bank detector. Final-code replay retained all outcomes, and32 portable
bundles passed Anti's unchanged strict evidence parser without HTTP.

This is a bank-specific, selected-window diagnostic. It does not qualify the
current Splendid Player bank, general polyphonic transcription, note attacks
or releases, full arrangements, real songs, source correctness or musical
acceptance. Registering an88-pitch dictionary does not itself qualify all88
pitches across velocities or timbres. Never repair a chord automatically from
this estimate.

References: [SciPy1.13.1 NNLS](https://docs.scipy.org/doc/scipy-1.13.1/reference/generated/scipy.optimize.nnls.html)
defines constrained least squares and its residual norm.
[Smaragdis and Brown's original polyphonic spectral-decomposition paper](https://www.merl.com/publications/docs/TR2003-139.pdf)
describes harmonic-profile assumptions and overlapping-note limitations. This
implementation uses fixed templates and NNLS, not that paper's learned NMF system.

## Optional prior-window evidence

Add `--with-history` to the existing command to include earlier measurements
from the same pinned clip. The default command remains a single-window fit.
This option does not change `pitchSetEstimate`, coefficients, residuals or
detection thresholds, and never unions earlier notes into the selected set.

The pinned spectral-onset estimator scans the full clip. Reference windows
start30ms after an estimated onset, snapped to the input sample grid. Each is
128ms, must finish before the target window begins, and must start within the
preceding1.2seconds. At most eight such windows are allowed; more refuses
locally without a partial report. This bounds fitting work and excludes future
fit windows. The full-clip onset scan means this is not causal online tracking.

The receipt retains all prior fits, null/uncertain results, the raw onset
estimates and separate history code/configuration identity. Historical fits
receive no expected score. Each current weak candidate links to earlier fit
claims that detected the same MIDI pitch, or an empty list if none did. The
portable candidate-link list shares the12-candidate bound and omitted count.
Earlier fit claims carry their own clip-local intervals. Earlier detection
does not establish current presence, duration, release or a repeated attack;
it can inherit the same bank and harmonic errors. Unknown current presence
and pitch-set completeness remain explicit. Never turn these links into an
automatic repair or a claim that a complete chord was recovered.

A separately frozen60-window temporal-anchor candidate retained the original
target set and added weighted candidates only when earlier complete windows
detected them. Fresh overlap recovered14/24 exact sets versus1/24 originally,
with zero false pitches but18 misses versus48. No-bass controls recovered8/12
versus7/12; harmonic chords0/12 versus0/12; unanchored quiet-note controls11/12
versus8/12. All four splits had zero false pitches for both methods. Coverage
failed the declared18/24 overlap rule, so that fusion detector was rejected.
It is private research, not a selectable profile. The exported history is
measurements for interpretation only; general transcription remains unqualified.

[Cheng, Mauch, Benetos and Dixon's attack/decay model](https://archives.ismir.net/ismir2016/paper/000085.pdf)
couples attack and decay components using learned same-piano templates.
[Ewert and Sandler's studio transcription model](https://arxiv.org/abs/1606.00785)
uses structured spectro-temporal patterns. These motivate investigating temporal
evidence; our rejected anchor rule does not implement either complete model.

## Quiet-note investigation

A separate frozen experiment compared the unchanged detector with a private
weighted, four-phase template fit. Fresh same-bank cases varied note age,
velocity and overlapping voices. The candidate recovered19/24 exact overlap
sets versus0/24 for the original detector, but introduced one false pitch in
that split. Harmonic chords recovered2/12 versus0/12 and introduced two false
pitches versus one. No-bass controls recovered10/12 versus6/12, with zero
false pitches versus two. The candidate failed the declared no-increase-in-
false-pitches rule and was rejected. It is not a selectable production profile.
These results do not qualify the original detector on those harder cases.

The original quiet bass failures had nonzero coefficients excluded by the
selection threshold. Exposing those coefficients as unresolved candidates
preserves useful ambiguity without claiming recovered notes or adopting a
lower detection threshold. A Gemini interpretation can cite this evidence,
but cannot use it to establish a complete chord or authorize a repair.

[Vincent, Bertin and Badeau's harmonic/inharmonic NMF paper](https://biblio.telecom-paristech.fr/cgi-bin/download.cgi?id=7663)
motivates weighted spectral objectives for low-energy notes and discusses
spurious-note risks. [The ISMIR2010 non-negative decomposition paper](https://ismir2010.ismir.net/proceedings/ismir2010-83.pdf)
discusses the weighting tradeoff and limitations of stationary templates.
Our rejected private experiment is not either paper's complete system.
