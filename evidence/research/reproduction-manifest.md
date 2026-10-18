# Reproduction manifest

This manifest records the tools and boundaries used by the experiments. It is
deliberately path-free and does not preserve model weights or copyrighted
media.

| Component | Provenance/configuration | Retention |
| --- | --- | --- |
| Demucs | `htdemucs_6s`, CPU worker route | weights reacquirable; delete local cache when not actively needed |
| Basic Pitch | ONNX/CLI role-specific passes; tempo supplied by worker/fallback | package/container is reproducible; generated stems are ephemeral |
| BS-RoFormer | local separator/checkpoint used for A/B evidence | reacquirable checkpoint; no Git copy |
| YourMT3+ | local probe/environment for comparison | reacquirable; no Git copy |
| Audiveris | optional local PDF/MusicXML conversion | keep adapter and reports; delete raster/intermediate output |
| HOMR | optional score/OMR comparison path | keep adapter and compact conclusions; delete generated corpus media |
| FluidSynth | optional local MIDI renderer | SoundFont identity/hash belongs in a private render manifest, not source control |

Common deterministic boundaries:

* beats are normalized through the parsed MIDI tempo/time-signature metadata;
* metal onset clusters use a `0.08` beat tolerance and phrase breaks at `1.5`
  beats;
* generated artifacts are written under an external `KEYSPILLI_ARTIFACT_ROOT`;
* evaluation references are opened only after generation candidates are frozen;
* reports use hashes and logical IDs, never source paths or raw note arrays;
* human claims require at least two listeners and are not inferred from CI or
  onset/pitch metrics.

Exact private-file SHA-256 values are kept in the ignored local retention
manifest. Public Git contains only code, tests, small reports, and this
reproduction boundary.
