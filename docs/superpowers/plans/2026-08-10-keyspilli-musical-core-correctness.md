# Keyspilli Musical-Core Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the verified correctness bugs in Keyspilli's musical core — grading, MusicXML/MIDI generation and parsing, simplification, and engraving — so practice scoring, exported scores, and sheet rendering are actually correct.

**Architecture:** Eight independent, test-first tasks across `@keyspilli/player-core`, `@keyspilli/midi`, and `@keyspilli/engrave`. Each task ships with regression tests that fail on the current code (verified during planning) and pass after the fix. No API shapes change except one additive export (`keySignature`) and one additive optional parameter (`renderMusicXml` toolkit override).

**Tech Stack:** TypeScript 5.6 (strict), vitest 3, Node >= 20, npm workspaces. No new dependencies.

## Global Constraints

- Repo root: `/Users/reidar/Projectos/Keyspilli`. Run every command from there.
- Match existing style exactly: no semicolons, double quotes, 2-space indent, `.js` import suffixes, `import type` for types.
- No new npm dependencies. Task 8 only declares the already-used workspace dep `@keyspilli/midi`.
- Test command pattern: `npm test -w @keyspilli/<pkg> -- test/<file>.test.ts` (vitest run with a single file).
- Typecheck pattern: `npm run typecheck -w @keyspilli/<pkg>`.
- Commit after each task with the exact message given; conventional commits as in repo history.
- Do not touch: `apps/web` behavior, the SQLite schema, worker/deploy code (separate plans), or `detectPitch`/`capSoundingPolyphony` (investigated — see Out of Scope below).
- Known effects (not bugs): `detectKey`/`keyName` now return minor names with an `m` suffix ("Am"); existing SQLite rows keep old key names until the next `npm run pipeline` regeneration. `writeMidi` now drops `vel < 1` notes. The Grader counts a miss only when `tick()` observes the window expire, and counts a correct-but-late note exactly once.

## Out of Scope (investigated during planning, no change)

- **detectPitch octave bias** (review finding): validated with synthetic harmonic-rich tones (fundamental 220 Hz + 0.5/0.33/0.25 harmonics; strong-2nd-harmonic variant) — the current algorithm already returns the correct fundamental (57). No reproduction, so no change; revisit only if real microphone recordings misread.
- **`capSoundingPolyphony` splice guard** (review finding): `out` and `active` multisets stay aligned by invariant (push together, splice together), so `out.indexOf(victim)` cannot return -1; the finding is a static-analysis false positive.
- **Worker job wedge, backup/restore, web auth, deploy ops** (review findings): separate plans, not in this one.

---

### Task 1: Grader counts missed and late notes; wait mode enforces timing

**Files:**
- Modify: `packages/player-core/src/grading.ts` (Grader class internals)
- Modify: `packages/player-core/test/player-core.test.ts` (grader describe block)

**Interfaces:**
- Consumes: `TimedNote` from `packages/player-core/src/timeline.ts` (unchanged: `{ midi, startSec, durSec, vel, hand? }`), `GradeResult` (unchanged shape).
- Produces: unchanged public API (`tick`, `play`, `currentWait`, `result`). Semantics change: `missed` is counted when `tick` observes a window expire; `late` (correct pitch, past window) is counted exactly once and consumes the note; wait mode rejects the expected note outside ±0.35 s.

- [ ] **Step 1: Write the failing tests**

Add to the `describe("grader", ...)` block in `packages/player-core/test/player-core.test.ts`, after the existing "wait mode holds until the right note" test:

```ts
  it("counts unplayed notes as missed instead of scoring 100%", () => {
    const g = new Grader(notes);
    g.tick(0.5);
    g.tick(1.0);
    g.tick(1.5);
    const r = g.result();
    expect(r.missed).toBe(3);
    expect(r.hit).toBe(0);
    expect(r.accuracyPct).toBe(0);
  });

  it("counts correct-but-late notes once, as late", () => {
    const g = new Grader(notes);
    g.play(60, 0.05);
    g.play(64, 2.0); // window for the note at 1.0s ended at 1.35s
    g.tick(1.5); // middle note passes untouched
    const r = g.result();
    expect(r.hit).toBe(1);
    expect(r.late).toBe(1);
    expect(r.missed).toBe(1);
    expect(r.accuracyPct).toBe(33);
  });

  it("rejects the expected note before its time window in wait mode", () => {
    const g = new Grader(notes, { waitMode: true });
    expect(g.currentWait?.midi).toBe(60);
    expect(g.play(60, -2)).toBe(false);
    expect(g.play(60, 0.05)).toBe(true);
  });
```

Also update the existing "scores hits, wrongs and misses" test so misses are observed by `tick` (new semantics):

```ts
  it("scores hits, wrongs and misses", () => {
    const g = new Grader(notes);
    g.play(60, 0.05);
    g.play(63, 0.55); // wrong pitch in window
    g.play(62, 0.6); // slightly late but within tolerance
    g.tick(1.5); // last note passes untouched
    const r = g.result();
    expect(r.hit).toBe(2);
    expect(r.wrong).toBe(1);
    expect(r.missed).toBe(1);
    expect(r.accuracyPct).toBe(50);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @keyspilli/player-core -- test/player-core.test.ts`

Expected: FAIL. The first new test reports `accuracyPct: 100` / `missed: 0` (current `tick` prunes without counting); the late test reports `late: 0`; the wait-mode test gets `true` from `g.play(60, -2)`; the updated existing test reports `missed: 0` / `accuracyPct: 67`.

- [ ] **Step 3: Implement the fix in grading.ts**

Replace the Grader class body (keep the constructor) and the `result()` method:

```ts
/**
 * Grades a player's note events against the expected notes.
 * - hit: correct pitch within the time window
 * - wrong: incorrect pitch within the time window
 * - missed: expected note whose window passed with no matching event
 * - late: correct pitch played after its window (counted once)
 */
export class Grader {
  private remaining: TimedNote[];
  private hits = 0;
  private wrongs = 0;
  private late = 0;
  private missed = 0;
  private waitMode = false;
  private waitingFor: TimedNote | null = null;

  constructor(
    notes: TimedNote[],
    opts: { waitMode?: boolean } = {},
  ) {
    this.remaining = [...notes].sort((a, b) => a.startSec - b.startSec);
    this.waitMode = opts.waitMode ?? false;
  }

  /** Call as time advances; counts expected notes whose window passed without input. */
  tick(now: number): void {
    if (this.waitMode) return; // wait mode advances only on correct input
    let i = 0;
    while (i < this.remaining.length) {
      const n = this.remaining[i]!;
      if (now - n.startSec > TIME_TOLERANCE) {
        this.missed++;
        this.remaining.splice(i, 1);
      } else {
        i++;
      }
    }
  }

  /** Feed a played note (midi) at the given time. Returns true if accepted in wait mode. */
  play(midi: number, now: number): boolean {
    if (this.waitMode && this.waitingFor) {
      if (midi !== this.waitingFor.midi) {
        this.wrongs++;
        return false;
      }
      if (Math.abs(now - this.waitingFor.startSec) <= TIME_TOLERANCE) {
        this.hits++;
        this.remaining.splice(this.remaining.indexOf(this.waitingFor), 1);
        this.waitingFor = null;
        return true;
      }
      return false; // correct pitch, outside the window: hold
    }
    const window = this.remaining.filter((n) => Math.abs(now - n.startSec) <= TIME_TOLERANCE);
    const exact = window.find((n) => n.midi === midi);
    if (exact) {
      this.hits++;
      this.remaining.splice(this.remaining.indexOf(exact), 1);
      return true;
    }
    if (window.length > 0) {
      this.wrongs++;
      return true;
    }
    const pastIdx = this.remaining.findIndex((n) => n.midi === midi && now > n.startSec + TIME_TOLERANCE);
    if (pastIdx >= 0) {
      this.late++;
      this.remaining.splice(pastIdx, 1);
    }
    return true;
  }

  /** In wait mode, the note the player must press right now. */
  get currentWait(): TimedNote | null {
    if (!this.waitMode) return null;
    if (this.waitingFor) return this.waitingFor;
    const next = this.remaining[0];
    if (next) this.waitingFor = next;
    return this.waitingFor;
  }

  result(): GradeResult {
    const total = this.hits + this.wrongs + this.missed + this.late;
    const accuracyPct = total === 0 ? 100 : Math.round((this.hits / total) * 100);
    let summary = "";
    if (accuracyPct >= 90) summary = "Great run — clean and in time.";
    else if (accuracyPct >= 70) summary = "Good work. A few spots to polish.";
    else if (this.missed > this.wrongs) summary = "Most mistakes were missed notes.";
    else summary = "Many notes were technically right but off the beat.";
    return { total, hit: this.hits, missed: this.missed, wrong: this.wrongs, late: this.late, accuracyPct, summary };
  }
}
```

Delete the now-unused `private played = new Set<number>();` field and the dead `const PITCH_TOLERANCE = 0;` constant (both already in `grading.ts` and unreferenced). Keep `const TIME_TOLERANCE = 0.35;`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @keyspilli/player-core -- test/player-core.test.ts`

Expected: PASS (all grader tests, including the three new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/player-core/src/grading.ts packages/player-core/test/player-core.test.ts
git commit -m "fix(player): count missed and late notes so silence can't score 100%"
```

---

### Task 2: MusicXML writer emits correct note types, valid dots, and a grand staff

**Files:**
- Modify: `packages/midi/src/writeXml.ts` (`typeFromDur`, note template, first-measure attributes)
- Modify: `packages/midi/test/midi.test.ts` (writeMusicXml describe block; add `Variant` to the imports from `../src/index.js`)

**Interfaces:**
- Consumes: `Variant`, `Note`, `PITCH_COLORS` (unchanged).
- Produces: unchanged `writeMusicXml(variant, title, artist): string`. Output changes: `<type>` values now correct (1 beat = quarter), dotted notes emit `<dot/>` directly, first-measure attributes include `<staves>2</staves>`.

- [ ] **Step 1: Write the failing tests**

Add to the `describe("writeMusicXml", ...)` block in `packages/midi/test/midi.test.ts`:

```ts
  it("writes correct note types for common durations", () => {
    const v: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [
        { midi: 60, start: 0, dur: 0.5, vel: 80, hand: "R" },
        { midi: 62, start: 0.5, dur: 1, vel: 80, hand: "R" },
        { midi: 64, start: 1.5, dur: 2, vel: 80, hand: "L" },
        { midi: 48, start: 3.5, dur: 4, vel: 80, hand: "L" },
      ],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    };
    const xml = writeMusicXml(v, "T", "A");
    expect(xml).toContain("<type>eighth</type>");
    expect(xml).toContain("<type>quarter</type>");
    expect(xml).toContain("<type>half</type>");
    expect(xml).toContain("<type>whole</type>");
    expect(xml).not.toContain("<dots>");
    expect(xml).toContain("<staves>2</staves>");
  });

  it("writes dotted notes as a direct <dot/>", () => {
    const v: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [{ midi: 60, start: 0, dur: 1.5, vel: 80, hand: "R" }],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    };
    const xml = writeMusicXml(v, "T", "A");
    expect(xml).toContain("<type>quarter</type><dot/>");
    expect(xml).not.toContain("<dots>");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @keyspilli/midi -- test/midi.test.ts`

Expected: FAIL. Current `typeFromDur` maps 1 beat → `"whole"`, 2 → `"whole"`, 0.5 → `"half"`, so the first test's `quarter`/`half`/`eighth` assertions fail; the dotted test fails on `<dots><dot/></dots>`.

- [ ] **Step 3: Implement the fix in writeXml.ts**

Replace `typeFromDur`:

```ts
function typeFromDur(beats: number): { type: string; dots: number } {
  const dotted: [number, string][] = [
    [1.5, "quarter"],
    [3, "half"],
    [6, "whole"],
    [0.75, "eighth"],
    [0.375, "16th"],
  ];
  for (const [b, t] of dotted) {
    if (Math.abs(beats - b) < 1e-6) return { type: t, dots: 1 };
  }
  const names = ["whole", "half", "quarter", "eighth", "16th", "32nd", "64th"];
  let b = beats;
  let i = 2; // 1 beat = quarter
  while (b < 1 && i < names.length - 1) {
    b *= 2;
    i++;
  }
  while (b > 1 && i > 0) {
    b /= 2;
    i--;
  }
  return { type: names[i]!, dots: 0 };
}
```

In the `noteXmls.push(...)` template, change `${dots ? "<dots><dot/></dots>" : ""}` to `${dots ? "<dot/>" : ""}`.

In the first-measure attributes string, change:

```ts
`<attributes><divisions>${DIV}</divisions>${keyTime}` +
```

to:

```ts
`<attributes><divisions>${DIV}</divisions>${keyTime}<staves>2</staves>` +
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @keyspilli/midi -- test/midi.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/midi/src/writeXml.ts packages/midi/test/midi.test.ts
git commit -m "fix(midi): write correct MusicXML note types, valid dotted markup, grand staff"
```

---

### Task 3: Minor-key signatures are emitted correctly everywhere

**Files:**
- Modify: `packages/midi/src/analyze.ts` (add `keySignature`, make `keyName` append `m` for minor)
- Modify: `packages/midi/src/writeXml.ts` (drop `keySigFromName`, use `keySignature`)
- Modify: `packages/midi/src/index.ts` (export `keySignature`)
- Modify: `packages/catalog/src/ingest.ts` (drop duplicated `keySigOf`, use `keySignature`)
- Modify: `packages/midi/test/midi.test.ts` (update detectKey expectation; add keySignature + writer tests; import `keySignature`)

**Interfaces:**
- Consumes: `detectKey` (now returns names like `"Am"`, `"Dm"`).
- Produces: `keySignature(key: string): { fifths: number; mode: 0 | 1 }` exported from `@keyspilli/midi` (defined in `analyze.ts`, re-exported by `index.ts`). Task 3's own consumers: `writeXml.ts` and `ingest.ts`.

- [ ] **Step 1: Write the failing tests**

In `packages/midi/test/midi.test.ts`, update the minor-key detection expectation (the test whose source notes end in `expect(detectKey(notes).name).toBe("A");`):

```ts
    expect(detectKey(notes).name).toBe("Am");
```

Add a new describe block (and import `keySignature` from `../src/index.js`):

```ts
describe("keySignature", () => {
  it("maps major and minor key names to fifths and mode", () => {
    expect(keySignature("C")).toEqual({ fifths: 0, mode: 0 });
    expect(keySignature("G")).toEqual({ fifths: 1, mode: 0 });
    expect(keySignature("F")).toEqual({ fifths: -1, mode: 0 });
    expect(keySignature("Am")).toEqual({ fifths: 0, mode: 1 });
    expect(keySignature("Dm")).toEqual({ fifths: -1, mode: 1 });
    expect(keySignature("Ebm")).toEqual({ fifths: -6, mode: 1 });
    expect(keySignature("F#m")).toEqual({ fifths: 3, mode: 1 });
  });
});
```

Add to the writeMusicXml describe block:

```ts
  it("writes minor key signatures", () => {
    const v: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [{ midi: 60, start: 0, dur: 1, vel: 80, hand: "R" }],
      chords: [],
      bassPattern: "block",
      key: "Dm",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    };
    const xml = writeMusicXml(v, "T", "A");
    expect(xml).toContain("<key><fifths>-1</fifths><mode>minor</mode></key>");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @keyspilli/midi -- test/midi.test.ts`

Expected: FAIL. `keySignature` is not defined; the updated detectKey test fails with `"A"`; the writer test finds `<fifths>0</fifths>` instead of `<fifths>-1</fifths>`.

- [ ] **Step 3: Implement the fix**

In `packages/midi/src/analyze.ts`, add after the existing key arrays:

```ts
const MAJOR_FIFTHS_BY_NAME: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
};
const MINOR_FIFTHS_BY_NAME: Record<string, number> = {
  A: 0, E: 1, B: 2, "F#": 3, "C#": 4, "G#": 5, "D#": 6, "A#": 7,
  D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6, Ab: -7,
};

/** Key signature (fifths + mode) for a key name like "G", "F#m" or "Eb". */
export function keySignature(key: string): { fifths: number; mode: 0 | 1 } {
  const minor = /m$/.test(key);
  const root = minor ? key.slice(0, -1) : key;
  const table = minor ? MINOR_FIFTHS_BY_NAME : MAJOR_FIFTHS_BY_NAME;
  return { fifths: table[root] ?? 0, mode: minor ? 1 : 0 };
}
```

Update `keyName` so minor keys carry their mode in the name (both return lines):

```ts
export function keyName(sharps: number, minor: boolean): string {
  const idx = Math.abs(sharps);
  if (idx > 7) return "C";
  if (sharps >= 0) return minor ? MINOR_SHARP[idx]! + "m" : SHARP_KEYS[idx]!;
  return minor ? MINOR_FLAT[idx]! + "m" : FLAT_KEYS[idx]!;
}
```

In `packages/midi/src/index.ts`, change the analyze re-export line to:

```ts
export { splitHands, detectKey, keyName, chordName, detectBassPattern, melodyFrom, keySignature } from "./analyze.js";
```

In `packages/midi/src/writeXml.ts`, delete the whole `keySigFromName` function, add `keySignature` to the import from `./analyze.js`, and replace the call:

```ts
  const { fifths, mode } = keySignature(variant.key);
```

In `packages/catalog/src/ingest.ts`, delete the whole `keySigOf` function, add `keySignature` to the `@keyspilli/midi` import block, and replace the two key options in the `writeMidi(v.notes, {...})` call:

```ts
      keySig: keySignature(v.key).fifths,
      keyMode: keySignature(v.key).mode,
```

(keep every other option in that call exactly as it is).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @keyspilli/midi -- test/midi.test.ts` then `npm run typecheck -w @keyspilli/catalog`

Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add packages/midi/src/analyze.ts packages/midi/src/writeXml.ts packages/midi/src/index.ts packages/catalog/src/ingest.ts packages/midi/test/midi.test.ts
git commit -m "fix(midi): emit correct key signatures for minor keys"
```

---

### Task 4: MusicXML parser keeps chords on one beat and honors backup/forward

**Files:**
- Modify: `packages/midi/src/parseXml.ts` (`parseMusicXmlNotes`)
- Modify: `packages/midi/test/parseXml.test.ts` (parseMusicXmlNotes describe block)

**Interfaces:**
- Consumes: `ParsedMidi`/`Note` shapes (unchanged).
- Produces: unchanged `parseMusicXmlNotes(xml): ParsedMidi`. Semantics change: chord members no longer advance the cursor; `<backup>`/`<forward>` shift the cursor; only the first `<part>` of multi-part scores is parsed; notes without a valid octave or with non-positive duration are skipped.

- [ ] **Step 1: Write the failing tests**

Add to the `describe("parseMusicXmlNotes", ...)` block in `packages/midi/test/parseXml.test.ts`:

```ts
  it("keeps chord members on one beat and honors <backup>", () => {
    const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>
<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration></note>
<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration></note>
<note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration></note>
<backup><duration>5</duration></backup>
<note><pitch><step>A</step><octave>3</octave></pitch><duration>2</duration></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
</measure></part></score-partwise>`;
    const m = parseMusicXmlNotes(xml);
    expect(m.notes.map((n) => `${n.midi}@${n.start}`)).toEqual(["60@0", "64@0", "67@0", "65@0.5", "57@0", "62@0.5"]);
  });

  it("skips notes without a valid octave or duration", () => {
    const xml = `<score-partwise version="4.0"><part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes>
<note><pitch><step>C</step></pitch><duration>2</duration></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>0</duration></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration></note>
</measure></part></score-partwise>`;
    const m = parseMusicXmlNotes(xml);
    expect(m.notes.map((n) => n.midi)).toEqual([64]);
  });

  it("parses only the first part of a multi-part score", () => {
    const xml = `<score-partwise version="4.0"><part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
</measure></part><part id="P2"><measure number="1"><attributes><divisions>4</divisions></attributes>
<note><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration></note>
</measure></part></score-partwise>`;
    const m = parseMusicXmlNotes(xml);
    expect(m.notes).toHaveLength(1);
    expect(m.notes[0]!.midi).toBe(60);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @keyspilli/midi -- test/parseXml.test.ts`

Expected: FAIL. The chord test gets `"65@1.5"`/`"57@1.75"` (cursor advanced by chord members and backup ignored); the invalid-note test includes `60` and `62`; the multi-part test returns 2 notes.

- [ ] **Step 3: Implement the fix in parseXml.ts**

Replace the measure-loop section of `parseMusicXmlNotes` (from `const measures = xml.match(...)` through the end of the `for (const el of noteEls)` loop):

```ts
  // Parse only the first part; multi-instrument exports are out of scope.
  // ponytail: per-part divisions/attributes unsupported; add when uploads need it.
  const partBody = xml.match(/<part\b[^>]*>([\s\S]*?)<\/part>/)?.[1] ?? xml;
  const measures = partBody.match(/<measure(?:[ >])[^>]*>[\s\S]*?<\/measure>/g) ?? [];
  const beatsPerMeasure = beats * (4 / beatType);
  for (let mi = 0; mi < measures.length; mi++) {
    const m = measures[mi]!;
    const measureStart = mi * beatsPerMeasure;
    let cursor = 0;
    let lastStart = 0;
    const els = m.match(/<(note|backup|forward)\b[^>]*>[\s\S]*?<\/(?:note|backup|forward)>/g) ?? [];
    for (const el of els) {
      if (el.startsWith("<backup") || el.startsWith("<forward")) {
        const d = parseInt(firstMatch(el, /<duration>(\d+)<\/duration>/), 10) || 0;
        cursor = el.startsWith("<backup")
          ? Math.max(0, cursor - d / divisions)
          : cursor + d / divisions;
        continue;
      }
      const chord = /<chord\s*\/>/.test(el);
      const step = firstMatch(el, /<step>([A-G])<\/step>/);
      if (!step) continue;
      const alter = parseInt(firstMatch(el, /<alter>(-?\d+)<\/alter>/), 10) || 0;
      const octave = parseInt(firstMatch(el, /<octave>(\d+)<\/octave>/), 10);
      const dur = parseInt(firstMatch(el, /<duration>(\d+)<\/duration>/), 10) || 0;
      const staffRaw = firstMatch(el, /<staff>(\d+)<\/staff>/);
      const voiceRaw = firstMatch(el, /<voice>(\d+)<\/voice>/);
      const pc = STEP_PC[step]! + alter;
      const midi = 12 * (octave + 1) + pc;
      const durBeats = dur / divisions;
      if (!Number.isFinite(midi) || midi < 0 || midi > 127 || !Number.isFinite(durBeats) || durBeats <= 0) continue;
      const start = chord ? lastStart : (lastStart = cursor);
      if (!chord) cursor += durBeats;
      const lyric = firstMatch(el, /<lyric\b[^>]*>[\s\S]*?<text>([\s\S]*?)<\/text>/);
      notes.push({
        midi,
        start: measureStart + start,
        dur: durBeats,
        vel: 80,
        hand: staffRaw === "2" ? "L" : staffRaw === "1" ? "R" : voiceRaw === "2" ? "L" : "R",
        lyrics: lyric ? lyric.replace(/&amp;/g, "&").replace(/&lt;/g, "<") : undefined,
      });
    }
  }
```

Keep the rest of the function (sort, `durationBeats`, return) unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @keyspilli/midi -- test/parseXml.test.ts`

Expected: PASS (all parseXml tests, including the existing roundtrip and chord-only tests).

- [ ] **Step 5: Commit**

```bash
git add packages/midi/src/parseXml.ts packages/midi/test/parseXml.test.ts
git commit -m "fix(midi): keep chords on one beat and honor backup/forward in MusicXML"
```

---

### Task 5: MIDI parser hardening (validation, running status, flat keys, drums, tempo)

**Files:**
- Modify: `packages/midi/src/parse.ts` (`parseMidi`)
- Modify: `packages/midi/test/midi.test.ts` (parseMidi describe block)

**Interfaces:**
- Consumes: nothing (standalone).
- Produces: unchanged `parseMidi(buf): ParsedMidi`. Stricter errors (`"not a MIDI file (missing MThd)"`, `"unsupported MIDI header length"`, `"invalid track count"`, `"bad track header"`, `"truncated track"`), `keySig` now sign-extended, running status only updated by channel messages, tempo meta with `us = 0` ignored, channel 10 note events skipped, invalid parsed notes filtered.

- [ ] **Step 1: Write the failing tests**

Add to the `describe("parseMidi", ...)` block in `packages/midi/test/midi.test.ts`:

```ts
  it("sign-extends flat key signatures", () => {
    const buf = HEX(`
      4d 54 68 64 00 00 00 06 00 00 00 01 01 e0
      4d 54 72 6b 00 00 00 08
      00 ff 59 02 ff 01
      00 ff 2f 00
    `);
    const m = parseMidi(buf);
    expect(m.keySig).toBe(-1);
    expect(m.keyMode).toBe(1);
  });

  it("keeps running status across meta events", () => {
    const buf = HEX(`
      4d 54 68 64 00 00 00 06 00 00 00 01 01 e0
      4d 54 72 6b 00 00 00 18
      00 90 3c 64
      00 ff 51 03 07 a1 20
      00 3e 64
      83 60 80 3c 40
      83 60 80 3e 40
      00 ff 2f 00
    `);
    const m = parseMidi(buf);
    expect(m.notes.map((n) => [n.midi, n.start, n.dur])).toEqual([
      [60, 0, 1],
      [62, 0, 1],
    ]);
  });

  it("skips drum channel (10) note events", () => {
    const buf = HEX(`
      4d 54 68 64 00 00 00 06 00 00 00 01 01 e0
      4d 54 72 6b 00 00 00 13
      00 99 24 60
      83 60 89 24 40
      00 90 3c 64
      83 60 80 3c 40
      00 ff 2f 00
    `);
    const m = parseMidi(buf);
    expect(m.notes.map((n) => n.midi)).toEqual([60]);
  });

  it("rejects truncated tracks and invalid headers with clear errors", () => {
    expect(() => parseMidi(new Uint8Array(4))).toThrow(/MThd/);
    const truncated = HEX(`
      4d 54 68 64 00 00 00 06 00 00 00 01 01 e0
      4d 54 72 6b 00 00 00 30
      00 90 3c 64
    `);
    expect(() => parseMidi(truncated)).toThrow(/truncated track/);
    expect(() => parseMidi(HEX(`4d 54 68 64 00 00 00 08 00 00 00 01 01 e0`))).toThrow(/header/);
  });

  it("ignores zero-duration tempo meta events", () => {
    const buf = HEX(`
      4d 54 68 64 00 00 00 06 00 00 00 01 01 e0
      4d 54 72 6b 00 00 00 09
      00 ff 51 03 00 00 00
      00 ff 2f 00
    `);
    const m = parseMidi(buf);
    expect(m.tempoBpm).toBe(120);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @keyspilli/midi -- test/midi.test.ts`

Expected: FAIL. `keySig` is `255` not `-1`; the running-status test gets only `[60, ...]` (D4 dropped); the drum test includes `36`; the truncated-track test does not throw; the tempo test gets `Infinity`.

- [ ] **Step 3: Implement the fix in parse.ts**

Replace the `parseMidi` function with:

```ts
export function parseMidi(buf: Uint8Array): ParsedMidi {
  if (buf.length < 14 || readStr(buf, { v: 0 }, 4) !== "MThd") throw new Error("not a MIDI file (missing MThd)");
  const headerLen = (buf[4]! << 24) | (buf[5]! << 16) | (buf[6]! << 8) | buf[7]!;
  if (headerLen !== 6) throw new Error("unsupported MIDI header length");
  const format = (buf[8]! << 8) | buf[9]!;
  const ntrks = (buf[10]! << 8) | buf[11]!;
  const division = (buf[12]! << 8) | buf[13]!;
  if (division & 0x8000) throw new Error("SMPTE timing not supported");
  if (ntrks === 0 || ntrks > 512) throw new Error("invalid track count");
  let pos = 8 + headerLen;

  const trackNotes: Note[][] = [];
  const trackNames: string[] = [];
  const tempos: { beat: number; bpm: number }[] = [];
  let timeSig: [number, number] = [4, 4];
  let keySig = 0;
  let keyMode: 0 | 1 = 0;
  let title: string | undefined;

  for (let t = 0; t < ntrks; t++) {
    if (pos + 8 > buf.length || readStr(buf, { v: pos }, 4) !== "MTrk") throw new Error("bad track header");
    pos += 4;
    const len = (buf[pos]! << 24) | (buf[pos + 1]! << 16) | (buf[pos + 2]! << 8) | buf[pos + 3]!;
    pos += 4;
    if (len < 0 || pos + len > buf.length) throw new Error("truncated track");
    const end = pos + len;
    let tick = 0;
    let running: number | null = null;
    const on: Map<number, { start: number; vel: number }> = new Map();
    const notes: Note[] = [];

    while (pos < end) {
      const deltaPos = { v: pos };
      tick += readVarint(buf, deltaPos);
      pos = deltaPos.v;
      let status = buf[pos++]!;
      if (status < 0x80) {
        if (running === null) throw new Error(`running status without previous status at pos=${pos} byte=${buf[pos]?.toString(16)}`);
        status = running;
        pos--;
      } else if (status < 0xf0) {
        // only channel messages update running status; meta/sysex must not
        running = status;
      }
      const kind = status & 0xf0;
      const chan = status & 0x0f;
      if (kind === 0xf0) {
        if (status === 0xff) {
          const type = buf[pos++]!;
          const lenPos = { v: pos };
          const len2 = readVarint(buf, lenPos);
          pos = lenPos.v;
          if (type === 0x51 && len2 === 3) {
            const us = (buf[pos]! << 16) | (buf[pos + 1]! << 8) | buf[pos + 2]!;
            if (us > 0) tempos.push({ beat: tick / division, bpm: 60_000_000 / us });
          } else if (type === 0x58 && len2 === 4) {
            timeSig = [buf[pos]!, 1 << buf[pos + 1]!];
          } else if (type === 0x59 && len2 === 2) {
            keySig = (buf[pos]! << 24) >> 24;
            keyMode = buf[pos + 1]! === 0 ? 0 : 1;
          } else if (type === 0x03) {
            trackNames.push(readStr(buf, { v: pos }, len2));
          } else if (type === 0x01 || type === 0x02) {
            const s = readStr(buf, { v: pos }, len2);
            if (!title && s.trim()) title = s.trim();
          }
          pos += len2;
        } else if (status === 0xf0 || status === 0xf7) {
          const lenPos = { v: pos };
          const len2 = readVarint(buf, lenPos);
          pos = lenPos.v;
          pos += len2;
        }
        continue;
      }
      const b = tick / division;
      if (kind === 0x80 || (kind === 0x90 && buf[pos + 1] === 0)) {
        const note = buf[pos]!;
        pos += 2;
        if (chan === 9) continue; // percussion: no piano notes
        const started = on.get(note);
        if (started) {
          on.delete(note);
          notes.push({ midi: note, start: started.start, dur: b - started.start, vel: started.vel });
        }
      } else if (kind === 0x90) {
        const note = buf[pos]!;
        const vel = buf[pos + 1]!;
        pos += 2;
        if (chan !== 9 && vel > 0) on.set(note, { start: b, vel });
      } else if (kind === 0xa0 || kind === 0xb0 || kind === 0xe0) {
        pos += 2;
      } else if (kind === 0xc0 || kind === 0xd0) {
        pos += 1;
      }
    }
    // close hanging notes at track end
    for (const [note, s] of on) {
      notes.push({ midi: note, start: s.start, dur: Math.max(0.01, tick / division - s.start), vel: s.vel });
    }
    trackNotes.push(notes);
    if (t === 0) {
      const n = trackNames[trackNames.length - 1];
      if (n && /piano/i.test(n)) trackNames.splice(trackNames.length - 1, 1, n);
    }
  }

  const valid = trackNotes
    .flat()
    .filter((n) => Number.isFinite(n.midi) && n.midi >= 0 && n.midi <= 127 && Number.isFinite(n.start) && Number.isFinite(n.dur));
  valid.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const tempoBpm = tempos[0]?.bpm ?? 120;
  const durationBeats = valid.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  return {
    format,
    division,
    tempoBpm,
    keySig,
    keyMode,
    timeSig,
    notes: valid,
    trackNames: trackNames.filter((n) => n.trim()),
    durationBeats,
    title,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @keyspilli/midi -- test/midi.test.ts`

Expected: PASS (all parseMidi tests, including the existing scale fixture).

- [ ] **Step 5: Commit**

```bash
git add packages/midi/src/parse.ts packages/midi/test/midi.test.ts
git commit -m "fix(midi): harden SMF parsing (running status, validation, flat keys, drums)"
```

---

### Task 6: MIDI writer cancels stale note-offs on same-pitch re-strikes

**Files:**
- Modify: `packages/midi/src/writeMidi.ts` (`writeMidi` track loop)
- Modify: `packages/midi/test/midi.test.ts` (writeMidi describe block)

**Interfaces:**
- Consumes: `Note[]`, `WriteMidiOptions` (unchanged).
- Produces: unchanged `writeMidi(notes, opts): Uint8Array`. Semantics change: when a pitch re-strikes before the previous instance ends, the previous instance's scheduled note-off is removed (no stale cut-off); notes with `vel < 1` are skipped; the time-signature denominator byte is rounded.

- [ ] **Step 1: Write the failing tests**

Add to the `describe("writeMidi", ...)` block in `packages/midi/test/midi.test.ts`:

```ts
  it("does not cut short a same-pitch re-strike", () => {
    const bytes = writeMidi(
      [
        { midi: 60, start: 0, dur: 4, vel: 80 },
        { midi: 60, start: 2, dur: 4, vel: 80 },
      ],
      { tempoBpm: 120, keySig: 0, keyMode: 0 },
    );
    const m = parseMidi(bytes);
    expect(m.notes.map((n) => [n.start, n.dur])).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it("skips zero-velocity notes", () => {
    const bytes = writeMidi([{ midi: 60, start: 0, dur: 1, vel: 0 }], { tempoBpm: 120 });
    expect(parseMidi(bytes).notes).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @keyspilli/midi -- test/midi.test.ts`

Expected: FAIL. The re-strike test gets `[[0, 2], [2, 2]]` (the stale note-off at beat 4 cuts the second strike short); the zero-velocity test finds 1 note (`vel || 80` fallback).

- [ ] **Step 3: Implement the fix in writeMidi.ts**

Replace the note-writing loop inside `writeMidi` (from `events.push({ tick: 0, bytes: [0xc0, 0] });` through the end of the track loop):

```ts
    events.push({ tick: 0, bytes: [0xc0, 0] }); // program: acoustic grand
    const on: Map<number, { midi: number; vel: number }> = new Map();
    const offEvents = new Map<number, TrackEvent>();
    for (const n of [...track.notes].sort((a, b) => a.start - b.start || a.midi - b.midi)) {
      const t = Math.round(n.start * division);
      const vel = Math.round(n.vel || 0);
      if (vel < 1) continue; // note-on velocity 0 is a note-off in MIDI
      if (on.has(n.midi)) {
        // re-strike: cancel the previous instance's scheduled note-off so it
        // cannot cut the new note short
        const stale = offEvents.get(n.midi);
        if (stale) {
          const i = events.indexOf(stale);
          if (i >= 0) events.splice(i, 1);
        }
        events.push({ tick: t, bytes: [0x80, n.midi, 0] });
        on.delete(n.midi);
      }
      on.set(n.midi, { midi: n.midi, vel });
      events.push({ tick: t, bytes: [0x90, n.midi, Math.max(1, Math.min(127, vel))] });
      const off = Math.round((n.start + n.dur) * division);
      const offEv = { tick: off, bytes: [0x80, n.midi, 0] as number[] };
      offEvents.set(n.midi, offEv);
      events.push(offEv);
    }
```

Also change the time-signature meta byte `Math.log2(den)` to `Math.round(Math.log2(den))` in the first-track meta block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @keyspilli/midi -- test/midi.test.ts`

Expected: PASS (including the existing write→parse roundtrip test).

- [ ] **Step 5: Commit**

```bash
git add packages/midi/src/writeMidi.ts packages/midi/test/midi.test.ts
git commit -m "fix(midi): cancel stale note-offs on same-pitch re-strikes"
```

---

### Task 7: Easy-variant bass roots follow the song key

**Files:**
- Modify: `packages/midi/src/simplify.ts` (`rootOf` and its two call sites)
- Modify: `packages/midi/test/midi.test.ts` (buildVariants describe block; add `ParsedMidi` to the imports from `../src/index.js`)

**Interfaces:**
- Consumes: `buildVariants(src, meta, opts)` (unchanged), `ParsedMidi`.
- Produces: unchanged `buildVariants` signature. Semantics change: the LH roots in the `easy` and `very-easy` variants resolve to the song's tonic pitch class instead of always C.

- [ ] **Step 1: Write the failing test**

Add to the `describe("buildVariants", ...)` block in `packages/midi/test/midi.test.ts`:

```ts
  it("roots easy-variant bass notes to the song key", () => {
    const src: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 1,
      keyMode: 0,
      timeSig: [4, 4],
      notes: [
        { midi: 71, start: 0, dur: 1, vel: 80 },
        { midi: 55, start: 0, dur: 1, vel: 80 },
        { midi: 67, start: 1, dur: 1, vel: 80 },
        { midi: 50, start: 1, dur: 1, vel: 80 },
      ],
      trackNames: ["Test"],
      durationBeats: 4,
    };
    const variants = buildVariants(src, { title: "G", artist: "T", key: "G" });
    for (const level of ["easy", "very-easy"] as const) {
      const v = variants.find((x) => x.level === level)!;
      const bass = v.notes.filter((n) => n.hand === "L");
      expect(bass.length).toBeGreaterThan(0);
      expect(bass.every((n) => n.midi % 12 === 7)).toBe(true);
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @keyspilli/midi -- test/midi.test.ts`

Expected: FAIL. Current `rootOf` returns pitch class 0 (C) for every note, so the G-major bass roots fail the `% 12 === 7` check.

- [ ] **Step 3: Implement the fix in simplify.ts**

Replace `rootOf`:

```ts
const KEY_PC: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

function rootOf(midi: number, key: string): number {
  const pc = KEY_PC[key.replace(/m$/, "")] ?? 0;
  const offset = ((midi - pc) % 12 + 12) % 12;
  return midi - offset;
}
```

Update both call sites to pass `key`:

```ts
  const easy = quantize(
    [...melodyOnly(rh, 0.125, 0.5), ...thinChord(lh, 2).map((n) => ({ ...n, midi: rootOf(n.midi, key) }))],
    { grid: 0.25 },
  );
  const lhRoots = lh
    .map((n) => ({ ...n, midi: rootOf(n.midi, key) }))
    .filter((n, i, a) => a.findIndex((x) => Math.abs(x.start - n.start) < 1e-6) === i);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @keyspilli/midi -- test/midi.test.ts`

Expected: PASS (all buildVariants tests, including the monotonicity test on the scale fixture).

- [ ] **Step 5: Commit**

```bash
git add packages/midi/src/simplify.ts packages/midi/test/midi.test.ts
git commit -m "fix(midi): root easy-variant bass to the song key"
```

---

### Task 8: Engrave applies Verovio options before layout; retryable load; first tests

**Files:**
- Modify: `packages/engrave/src/verovio.ts` (`VerovioToolkit` interface, `loadVerovio`, `renderMusicXml`)
- Modify: `packages/engrave/package.json` (declare `@keyspilli/midi`)
- Create: `packages/engrave/test/verovio.test.ts`

**Interfaces:**
- Consumes: `RenderOptions` (unchanged), the browser Verovio ESM module.
- Produces: `renderMusicXml(xml: string, opts?: RenderOptions, toolkit?: VerovioToolkit): Promise<string>` — the new optional third parameter lets tests inject a fake toolkit; `VerovioToolkit` gains optional `setOptions`.

- [ ] **Step 1: Write the failing tests**

Create `packages/engrave/test/verovio.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderMusicXml } from "../src/index.js";

function fakeToolkit() {
  const calls: string[] = [];
  const tk = {
    loadData: (xml: string) => {
      calls.push("loadData");
      return true;
    },
    renderToSVG: (page?: number) => {
      calls.push("renderToSVG");
      return "<svg/>";
    },
    getPageCount: () => 1,
    setOptions: (o: Record<string, unknown>) => {
      calls.push("setOptions");
    },
  };
  return { tk, calls };
}

describe("renderMusicXml", () => {
  it("applies options before loading data", async () => {
    const { tk, calls } = fakeToolkit();
    await renderMusicXml("<score/>", { scale: 55, pageWidth: 1400 }, tk);
    expect(calls.indexOf("setOptions")).toBeLessThan(calls.indexOf("loadData"));
    expect(calls[calls.length - 1]).toBe("renderToSVG");
  });

  it("throws when loadData fails instead of rendering garbage", async () => {
    const { tk } = fakeToolkit();
    tk.loadData = () => false;
    await expect(renderMusicXml("<score/>", {}, tk)).rejects.toThrow(/loadData/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @keyspilli/engrave -- test/verovio.test.ts`

Expected: FAIL to compile/run — `renderMusicXml` does not accept a third argument, and the option-ordering assertion fails because `loadData` runs before `setOptions`.

- [ ] **Step 3: Implement the fix**

In `packages/engrave/src/verovio.ts`, extend the interface and rework the two functions:

```ts
export interface VerovioToolkit {
  loadData: (xml: string) => boolean;
  renderToSVG: (page?: number) => string;
  getPageCount: () => number;
  setOptions?: (o: Record<string, unknown>) => void;
}

let toolkitPromise: Promise<VerovioToolkit> | null = null;

/** Lazily load the Verovio WASM toolkit (client-side only). */
export async function loadVerovio(): Promise<VerovioToolkit> {
  if (toolkitPromise) return toolkitPromise;
  toolkitPromise = (async () => {
    // Load Verovio from the public/ assets (browser ESM build) so webpack
    // never touches its Node-targeted CJS build or its 7.6 MB wasm bundle.
    const createVerovioModule = (await import(/* webpackIgnore: true */ ("/verovio/verovio-module.mjs" as string))) as unknown as {
      default: () => Promise<unknown>;
    };
    const { VerovioToolkit } = (await import(/* webpackIgnore: true */ ("/verovio/verovio.mjs" as string))) as unknown as {
      VerovioToolkit: new (m: unknown) => VerovioToolkit;
    };
    const VerovioModule = await createVerovioModule.default();
    return new VerovioToolkit(VerovioModule);
  })();
  // A failed load must not brick the sheet view for the whole session.
  toolkitPromise.catch(() => {
    toolkitPromise = null;
  });
  return toolkitPromise;
}

export interface RenderOptions {
  scale?: number;
  pageWidth?: number;
  pageHeight?: number;
  colored?: boolean;
  breaks?: "none" | "auto";
}

/** Render MusicXML to an SVG document string. */
export async function renderMusicXml(xml: string, opts: RenderOptions = {}, toolkit?: VerovioToolkit): Promise<string> {
  const tk = toolkit ?? (await loadVerovio());
  const options = {
    scale: opts.scale ?? 50,
    pageWidth: opts.pageWidth ?? 1200,
    pageHeight: opts.pageHeight ?? 1600,
    breaks: opts.breaks ?? "none",
    border: 0,
    adjustPageHeight: 1,
    font: "Bravura",
  };
  // Verovio lays out at load time; options must be set first.
  tk.setOptions?.(options);
  if (!tk.loadData(xml)) throw new Error("Verovio loadData failed");
  return tk.renderToSVG(1);
}
```

In `packages/engrave/package.json`, add `"@keyspilli/midi": "*"` to `dependencies` (alphabetically before `"verovio"`; `colors.ts` already imports it).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @keyspilli/engrave -- test/verovio.test.ts` then `npm run typecheck -w @keyspilli/engrave`

Expected: PASS both.

- [ ] **Step 5: Full workspace verification and commit**

Run: `npm run typecheck && npm test`

Expected: all workspaces typecheck; all tests pass (midi 18+, player-core 12+, catalog 2, engrave 2).

```bash
git add packages/engrave/src/verovio.ts packages/engrave/package.json packages/engrave/test/verovio.test.ts
git commit -m "fix(engrave): apply Verovio options before layout; retryable load; add tests"
```

---

## Self-Review Notes

- **Spec coverage:** every task maps to a review finding with a verified failing case: T1 → grading false-100%/dead `late`/wait-mode timing; T2 → `typeFromDur` + `<dots>` + `<staves>`; T3 → minor-key signatures (writer + ingest + keyName); T4 → chord cursor + backup/forward + NaN guard; T5 → parser validation/running status/flat keys/drums/tempo; T6 → same-pitch overlap + vel fallback + log2; T7 → key-aware LH roots; T8 → Verovio option ordering + retryable load + engrave tests/dep. Review findings deliberately excluded are listed under Out of Scope.
- **Placeholder scan:** every step contains concrete code; no TBD/TODO.
- **Type consistency:** `keySignature` is defined once (analyze.ts) and re-exported once (index.ts), consumed by writeXml.ts and ingest.ts with the same `{ fifths: number; mode: 0 | 1 }` shape; `renderMusicXml`'s third parameter is optional everywhere; test imports updated per task (`Variant`, `ParsedMidi`, `keySignature`).
- **Rejected alternative:** leaving `ingest.ts` with its own `keySigOf` would keep wrong key signatures on the worker/upload path (duplicated logic) — fixed via the shared `keySignature`.
