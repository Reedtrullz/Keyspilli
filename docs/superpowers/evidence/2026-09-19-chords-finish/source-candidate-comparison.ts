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

type RawTrackNote = {
  trackIndex: number;
  channel: number;
  midi: number;
  start: number;
  dur: number;
  vel: number;
};

type RawNoteSource = { trackIndex: number; channel: number };

function rawTrackMetadata(
  data: Uint8Array,
  division: number,
  noteSources: readonly RawNoteSource[] = [],
): Array<Record<string, unknown>> {
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
    const activeNotes = new Map<string, Array<{ midi: number; start: number; vel: number; channel: number }>>();
    const trackNotes: RawTrackNote[] = [];
    const captureChannel = noteSources.some((source) => source.trackIndex === trackIndex);
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
      if (captureChannel) {
        const key = `${channel}:${note}`;
        if (kind === 0x90 && velocity > 0 && noteSources.some((source) => source.trackIndex === trackIndex && source.channel === channel)) {
          const pending = activeNotes.get(key) ?? [];
          pending.push({ midi: note, start: tick / division, vel: velocity, channel });
          activeNotes.set(key, pending);
        } else if ((kind === 0x80 || (kind === 0x90 && velocity === 0)) && noteSources.some((source) => source.trackIndex === trackIndex && source.channel === channel)) {
          const pending = activeNotes.get(key);
          const started = pending?.shift();
          if (pending?.length === 0) activeNotes.delete(key);
          if (started) trackNotes.push({ trackIndex, channel, midi: started.midi, start: started.start, dur: Math.max(0.01, tick / division - started.start), vel: started.vel });
        }
      }
      if ((kind === 0x90 && velocity > 0) && channel !== 9) {
        const state = channelNotes.get(channel) ?? { noteOnCount: 0, firstNoteBeat: null, lastNoteBeat: null };
        const beat = Number((tick / division).toFixed(6));
        state.noteOnCount += 1;
        state.firstNoteBeat ??= beat;
        state.lastNoteBeat = beat;
        channelNotes.set(channel, state);
      }
    }
    for (const pending of activeNotes.values()) {
      for (const started of pending) trackNotes.push({ trackIndex, channel: started.channel, midi: started.midi, start: started.start, dur: Math.max(0.01, tick / division - started.start), vel: started.vel });
    }
    tracks.push({
      trackIndex,
      trackNames,
      texts,
      programs,
      channelNotes: Object.fromEntries([...channelNotes.entries()].sort(([left], [right]) => left - right)),
      ...(trackNotes.length > 0 ? { notes: trackNotes.sort((left, right) => left.start - right.start || left.midi - right.midi) } : {}),
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

function unionBeats(spans: readonly { start: number; end: number }[], durationBeats: number): number {
  const sorted = spans
    .map((span) => ({ start: Math.max(0, Math.min(durationBeats, span.start)), end: Math.max(0, Math.min(durationBeats, span.end)) }))
    .filter((span) => span.end > span.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let total = 0;
  let current: { start: number; end: number } | null = null;
  for (const span of sorted) {
    if (!current || span.start > current.end) {
      if (current) total += current.end - current.start;
      current = { ...span };
    } else {
      current.end = Math.max(current.end, span.end);
    }
  }
  if (current) total += current.end - current.start;
  return total;
}

function polyphonySummary(notes: readonly { start: number; dur: number }[], durationBeats: number): Record<string, number> {
  const boundaries = [...new Set([0, durationBeats, ...notes.flatMap((note) => [note.start, note.start + note.dur])])]
    .map((beat) => Math.max(0, Math.min(durationBeats, beat)))
    .sort((left, right) => left - right);
  let overlapBeats = 0;
  let maxPolyphony = 0;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]!;
    const end = boundaries[index + 1]!;
    if (end <= start) continue;
    const active = notes.filter((note) => note.start <= start && note.start + note.dur > start).length;
    maxPolyphony = Math.max(maxPolyphony, active);
    if (active > 1) overlapBeats += end - start;
  }
  return { maxPolyphony, overlapBeats: Number(overlapBeats.toFixed(6)) };
}

function trackCoverage(notes: readonly RawTrackNote[], durationBeats: number): Record<string, unknown> {
  const spans = notes.map((note) => ({ start: note.start, end: note.start + note.dur }));
  const activeBeats = unionBeats(spans, durationBeats);
  const firstStart = notes.length ? Math.min(...notes.map((note) => note.start)) : null;
  const lastEnd = notes.length ? Math.max(...notes.map((note) => note.start + note.dur)) : null;
  return {
    noteCount: notes.length,
    firstStartBeat: firstStart,
    lastEndBeat: lastEnd,
    activeBeats: Number(activeBeats.toFixed(6)),
    restBeats: Number(Math.max(0, durationBeats - activeBeats).toFixed(6)),
    introRestBeats: firstStart === null ? durationBeats : Number(Math.max(0, firstStart).toFixed(6)),
    outroRestBeats: lastEnd === null ? 0 : Number(Math.max(0, durationBeats - lastEnd).toFixed(6)),
    ...polyphonySummary(notes, durationBeats),
  };
}

function activityComparison(
  left: readonly RawTrackNote[],
  right: readonly RawTrackNote[],
  durationBeats: number,
): Record<string, number> {
  const boundaries = [...new Set([0, durationBeats, ...left.flatMap((note) => [note.start, note.start + note.dur]), ...right.flatMap((note) => [note.start, note.start + note.dur])])]
    .map((beat) => Math.max(0, Math.min(durationBeats, beat)))
    .sort((a, b) => a - b);
  let leftOnly = 0;
  let rightOnly = 0;
  let both = 0;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]!;
    const end = boundaries[index + 1]!;
    if (end <= start) continue;
    const leftActive = left.some((note) => note.start <= start && note.start + note.dur > start);
    const rightActive = right.some((note) => note.start <= start && note.start + note.dur > start);
    if (leftActive && rightActive) both += end - start;
    else if (leftActive) leftOnly += end - start;
    else if (rightActive) rightOnly += end - start;
  }
  return {
    leftOnlyBeats: Number(leftOnly.toFixed(6)),
    rightOnlyBeats: Number(rightOnly.toFixed(6)),
    sharedActiveBeats: Number(both.toFixed(6)),
  };
}

function rawToCanonicalMatch(rawNotes: readonly RawTrackNote[], canonicalNotes: readonly Note[]): Record<string, unknown> {
  const onsetTolerance = 0.125;
  const durationTolerance = 0.125;
  const remaining = new Set(canonicalNotes.map((_, index) => index));
  let exactMatches = 0;
  let transformedMatches = 0;
  let pitchMismatchMatches = 0;
  let durationMismatchMatches = 0;
  let onsetMismatchLosses = 0;
  let durationDeltaTotal = 0;
  let onsetDeltaTotal = 0;
  for (const raw of [...rawNotes].sort((left, right) => left.start - right.start || left.midi - right.midi)) {
    const samePitch = [...remaining]
      .filter((index) => canonicalNotes[index]!.midi === raw.midi)
      .sort((left, right) => {
        const a = canonicalNotes[left]!;
        const b = canonicalNotes[right]!;
        return Math.abs(a.start - raw.start) - Math.abs(b.start - raw.start)
          || Math.abs(a.dur - raw.dur) - Math.abs(b.dur - raw.dur)
          || left - right;
      });
    const samePitchOnset = samePitch.find((index) => Math.abs(canonicalNotes[index]!.start - raw.start) <= onsetTolerance);
    const sameOnsetDifferentPitch = [...remaining]
      .filter((index) => Math.abs(canonicalNotes[index]!.start - raw.start) <= onsetTolerance)
      .sort((left, right) => Math.abs(canonicalNotes[left]!.midi - raw.midi) - Math.abs(canonicalNotes[right]!.midi - raw.midi))[0];
    const matchedIndex = samePitchOnset ?? sameOnsetDifferentPitch;
    if (matchedIndex === undefined) {
      onsetMismatchLosses += 1;
      continue;
    }
    remaining.delete(matchedIndex);
    const matched = canonicalNotes[matchedIndex]!;
    const onsetDelta = Math.abs(matched.start - raw.start);
    const durationDelta = Math.abs(matched.dur - raw.dur);
    onsetDeltaTotal += onsetDelta;
    durationDeltaTotal += durationDelta;
    if (matched.midi !== raw.midi) pitchMismatchMatches += 1;
    else if (durationDelta > durationTolerance) durationMismatchMatches += 1;
    if (matched.midi === raw.midi && onsetDelta <= onsetTolerance && durationDelta <= durationTolerance) exactMatches += 1;
    else transformedMatches += 1;
  }
  const matched = rawNotes.length - onsetMismatchLosses;
  return {
    rawNoteCount: rawNotes.length,
    canonicalNoteCount: canonicalNotes.length,
    matchedNotes: matched,
    exactPitchOnsetDurationMatches: exactMatches,
    transformedMatches,
    pitchMismatchMatches,
    durationMismatchMatches,
    onsetMismatchLosses,
    unmatchedRawNotes: rawNotes.length - matched,
    unmatchedCanonicalNotes: remaining.size,
    meanMatchedOnsetDeltaBeats: matched ? Number((onsetDeltaTotal / matched).toFixed(6)) : null,
    meanMatchedDurationDeltaBeats: matched ? Number((durationDeltaTotal / matched).toFixed(6)) : null,
    tolerances: { onsetBeats: onsetTolerance, durationBeats: durationTolerance, pitch: "exact MIDI pitch required for an exact match" },
  };
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

function boundedArrangementDiagnostics(
  result: MelodyAccompanimentResolution,
  startBeat: number,
  endBeat: number,
  tempoBpm: number,
): Record<string, unknown> {
  const notes = result.notes.flatMap((note) => {
    const start = Math.max(startBeat, note.start);
    const end = Math.min(endBeat, note.start + note.dur);
    return end > start ? [{ ...note, start: start - startBeat, dur: end - start }] : [];
  });
  return {
    noteCount: notes.length,
    attackCount: new Set(notes.map((note) => note.start)).size,
    playability: playabilitySummary(notes, endBeat - startBeat, tempoBpm),
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
  const rawTrackLabels = ["PIANO", "CHOIR", "-CANTO-"];
  const rawTrackMetadataWithoutNotes = rawTrackMetadata(rawMidiBytes, rawMidi.division);
  const rawNoteSources = rawTrackMetadataWithoutNotes.flatMap((track) => {
    const texts = Array.isArray(track.texts) ? track.texts as Array<{ text?: string }> : [];
    const label = texts.find((event) => typeof event.text === "string" && rawTrackLabels.includes(event.text));
    if (!label) return [];
    const channels = track.channelNotes && typeof track.channelNotes === "object"
      ? Object.keys(track.channelNotes as Record<string, unknown>).map(Number).filter(Number.isInteger)
      : [];
    const channel = channels[0];
    return channel === undefined ? [] : [{ trackIndex: Number(track.trackIndex), channel, label: label.text! }];
  });
  const rawTrackData = rawTrackMetadata(rawMidiBytes, rawMidi.division, rawNoteSources);
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
  const notesForSource = (source: RawNoteSource | undefined): RawTrackNote[] => {
    if (!source) return [];
    const track = rawTrackData.find((item) => item.trackIndex === source.trackIndex);
    return Array.isArray(track?.notes)
      ? track.notes as RawTrackNote[]
      : [];
  };
  const rawCantoSource = rawNoteSources.find((source) => source.label === "-CANTO-");
  const rawPianoSource = rawNoteSources.find((source) => source.label === "PIANO");
  const rawChoirSource = rawNoteSources.find((source) => source.label === "CHOIR");
  const rawCantoNotes = notesForSource(rawCantoSource);
  const rawCantoAsNotes: Note[] = rawCantoNotes.map(({ trackIndex: _trackIndex, channel: _channel, ...note }) => ({ ...note, hand: "R" }));
  const rawCantoArrangement = rawCantoAsNotes.length > 0
    ? buildMelodyAccompaniment(rawCantoAsNotes, chordTimeline, options("right-hand", `raw-midi:${target.baseId}:track:${rawCantoSource?.trackIndex}:channel:${rawCantoSource?.channel}`))
    : null;
  const currentIds = new Set(current.provenance.melodyNoteIds);
  const candidateIds = new Set(candidate.provenance.melodyNoteIds);
  const xmlNoteBlocks = noteBlocks(xml);
  const rawTrackEvidence = rawTrackData.map(({ notes: _notes, ...track }) => track);
  const rawRoleActivity = rawCantoSource || rawPianoSource || rawChoirSource ? {
    sources: rawNoteSources,
    piano: trackCoverage(notesForSource(rawPianoSource), canonicalDuration),
    choir: trackCoverage(notesForSource(rawChoirSource), canonicalDuration),
    pianoChoirActivity: activityComparison(notesForSource(rawPianoSource), notesForSource(rawChoirSource), canonicalDuration),
  } : null;
  const selectedWindow = worstWindow(current, candidate, canonicalDuration);
  const selectedStartBeat = selectedWindow.startBeat as number;
  const selectedEndBeat = selectedWindow.endBeat as number;
  const rawCantoWindowComparison = rawCantoArrangement ? {
    window: {
      startBeat: selectedStartBeat,
      endBeat: selectedEndBeat,
      selectionBasis: "The existing current-vs-derived worst window; not selected for the raw CANTO candidate and not an untouched holdout.",
    },
    comparisonTempoBpm,
    currentAutomatic: boundedArrangementDiagnostics(current, selectedStartBeat, selectedEndBeat, comparisonTempoBpm),
    rawCantoCandidate: boundedArrangementDiagnostics(rawCantoArrangement, selectedStartBeat, selectedEndBeat, comparisonTempoBpm),
  } : null;
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
      rawMidiTrackMetadata: rawTrackEvidence,
      rawRoleActivity,
      rawCantoCandidate: rawCantoSource ? {
        label: rawCantoSource.label,
        trackIndex: rawCantoSource.trackIndex,
        channel: rawCantoSource.channel,
        coverage: trackCoverage(rawCantoNotes, canonicalDuration),
        transformAndMatch: rawToCanonicalMatch(rawCantoNotes, data.notes),
        arrangementAt108Bpm: rawCantoArrangement ? arrangementSummary(rawCantoArrangement, canonicalDuration, comparisonTempoBpm) : null,
        interpretation: "A disposable raw vocal-lane candidate. Its FF01 label, channel, and timing are source evidence only; no melody or learner-role approval is implied.",
      } : null,
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
    rawCantoCandidate: rawCantoArrangement ? arrangementSummary(rawCantoArrangement, canonicalDuration, comparisonTempoBpm) : null,
    rawCantoBoundedComparison: rawCantoWindowComparison,
    melodyIdentityComparison: {
      currentAutomaticMelodyNotes: currentIds.size,
      derivedUpperStaffOverrideMelodyNotes: candidateIds.size,
      sharedSourceIds: [...currentIds].filter((id) => candidateIds.has(id)).length,
      differingSourceIds: new Set([...currentIds, ...candidateIds].filter((id) => !currentIds.has(id) || !candidateIds.has(id))).size,
      derivedOverrideUnresolvedSpans: candidate.provenance.unresolvedSpans,
      interpretation: "Zero unresolved beats here are expected from selecting the existing staff=1/voice=1 lane with right-hand override semantics; they are not evidence that the original source melody has been recovered.",
    },
    worst12BeatWindow: selectedWindow,
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
    "The raw -CANTO- lane is a bounded vocal-track candidate; its label and channel do not establish learner-melody ownership.",
    "Raw MIDI meter events do not independently prove pickup/downbeat phase.",
    "Event counts and structural playability diagnostics do not establish musical acceptance.",
  ],
  targets: targets.map(evaluateTarget),
}, null, 2));
