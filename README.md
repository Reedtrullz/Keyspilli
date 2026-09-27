# Keyspilli

**Play the songs you love.** A self-hosted piano practice app with interactive notation, difficulty variants, and backing-only Chords arrangements.

[![CI / Deploy](https://github.com/Reedtrullz/Keyspilli/actions/workflows/ci.yml/badge.svg)](https://github.com/Reedtrullz/Keyspilli/actions/workflows/ci.yml)

[Documentation](docs/README.md) · [Contributing](CONTRIBUTING.md) · [Musical review files](https://github.com/Reedtrullz/Keyspilli/releases/tag/archive/chords-review-2026-09-27) · [Private deployment](https://keys.reidar.tech)

Keyspilli is built for personal piano practice. The hosted instance requires an invitation and credentials; it is not a public demo or a multi-user account service.

## Practice your way

- **Four views:** Fall Down, Note letters, Sheet Music, and Lead Sheet.
- **Original and Chords:** follow the arrangement or play compact bass-and-chord backing that leaves room for singing. Chords is shared across a song's difficulty levels; melody plus accompaniment is an explicit option.
- **Practice controls:** slow down, transpose, loop a passage, isolate a hand, and use guided note/chord practice.
- **Input and sound:** computer/on-screen keys, connected MIDI keyboards where supported, and microphone input in beta; piano, synth, and organ playback.
- **Portable lessons:** import MIDI, MusicXML, or compressed MusicXML (MXL), and export MIDI, MusicXML, and PDF.

Sheet Music and standard downloads use the stored arrangement. They do not automatically export the active Chords backing; the [song preparation tools](docs/development.md#prepare-original-and-chords) produce separate Chords files.

## Add a song

Open **Add a song** and upload a symbolic music file, up to 10 MiB. Keyspilli validates it and builds the difficulty variants. Optional source search provides metadata links when a provider is configured; it does not download third-party scores.

An opt-in **YouTube piano-tutorial beta** extracts notes from supported visible-key tutorials. It requires the tutorial worker and runtime configuration, and can reject unsupported videos. Arbitrary recording-to-piano transcription is not the standard import path. See [import configuration](docs/development.md#import-options).

Generated arrangements can still need musical correction. Automated checks establish parsing and playback consistency; they do not establish that every song sounds good. See [Chords tuning](docs/chords-tuning.md) and the [release gates](docs/decisions/0004-release-gates.md).

## Run locally

Use **Node.js 22.22.3**, matching CI, and npm. Native SQLite dependencies may need Python and C/C++ build tools if a prebuilt binary is unavailable.

```bash
git clone https://github.com/Reedtrullz/Keyspilli.git
cd Keyspilli
npm ci
npm run dev -w @keyspilli/web -- --hostname 127.0.0.1
```

Open [localhost:3000](http://localhost:3000), then upload a file through **Add a song**. An empty local catalog initializes automatically; no Python worker is needed for symbolic uploads. Keep this development server local. Public hosting requires the private access boundary described in [operations](docs/ops.md).

The full hosted catalog is **not bundled with a clone**. `npm run pipeline` needs the source files named in `catalog/manifest.json` and writes artifacts and SQLite state. See [development setup](docs/development.md) for isolated data, seed downloads, and tests.

## Project layout

| Location | Responsibility |
| --- | --- |
| [`apps/web`](apps/web) | Next.js/React interface, upload routes, player and exports |
| [`packages/catalog`](packages/catalog) | SQLite catalog, ingest, source provenance and atomic publication |
| [`packages/midi`](packages/midi) | MIDI/MusicXML parsing, difficulty variants and harmony |
| [`packages/player-core`](packages/player-core) | Playback, accompaniment and practice grading |
| [`packages/engrave`](packages/engrave) | Verovio score rendering and PDF support |
| [`services/transcribe`](services/transcribe) | Tutorial extraction and separate legacy audio research paths |
| [`catalog`](catalog) | Source metadata, chord charts and review references |
| [`deploy`](deploy) | Docker/Ansible deployment, access boundary and backups |

## Contribute

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Contributors can download the [Chords review dataset](https://github.com/Reedtrullz/Keyspilli/releases/tag/archive/chords-review-2026-09-27) and [historical evidence archive](docs/archive/README.md), including checksums and matching source revisions. Preserve source attribution and review status when working with musical material.

Useful starting points: [developer guide](docs/development.md), [operations](docs/ops.md), [Chords tuning](docs/chords-tuning.md), and [private-alpha feedback](docs/private-alpha-feedback-guide.md).
