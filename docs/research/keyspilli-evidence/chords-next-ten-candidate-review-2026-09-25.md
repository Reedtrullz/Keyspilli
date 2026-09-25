# Ten more Chords candidates — source review, 25 September 2026

The [ranked shortlist](chords-next-ten-2026-09-25.md) now has ten full-song authored Chords timelines on draft PR #109. They are **listening candidates**, not golden-corpus additions. The five-song [golden index](../../../catalog/chord-golden-corpus.json) is unchanged. The published chord pages were used as harmonic references; change timing, sectional deviations, and repeated attacks were checked against each song's actual Advanced note grid. None of these ten has an owner listening verdict yet.

I copied only each production `a/notes.json` read-only into the isolated local preview. Those source files are not committed. Their SHA-256 values below identify the arrangements used for alignment. The local preview database had stale ABBA Advanced metadata (`D`, 124 BPM, 306 s); production has `F#`, 123 BPM, 289 s, matching the current production Advanced artifact. I corrected only the isolated preview row. All ten preview API routes now load their Advanced notes and authored timelines; they report `legacy` artifact status locally because the isolated copy contains only `notes.json`, not the complete production artifact manifest.

| Candidate | Source grid / chart events / realized chord attacks | Source-linked decisions and listening focus |
| --- | --- | --- |
| Your Song | Eb, 129 BPM, 4/4; 516 beats / 79 / 135 | Replaced the 128-beat opening-only chart. The first Eb/Bb, Ab/C, and Bb/D follow the cover's played bass; listen to expressive later verses and whether three-beat minimum strike spacing leaves enough support. |
| I Will Survive | Am, 115 BPM, 4/4; 388 / 91 / 169 | The Advanced part repeats a 32-beat cycle, including Dm over A, G7, Cmaj7 over G, and the B half-diminished function (`Dm/B`). Several chord stacks precede their repeated bass pulse by roughly 0.5–0.625 beats; the chart now follows the played stack where harmonic identity is clear. A held Am replaces two unsupported ending changes. The E-to-diminished introduction and chromatic B passage need listening. |
| Help | A, 173 BPM, 4/4; 436 / 58 / 190 | Preserved the Bm→Bm/A→G→G/F# descent and D→G→A ladder. Check that the brisk two-beat strike spacing feels natural at this tempo. |
| In the Army Now | Em metadata, 109 BPM, 4/4; 428 / 61 / 185 | The source starts in D minor and moves to E minor near beat 192. The chart includes that modulation and limits repeated rock chords to two-beat spacing. |
| Dreamer | C metadata, 148 BPM, 4/4; 520 / 73 / 121 | The piano source opens on D harmony, then uses Ab/Bb/Gm/C and a long C/Bb pedal passage. I replaced a false 100-plus-beat C7 hold with played sectional changes. This is the highest-priority harmonic check by ear. |
| All of Me | Fm, 129 BPM, 4/4; 664 / 100 / 192 | Fm→Db→Ab→Eb opening changes follow fractional source bass onsets (4.5, 8.875, 13.375). Check the later Bbm section and end-of-song attack density after reducing repeated strikes to a 2.5-beat minimum. |
| Don't Stop Believin' | C#, 118 BPM, 4/4; 520 / 107 / 196 | Its early piano bass is a rising figure, so the first cycle is timed to entries at beats 4, 6.5, 10.5, and 15.5 instead of a square four-beat grid; the second chord is G#/D# to preserve its played D# bass. Check the transition from that figure into later sections. |
| Those Were the Days | Am, 90 BPM, **2/4**; 344 / 70 / 166 | Retained the source meter and the Am→A7 approach to Dm, plus B7→E7 and Dm→G7→C. Listen for the waltz-like phrase and whether one or two strikes per short bar is best. |
| Fix You | Eb, 136 BPM, 4/4; 668 / 102 / 223 | Kept space in the opening: Eb→Ebmaj7→Cm→Bb at the cover's onsets, with a three-beat minimum strike spacing through beat 176 and two beats later. Later source-backed sections use fewer chart events than accompaniment notes. Listen to the quiet-to-loud transition and whether the denser ending feels too busy. |
| The Winner Takes It All | F#, 123 BPM, 4/4; 592 / 82 / 143 | The production artifact and DB agree on F#/123 BPM; the old preview row did not. The repeated F#→C#/F→G#m→C# bass descent is preserved. Check the long verse cycles and final cadence. |

The source `notes.json` SHA-256 values, in table order, are:

```text
Your Song              b1a3051fc7e6f0fbc29d9449f6b8f188fc83507bb944b47ad8b1f0cbd73cd72a
I Will Survive          448373fe2bb4a5c8e510b26dd6a226b5ab3366cb37808bc9029af965564dc8e1
Help                    5c8415696a87858a486835db81e4904e7d8ce71d4f4bdc9f29dbe73cad4b5e55
In the Army Now         f61af5ba58446fd7cafc71ae95569a75d1dc16ca584d787d40ec317c359656ad
Dreamer                 101adb21cbc0eb4afd7786394db041670ddcf55ddc67937de2356e468565f958
All of Me               2d8212fa850c7dfcbc3dbf0029f4b22a2ee93385fe686214b48b20db28865cfb
Don't Stop Believin'    d4fe2e2e14bb77889a37f6fe37a040df8c470897270c128c09675ab21a04b354
Those Were the Days     5b76fc45646effb0b6dd9382fe7481c8505647dffdb29be6be36215ba02c1545
Fix You                 a96c5de5d10a1b5b2bc5949f8976cf9a71e43d692be40f97c79558d1567ab964
The Winner Takes It All 9d9ae9b17b3bd10ebc973d549b12d1102606e66a9342a4702d449e7f73afd664
```

## Patterns to carry into later automatic Chords work

1. **Align the exact arrangement.** A published chord page establishes plausible harmony, but its capo, key, structure, and bar positions can differ from the Advanced grid. The raw bass onsets, simultaneous chord stacks, and measure boundaries locate changes more reliably. Your Song and All of Me have fractional entry times; Journey's rising bass figure should not be flattened into equal four-beat blocks.
2. **Treat sections and meter as explicit evidence.** Army Now changes key during the song, Dreamer has several harmonic regions, and Those Were the Days is encoded in 2/4. A single catalogue key or a standard four-beat cycle cannot stand in for source inspection. The ABBA preview mismatch shows that generation should check current artifact and database identity before evaluating music.
3. **Separate chord identity, change boundaries, and re-strikes.** The chord source supplies the harmonic vocabulary; the Advanced part supplies the rhythm. The backing replays source accompaniment onsets with a per-event minimum spacing, while explicit opening `N.C.` spans preserve silence. Too many attacks create chord spam; holding everything to the next change suppresses deliberate release. These are independent decisions and need separate listening feedback.
   I Will Survive exposed a second onset trap: repeated bass pulses land after the full chord stack. Taking the nearest later bass as the change boundary made every cycle audibly late. Use the earliest source event that actually establishes the new harmony; preserve a later bass as a re-strike, not a new change.
4. **Pedal notes can hide harmony changes.** Dreamer's C/Bb passage held low notes while the right hand alternated full triads. A bass-dominated classifier reduced this to one long C7, contradicting the played chords. The source's simultaneous upper chord stacks are needed when bass is sustained. Conversely, a right-hand single-note melody should not trigger a new chord, as the Clocks review already showed.
5. **Keep a human acceptance boundary.** The Player replay selected the authored source for all ten, with no unvoiced chord symbols, and the checked-in timelines parse end-to-end. These checks show the candidates are available for listening, not that they sound good or belong in the golden corpus. Reuse owner-approved rendered outputs as future regression targets only after listening.

## Checks and remaining gates

- `verify-chord-sources`: 18 checked-in charts parse, including these ten; no failures. The empty-database local run skipped its catalogue fallback sweep.
- `packages/catalog/test/chord-sources.test.ts`: 32 tests pass, including full coverage and source-change anchors for each of the ten.
- The exact Player backing replay selected `ug` without generated fallback for all ten. All chord symbols produced sounding voicings. There were no chord attacks less than 0.75 beats apart after the final timing pass. Explicit opening `N.C.` spans are reported as intentional fallback spans by the resolver.
- Nine of ten candidates pass the current structural Chords gate. **I Will Survive fails its semitone-clash proxy at 26% against a 25% threshold**, despite 169 attacks, 166 on exact source onsets, three dead-air onsets, and 86% strong-beat tune/chord-tone agreement. The proxy counts a tune note against every chord pitch class, including a note that is itself in the chord: 60 of 61 Fmaj7 clashes and 23 of 26 Cmaj7/G clashes have that property. E7 and the B half-diminished passage also create non-chord-tone clashes and should be judged by ear. I kept the chart/source-supported seventh harmony rather than simplify it to improve the proxy score.
- All ten isolated preview `/api/songs/{baseId}-a` routes returned Advanced notes and the intended chart. The local snapshot is for listening; production remains unchanged.
- The existing golden output audit still reports **Skyfall, My Way, and Imagine as `DRIFT`**, while Let It Be and Clocks match. This predates the ten-song work and is documented in the [golden review](chords-golden-corpus-review-2026-09-25.md#source-informed-phrasing-follow-up). Input and timeline pins match. Do not repin those three merely to make the audit green; their current phrasing needs the owner's listening decision.

Next: the owner listens to these ten local candidates, starting with Dreamer, Your Song, Journey, and Fix You. Record exact timestamps for any wrong chord or off-beat re-strike. Only then decide which candidates enter the golden corpus and use those accepted rendered outputs to evaluate an automatic new-song workflow.
