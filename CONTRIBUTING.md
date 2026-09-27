# Contributing to Keyspilli

Keyspilli is a personal piano practice app. Useful contributions include player fixes, accessibility improvements, clearer documentation, and better Original/Chords arrangements.

## Start here

1. Follow the [developer guide](docs/development.md) with Node.js 22.22.3 and `npm ci`.
2. Work on a focused branch with an isolated local catalog.
3. For code changes, run the relevant tests and typechecks. For docs, verify commands and links against the source.
4. Open a pull request describing the problem, resulting behavior, verification, and any remaining limitations. Add a playable preview for musical changes.

CI covers engineering checks. Musical quality, recognizable phrasing, and keyboard playability have separate [release gates](docs/decisions/0004-release-gates.md). A successful test run is not a listening verdict.

## Musical files and review evidence

| Download | Contents |
| --- | --- |
| [Chords review dataset](https://github.com/Reedtrullz/Keyspilli/releases/tag/archive/chords-review-2026-09-27) | Preserved song/catalog files for contributor testing and Chords automation work; release README, manifest and checksums explain the snapshot. |
| [Historical evidence archive](https://github.com/Reedtrullz/Keyspilli/releases/tag/archive/repository-evidence-2026-09-27) | Historical audio, MIDI, screenshots, review reports and manifests removed from the active checkout. |

Read the release notes, verify `SHA256SUMS`, and extract into a separate empty directory. Use current `main` for new Chords work and each snapshot's matching historical revision to reproduce old evidence; never overwrite a live catalog with an archive. [Archive navigation](docs/archive/README.md) links retained reports and unresolved findings.

Keep raw source media, generated catalogs, SQLite databases, tokens, cookies and local credentials out of new commits. The archives preserve existing collaboration material; availability is not a blanket license for the music. Retain provenance and respect source-specific permissions. The repository currently has no top-level software license; do not label it MIT or otherwise assume a license that has not been selected.

## Chords contributions

Start with [Chords tuning](docs/chords-tuning.md), the [golden corpus](catalog/chord-golden-corpus.json), and [song preparation](docs/development.md#prepare-original-and-chords). Chords defaults to bass-and-chord backing that leaves room for singing. Preserve rests, harmonic timing, useful hand balance, and playable shapes. Keep Original and Chords review decisions distinct.

Include source identity, artifact hashes, exact reproduction steps, playable before/after excerpts, and known gaps. Do not replace accepted golden digests solely to make a regression check pass. Existing approval applies to its exact heard version; changed musical output needs its own assessment.

## Report a problem

Use [GitHub Issues](https://github.com/Reedtrullz/Keyspilli/issues) for non-sensitive bugs. Include what you tried, expected/actual behavior, browser/device, and reproduction steps. For a song, include its title, level, mode and passage timestamp. Do not attach private music or credentials. The [private-alpha feedback guide](docs/private-alpha-feedback-guide.md) has a compact template.
