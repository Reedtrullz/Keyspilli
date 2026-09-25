# Tuning Chords mode

Chords mode plays a bass note and a chord for every visible song, derived from its Advanced arrangement and shared by all difficulty levels. Global tuning values live in [`packages/midi/src/chords-tuning.ts`](../packages/midi/src/chords-tuning.ts); source-informed phrasing lives in [`packages/player-core/src/accompaniment.ts`](../packages/player-core/src/accompaniment.ts). Structural checks help locate passages to listen to, but do not establish musical quality.

## How the backing is made

1. **Chord names.** `inferHarmonyTimeline` (`packages/midi/src/harmony.ts`) scores every major and minor triad against the notes sounding on each beat, weighted by how long they sound and by the lowest note. It then picks the best path through the song, paying a penalty for each change. Every note counts as evidence, including the sung line, because a backing that fights the tune is wrong. No source note is copied into the backing. Silence and a short pickup bar get no chord (N.C.). Authored chord charts and learner levels keep their own labels.
2. **Strikes and releases.** `resolveAccompaniment` strikes each chord where the arrangement's left hand strikes, or where its bass note changes when a source has no hands. A beginner is asked to strike at most once a beat. For an authored chart, isolated non-root bass notes and a softer upper root octave after a bass fifth do not automatically re-strike the whole chord; a chart change still starts on time. A held source chord stack can suppress a synthetic barline strike. When fewer than two distinct chord tones remain held, the sounding chord can end up to a quarter beat before the next strike. The displayed chord label keeps the chart's full span. Generated timelines retain their existing strike and duration rules.
3. **Voicing.** The existing voicing keeps the right-hand triad within an octave around middle C and moves it as little as possible between chords, with the bass in the left hand.

The Winner pilot (`reviewed-source-backing.ts`) still overrides this for production's exact Winner Advanced file.

## The knobs

| Setting | What you hear when you raise it |
| --- | --- |
| `harmony.changePenalty` | Chords hold longer and ignore passing harmony. Lower follows every change and can flicker. |
| `harmony.changeGrid` | Where a chord may change: `"beat"`, `"half-bar"` or `"bar"`. |
| `harmony.pedal` | Notes count as held to the end of this window when naming chords, like a sustain pedal. It stops single arpeggio notes becoming chords. |
| `harmony.bassWeight` | The lowest note decides the root more often. |
| `harmony.outsideWeight` | Non-chord tones count more against a chord. |
| `harmony.presenceWeight` | Chords whose every tone is present win more often. |
| `harmony.nonDiatonicCost` | Chords outside the song's key need stronger evidence. |
| `harmony.qualityCost` | Which chord types exist and how much evidence each needs. `null` switches a type off. Only major and minor are on, because they scored best and are the easiest to play. |
| `strikes.minSpacingBeats` | Fewer, calmer strikes for a beginner. |
| `strikes.maxSilentBars` | Longer gaps allowed before a held chord is struck again. |
| `gate.*` | The limits a song's backing must meet (below). |

## Check a change

Run everything from the repository root on Node 22.

**Listen:** run the app (`npm run dev`), open a song, choose Chords. Harmony labels are computed on the server and strikes in the browser, so a reload picks up the change.

**Against expert chords.** POP909-CL (MIT licence) has 909 pop songs as piano MIDI with expert-reviewed chords. The benchmark runs each song through the catalogue's own import (`buildVariants`) and scores the labels. Every fifth song is held out; tune on `dev` and read `holdout` last.

```bash
git clone --depth 1 https://github.com/AndyWeasley2004/POP909-CL-Dataset output/pop909-cl
npx tsx packages/midi/scripts/chord-benchmark.ts output/pop909-cl/POP909_processed --split dev
npx tsx packages/midi/scripts/chord-benchmark.ts output/pop909-cl/POP909_processed --gate
```

`--tuning file.json` tries harmony settings without editing the file, for example `{"changePenalty": 0.4}`. Scores are shares of time: `root`, `majMin` (right major/minor triad), `sevenths` and `segmentation` (how well chord changes line up).

**On the catalogue.** The evaluator replays the Player's own Chords path for every visible song and applies the gate:

```bash
KEYSPILLI_DATA_DIR=/path/to/data npx tsx apps/web/scripts/evaluate-all-song-chords.mts --gate
```

It lists each failing song with its reasons. Each check stands in for something a listener hears:

| Check | Stands in for | Gate |
| --- | --- | --- |
| Dead air: a source note starts after a bar without a strike or sounding backing, outside an explicit N.C. span | "There are no chords here" | `maxDeadAirOnsets` |
| Share of the tune's strong-beat notes that are chord tones | Wrong chord | `minStrongBeatTuneChordToneShare` |
| Share of tune notes a semitone from a backing note | Clash | `maxTuneSemitoneClashShare` |
| Share of chords lasting one beat or less | Flicker, hard to follow | `maxOneBeatChordShare` |

The report counts source onsets inside explicit N.C. spans separately as `intentionalSilenceOnsets`. The tune is approximated by the highest right-hand note, so these checks are weaker evidence than the benchmark. Use them to find songs worth a listen, and the benchmark to decide whether a setting is better.

For the five current owner-accepted reference songs, the local replay audit checks pinned Advanced notes, authored timeline, selected source, and realized backing digest:

```bash
KEYSPILLI_DATA_DIR=/path/to/data npx tsx apps/web/scripts/audit-golden-chords.mts --require-match
```

An unaccepted phrasing candidate reports `DRIFT` for each changed song until the owner has listened and accepted its new backing. Do not replace accepted digests solely to make this audit pass.

## Current results

On 24 September 2026, with the defaults in the tuning file:

- **POP909-CL, 181 held-out songs.** Right major/minor 87.3% (the old labeller: 17.3%). Right root 88.0% (old: 48.0%). The 728 tuning songs score the same, so the settings are not overfitted.
- **Staged all-song snapshot, 459 visible songs.**
  - 387 pass the gate.
  - Most failures are classical pieces and sparse songs, where major/minor triads fit poorly.
  - None is silent, and 28 have some dead air.
  - The median song fits the tune on 76% of strong beats and clashes on 12% of tune notes.
  - Its median flicker share is 8%.
