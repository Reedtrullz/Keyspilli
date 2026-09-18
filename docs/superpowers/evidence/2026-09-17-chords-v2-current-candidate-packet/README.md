# Chords v2 current-candidate Oops packet

This bounded packet is current Player evidence for the frozen Oops development phrase [64,108] at 95 BPM. It was captured from checkout df09212e33c384036f8bd5d7978dc82facdcb3c5 using the actual Player source path and browser AudioEngine synth.

Listen:

- [Original](./oops-development-64-108-original.webm)
- [Current Automatic](./oops-development-64-108-current-automatic.webm)

Player path: resolveChordSources -> selectChordSource("auto") -> melodyHarmonicSupportPolicy(auto) -> buildMelodyAccompaniment. The selected generated source is variant:a:notes.json; the current Automatic policy is authored-only. The policy implementation is 7775d5b383289a28212dc9c2a8ec2e1f3b752d81. The status-accounting correction is f0cb469464385addaced7e451c9e38aca82175f5 and does not change this audio.

Both captures passed the existing Playwright capture test and contain signal. The requested capture duration was 28.79 seconds; decoded PCM is 28.86 seconds, and ffprobe reports 28.800089 seconds for Original and 28.803113 seconds for Current Automatic. Hashes and complete source identity are in manifest.json.

The historical reserved packet at ../2026-09-17-chords-v2-capture-packet/ is unchanged and remains historical evidence. The resume comparison is intentionally not copied here. Human musical acceptance remains pending.
