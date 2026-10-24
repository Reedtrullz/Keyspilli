# Development

## Runtime and local data

Run commands from the repository root with Node.js 22.22.3 (the CI pin) and pnpm, which Corepack provides at the version pinned in `package.json` (`corepack enable` once). Install the lockfile with `pnpm install --frozen-lockfile`; the root package's broader engine range is not the tested runtime pin. If `better-sqlite3` must compile, install Python and a C/C++ toolchain first. Changing Node versions may require a fresh `pnpm install --frozen-lockfile`.

For a separate local catalog, use a directory under ignored `output/`:

```bash
export KEYSPILLI_DATA_DIR="$PWD/output/dev-data"
pnpm --filter @keyspilli/web run dev --hostname 127.0.0.1
```

Without the override, runtime state lives in `data/`: `db.sqlite`, `artifacts/`, and `uploads/`. Uploading from the browser bootstraps an empty catalog. Source files are retained, so use material you are authorized to process. Do not point experiments, tests, or bundle installs at a running service's data directory.

## Seed catalog

A clone contains metadata and a small number of source files, not the hosted library. The optional seed fetch downloads from Mutopia **and rewrites `catalog/manifest.json`**, merging available local sources. Run it in a disposable checkout, inspect the manifest diff, and retain each source's attribution/license.

```bash
pnpm --filter @keyspilli/catalog run fetch-seed
pnpm run pipeline
pnpm run verify-catalog
```

Use the default data directory for this sequence: the fetch script writes `data/seed-midi` under the checkout, while the pipeline honors `KEYSPILLI_DATA_DIR`. Unset an earlier override first, or deliberately copy the needed seeds into the chosen isolated data directory. The pipeline creates six stored variants per base and updates SQLite; missing sources cause failure. Disabled manifest entries can remove stale rows. It is not a read-only check or a production sync command.

## Import options

| Path | Requirements and behavior |
| --- | --- |
| MIDI / MusicXML / MXL | Browser `/uploads`; maximum 10 MiB; web app alone is sufficient. Re-uploading identical bytes retains a stable base ID. |
| Optional source discovery | Server-side `KEYSPILLI_SOURCE_SEARCH_PROVIDER=brave` and `KEYSPILLI_SOURCE_SEARCH_API_KEY`; metadata only. Direct upload works without it. |
| Piano-tutorial beta | `KEYSPILLI_TUTORIAL_BETA=1`, a nonempty `KEYSPILLI_DATA_DIR`, and production/development runtime. The development-only `KEYSPILLI_TUTORIAL_PREVIEW=1` is an alternative. Run a compatible tutorial worker against the same data directory. |
| Legacy full-mix/stem transcription | Explicit operator/research workflow; see [legacy audio worker](legacy-audio-worker.md). |

Direct symbolic upload supports MIDI formats 0 and 1 with positive PPQ timing and at most 512 tracks. It rejects format 2, SMPTE timing and invalid format-0 track counts. MusicXML/MXL upload supports `score-partwise` notes, rests, chords, ties, divisions, compatible part meters, key/time signatures and constant quarter-note tempo. A bounded single-part, two-pass repeat subset is supported; other repeats, endings and navigation, changing/non-quarter tempo and conflicting part meters are rejected. MXL extraction accepts ordinary single-disk ZIP entries and limits the actual expanded data to 64 MiB across 200 entries. ZIP64 and spanning archives are unsupported. Transposition, octave-shift and nonzero note attack/release offsets now require an actionable alternative export; omitted dynamics and expression are reported explicitly. See the [MusicXML fidelity boundary](ops/musicxml-fidelity.md) for supported checks and format-specific losses. A successful symbolic import is not expressive or musical certification.

The tutorial worker's complete pinned dependency recipe is [`services/transcribe/Dockerfile.tutorial`](../services/transcribe/Dockerfile.tutorial), target `worker`. The default target is a standalone extraction CLI, not the queue worker. The deployed workflow builds the worker target. Root [`docker-compose.yml`](../docker-compose.yml) selects the older audio worker and does not enable the tutorial beta automatically.

Server-side secrets belong in the process/deployment secret store, never in browser code or committed files. For direct machine mutations, configure `KEYSPILLI_API_TOKEN` and use the bearer transport described in [operations](ops.md#bounded-symbolic-uploads). Same-origin browser checks rely on the authenticated reverse proxy in production; they are not a user account system.

## Checks

```bash
pnpm run typecheck
pnpm test
```

Catalog-dependent checks require a populated local catalog:

```bash
pnpm run verify-catalog
pnpm run verify-chord-sources --require-catalog
pnpm run calibrate
pnpm run build
```

The browser suite starts its own production server. With local ports 3000 and 3100 free, after building:

```bash
pnpm --filter @keyspilli/web exec playwright install --with-deps chromium webkit
pnpm --filter @keyspilli/web run e2e
pnpm --filter @keyspilli/web run e2e:scratch
```

The regular suite uses the selected catalog; the scratch suite uses a temporary isolated catalog and teardown. Additional melody/Chords evaluations need their documented private fixtures. The full CI sequence, including Python and access-boundary checks, is in [CI / Deploy](../.github/workflows/ci.yml).

## Prepare Original and Chords

The repository's preparation tools start from an already acquired and arranged symbolic source. They do not search for or transcribe an arbitrary song name by themselves.

```bash
node --import tsx apps/web/scripts/prepare-song.mts \
  /absolute/path/song.mid output/song-prep/my-song "Song title" "Artist"
```

Use a new run directory inside the checkout. The tool ingests into an isolated catalog, prepares both modes, packages exact artifacts, and verifies a fresh install plus repeated-install consistency. Read its `result.json`; the output remains provisional. The [bundle tool](../apps/web/scripts/song-bundle.mts) supports `pack`, `install`, `verify`, and `rollback` for isolated catalogs. It is not a live-catalog replacement command.

Deliver playable Original and Chords previews alongside the MIDI/MusicXML files. Preserve source and bundle hashes, known limitations, and approval of the exact version. Positive feedback and permission to publish are separate: after publication is authorized, use the [approved-package workflow](ops.md#persisted-approved-chords-packages), then verify deployed playback identity. The optional [audio review tool](../apps/web/scripts/review-song-audio.mts) sends media only with explicit `--send-audio` and configured provider credentials; its excerpt findings are not automatic full-song acceptance.

## Contributor datasets

Use the [contribution guide](../CONTRIBUTING.md#musical-files-and-review-evidence) for the review dataset and historical evidence. These are dated snapshots, not a current production backup. Extract into a separate empty directory, verify the supplied checksums, and follow the release's setup instructions. Use current `main` for new Chords work; use the matching historical revision when reproducing old evidence.
