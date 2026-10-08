# Lyric excerpts and omitted marker boundaries

This batch edits twelve maps and adds eight bases: five printed stanza excerpts, three Pop lyric maps, and updates to Help and three retained-marker maps. Expected public coverage is17 to25 of441 bases with at least one named span. Most forms remain incomplete; this is not catalog-wide naming completion or musical acceptance.

## Complete paragraph role correspondence

Saved chart paragraphs must contain at least two substantive lines and60 normalized characters. Every substantive line is retained, including short lines. The whole paragraph must match timed MIDI lyric text at complete cue edges. No word substitution, partial line or internal cue fragment is accepted.

A paragraph may occur several times. Every acquired chart containing that exact complete paragraph must agree on its generic role. Each exact timed occurrence can then carry `Verse excerpt` or `Chorus excerpt`; no occurrence number or repeated-harmony assignment is selected. Conflicting roles, ambiguous lyric tracks, overlapping candidate spans and zero-duration matches are rejected. Excerpts stop at the last matched cue onset, excluding final syllable release. Full section boundaries and downbeats remain unresolved.

This supports Imagine and Can't Help Falling in Love, adds a unique Verse excerpt to Let It Be, and extends Help while preserving its separately checked Intro0..32 and prior receipts. The prepared Britney chart candidate was omitted because the existing source-marker map is stronger. Its source sections remain in use.

## Printed stanza excerpts

Five byte-matched Mutopia scores explicitly assign `stanza = "1."` to a complete lyric block. That block uniquely matches one timed source lyric track. The map says `Stanza 1 excerpt`, from first to last matched cue onset, excluding release. Other printed stanzas occur in parallel over the same music; the maps do not invent successive performed verses.

The bases are I Cannot Sing the Old Songs, When the Swallows Homeward Fly, Sally in Our Alley, Home Sweet Home, and Alice, Where Art Thou. C. W. Glover's Do They Think of Me at Home and The Blue Alsatian Mountains failed unique full-block correspondence and remain unresolved.

## Literal retained markers

Journey's exact retained FF06 stream labels Instrumental228..244 and guitar solo372..404. The old guitar solo span extended to516 across an ad-lib cue at404 and End500; it now stops at404. Numeric, piano, strangers and ad-lib cues remain estimated. Every cue terminates the preceding named certainty. Journey already had a named span; it is not counted as a newly named base.

Afterlife's previously broad Chorus spans included the explicit Riff A224..244 and Riff B372..404 markers. Those source labels are now separate and the Choruses stop at224 and372. Britney's explicit Break192..208 similarly ends Chorus2 at192; End332 ends the last named span. Its trailing release remains estimated. These are literal retained annotations, not official artist form declarations.

## Identity, confidence and checks

All maps pin the captured source hash, actual production Advanced-note hash and playback BPM. Independent Mido readers match every producer pitched onset within1/16 beat on the raw source quarter-beat clock. That is a pitch/onset correspondence check, not a duration, expressive timing, artistic authority or musical-quality judgment.

The lyric `confidenceScore` is the minimum of complete normalized-text coverage, unambiguous role or printed-stanza correspondence and independent pitch/onset clock correspondence. It is an uncalibrated correspondence score, not musical probability. Weak ordered-harmony trials are not rescued by this score; these excerpts use separate exact timed-text evidence.

An independent native reviewer checked the nine excerpt maps, full saved paragraphs, all seven Pop charts, score stanza references, raw MIDI and captured pins. It identified the redundant Britney chart replacement before catalog insertion; that candidate was removed. Ten adversarial matcher cases reject missing/changed text, omitted short lines, cue fragments, too-short/single-line paragraphs, mixed role names and zero intervals. Repeated text keeps a generic label only. A separate independent review passed all three marker edits: it read their complete FF06 streams directly, rechecked7,617 producer onsets, and confirmed all twelve map integrations and both unchanged learner-blocked entries. No material findings remained.

Raw saved charts, source copies, private checker scripts and receipts remain under `output/section-all-bases/`; copied song text is not checked into the repository. The two learner-blocked maps, generation manifests, owner section metadata and `inferSongForm` are preserved.
