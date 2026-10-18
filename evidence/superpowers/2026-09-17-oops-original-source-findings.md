# Oops original-source recovery findings

Read-only inspection found an existing local backup MusicXML artifact for the same seed source. No source file was copied, re-imported, catalogued, or used to change the frozen live fixture.

## Reproducible inputs

- Backup source: `/Users/reidar/Backups/Keyspilli/20260816-1912-prebatch/data/artifacts/britney-spears-oops-i-did-it-again/a/variant.xml`
- Reproducible source-relative label: `britney-spears-oops-i-did-it-again/a/variant.xml`
- Companion parsed snapshot: `/Users/reidar/Backups/Keyspilli/20260816-1912-prebatch/data/artifacts/britney-spears-oops-i-did-it-again/a/notes.json`
- MusicXML SHA-256: `42cb080b1cbcf203bca36e2342b5e04cc066894b098852d12d1f1e0f4d4812fd`
- Backup parsed-note snapshot SHA-256: `bf893f4c6269651300e7c8add62b01ce17a612526d94553733ad946698b9b439`
- Existing parser: `packages/midi/src/parseXml.ts::parseMusicXmlNotes`

The backup XML parses to 1,897 notes, 332.375 beats, 95 BPM, 4/4. The frozen live fixture has 1,891 notes and the same 332.375-beat note extent. A raw `(midi,start,dur,vel,hand)` multiset comparison has 74 backup-only and 68 live-only key multiplicities; this is a source-version difference, not a melody label.

## What is recoverable

The XML has one part named `Piano` with two staves. Raw note elements expose staff/voice ownership: staff/voice `1/1` has 1,443 elements and `2/2` has 465. It also contains nine note-color classes, but the XML has no legend that assigns those colors to melody, accompaniment, or review status.

The existing parser maps staff 1/2 to R/L and uses voice identity while merging ties, then removes the raw voice field from the returned `Note` objects. Therefore source staff/voice evidence is recoverable offline, but it is not present in the frozen API payload and cannot be treated as a gold melody annotation. It supports a bounded source-recovery/import task if needed; it does not authorize automatic melody promotion.

## Decision

Source-lane recovery is feasible from the local backup, but the current live variant is not byte-equivalent to that backup and the source contains chordal material on both staves. T3 synthetic tests remain the valid implementation evidence. Oops G2 remains `needs-review` until staff/voice semantics are reviewed or the result is explicitly marked unresolved. No real-song tuning was based on these source traits.
