import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  artifactsDir,
  createLegacyBootstrapManifest,
  dataDir,
  getDb,
  getSong,
  getSongsByBase,
  invalidateSongReadModel,
  parseTempoProvenance,
  publishBaseArtifact,
  readArrangementManifest,
  temposAgree,
  writeArrangementManifestFile,
  SongRow,
  type ArrangementManifest,
  type TempoProvenance,
} from "@keyspilli/catalog";
import { keySignature, writeMidi, writeMusicXml, type Variant } from "@keyspilli/midi";

export interface SongPatch {
  title?: string;
  artist?: string;
  key?: string;
  /** Backward-compatible alias for playbackTempo. */
  tempo?: number;
  /** Learner playback tempo; changes scheduling, not beat-space coordinates. */
  playbackTempo?: number;
  /** Source/audio calibration tempo; may rebuild beat-space coordinates. */
  calibrationTempo?: number;
  category?: string;
  style?: string;
  mood?: string;
}

export class SongUpdateError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const KEY_ROOTS = new Set([
  "C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B",
  "Cb", "B#", "E#", "Fb",
]);

const EXPECTED_VARIANT_COUNT = 6;
const EXPECTED_VARIANT_LEVELS = new Set(["a", "b", "e", "m", "ve", "vb"]);
const BEAT_TOLERANCE = 1e-6;

export function isValidKey(key: string): boolean {
  const m = /^([A-Ga-g](?:#|b)?)(?:\s*(?:m|minor|major))?$/i.exec(key.trim());
  if (!m) return false;
  const root = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  return KEY_ROOTS.has(root);
}

function normalizeKeyName(key: string): string {
  const match = /^([A-Ga-g](?:#|b)?)(?:\s*(m|minor|major))?$/i.exec(key.trim());
  if (!match) return key.trim();
  const root = match[1]!.charAt(0).toUpperCase() + match[1]!.slice(1);
  return /^(?:m|minor)$/i.test(match[2] ?? "") ? `${root}m` : root;
}

export function resolveBaseId(id: string): string | null {
  const byId = getSong(id);
  if (byId) return byId.baseId;
  return getSongsByBase(id).length ? id : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function chordEnd(chord: Variant["chords"][number]): number {
  const beat = finiteNumber(chord.beat) ? chord.beat : 0;
  const value = chord as Variant["chords"][number] & { duration?: unknown };
  const duration = finiteNumber(value.durationBeats)
    ? value.durationBeats
    : finiteNumber(value.duration)
      ? value.duration
      : 0;
  return beat + Math.max(0, duration);
}

function timelineEnd(
  notes: Variant["notes"],
  chords: Variant["chords"],
  measures: Variant["measures"],
  durationBeats: unknown,
): number {
  let end = finiteNumber(durationBeats) ? durationBeats : 0;
  for (const note of notes) {
    const candidate = note.start + note.dur;
    if (finiteNumber(candidate) && candidate > end) end = candidate;
  }
  for (const chord of chords) {
    const candidate = chordEnd(chord);
    if (finiteNumber(candidate) && candidate > end) end = candidate;
  }
  for (const measure of measures) {
    if (finiteNumber(measure.endBeat) && measure.endBeat > end) end = measure.endBeat;
  }
  return Math.max(end, 1);
}

function buildMeasures(
  notes: Variant["notes"],
  timeSig: [number, number],
  chords: Variant["chords"] = [],
  durationBeats?: unknown,
): Variant["measures"] {
  const [num, den] = timeSig;
  const rawBeatsPerMeasure = num * (4 / den);
  const beatsPerMeasure = finiteNumber(rawBeatsPerMeasure) && rawBeatsPerMeasure > 0 ? rawBeatsPerMeasure : 4;
  const dur = timelineEnd(notes, chords, [], durationBeats);
  const count = Math.max(1, Math.ceil(dur / beatsPerMeasure));
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    startBeat: i * beatsPerMeasure,
    endBeat: (i + 1) * beatsPerMeasure,
  }));
}

/**
 * Rescale persisted measure boundaries rather than rebuilding them from
 * note ends. Measures intentionally carry musical space that may contain a
 * chord-only passage, a release tail, or a final empty bar. If an old
 * artifact's measures do not cover a newly transformed event, append enough
 * bars to keep that event and the stored duration reachable.
 */
function rebuildMeasuresForCalibration(
  storedMeasures: Variant["measures"] | undefined,
  notes: Variant["notes"],
  chords: Variant["chords"],
  durationBeats: unknown,
  factor: number,
  timeSig: [number, number],
): Variant["measures"] {
  const scaled = (storedMeasures ?? []).map((measure) => ({
    ...measure,
    startBeat: measure.startBeat * factor,
    endBeat: measure.endBeat * factor,
  }));
  if (!scaled.length) return buildMeasures(notes, timeSig, chords, durationBeats);

  const [num, den] = timeSig;
  const rawBeatsPerMeasure = num * (4 / den);
  const beatsPerMeasure = finiteNumber(rawBeatsPerMeasure) && rawBeatsPerMeasure > 0 ? rawBeatsPerMeasure : 4;
  const requiredEnd = timelineEnd(notes, chords, scaled, durationBeats);
  let endBeat = 0;
  let nextIndex = -1;
  for (const measure of scaled) {
    if (finiteNumber(measure.endBeat) && measure.endBeat > endBeat) endBeat = measure.endBeat;
    if (finiteNumber(measure.index) && measure.index > nextIndex) nextIndex = measure.index;
  }
  nextIndex += 1;
  while (endBeat + BEAT_TOLERANCE < requiredEnd) {
    scaled.push({ index: nextIndex++, startBeat: endBeat, endBeat: endBeat + beatsPerMeasure });
    endBeat += beatsPerMeasure;
  }
  return scaled;
}

interface StoredVariant {
  notes: Variant["notes"];
  chords?: Variant["chords"];
  measures?: Variant["measures"];
  key: string;
  tempoBpm: number;
  timeSig: [number, number];
  /** Optional on legacy notes.json; validated when present and rewritten on update. */
  provenance?: Record<string, unknown>;
  [key: string]: unknown;
}

interface LoadedVariant {
  row: SongRow;
  dir: string;
  stored: StoredVariant;
  notesJson: string;
}

function validTempo(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 20 && value <= 300;
}

/**
 * `songs.duration` is a wall-clock duration in whole seconds. Ingest derives
 * it from the source beat span (`durationBeats * 60 / tempoBpm`), so a tempo
 * edit must keep this denormalized read-model value in the same time domain:
 * playback edits change seconds-per-beat, while source calibration edits
 * change the stored beat span. The SQL update applies the factor to each row
 * rather than assuming every legacy level has an identical rounded value.
 */
function durationScale(
  calibrationChanged: boolean,
  playbackChanged: boolean,
  calibrationTempo: number,
  previousCalibration: number,
  playbackTempo: number,
  previousPlayback: number,
): number {
  if (calibrationChanged) return calibrationTempo / previousCalibration;
  if (playbackChanged) return previousPlayback / playbackTempo;
  return 1;
}

function validateTempoPatch(name: "tempo" | "playbackTempo" | "calibrationTempo", value: unknown): void {
  if (value === undefined) return;
  if (!validTempo(value)) {
    if (name === "tempo") throw new SongUpdateError(400, "tempo must be a number between 20 and 300");
    throw new SongUpdateError(400, `${name} must be a number between 20 and 300`);
  }
}

function validateStoredTempoProvenance(stored: StoredVariant, rowId: string): void {
  // Legacy notes.json files predate role-tagged tempo provenance. Missing or
  // non-object legacy provenance remains readable; a present tempo block is a
  // new contract and must not silently lose role/source metadata.
  const provenance = stored.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance) || provenance.tempo === undefined) return;
  try {
    parseTempoProvenance(provenance.tempo, "provenance.tempo");
  } catch (error) {
    throw new SongUpdateError(500, `malformed tempo provenance in notes.json for ${rowId}: ${(error as Error).message}`);
  }
}

function nextNotesProvenance(stored: StoredVariant, tempo: TempoProvenance): Record<string, unknown> {
  const existing = stored.provenance;
  return {
    ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}),
    tempo,
  };
}

/**
 * Fingerprint the complete source snapshot used to prepare a metadata edit.
 * The publication lock is acquired only after the initial read, so the
 * writer must compare this value again while holding that lock. This prevents
 * a slower metadata request from overwriting a concurrent ingest/update with
 * stale notes or database mirrors.
 */
function sourceSnapshotFingerprint(
  rows: readonly SongRow[],
  manifest: Awaited<ReturnType<typeof readArrangementManifest>>,
  variants: readonly LoadedVariant[],
): string {
  const digest = createHash("sha256");
  // Exclude the live `plays` counter: a learner starting playback during a
  // metadata edit is not a source conflict and must not cause a spurious
  // 409. All fields that this update can overwrite, plus the arrangement
  // identity fields, remain part of the compare-and-swap snapshot.
  digest.update(JSON.stringify([...rows]
    .map((row) => ({
      id: row.id,
      baseId: row.baseId,
      title: row.title,
      artist: row.artist,
      category: row.category,
      difficulty: row.difficulty,
      difficultyScore: row.difficultyScore,
      key: row.key,
      tempo: row.tempo,
      style: row.style,
      mood: row.mood,
      bassPattern: row.bassPattern,
      duration: row.duration,
      contentType: row.contentType,
      acquiredVia: row.acquiredVia,
      sourceYoutubeUrl: row.sourceYoutubeUrl,
      hasSheetXml: row.hasSheetXml,
      sections: row.sections,
      level: row.level,
      createdAt: row.createdAt,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))));
  digest.update("\0");
  digest.update(JSON.stringify(
    manifest.status === "valid"
      ? manifest.manifest
      : { status: manifest.status, errors: manifest.status === "invalid" ? manifest.errors : [] },
  ));
  digest.update("\0");
  for (const variant of [...variants].sort((a, b) => a.row.id.localeCompare(b.row.id))) {
    digest.update(variant.row.id);
    digest.update("\0");
    digest.update(variant.notesJson);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function scaleChords(chords: Variant["chords"], factor: number): Variant["chords"] {
  return chords.map((chord) => {
    const value = chord as Variant["chords"][number] & { duration?: unknown };
    const scaled: Variant["chords"][number] & { duration?: unknown } = {
      ...value,
      beat: value.beat * factor,
    };
    if (typeof value.durationBeats === "number") scaled.durationBeats = value.durationBeats * factor;
    // Some older chart imports used `duration` as a beat span. Preserve and
    // rescale that legacy field alongside the canonical durationBeats alias.
    if (typeof value.duration === "number") scaled.duration = value.duration * factor;
    return scaled;
  });
}

function updateManifest(
  baseId: string,
  source: ArrangementManifest,
  calibrationTempo: number,
  playbackTempo: number,
  calibrationChanged: boolean,
  playbackChanged: boolean,
  now: string,
): ArrangementManifest {
  const configFingerprint = calibrationChanged && source.configFingerprint
    ? createHash("sha256")
        .update(JSON.stringify({
          previous: source.configFingerprint,
          operation: "manual-source-calibration",
          calibrationTempo,
        }))
        .digest("hex")
    : source.configFingerprint;
  return {
    ...source,
    ...(configFingerprint ? { configFingerprint } : {}),
    tempo: {
      calibration: calibrationChanged
        ? { ...source.tempo.calibration, bpm: calibrationTempo, source: "manual", resolvedAt: now, role: "source-calibration" }
        : source.tempo.calibration,
      playback: playbackChanged
        ? { ...source.tempo.playback, bpm: playbackTempo, source: "manual", resolvedAt: now, role: "playback" }
        : source.tempo.playback,
    },
    // Keep this explicit even though the current manifest is already tied to
    // the same base. It makes accidental cross-base copies fail validation.
    baseId,
    artifactWrittenAt: now,
  };
}

/**
 * Load and validate the complete six-level source set before publication.
 * A first manifest is deliberately conservative: existing artifacts must
 * agree on their denormalized playback tempo before they can be adopted.
 */
async function loadStoredVariants(baseId: string, rows: SongRow[], manifest: Awaited<ReturnType<typeof readArrangementManifest>>): Promise<{
  variants: LoadedVariant[];
  manifest: ArrangementManifest;
  legacy: boolean;
  sourceFingerprint: string;
}> {
  if (rows.length !== EXPECTED_VARIANT_COUNT) {
    throw new SongUpdateError(500, `expected ${EXPECTED_VARIANT_COUNT} variants for ${baseId}, found ${rows.length}`);
  }
  const levels = new Set(rows.map((row) => row.level));
  if (levels.size !== rows.length) throw new SongUpdateError(500, `duplicate variant levels for ${baseId}`);
  const missingLevels = [...EXPECTED_VARIANT_LEVELS].filter((level) => !levels.has(level));
  const unexpectedLevels = [...levels].filter((level) => !EXPECTED_VARIANT_LEVELS.has(level));
  if (missingLevels.length || unexpectedLevels.length) {
    throw new SongUpdateError(
      500,
      `invalid variant levels for ${baseId}; missing ${missingLevels.join(", ") || "none"}; unexpected ${unexpectedLevels.join(", ") || "none"}`,
    );
  }

  const variants = await Promise.all(
    rows.map(async (row): Promise<LoadedVariant> => {
      const dir = artifactsDir(baseId, row.level);
      let notesJson: string;
      let stored: StoredVariant;
      try {
        notesJson = await readFile(join(dir, "notes.json"), "utf8");
        stored = JSON.parse(notesJson) as StoredVariant;
      } catch {
        notesJson = "";
        stored = {} as StoredVariant;
      }
      if (!stored || !Array.isArray(stored.notes) || !validTempo(stored.tempoBpm)) {
        throw new SongUpdateError(500, `missing or corrupt notes.json for ${row.id}`);
      }
      validateStoredTempoProvenance(stored, row.id);
      return { row, dir, stored, notesJson };
    }),
  );

  const storedTempo = variants[0]!.stored.tempoBpm;
  if (variants.some(({ stored }) => !temposAgree(stored.tempoBpm, storedTempo))) {
    throw new SongUpdateError(500, `variant tempo mismatch for ${baseId}; repair artifacts before updating`);
  }

  let resolvedManifest: ArrangementManifest;
  if (manifest.status === "missing") {
    // The legacy rows are the only available authority at this boundary. Do
    // not infer a different calibration from one difficulty level.
    if (rows.some((row) => !validTempo(row.tempo) || !temposAgree(row.tempo, storedTempo))) {
      throw new SongUpdateError(500, `database tempo mismatch for ${baseId}; repair artifacts before updating`);
    }
    resolvedManifest = createLegacyBootstrapManifest(baseId, storedTempo);
  } else if (manifest.status === "invalid") {
    throw new SongUpdateError(500, `invalid arrangement manifest for ${baseId}: ${manifest.errors.join("; ")}`);
  } else {
    resolvedManifest = manifest.manifest;
    if (resolvedManifest.baseId !== baseId) {
      throw new SongUpdateError(500, `arrangement manifest base id mismatch for ${baseId}`);
    }
    const playbackTempo = resolvedManifest.tempo.playback.bpm;
    if (variants.some(({ stored }) => !temposAgree(stored.tempoBpm, playbackTempo))) {
      throw new SongUpdateError(500, `artifact playback tempo mismatch for ${baseId}; repair artifacts before updating`);
    }
    if (rows.some((row) => !validTempo(row.tempo) || !temposAgree(row.tempo, playbackTempo))) {
      throw new SongUpdateError(500, `database tempo mismatch for ${baseId}; repair artifacts before updating`);
    }
  }

  return {
    variants,
    manifest: resolvedManifest,
    legacy: manifest.status === "missing",
    sourceFingerprint: sourceSnapshotFingerprint(rows, manifest, variants),
  };
}

/**
 * Apply metadata to all six variants of a song and publish their artifacts as
 * one complete base-level swap. `tempo` remains a playback alias. Explicit
 * calibration edits are the only tempo updates that alter beat coordinates;
 * playback edits update scheduling mirrors while preserving those coordinates.
 */
export async function applySongMetadata(id: string, patch: SongPatch): Promise<SongRow[]> {
  const baseId = resolveBaseId(id);
  if (!baseId) throw new SongUpdateError(404, "song not found");
  const rows = getSongsByBase(baseId);
  if (!rows.length) throw new SongUpdateError(404, "song not found");

  if (patch.tempo !== undefined && patch.playbackTempo !== undefined) {
    throw new SongUpdateError(400, "use either tempo or playbackTempo, not both");
  }
  if ((patch.tempo !== undefined || patch.playbackTempo !== undefined) && patch.calibrationTempo !== undefined) {
    throw new SongUpdateError(400, "choose one tempo role per update: playback or calibration");
  }
  validateTempoPatch("tempo", patch.tempo);
  validateTempoPatch("playbackTempo", patch.playbackTempo);
  validateTempoPatch("calibrationTempo", patch.calibrationTempo);
  if (patch.key !== undefined && !isValidKey(patch.key)) {
    throw new SongUpdateError(400, `invalid key: ${patch.key}`);
  }
  const normalizedKey = patch.key === undefined ? undefined : normalizeKeyName(patch.key);
  const hasPatch = [
    patch.title,
    patch.artist,
    patch.key,
    patch.tempo,
    patch.playbackTempo,
    patch.calibrationTempo,
    patch.category,
    patch.style,
    patch.mood,
  ].some((v) => v !== undefined);
  if (!hasPatch) return rows;

  const manifest = await readArrangementManifest(baseId);
  const loaded = await loadStoredVariants(baseId, rows, manifest);
  const now = new Date().toISOString();
  // The old `tempo` alias remains fully equivalent to playbackTempo when it
  // is sent by itself; ambiguous role combinations were rejected above.
  const requestedPlayback = patch.playbackTempo ?? patch.tempo;
  const previousCalibration = loaded.manifest.tempo.calibration.bpm;
  const previousPlayback = loaded.manifest.tempo.playback.bpm;
  const calibrationTempo = patch.calibrationTempo ?? previousCalibration;
  const playbackTempo = requestedPlayback ?? previousPlayback;
  const calibrationChanged = !temposAgree(calibrationTempo, previousCalibration);
  const playbackChanged = !temposAgree(playbackTempo, previousPlayback);
  const nextManifest = updateManifest(
    baseId,
    loaded.manifest,
    calibrationTempo,
    playbackTempo,
    calibrationChanged,
    playbackChanged,
    now,
  );

  const writes = loaded.variants.map(({ row, stored }) => {
    const factor = calibrationTempo / previousCalibration;
    const notes = calibrationChanged
      ? stored.notes.map((note) => ({ ...note, start: note.start * factor, dur: note.dur * factor }))
      : stored.notes;
    const chords = calibrationChanged
      ? scaleChords(stored.chords ?? [], factor)
      : (stored.chords ?? []);
    const scaledStoredMeasures = calibrationChanged
      ? (stored.measures ?? []).map((measure) => ({
          ...measure,
          startBeat: measure.startBeat * factor,
          endBeat: measure.endBeat * factor,
        }))
      : [];
    const durationBeats = calibrationChanged
      ? timelineEnd(
          notes,
          chords,
          scaledStoredMeasures,
          finiteNumber(stored.durationBeats) ? stored.durationBeats * factor : 0,
        )
      : stored.durationBeats;
    const measures = calibrationChanged
      ? rebuildMeasuresForCalibration(stored.measures, notes, chords, durationBeats, factor, stored.timeSig)
      : (stored.measures ?? buildMeasures(notes, stored.timeSig, chords, stored.durationBeats));
    const key = normalizedKey ?? stored.key;
    const variant: Variant = {
      level: row.difficulty as Variant["level"],
      difficultyScore: row.difficultyScore,
      notes,
      chords,
      measures,
      bassPattern: row.bassPattern,
      key,
      tempoBpm: playbackTempo,
      timeSig: stored.timeSig,
    };
    const title = patch.title ?? row.title;
    const artist = patch.artist ?? row.artist;
    const k = keySignature(key);
    const notesJson = JSON.stringify({
      ...stored,
      notes,
      chords,
      measures,
      key,
      tempoBpm: playbackTempo,
      ...(durationBeats === undefined ? {} : { durationBeats }),
      provenance: nextNotesProvenance(stored, nextManifest.tempo),
    });
    return { row, dirName: row.level, notesJson, variant, title, artist, keySig: k };
  });

  const dbSets: string[] = [];
  const dbParams: Record<string, unknown> = { baseId };
  for (const [col, key] of [
    ["title", "title"],
    ["artist", "artist"],
    ["category", "category"],
    ["style", "style"],
    ["mood", "mood"],
    ["key", "key"],
  ] as const) {
    const value = key === "key"
      ? normalizedKey
      : (patch as Record<string, unknown>)[key];
    if (value !== undefined) {
      dbSets.push(`${col} = @${key}`);
      dbParams[key] = value;
    }
  }
  if (requestedPlayback !== undefined) {
    dbSets.push("tempo = @tempo");
    dbParams.tempo = playbackTempo;
  }
  const durationFactor = durationScale(
    calibrationChanged,
    playbackChanged,
    calibrationTempo,
    previousCalibration,
    playbackTempo,
    previousPlayback,
  );
  if (durationFactor !== 1) {
    // DB duration is integer seconds (see ingestSource), not beat units.
    // SQLite's ROUND keeps the same whole-second contract as ingestion while
    // preserving a potentially different legacy duration per level.
    dbSets.push("duration = CAST(ROUND(duration * @durationFactor) AS INTEGER)");
    dbParams.durationFactor = durationFactor;
  }

  await publishBaseArtifact(
    baseId,
    async (stage) => {
      // `publishBaseArtifact` acquires the per-base lock before invoking this
      // writer. Re-read the complete source snapshot under that lock so a
      // concurrent ingest or metadata edit cannot be overwritten by the
      // stale `writes` array prepared above.
      const currentRows = getSongsByBase(baseId);
      const currentManifest = await readArrangementManifest(baseId);
      const current = await loadStoredVariants(baseId, currentRows, currentManifest);
      if (current.sourceFingerprint !== loaded.sourceFingerprint) {
        throw new SongUpdateError(409, "song changed while the update was being prepared; retry the update");
      }
      for (const item of writes) {
        const dir = join(stage, item.dirName);
        await mkdir(dir, { recursive: true });
        await Promise.all([
          writeFile(join(dir, "notes.json"), item.notesJson, "utf8"),
          writeFile(
            join(dir, "variant.mid"),
            writeMidi(item.variant.notes, {
              tempoBpm: item.variant.tempoBpm,
              timeSig: item.variant.timeSig,
              keySig: item.keySig.fifths,
              keyMode: item.keySig.mode,
              title: `${item.title} (${item.row.difficulty})`,
              tracks: [
                { name: "Right Hand", notes: item.variant.notes.filter((n) => n.hand !== "L") },
                { name: "Left Hand", notes: item.variant.notes.filter((n) => n.hand === "L") },
              ],
            }),
          ),
          writeFile(join(dir, "variant.xml"), writeMusicXml(item.variant, item.title, item.artist), "utf8"),
        ]);
      }
      // The manifest is written last and acts as the commit marker for the
      // staged six-level set.
      await writeArrangementManifestFile(join(stage, "manifest.json"), nextManifest);
    },
    {
      artifactsRoot: join(dataDir(), "artifacts"),
      semanticValidation: "strict",
      afterSwap: () => {
        if (!dbSets.length) return;
        getDb().prepare(`UPDATE songs SET ${dbSets.join(", ")} WHERE base_id = @baseId`).run(dbParams);
        // This metadata UPDATE bypasses the catalog write helpers; drop the
        // grouped read-model snapshot after the artifact/database commit.
        invalidateSongReadModel();
      },
    },
  );

  return getSongsByBase(baseId);
}
