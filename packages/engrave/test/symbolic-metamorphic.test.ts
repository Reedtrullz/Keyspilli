import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Verovio is already installed through @keyspilli/engrave; the package ships no TS declarations.
// @ts-expect-error Existing workspace dependency, intentionally used as an independent MusicXML consumer.
import createVerovioModule from "verovio/wasm";
// @ts-expect-error Existing workspace dependency, intentionally used as an independent MusicXML consumer.
import { VerovioToolkit } from "verovio/esm";
import { parseMidi, parseMusicXmlNotes, writeMidi, writeMusicXml, type Note, type Variant } from "@keyspilli/midi";

const SEEDS = [0x61, 0x6101, 0x61cafe] as const;
const NOTE_COUNT = 6;
const TRANSPOSE = 5;
const TIME_SHIFT = 1;

interface VerovioConsumer {
  setOptions(options: { inputFrom: string }): unknown;
  loadData(xml: string): boolean | number;
  renderToMIDI(): string;
  destroy(): void;
}

function seededVariant(seed: number): Variant {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const durations = [0.5, 1, 1.5] as const;
  const notes: Note[] = Array.from({ length: NOTE_COUNT }, (_, index) => ({
    // Distinct pitches keep this check about format conversion, not unison voice allocation.
    midi: 48 + ((seed + index * 7) % 31),
    start: Math.floor(random() * 8) / 2,
    dur: durations[Math.floor(random() * durations.length)]!,
    vel: 64 + Math.floor(random() * 48),
    hand: index % 2 === 0 ? "R" : "L",
  }));
  return {
    level: "advanced",
    difficultyScore: 0,
    notes,
    chords: [],
    bassPattern: "block",
    key: "C",
    tempoBpm: 120,
    timeSig: [4, 4],
    measures: [
      { index: 0, startBeat: 0, endBeat: 4 },
      { index: 1, startBeat: 4, endBeat: 8 },
    ],
  };
}

function noteShape(notes: readonly Note[]) {
  return notes
    .map(({ midi, start, dur }) => ({
      midi,
      start: Math.round(start * 1000) / 1000,
      dur: Math.round(dur * 1000) / 1000,
    }))
    .sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur);
}

function transpose(variant: Variant, semitones: number): Variant {
  return { ...variant, notes: variant.notes.map((note) => ({ ...note, midi: note.midi + semitones })) };
}

function shiftTime(variant: Variant, beats: number): Variant {
  return { ...variant, notes: variant.notes.map((note) => ({ ...note, start: note.start + beats })) };
}

describe("bounded symbolic differential and metamorphic checks", () => {
  let toolkit: VerovioConsumer;

  beforeAll(async () => {
    const module = await createVerovioModule();
    toolkit = new VerovioToolkit(module) as VerovioConsumer;
    toolkit.setOptions({ inputFrom: "xml" });
  });

  afterAll(() => toolkit.destroy());

  const compareMusicXml = (variant: Variant, context: string) => {
    const xml = writeMusicXml(variant, context, "Synthetic fixture");
    const projectReader = parseMusicXmlNotes(xml);
    expect(toolkit.loadData(xml), `Verovio load failed for ${context}`).toBeTruthy();
    const rendered = Buffer.from(toolkit.renderToMIDI(), "base64");
    const ticksPerQuarter = rendered.readUInt16BE(12);
    expect(ticksPerQuarter).toBeGreaterThan(0);
    expect(ticksPerQuarter & 0x8000).toBe(0);
    const independentReader = parseMidi(rendered);
    // Verovio 6 emits note-offs one tick before the notated end (GenerateMIDIFunctor).
    // Compare that exact documented playback transform, not a loose duration tolerance.
    const playbackShape = (notes: readonly Note[]) => noteShape(notes.map(note => ({ ...note, dur: note.dur - 1 / ticksPerQuarter })));
    const expected = noteShape(variant.notes);

    expect.soft(noteShape(projectReader.notes), `project MusicXML parser mismatch for ${context}`).toEqual(expected);
    expect.soft(noteShape(independentReader.notes), `Verovio MusicXML import mismatch for ${context}`).toEqual(playbackShape(variant.notes));
    expect.soft(noteShape(independentReader.notes), `consumer disagreement for ${context}`).toEqual(playbackShape(projectReader.notes));
  };

  it("preserves a later overlapping attack for an independent consumer", () => {
    compareMusicXml({
      level: "advanced",
      difficultyScore: 0,
      notes: [
        { midi: 60, start: 0, dur: 2, vel: 80, hand: "R" },
        { midi: 64, start: 1, dur: 1, vel: 80, hand: "R" },
      ],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    }, "overlapping C4/E4 voices");
  });

  it("preserves a single note tied across the barline for an independent consumer", () => {
    compareMusicXml({
      ...seededVariant(SEEDS[0]),
      notes: [{ midi: 50, start: 3, dur: 1.5, vel: 80, hand: "R" }],
    }, "single cross-bar tie");
  });

  it("preserves simultaneous cross-staff ties across the barline", () => {
    compareMusicXml({
      ...seededVariant(SEEDS[0]),
      notes: [
        { midi: 50, start: 3, dur: 1.5, vel: 80, hand: "R" },
        { midi: 57, start: 3.5, dur: 1.5, vel: 80, hand: "L" },
      ],
    }, "simultaneous cross-staff cross-bar ties");
  });

  it("preserves duplicate unisons and an overlapping repeated-pitch attack", () => {
    compareMusicXml({
      ...seededVariant(SEEDS[0]),
      notes: [
        { midi: 60, start: 0, dur: 2, vel: 80, hand: "R" },
        { midi: 60, start: 0, dur: 2, vel: 80, hand: "R" },
        { midi: 60, start: 1, dur: 1, vel: 80, hand: "R" },
      ],
    }, "duplicate C4 unisons and overlapping re-attack");
  });

  it("preserves a cross-bar tie after switching voices", () => {
    compareMusicXml({
      level: "advanced",
      difficultyScore: 0,
      notes: [
        { midi: 73, start: 1.5, dur: 1.5, vel: 80, hand: "L" },
        { midi: 59, start: 2, dur: 0.5, vel: 80, hand: "L" },
        { midi: 56, start: 3.5, dur: 1, vel: 80, hand: "L" },
      ],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [
        { index: 0, startBeat: 0, endBeat: 4 },
        { index: 1, startBeat: 4, endBeat: 8 },
      ],
    }, "cross-bar tie after voice switch");
  });

  it("agrees with Verovio after bounded transpose and time-shift transformations", () => {
    for (const seed of SEEDS) {
      const source = seededVariant(seed);
      const cases = [
        ["source", source],
        [`transpose +${TRANSPOSE}`, transpose(source, TRANSPOSE)],
        [`time shift +${TIME_SHIFT}`, shiftTime(source, TIME_SHIFT)],
      ] as const;
      for (const [transform, variant] of cases) {
        compareMusicXml(variant, `seed ${seed}, ${transform}`);
      }
    }
  });

  it("preserves MIDI note and global timing semantics across track orders", () => {
    const tracks = [
      { name: "Top", notes: [{ midi: 64, start: 0, dur: 1, vel: 88 }, { midi: 67, start: 2, dur: 0.5, vel: 92 }] },
      { name: "Bass", notes: [{ midi: 40, start: 0.5, dur: 1.5, vel: 76 }] },
      { name: "Middle", notes: [{ midi: 55, start: 1, dur: 1, vel: 82 }] },
    ];
    const orders = [[0, 1, 2], [2, 0, 1], [1, 2, 0]] as const;
    const expected = noteShape(tracks.flatMap((track) => track.notes));

    for (const order of orders) {
      const parsed = parseMidi(writeMidi([], {
        tempoBpm: 96,
        timeSig: [3, 4],
        tracks: order.map((index) => tracks[index]!),
      }));
      expect(noteShape(parsed.notes)).toEqual(expected);
      expect(parsed.tempoBpm).toBe(96);
      expect(parsed.timeSig).toEqual([3, 4]);
    }
  });

  it("preserves pickup and meter-change measure boundaries with repeated pitches", () => {
    const variant: Variant = {level:"advanced",difficultyScore:0,chords:[],bassPattern:"block",key:"C",tempoBpm:120,timeSig:[4,4],
      timeSigEvents:[{beat:0,tick:0,timeSig:[4,4]},{beat:1,tick:960,timeSig:[6,8]},{beat:4,tick:3840,timeSig:[3,4]}],
      measures:[{index:0,startBeat:0,endBeat:1},{index:1,startBeat:1,endBeat:4},{index:2,startBeat:4,endBeat:7}],
      notes:[{midi:60,start:0,dur:1,vel:80,hand:"R"},{midi:60,start:1,dur:.5,vel:80,hand:"R"},{midi:60,start:4,dur:1,vel:80,hand:"R"}]};
    compareMusicXml(variant,"pickup / 6-8 / 3-4 repeated C4");
    expect(parseMusicXmlNotes(writeMusicXml(variant,"Pickup","Synthetic")).notationMeasures).toEqual(variant.measures);
  });

  it("preserves composite and tuplet durations instead of rounding their written value",()=>{
    compareMusicXml({level:"advanced",difficultyScore:0,chords:[],bassPattern:"block",key:"C",tempoBpm:120,timeSig:[4,4],measures:[{index:0,startBeat:0,endBeat:4},{index:1,startBeat:4,endBeat:8}],notes:[{midi:60,start:0,dur:2.5,vel:80,hand:"R"},{midi:64,start:0,dur:3,vel:80,hand:"R"},{midi:62,start:3,dur:1.25,vel:80,hand:"L"},{midi:67,start:5,dur:.625,vel:80,hand:"R"},{midi:69,start:6,dur:1/3,vel:80,hand:"L"}]},"composite notes and exact tuplet remainder");
  });

  it("agrees with native Verovio on a finite two-pass repeat before canonical export",()=>{
    const xml='<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">'+['C','D','E'].map((step,i)=>`<measure number="${i+1}">${i===0?'<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><barline location="left"><repeat direction="forward"/></barline>':''}<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>${i===1?'<barline location="right"><repeat direction="backward" times="2"/></barline>':''}</measure>`).join('')+'</part></score-partwise>';
    const canonical=parseMusicXmlNotes(xml);
    expect(toolkit.loadData(xml)).toBeTruthy();const rendered=Buffer.from(toolkit.renderToMIDI(),"base64"),ppq=rendered.readUInt16BE(12);
    expect(noteShape(parseMidi(rendered).notes)).toEqual(noteShape(canonical.notes.map(n=>({...n,dur:n.dur-1/ppq}))));
    const variant:Variant={level:"advanced",difficultyScore:0,notes:canonical.notes,chords:[],bassPattern:"none",key:"C",tempoBpm:120,timeSig:[4,4],measures:canonical.notationMeasures!};
    compareMusicXml(variant,"finite repeat canonical sequence");
    expect(parseMusicXmlNotes(writeMusicXml(variant,"Repeat","Synthetic")).notationMeasures).toEqual(canonical.notationMeasures);
  });

  it("fails closed for unsupported MIDI format 2 and MusicXML repeats", () => {
    const midi = writeMidi([], {
      tempoBpm: 120,
      tracks: [
        { name: "A", notes: [{ midi: 60, start: 0, dur: 1, vel: 80 }] },
        { name: "B", notes: [{ midi: 48, start: 0, dur: 1, vel: 80 }] },
      ],
    });
    midi[8] = 0;
    midi[9] = 2;
    expect(() => parseMidi(midi)).toThrow(/unsupported MIDI format 2/i);

    const variant = seededVariant(SEEDS[0]);
    const xml = writeMusicXml(variant, "Repeat case", "Synthetic fixture");
    const repeated = xml.replace("</measure>", '<barline><repeat direction="backward"/></barline></measure>');
    expect(repeated).not.toBe(xml);
    expect(() => parseMusicXmlNotes(repeated)).toThrow(/unsupported.*repeat/i);
  });
});
