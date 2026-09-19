import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseMidi } from "../../../../packages/midi/src/parse.ts";
import { parseMusicXmlNotes } from "../../../../packages/midi/src/parseXml.ts";
import {
  buildMelodyAccompaniment,
  type MelodyAccompanimentResolution,
} from "../../../../packages/player-core/src/accompaniment.ts";
import { measurePlayability } from "../../../../packages/midi/src/playability-audit.ts";
import { buildMelodyArrangementOptions } from "../../../../apps/web/src/components/player/melody-arrangement-runtime.ts";
import {
  melodyHarmonicSupportPolicy,
  resolveChordSources,
  selectChordSource,
} from "../../../../apps/web/src/components/player/chord-sources.ts";
import type { Note, SongData } from "../../../../packages/player-core/src/types.ts";

const dataRoot = process.env.KEYSPILLI_CANONICAL_DATA_ROOT ?? "/Users/reidar/Projectos/Keyspilli/data";
const comparisonTempoBpm = 108;
const windowBeats = 12;

const targets = [
  {
    id: "queen-somebody-to-love-a",
    title: "Somebody To Love",
    baseId: "queen-somebody-to-love",
    midi: "seed-midi/queen-somebody-to-love.mid",
    targetTempoBpm: 108,
  },
  {
    id: "britney-spears-oops-i-did-it-again-a",
    title: "Oops I Did It Again",
    baseId: "britney-spears-oops-i-did-it-again",
    midi: "seed-midi/britney-spears-oops-i-did-it-again.mid",
    targetTempoBpm: 95,
  },
  {
    id: "the-beatles-blackbird-a",
    title: "Blackbird",
    baseId: "the-beatles-blackbird",
    midi: "seed-midi/the-beatles-blackbird.mid",
    targetTempoBpm: 120,
  },
] as const;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function duration(data: SongData): number {
  return Math.max(
    0,
    ...data.notes.map((note) => note.start + note.dur),
    ...data.measures.map((measure) => measure.endBeat),
  );
}

function noteKey(note: Pick<Note, "midi" | "start" | "dur" | "hand">): string {
  return JSON.stringify([note.midi, note.start, note.dur, note.hand ?? null]);
}

function multiset(notes: readonly Note[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const note of notes) result.set(noteKey(note), (result.get(noteKey(note)) ?? 0) + 1);
  return result;
}

function multisetOnly(left: Map<string, number>, right: Map<string, number>): number {
  let count = 0;
  for (const [key, value] of left) count += Math.max(0, value - (right.get(key) ?? 0));
  return count;
}

function replaceCandidateVelocity(xmlNotes: readonly Note[], currentNotes: readonly Note[]): Note[] {
  const currentByKey = new Map<string, Note[]>();
  for (const note of currentNotes) {
    const key = noteKey(note);
    const bucket = currentByKey.get(key) ?? [];
    bucket.push(note);
    currentByKey.set(key, bucket);
  }
  return xmlNotes.map((note) => {
    const match = currentByKey.get(noteKey(note))?.shift();
    if (!match) throw new Error(`MusicXML candidate note is absent from canonical notes: ${noteKey(note)}`);
    return { ...note, vel: match.vel };
  });
}

function noteBlocks(xml: string): string[] {
  return [...xml.matchAll(/<note\b[^>]*>[\s\S]*?<\/note>/g)].map(([block]) => block);
}

function tagCounts(blocks: readonly string[], tag: "staff" | "voice" | "color"): Record<string, number> {
  const counts = new Map<string, number>();
  const pattern = tag === "color" ? /\bcolor=["']([^"']+)["']/ : new RegExp(`<${tag}>([^<]+)<\/${tag}>`);
  for (const block of blocks) {
    const value = block.match(pattern)?.[1];
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function readVarint(data: Uint8Array, position: { value: number }, end: number): number {
  let value = 0;
  for (let index = 0; index < 4; index += 1) {
    if (position.value >= end) throw new Error("truncated MIDI variable-length value");
    const byte = data[position.value++]!;
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error("invalid MIDI variable-length value");
}

function readAscii(data: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...data.slice(start, start + length)).replaceAll("\u0000", "").trim();
}

function rawTrackMetadata(data: Uint8Array, division: number): Array<Record<string, unknown>> {
  const readU32 = (offset: number) => ((data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!) >>> 0;
  if (readAscii(data, 0, 4) !== "MThd") throw new Error("raw source is not a MIDI file");
  const headerLength = readU32(4);
  const trackCount = (data[10]! << 8) | data[11]!;
  let offset = 8 + headerLength;
  const tracks: Array<Record<string, unknown>> = [];
  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    if (readAscii(data, offset, 4) !== "MTrk") throw new Error(`missing MIDI track header at ${trackIndex}`);
    const length = readU32(offset + 4);
    let position = offset + 8;
    const end = position + length;
    let tick = 0;
    let running: number | null = null;
    const trackNames: Array<{ tick: number; beat: number; text: string }> = [];
    const texts: Array<{ tick: number; beat: number; text: string }> = [];
    const programs: Array<{ tick: number; beat: number; channel: number; program: number }> = [];
    const channelNotes = new Map<number, { noteOnCount: number; firstNoteBeat: number | null; lastNoteBeat: number | null }>();
    while (position < end) {
      const deltaPosition = { value: position };
      tick += readVarint(data, deltaPosition, end);
      position = deltaPosition.value;
      if (position >= end) break;
      let status = data[position++]!;
      if (status < 0x80) {
        if (running === null) throw new Error(`MIDI running status missing at track ${trackIndex}`);
        status = running;
        position -= 1;
      } else if (status < 0xf0) {
        running = status;
      }
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      if (kind === 0xf0) {
        if (status === 0xff) {
          if (position >= end) throw new Error(`MIDI meta type missing at track ${trackIndex}`);
          const type = data[position++]!;
          const lengthPosition = { value: position };
          const eventLength = readVarint(data, lengthPosition, end);
          position = lengthPosition.value;
          if (position + eventLength > end) throw new Error(`MIDI meta event exceeds track at track ${trackIndex}`);
          const text = readAscii(data, position, eventLength);
          const event = { tick, beat: Number((tick / division).toFixed(6)), text };
          if (type === 0x01 && text) texts.push(event);
          if (type === 0x03 && text) trackNames.push(event);
          position += eventLength;
        } else if (status === 0xf0 || status === 0xf7) {
          const lengthPosition = { value: position };
          const eventLength = readVarint(data, lengthPosition, end);
          position = lengthPosition.value + eventLength;
        } else if (status === 0xf1 || status === 0xf3) {
          position += 1;
        } else if (status === 0xf2) {
          position += 2;
        }
        continue;
      }
      if (kind === 0xc0 || kind === 0xd0) {
        if (position >= end) throw new Error(`MIDI channel event truncated at track ${trackIndex}`);
        if (kind === 0xc0) programs.push({ tick, beat: Number((tick / division).toFixed(6)), channel, program: data[position]! });
        position += 1;
        continue;
      }
      if (position + 2 > end) throw new Error(`MIDI channel event truncated at track ${trackIndex}`);
      const note = data[position]!;
      const velocity = data[position + 1]!;
      position += 2;
      if ((kind === 0x90 && velocity > 0) && channel !== 9) {
        const state = channelNotes.get(channel) ?? { noteOnCount: 0, firstNoteBeat: null, lastNoteBeat: null };
        const beat = Number((tick / division).toFixed(6));
        state.noteOnCount += 1;
        state.firstNoteBeat ??= beat;
        state.lastNoteBeat = beat;
        channelNotes.set(channel, state);
      }
    }
    tracks.push({
      trackIndex,
      trackNames,
      texts,
      programs,
      channelNotes: Object.fromEntries([...channelNotes.entries()].sort(([left], [right]) => left - right)),
    });
    offset = end;
  }
  return tracks;
}

function declaredMeasureStarts(
  events: readonly { beat: number; timeSig: readonly [number, number] }[] | undefined,
  endBeat: number,
): number[] {
  if (!events?.length) return [];
  const starts: number[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const nextBeat = events[index + 1]?.beat ?? endBeat;
    const measureBeats = event.timeSig[0]! * (4 / event.timeSig[1]!);
    for (let beat = event.beat; beat < nextBeat - 1e-9; beat += measureBeats) starts.push(Number(beat.toFixed(6)));
  }
  return starts;
}

function spanBeatsInWindow(
  spans: readonly { startBeat: number; endBeat: number }[],
  startBeat: number,
  endBeat: number,
): number {
  return spans.reduce((sum, span) => sum + Math.max(0, Math.min(endBeat, span.endBeat) - Math.max(startBeat, span.startBeat)), 0);
}

function eventIdsInWindow(
  result: MelodyAccompanimentResolution,
  startBeat: number,
  endBeat: number,
): Set<string> {
  return new Set(result.events
    .filter((event) => event.role === "melody" && event.note.start >= startBeat && event.note.start < endBeat)
    .flatMap((event) => event.sourceNoteIds));
}

function worstWindow(
  current: MelodyAccompanimentResolution,
  candidate: MelodyAccompanimentResolution,
  durationBeats: number,
): Record<string, unknown> {
  const starts = new Set<number>();
  for (let start = 0; start < durationBeats; start += windowBeats) starts.add(Number(start.toFixed(6)));
  starts.add(Math.max(0, Number((durationBeats - windowBeats).toFixed(6))));
  const windows = [...starts].map((startBeat) => {
    const endBeat = Math.min(durationBeats, startBeat + windowBeats);
    const currentIds = eventIdsInWindow(current, startBeat, endBeat);
    const candidateIds = eventIdsInWindow(candidate, startBeat, endBeat);
    const differingIds = new Set([...currentIds, ...candidateIds].filter((id) => !currentIds.has(id) || !candidateIds.has(id)));
    return {
      startBeat,
      endBeat,
      secondsAtComparison108Bpm: Number(((endBeat - startBeat) * 60 / comparisonTempoBpm).toFixed(3)),
      currentMelodyNotes: currentIds.size,
      candidateMelodyNotes: candidateIds.size,
      sharedMelodyNotes: [...currentIds].filter((id) => candidateIds.has(id)).length,
      differingMelodySourceIds: differingIds.size,
      currentUnresolvedBeats: Number(spanBeatsInWindow(current.provenance.unresolvedSpans, startBeat, endBeat).toFixed(3)),
      candidateUnresolvedBeats: Number(spanBeatsInWindow(candidate.provenance.unresolvedSpans, startBeat, endBeat).toFixed(3)),
    };
  });
  return windows.sort((left, right) =>
    right.differingMelodySourceIds - left.differingMelodySourceIds
    || right.currentMelodyNotes - left.currentMelodyNotes
    || left.startBeat - right.startBeat,
  )[0]!;
}

function playabilitySummary(notes: readonly Note[], durationBeats: number, tempoBpm: number): Record<string, unknown> {
  const result = measurePlayability(notes, tempoBpm, durationBeats);
  return {
    attacks: result.global.onsetCount,
    medianIoiSeconds: result.global.medianIoiSeconds,
    maxSimultaneous: result.global.maxSimultaneous,
    maxSounding: result.global.maxSounding,
    worstTopVoiceLeap: result.hands.R.worstTopVoiceLeap,
    worstAttackWindow: result.global.worstAttackWindow,
  };
}

function arrangementSummary(
  result: MelodyAccompanimentResolution,
  durationBeats: number,
  targetTempoBpm: number,
): Record<string, unknown> {
  return {
    melodyNotes: result.melody.length,
    outputEvents: result.events.length,
    outputAttacks: new Set(result.events.map((event) => event.note.start)).size,
    unresolvedBeats: Number(spanBeatsInWindow(result.provenance.unresolvedSpans, 0, durationBeats).toFixed(3)),
    fallbackBeats: result.provenance.fallbackBeats,
    generatedNoteCount: result.provenance.generatedNoteCount,
    changeSummary: result.changeSummary,
    playabilityAtTargetTempo: playabilitySummary(result.notes, durationBeats, targetTempoBpm),
    playabilityAtComparison108Bpm: playabilitySummary(result.notes, durationBeats, comparisonTempoBpm),
  };
}

function readJsonIfPresent(path: string): Record<string, unknown> | null {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> : null;
}

function sourceProvenance(baseId: string, dataRootPath: string, data: SongData): Record<string, unknown> {
  const catalogPath = `${dataRootPath}/../catalog/manifest.json`;
  const catalog = readJsonIfPresent(catalogPath) as { songs?: Array<Record<string, unknown>> } | null;
  const catalogEntry = catalog?.songs?.find((song) => song.id === baseId) ?? null;
  const artifactManifest = readJsonIfPresent(`${dataRootPath}/artifacts/${baseId}/manifest.json`);
  const notesRecord = data as SongData & { provenance?: unknown };
  return {
    catalogManifestPath: catalogPath,
    catalogEntry: catalogEntry ? {
      sourceUrl: catalogEntry.sourceUrl ?? null,
      sourceFile: catalogEntry.sourceFile ?? null,
      license: catalogEntry.license ?? null,
      source: catalogEntry.source ?? null,
      verifiedTitle: catalogEntry.verifiedTitle ?? null,
    } : null,
    artifactManifest: artifactManifest ? {
      sourceArtifactHash: artifactManifest.sourceArtifactHash ?? null,
      source: artifactManifest.source ?? null,
      tempo: artifactManifest.tempo ?? null,
    } : null,
    notesProvenance: {
      sourceFingerprint: data.sourceFingerprint ?? null,
      sourceTiming: data.sourceTiming ?? null,
      timeSigEvents: data.timeSigEvents ?? null,
      legacyProvenance: notesRecord.provenance ?? null,
    },
  };
}

function evaluateTarget(target: (typeof targets)[number]): Record<string, unknown> {
  const jsonPath = `${dataRoot}/artifacts/${target.baseId}/a/notes.json`;
  const xmlPath = `${dataRoot}/artifacts/${target.baseId}/a/variant.xml`;
  const midiPath = `${dataRoot}/${target.midi}`;
  const data = JSON.parse(readFileSync(jsonPath, "utf8")) as SongData;
  const xmlBytes = readFileSync(xmlPath);
  const xml = xmlBytes.toString("utf8");
  const parsedXml = parseMusicXmlNotes(xml);
  const rawMidiBytes = readFileSync(midiPath);
  const rawMidi = parseMidi(rawMidiBytes);
  const rawTrackData = rawTrackMetadata(rawMidiBytes, rawMidi.division);
  const canonicalDuration = duration(data);
  const candidateNotes = replaceCandidateVelocity(parsedXml.notes, data.notes);
  const canonicalSet = multiset(data.notes);
  const candidateSet = multiset(candidateNotes);
  if (multisetOnly(canonicalSet, candidateSet) || multisetOnly(candidateSet, canonicalSet)) {
    throw new Error(`${target.id}: MusicXML candidate is not the same note/staff structure as canonical notes`);
  }

  const chordSource = selectChordSource(resolveChordSources(data), "auto");
  const chordTimeline = chordSource.source?.chords ?? [];
  const harmonicSupport = melodyHarmonicSupportPolicy(chordSource.source);
  const currentFingerprint = data.sourceFingerprint ?? `canonical:${sha256(JSON.stringify(data.notes))}`;
  const candidateFingerprint = `derived:musicxml-staff-voice:${sha256(xmlBytes)}`;
  const options = (selection: "automatic" | "right-hand", sourceFingerprint: string) => buildMelodyArrangementOptions({
    durationBeats: canonicalDuration,
    sourceFingerprint,
    selection,
    phraseOverrides: [],
    harmonicSupport,
    sourceBackingMode: "default",
  });
  const current = buildMelodyAccompaniment(data.notes, chordTimeline, options("automatic", currentFingerprint));
  const candidate = buildMelodyAccompaniment(candidateNotes, chordTimeline, options("right-hand", candidateFingerprint));
  const currentIds = new Set(current.provenance.melodyNoteIds);
  const candidateIds = new Set(candidate.provenance.melodyNoteIds);
  const xmlNoteBlocks = noteBlocks(xml);
  return {
    id: target.id,
    title: target.title,
    comparisonTempoBpm,
    windowBeats,
    inputs: {
      canonicalNotesSha256: sha256(readFileSync(jsonPath)),
      musicXmlSha256: sha256(xmlBytes),
      rawMidiSha256: sha256(rawMidiBytes),
      canonicalNotes: data.notes.length,
      candidateNotes: candidateNotes.length,
      rawMidiNotes: rawMidi.notes.length,
      canonicalDurationBeats: canonicalDuration,
    },
    sourceEvidence: {
      rawMidiTrackNames: rawMidi.trackNames,
      rawMidiTimeSigEvents: rawMidi.timeSigEvents ?? [],
      rawMidiFirstNoteBeat: rawMidi.notes[0]?.start ?? null,
      rawMidiTrackMetadata: rawTrackData,
      currentXmlTimeSigEvents: parsedXml.timeSigEvents ?? [],
      currentMeasureStarts: data.measures.slice(0, 10).map((measure) => measure.startBeat),
      rawDeclaredMeasureStarts: declaredMeasureStarts(rawMidi.timeSigEvents, canonicalDuration),
      musicXmlPartName: xml.match(/<part-name>([^<]*)<\/part-name>/)?.[1] ?? null,
      musicXmlStaffCounts: tagCounts(xmlNoteBlocks, "staff"),
      musicXmlVoiceCounts: tagCounts(xmlNoteBlocks, "voice"),
      musicXmlColorCounts: tagCounts(xmlNoteBlocks, "color"),
      musicXmlLyrics: xml.match(/<lyric\b/g)?.length ?? 0,
      candidateMelodyIdentity: "Derived MusicXML staff=1/voice=1 mapped to stored R hand; this is a hand override comparison, not independent source recovery",
      sourceProvenance: sourceProvenance(target.baseId, dataRoot, data),
      phaseStatus: "Raw meter declarations are evidence for a diagnostic phase candidate, not validated source-measure-boundary provenance.",
    },
    targetTempoBpm: target.targetTempoBpm,
    currentAutomatic: arrangementSummary(current, canonicalDuration, target.targetTempoBpm),
    derivedUpperStaffHandOverride: arrangementSummary(candidate, canonicalDuration, target.targetTempoBpm),
    melodyIdentityComparison: {
      currentAutomaticMelodyNotes: currentIds.size,
      derivedUpperStaffOverrideMelodyNotes: candidateIds.size,
      sharedSourceIds: [...currentIds].filter((id) => candidateIds.has(id)).length,
      differingSourceIds: new Set([...currentIds, ...candidateIds].filter((id) => !currentIds.has(id) || !candidateIds.has(id))).size,
      derivedOverrideUnresolvedSpans: candidate.provenance.unresolvedSpans,
      interpretation: "Zero unresolved beats here are expected from selecting the existing staff=1/voice=1 lane with right-hand override semantics; they are not evidence that the original source melody has been recovered.",
    },
    worst12BeatWindow: worstWindow(current, candidate, canonicalDuration),
  };
}

console.log(JSON.stringify({
  schemaVersion: 1,
  sourceMode: "read-only canonical artifacts; derived MusicXML staff/voice lane is compared through the existing right-hand override, not promoted as independent source recovery",
  generatedAt: "2026-09-19",
  comparisonTempoBpm,
  windowBeats,
  nonClaims: [
    "The derived upper-staff/voice-1 hand-override comparison is not a semantic melody approval or independent source recovery.",
    "Zero unresolved beats in the derived override are expected by its selection semantics and do not validate the source melody.",
    "Raw MIDI meter events do not independently prove pickup/downbeat phase.",
    "Event counts and structural playability diagnostics do not establish musical acceptance.",
  ],
  targets: targets.map(evaluateTarget),
}, null, 2));
