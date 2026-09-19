# Historical compatibility diagnostics (not T3 completion)

> This report is historical fixture evidence only. It is retained to compare
> the producer against the earlier three-fixture run; it is not acceptance
> evidence for T3 because it does not use the pinned canonical loader inputs
> for all required targets.

Revision: `e309c86`

Run under Node `v22.22.3` from the repository root:

```sh
./node_modules/.bin/tsx docs/superpowers/evidence/2026-09-19-chords-finish/t3-structural-evaluation.ts
```

The evaluator uses the frozen three-fixture set, automatic melody selection,
`allowRests`, coherent-phrase sounding limits, and authored-only harmonic
support. It hashes the complete source fixture and the final allocated event
projection, then measures the final events rather than pre-allocation
candidates.

| Fixture | Source SHA256 | Final event SHA256 | Source notes | Final events/attacks | Generated support | Fallback beats | Review beats | RH max sim/sounding | LH max sim/sounding |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| Oops | `346c168afa388c8582fbd631a1e0d79ba8bd585caa49ad7a1082492b5ecb7f98` | `d946ceaf10eaacc699743cebdfcf3069251daa6e0bd6e14ca343aea6f810965e` | 1891 | 1433 / 625 | 0 | 111 | 111 | 4 / 5 | 3 / 3 |
| Blackbird | `5aa5671d42bd93c2ac65c1fd21c87aa049b8baead3dfb48ae265213e6f445c75` | `b3db09301e1ecc108115c74fe9b44875088f433b18bc0ffcae06b7a7a8eb709b` | 1069 | 1041 / 657 | 0 | 53.625 | 53.625 | 3 / 3 | 3 / 3 |
| Hell | `587680e888ee479a4be9c4c664b5910af88ecb2132863091e8b661b65040f6e4` | `486f57bbefc1b25f12cab8f0c7d6db1b8f3f5b65d57a51cc60c1f72022d81257` | 1130 | 1110 / 717 | 0 | 88.125 | 88.125 | 3 / 4 | 3 / 3 |

Structural diagnostics:

- Oops: 583 melody events, 850 support events, 458 source notes not emitted; strategies `original=98`, `source-reduction=236`, `silence=16`. The largest rapid region is beats `204–208.375` with 35 rapid IOIs and 36 RH attacks; the worst RH top-voice leap is 38 semitones at `132.315789s`.
- Blackbird: 554 melody events, 487 support events, 28 source notes not emitted; strategies `original=19`, `source-reduction=111`, `silence=1`. The worst RH top-voice leap is 18 semitones at `56.875s` with a `0.1875s` gap.
- Hell: 538 melody events, 572 support events, 20 source notes not emitted; strategies `original=61`, `source-reduction=180`, `silence=7`. The largest rapid regions are beats `135.125–135.5` and `246.625–247`, each with 3 rapid IOIs; the worst RH top-voice leap is 27 semitones at `9.789474s`.

All three fixtures produced zero generated support because their labels were
not independent authored harmonic evidence under the evaluator policy.
Unresolved spans are predominantly ambiguous melody; the output is therefore
not a semantic melody proof. The results are structural diagnostics only and
do not establish recognizability, instrument balance, pedal cleanliness,
target-tempo fingering, human listening, or keyboard acceptance. Somebody To
Love and Your Song are not included because no matching frozen runtime
fixtures were available in this worktree; substituting another source would
invalidate the pinned-source gate. The canonical loader capture is recorded
separately in `t3-canonical-loader-evaluation.md`.
