/** @typedef {{midi:number,start:number,dur:number,vel:number,hand?:string,identitySource?:string}} Note */

const onset = (start) => Number(start.toFixed(3));

export function groupOnsets(notes) {
  const groups = new Map();
  for (const note of [...notes].sort((a, b) => onset(a.start) - onset(b.start) || a.midi - b.midi)) {
    const key = onset(note.start);
    groups.set(key, [...(groups.get(key) ?? []), note]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, group]) => group);
}

export function selectAnchors(notes, windowBeats) {
  const byWindow = new Map();
  for (const note of notes.filter((n) => n.hand === "L").sort((a, b) => a.start - b.start || a.midi - b.midi)) {
    const window = Math.floor((note.start + 1e-9) / windowBeats);
    byWindow.set(window, [...(byWindow.get(window) ?? []), note]);
  }
  return [...byWindow.entries()].sort((a, b) => a[0] - b[0]).map(([window, list]) => {
    const starts = [...new Set(list.map((n) => onset(n.start)))].sort((a, b) => a - b);
    const pick = (start) => list.filter((n) => onset(n.start) === start).sort((a, b) => a.midi - b.midi || b.vel - a.vel)[0];
    return { window, first: pick(starts[0]), alternatives: starts.map(pick) };
  });
}

export function structuralClass(note, trusted, allowDirectPianoEvidence = false) {
  if (!trusted || note.hand !== "L") return "UNKNOWN_UNSAFE";
  if (note.identitySource === "guitar") return "STRUCTURAL_LH";
  if (allowDirectPianoEvidence && note.identitySource === undefined) return "EXISTING_VERY_EASY_LH_EVIDENCE";
  return "UNKNOWN_UNSAFE";
}

const starts = (notes) => [...new Set(notes.map((n) => onset(n.start)))].sort((a, b) => a - b);
const duration = (notes) => Math.max(0, ...notes.map((n) => n.start + n.dur));
const maxSpan = (notes, hand) => Math.max(0, ...starts(notes).map((start) => {
  const active = notes.filter((n) => (hand === "L" ? n.hand === "L" : n.hand !== "L") && n.start <= start + 1e-9 && n.start + n.dur > start + 1e-9);
  return active.length ? Math.max(...active.map((n) => n.midi)) - Math.min(...active.map((n) => n.midi)) : 0;
}));

export function evaluateBeginnerGates(notes, tempo, validationErrors = []) {
  const starts3 = starts(notes);
  const seconds = Math.max(1e-9, duration(notes) * 60 / tempo);
  const gaps = starts3.slice(1).map((start, i) => (start - starts3[i]) * 60 / tempo).sort((a, b) => a - b);
  const medianIoi = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const grid = notes.every((n) => Number.isFinite(n.start) && Math.abs(n.start - Math.round(n.start / 0.25) * 0.25) <= 0.001);
  const sounding = Math.max(0, ...starts3.map((start) => notes.filter((n) => n.start <= start + 1e-9 && n.start + n.dur > start + 1e-9).length));
  const density = starts3.length / seconds;
  const checks = {
    validator: { pass: validationErrors.every((e) => !e.startsWith("beginner:")), errors: validationErrors.filter((e) => e.startsWith("beginner:")) },
    grid: { pass: grid }, density: { pass: density <= 6 && gaps.every((gap) => gap >= 0.25 * 60 / tempo) }, medianIoi: { pass: medianIoi === null || medianIoi >= 0.08 },
    duration: { pass: notes.every((n) => Number.isFinite(n.dur) && n.dur > 0) },
    span: { pass: maxSpan(notes, "L") <= 12 && maxSpan(notes, "R") <= 12 },
    voice: { pass: Math.max(0, ...starts3.map((start) => notes.filter((n) => n.start === start && n.hand === "L").length)) <= 2 },
    maxSimultaneity: { pass: sounding <= 2 },
  };
  return { ...checks, checks, allPass: Object.values(checks).every((check) => check.pass) };
}

export function fixtureHashGate(expected, actual) { return { expected, actual, matches: expected !== null && expected === actual }; }

export function resolveOutputPath(argv = process.argv) {
  const inline = argv.find((arg) => arg.startsWith("--out="));
  const index = argv.indexOf("--out");
  const value = inline?.slice(6) ?? (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : undefined);
  return value || "/private/tmp/keyspilli-lower-tier-eval-20260902-a1/lower-tier-evaluator.json";
}
