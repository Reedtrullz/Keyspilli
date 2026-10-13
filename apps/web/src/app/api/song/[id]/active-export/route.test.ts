import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inferHarmonyTimeline, parseMidi, parseMusicXmlNotes, type Note } from "@keyspilli/midi";
import type { SongData } from "@keyspilli/player-core";
import { activeExportDigest, activeExportVariant, resolveActiveExport, type ActiveExportSelection } from "@/components/player/active-arrangement-export";

const getSongDetail = vi.hoisted(() => vi.fn());
const getSongDetailShell = vi.hoisted(() => vi.fn());
const PublicationRevisionConflictError = vi.hoisted(() => class extends Error {});
// Only the publication store and request authorization are substituted. The
// active resolver, serializer, response bytes, and reparsers are production code.
vi.mock("@/lib/catalog-api", () => ({ getSongDetail, getSongDetailShell, PublicationRevisionConflictError }));
vi.mock("@/lib/mutation-auth", () => ({ checkMutationAuth: () => null }));

import { POST } from "./route";

const source: Note[] = [
  { midi: 52, hand: "L", start: 0.5, dur: 2, vel: 64 },
  { midi: 55, hand: "R", start: 0.5, dur: 2, vel: 88 },
  { midi: 60, hand: "R", start: 0.5, dur: 2, vel: 96 },
];
const measures = [{ index: 0, startBeat: 0, endBeat: 4 }];
const authored: SongData = {
  notes: source, key: "C", tempoBpm: 120, timeSig: [4, 4], measures,
  sourceFingerprint: "synthetic-ks06-authored",
  chords: [
    { beat: 0, name: "N.C.", notes: [], durationBeats: 0.5, sourceKind: "authored" },
    { beat: 0.5, name: "C/E", notes: [], durationBeats: 2, sourceKind: "authored" },
    { beat: 2.5, name: "N.C.", notes: [], durationBeats: 1.5, sourceKind: "authored" },
  ],
};
const generated: SongData = {
  ...authored, sourceFingerprint: "synthetic-ks06-generated",
  chords: inferHarmonyTimeline(source, measures, { key: "C", backingOnly: true }),
};
const defaults: ActiveExportSelection = {
  backgroundMode: "chord", accompanimentStyle: "bass-chords", hand: "both", audibleSupport: false,
  speed: 0.5, transpose: 0, renderedExpression: "source", chordSource: "auto",
  melodySelection: "automatic", sourceBackingMode: "default", phraseOverrides: [],
};
const hands = ["both", "L", "R"] as const;
const transposeFor = { both: 0, L: -2, R: 2 } as const;
const shape = (notes: readonly Note[]) => notes.map(({ midi, hand, start, dur }) => ({ midi, hand, start, dur }))
  .sort((a, b) => a.start - b.start || a.midi - b.midi);
const params = Promise.resolve({ id: "synthetic-ks06" });

async function exported(data: SongData, selection: ActiveExportSelection, type: "midi" | "musicxml") {
  const resolution = resolveActiveExport(data, selection);
  const variant = activeExportVariant(data, resolution, selection);
  const expectedHash = await activeExportDigest(variant);
  getSongDetail.mockResolvedValue({ song: { id: "synthetic-ks06", title: "Synthetic hand export", artist: "Software control" }, data, publicationRevision: "synthetic-revision" });
  const response = await POST(new NextRequest("http://127.0.0.1/api/song/synthetic-ks06/active-export", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, revision: "synthetic-revision", sourceFingerprint: data.sourceFingerprint, selection, expectedHash }),
  }), { params });
  expect(response.status).toBe(200);
  expect(response.headers.get("x-active-arrangement-sha256")).toBe(expectedHash);
  const parsed = type === "midi" ? parseMidi(new Uint8Array(await response.arrayBuffer())) : parseMusicXmlNotes(await response.text());
  return { resolution, variant, parsed };
}

describe("active export hand semantics through the download response", () => {
  beforeEach(() => {
    getSongDetail.mockReset();
    getSongDetailShell.mockReset().mockResolvedValue({ song: { hasSheetXml: 1 }, publicationRevision: "synthetic-revision" });
  });

  it.each((["midi", "musicxml"] as const).flatMap(type => (["authored", "generated"] as const).flatMap(kind =>
    hands.flatMap(hand => [false, true].map(audibleSupport => ({ type, kind, hand, audibleSupport }))))))
  ("preserves $kind $hand hands in $type with audible support $audibleSupport", async ({ type, kind, hand, audibleSupport }) => {
    const data = kind === "authored" ? authored : generated;
    const before = JSON.stringify(data);
    const transpose = transposeFor[hand];
    const selection = { ...defaults, hand, audibleSupport, transpose };
    const { resolution, variant, parsed } = await exported(data, selection, type);
    // This independently stated C/E voicing is the Player's delivered plan.
    const expected: Note[] = [
      { midi: 40, hand: "L" as const, start: 0.5, dur: 2, vel: 100 },
      ...[67, 72, 76].map(midi => ({ midi, hand: "R" as const, start: 0.5, dur: 2, vel: 100 })),
    ].filter(note => audibleSupport || hand === "both" || note.hand === hand)
      .map(note => ({ ...note, midi: note.midi + transpose }));
    expect(shape(resolution.guidanceNotes.filter(note => audibleSupport || hand === "both" || note.hand === hand)
      .map(note => ({ ...note, midi: note.midi + transpose })))).toEqual(shape(expected));
    // Assert the external file first: an in-memory hand fix alone is insufficient.
    expect(shape(parsed.notes)).toEqual(shape(expected));
    expect(shape(variant.notes)).toEqual(shape(expected));
    expect(variant.notes.every(note => note.vel === 100)).toBe(true);
    expect(parsed.tempoBpm).toBeCloseTo(60, 4);
    expect(parsed.notes.map(note => note.vel)).toEqual(expected.map(note => note.vel));
    expect(JSON.stringify(data)).toBe(before);
  });

  it.each((["midi", "musicxml"] as const).flatMap(type => hands.map(hand => ({ type, hand }))))
  ("preserves the Original source stream for $hand in $type", async ({ type, hand }) => {
    const transpose = transposeFor[hand];
    const { variant, parsed } = await exported(authored, { ...defaults, backgroundMode: "piano", hand, transpose }, type);
    const expected = source.filter(note => hand === "both" || note.hand === hand).map(note => ({ ...note, midi: note.midi + transpose }));
    expect(shape(parsed.notes)).toEqual(shape(expected));
    expect(shape(variant.notes)).toEqual(shape(expected));
    expect(variant.notes.map(note => note.vel)).toEqual(expected.map(note => note.vel));
    expect(parsed.notes.map(note => note.vel)).toEqual(expected.map(note => note.vel));
  });
  it.each((["midi","musicxml"] as const).flatMap(type=> (["source","meter-accents"] as const).map(renderedExpression=>({type,renderedExpression}))))
  ("preserves selected $renderedExpression velocities in the actual $type download",async({type,renderedExpression})=>{
    const data:SongData={...authored,notes:[{midi:60,start:0,dur:6,vel:20,hand:"R",sourceMidiChannel:2},{midi:64,start:0,dur:2,vel:100,hand:"R",sourceMidiChannel:2},{midi:48,start:2,dur:1,vel:71,hand:"L",sourceMidiChannel:3}],measures:[{index:0,startBeat:0,endBeat:4},{index:1,startBeat:4,endBeat:8}],sourcePedal:{version:1,endBeat:8,provenance:"midi-file",changes:[{beat:0,channel:2,value:127,source:"midi:0"},{beat:7,channel:2,value:0,source:"midi:0"}]}};
    data.sourceTiming={timeSig:[4,4],measureStartBeat:0,provenance:"source-measure-boundary",sourceFingerprint:data.sourceFingerprint!};
    if(renderedExpression==="meter-accents")data.notes=data.notes.map(n=>({...n,vel:80}));
    const before=structuredClone(data),selection={...defaults,backgroundMode:"piano" as const,hand:"R" as const,audibleSupport:true,speed:.5,transpose:2,renderedExpression};
    const {variant,parsed}=await exported(data,selection,type);
    expect(parsed.notes.map(n=>[n.midi,n.start,n.dur,n.vel,n.sourceMidiChannel])).toEqual(variant.notes.map(n=>[n.midi,n.start,n.dur,n.vel,n.sourceMidiChannel]));
    expect(parsed.tempoBpm).toBeCloseTo(60,4);expect(parsed.sourcePedal?.endBeat).toBe(data.sourcePedal!.endBeat);expect(parsed.sourcePedal?.changes.map(e=>[e.beat,e.channel,e.value])).toEqual(data.sourcePedal!.changes.map(e=>[e.beat,e.channel,e.value]));expect(data).toEqual(before);
    if(renderedExpression==="source")expect(parsed.notes.map(n=>n.vel)).toEqual([20,100,71]);
    else expect(parsed.notes.map(n=>n.vel)).toEqual([92,92,76]);
  });

});
