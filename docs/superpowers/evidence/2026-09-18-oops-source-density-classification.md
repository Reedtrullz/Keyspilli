# Oops [64,108) source-density classification

Date: 2026-09-18

## Scope and execution state

This is a read-only classification of the exact Oops fixture interval `[64,108)`.
No source code, tests, existing reports/checkpoints, plans, or `pnpm-lock.yaml`
were edited for this investigation. No package-manager command, commit, push,
deployment, catalogue mutation, or live mutation was run.

Repository state at capture:

- Worktree: `/Users/reidar/.codex/worktrees/musically-useful-chords-mode`
- Branch: `codex/musically-useful-chords-mode`
- Final capture `HEAD`: `4d35c0b8852bbc87a94a1a744b1c2fb620964a9f`
- The Node 22 reproduction and classification reruns were executed at this `HEAD`; the worktree remained dirty only in UI WIP when this file was captured.
- Node: `v22.22.3` from `/Users/reidar/.nvm/versions/node/v22.22.3/bin`; local runner: `tsx v4.23.11`

Exact fixture:

`docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/britney-spears-oops-i-did-it-again/a/notes.json`

- 1,891 source notes, 84 measures, 95 BPM, 4/4
- `sourceFingerprint`: `variant:britney-spears-oops-i-did-it-again:a:britney-spears-oops-i-did-it-again-a:64d18aa4c23f7625a6eb0a7a234843a7a2278003d75cba9ea04efde7d8225ad4:notes:84153b6de3857351ce92086c8f5a28f9147073070948ed96fd39e6d6f8f212ae`
- Measures in scope: 17–27, `[64,68)`, `[68,72)`, …, `[104,108)`

Reproducible command, using the repository's existing producer/reproduction
path directly (not a package-manager command):

```sh
cd /Users/reidar/.codex/worktrees/musically-useful-chords-mode
PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH \
  node_modules/.bin/tsx \
  docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit-reproduce.ts
```

The path is:

1. `resolveChordSources(data).auto`
2. `buildMelodyAccompaniment(data.notes, auto.chords, { durationBeats, sourceFingerprint, selection: "automatic", allowRests: true, soundingPolicy: "coherent-phrase", harmonicSupport: "authored-only" })`
3. `sourceBackingStream`: fixture notes whose generated source IDs are not in `result.provenance.melodyNoteIds`
4. `finalBackingStream`: current result events whose role is not `melody`

The reproduction script also compares the preserved historical JSON baseline.
That baseline is context only; it is not treated as a target.

## Current stream accounting

Within `[64,108)`:

| Stream | Notes/events | Attack locations | Lineage |
|---|---:|---:|---|
| Source notes before melody split | 327 | 85 | Fixture source |
| Automatically selected melody | 86 | — | 83 R-hand, 3 L-hand source notes |
| Source backing stream | 241 | 85 | All fixture source IDs |
| Final backing stream | 151 events | 85 | 151 source-linked, 0 generated |
| Final `accompaniment` events | 119 | 76 | Source-linked |
| Final `retained-unclassified` events | 32 | 10 of the 85 locations | Source-linked |

The final backing stream has 151 unique source note IDs; 90 of the 241 source
backing IDs are omitted by the current reduction. Every final event in the
window has a source ID and no final attack is synthesized outside the source
attack union. The support-only counters in the reproduction are 119 notes and
76 attacks; the full final backing stream is 151 events and 85 attacks because
retained source events remain in the final stream.

The exact source and final attack-location lists are identical:

```text
64, 64.5, 65, 65.5, 66, 66.5, 67, 67.5,
68, 68.5, 69, 69.5, 70, 70.5, 71, 71.5,
72, 72.5, 73, 73.5, 74, 74.5, 75, 75.5,
77.5,
80, 80.5, 81, 81.5, 82, 82.5, 83, 83.5,
84, 84.5, 85, 85.5, 86, 86.5, 87, 87.5,
88, 88.5, 89, 89.5, 90, 90.5, 91, 91.5,
92, 92.5, 93, 93.5, 94, 94.5, 94.875, 95,
95.5, 96, 96.5, 97, 97.5, 98, 98.5,
99, 99.5, 99.75, 100, 100.5, 101, 101.5, 101.75,
102, 102.5, 103, 103.5, 104, 104.5, 105, 105.5,
105.875, 106, 106.5, 107, 107.5
```

Current full-song reproduction counters for context are 1,433 output notes,
601 source-support notes, 0 generated notes, and support modes
`source-rhythm` plus `fallback`. The historical comparison reports +35
window support notes and +21 window support attacks versus its preserved
84-note/55-attack window, but those deltas do not justify deleting current
attacks.

## Auto chord boundaries used for segmentation

These are the current `resolveChordSources(...).auto` labels. They are
generated/inferred fixture labels, not reviewed harmonic truth. Because the
producer is run with `harmonicSupport: "authored-only"`, they do not authorize
synthesized harmonic backing in this run.

| Span | Current auto label | Current auto notes |
|---|---|---|
| `[64,67)` | `C#5` | 37, 44, 49 |
| `[67,68)` | `C#m` | 61, 64 |
| `[68,69.5)` | `G#5` | 32, 75 |
| `[69.5,75.5)` | `Cm` | 60, 63 |
| `[75.5,81)` | `B5` | 35, 42, 47 |
| `[81,82)` | `C#m` | 61, 64 |
| `[82,83.5)` | `G#5` | 32, 87 |
| `[83.5,89.5)` | `C#5` | 32, 85 |
| `[89.5,90)` | no auto span | — |
| `[90,91.5)` | `B5` | 35, 78 |
| `[91.5,94)` | `E5` | 35, 88 |
| `[94,97)` | `B5` | 35, 78 |
| `[97,98)` | `C#m` | 61, 64 |
| `[98,99.5)` | `G#5` | 32, 87 |
| `[99.5,103)` | `C#5` | 32, 85 |
| `[103,108)` | `D#m` | 27, 78 |

## Source-evidence classification

The categories below are evidence tags and intentionally overlap. They are
not semantic claims that a note is definitely bass, melody, or harmony.

| Tag | Defensible rule applied to source backing | Count |
|---|---|---:|
| Explicit reviewed metadata | `identitySource` or `sourceLane` is present | 0 |
| Bass/register candidate | `hand === "L"` and lowest L-hand MIDI at that source attack | 44 |
| Melodic-hook candidate | backing `hand === "R"`, MIDI ≥ 75, duration ≥ 0.5 beat; candidate only | 14 |
| Held overlap | Note end extends past a later source-backing attack | 32 |
| Repeated chord/voicing attack | Backing R-hand group has at least two R notes at the same attack | 186 notes at 82 attack locations |
| Unclassified | No tag above | 7 |

The repeated-voicing evidence is strongest at the attack level: only three of
the 85 source-backing attacks do not have at least two backing R notes:
`77.5`, `94.875`, and `105.875`. Common repeated source tuples include
`81,85` at 14 attacks, `80,84` at 14, `80,85` at 13, `80,83` at 11,
`76,80,83` at 5, and `78,83,87` at 5. These are repeated source shapes, not
proof that every member is safe to remove.

The 14 hook candidates under the stated rule are:

```text
64:78/2/R, 68:75/1.5/R, 75.5:83/2/R, 80:80/0.5/R,
86:75/0.5/R, 88:76/2/R, 92:76/2/R, 94:78/0.5/R,
96:80/0.5/R, 102:75/0.5/R, 103.5:81/1/R,
104:76/2.5/R, 104.5:80/0.5/R, 106.5:76/0.625/R
```

The 32 held-overlap notes are:

```text
64:30/0.625/L, 64:78/2/R, 65.5:64/1.5/L, 67:61/0.875/L,
67:64/1/L, 68:75/1.5/R, 69.5:60/1.125/L, 69.5:63/1.125/L,
71:32/0.875/L, 72:33/0.75/L, 73:64/0.625/L, 74:33/1.5/L,
81:61/0.625/L, 81:64/0.625/L, 82:32/0.625/L, 87.5:64/1.25/L,
88:76/2/R, 92:28/0.625/L, 92:76/2/R, 94:35/0.625/L,
95:36/0.625/L, 97:61/0.625/L, 97:64/0.625/L, 98:32/0.625/L,
99.5:32/0.375/L, 100:37/0.625/L, 101.5:37/0.375/L,
103:27/0.875/L, 103.5:81/1/R, 104:76/2.5/R, 106:28/0.875/L,
106.5:76/0.625/R
```

The seven source notes with no evidence tag are:

```text
64:42/0.5/L, 75.5:42/0.5/L, 75.5:47/0.5/L,
77.5:42/0.375/L, 77.5:47/0.375/L,
86:63/0.5/L, 102:63/0.375/L
```

## Opt-in conservative source-only preview

After the classification, the worktree added an explicitly selectable
`sourceBackingMode: "conservative"` preview. This is not the automatic/default
path and is not a claim that the source is harmonically understood. It disables
harmonic generation, keeps source IDs on every emitted backing event, protects
the lowest playable source note at each backing attack plus held, long/high,
and explicit-identity candidates, and removes only repeated short R-hand
voicing members that match the immediately preceding source tuple.

The Node 22 one-off comparison used the same fixture, source fingerprint,
automatic melody selection, `allowRests: true`, coherent sound policy, and
`harmonicSupport: "authored-only"` as the default reproduction. It was run
against the current worktree implementation at the follow-up commit; the
historical JSON was not changed.

| Mode | Full final backing events | Full attacks | Support-only events | Support-only attacks | Generated | Source-linked final events |
|---|---:|---:|---:|---:|---:|---:|
| Default | 151 | 85 | 119 | 76 | 0 | 151 |
| Conservative preview | 157 | 85 | 37 | 24 | 0 | 157 |

The conservative preview retains 6 more events than the current default final
stream in this interval while leaving the 85-attack source grid unchanged. It
is a source-only voicing preview, not a rhythm repair. The support-only count is
intentionally not the full-stream count because most remaining source-linked
events are retained-unclassified anchors. No inferred or generated pitch is
emitted in either mode.

Protected and unresolved source notes are emitted as `retained-unclassified`
and remain mandatory input to the final sounding-limit pass. That pass still
runs, but these notes bypass ordinary support allocation and velocity reduction;
the preview is not a claim of safer density or physical playability.

Per-measure classification and final lineage:

| Measure | Span | Source notes | Source attacks | L/R | Bass | Hook | Held | Repeated R | Unclassified | Final events | Accomp. | Retained | Final attacks |
|---:|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 17 | 64–68 | 22 | 8 | 5/17 | 3 | 1 | 5 | 17 | 1 | 12 | 2 | 10 | 8 |
| 18 | 68–72 | 21 | 8 | 4/17 | 3 | 1 | 4 | 17 | 0 | 11 | 1 | 10 | 8 |
| 19 | 72–76 | 22 | 8 | 6/16 | 4 | 1 | 3 | 16 | 2 | 14 | 5 | 9 | 8 |
| 20 | 76–80 | 3 | 1 | 3/0 | 1 | 0 | 0 | 0 | 2 | 3 | 2 | 1 | 1 |
| 21 | 80–84 | 24 | 8 | 6/18 | 5 | 1 | 3 | 18 | 0 | 17 | 5 | 12 | 8 |
| 22 | 84–88 | 24 | 8 | 6/18 | 5 | 1 | 1 | 18 | 1 | 14 | 5 | 9 | 8 |
| 23 | 88–92 | 25 | 8 | 4/21 | 4 | 1 | 1 | 21 | 0 | 14 | 6 | 8 | 8 |
| 24 | 92–96 | 25 | 9 | 5/20 | 5 | 2 | 4 | 20 | 0 | 17 | 2 | 15 | 9 |
| 25 | 96–100 | 26 | 9 | 6/20 | 5 | 1 | 4 | 20 | 0 | 20 | 4 | 16 | 9 |
| 26 | 100–104 | 26 | 9 | 6/20 | 5 | 2 | 4 | 20 | 1 | 20 | 3 | 17 | 9 |
| 27 | 104–108 | 23 | 9 | 4/19 | 4 | 3 | 3 | 19 | 0 | 15 | 2 | 13 | 9 |

All final events in each row are source-linked. The conservative preview emits
`120` retained-unclassified events across all `85` source attack locations;
they are not generated harmony and remain evidence-limited source material.

Representative final lineage from the live stream:

```text
64   -> 30 and 42, each source-linked to its same-pitch source note
75.5 -> 35, 42, and 47, each source-linked; repeated L stack retained
80   -> 80 and 85, each source-linked R notes
95   -> 36, 80, 84, and 85, all retained-unclassified and source-linked
104  -> 76 and 80, each source-linked R notes
```

## Reduction assessment

### Evidence-supported candidates

- The 82 repeated R-hand attack locations are concrete source-only density
  evidence. Short repeated R members that are neither long/high hook
  candidates nor held across a later attack are the narrowest candidates for
  review or reduction.
- The seven unclassified notes are concrete candidates for manual inspection,
  especially the non-lowest L notes at `75.5` and `77.5`, and `102:63`.
  Their non-lowest register is evidence of possible redundancy, not proof of
  an omitted chord tone.
- The lowest L note at an attack is a defensible bass/register anchor for a
  source-only reduction pass, but the fixture contains no explicit reviewed
  bass identity. Preserve it by default rather than call it semantically
  correct.
- The 14 long/high R candidates and 32 held notes should not be removed by a
  density-only rule. Held notes can carry phrase continuity, and the high/long
  notes are plausible hooks even though the fixture supplies no reviewed hook
  metadata.

### Evidence-insufficient cases

- The fixture has zero `identitySource`, `sourceLane`, or equivalent reviewed
  metadata in this interval. No source note is explicitly approved as bass,
  hook, or chord tone.
- The current auto chord labels are inferred from the same contaminated note
  material and must not be used as independent harmony evidence.
- The 151 final events have no generated harmonic lineage, so this real fixture
  does not demonstrate a meaningful generated-only rhythm/reduction path.
- The historical 55-attack window is aggregate evidence only. Matching it by
  deletion would be target-fitting, not a defensible source correction.

## Proposed next implementation path

Do not add a blanket automatic deletion rule for `[64,108)`.

1. Keep the automatic path source-only and fail-closed: preserve explicit
   reviewed anchors when present, preserve held notes and long/high hook
   candidates, preserve the lowest L-register candidate, and only consider
   short repeated-voicing members when their source identity and phrase
   context are reviewed. Emit source IDs and `needs-review` provenance for
   mixed or unclassified spans.
2. For this fixture, prefer a phrase-local, user-selectable source reduction or
   manual correction. The conservative preview is now exposed as a separate
   source-backing choice from melody hand/rest correction. It retains source
   IDs and source-only pitches, but its confidence remains limited because the
   source has no reviewed identities; it is not the default and must be
   previewed before practice. This is the appropriate path for the 32
   retained-unclassified events and repeated R stacks because it does not
   infer harmony from contaminated notes.
3. Add automatic reduction only after the source artifact supplies reviewed
   bass/hook identities or an authored chord/phrase annotation. Re-run the
   same stream comparison and require a human musical check before calling the
   result useful.

## Non-claims

This file does not claim musical usefulness, correct harmony, human
playability, fingering quality, audio acceptance, or a fix for the Oops dense
interval. The conservative preview demonstrates source-linked voicing
reduction only; it does not reduce the attack grid. It does not claim merge,
release, catalogue, deployment, or live production state.
