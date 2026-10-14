import { splitHands } from "./analyze.js";
import { splitPianoRoles } from "./piano-roles.js";
import { midiBeatToNativeSeconds } from "./parse.js";
import { mergedNoteLineage } from "./quantize.js";
import { sourcePedalEnd, sourcePedalErrors } from "./source-pedal.js";
import { validateVariants } from "./validate.js";
import { LEVEL_ORDER, type DifficultyLevel, type Hand, type Note, type ParsedMidi, type Variant } from "./types.js";

/** Semantic declarations are independent of instrument, track and physical hand. */
export type PhraseRole = "melody" | "hook" | "bass" | "harmony" | "accompaniment" | "unknown";
/** Same provenance vocabulary as the source-review contract; never an approval. */
export type PhraseAuthority = "unknown" | "model-estimate" | "self-authored" | "human-validated";
export type PhraseTransformation = "omit" | "octave-displacement" | "onset-change" | "release-change" | "hand-reassignment" | "velocity-change";
export interface PhraseEvent {
  id: string;
  sourceOriginId: string;
  sourceOccurrence?: 1 | 2;
  role: PhraseRole;
  priority: number;
  expected: { midi: number; startBeat: number; durationBeats: number; hand?: Hand };
  required: boolean;
  allowedTransformations: PhraseTransformation[];
}
export interface SourcePhrase {
  id: string;
  occurrenceId: string;
  startBeat: number;
  endBeat: number;
  evidence: { authority: PhraseAuthority; confidence: number | null; basis: string; validationReceiptSha256?: string };
  events: PhraseEvent[];
  rests: Array<{ id: string; startBeat: number; endBeat: number; scope: "all" | PhraseRole }>;
}
export interface PhrasePlanV1 {
  schemaVersion: 1;
  kind: "keyspilli-phrase-plan";
  levels: DifficultyLevel[];
  source: {
    sha256: string;
    compositionId: string;
    performanceId: string;
    clock: ReturnType<typeof sourcePhraseClock>;
  };
  phrases: SourcePhrase[];
}
export interface PhraseProtectionReport {
  schemaVersion: 1;
  sourceSha256: string;
  status: "preserved" | "not-targeted";
  protectedEvents: number;
  selectionAccuracy: "not-established";
  musicalAcceptance: "not-established";
  inferredHands: number;
  outputClock: { timebase: "variant-quarter-beats"; sourceTempoBpm: number; playbackTempoBpm: number };
  changes: Array<{ eventId: string; phraseId: string; occurrenceId: string; role: PhraseRole;
    operation: "restored-source" | "permitted-transformation"; before: Note[]; after: Note[] }>;
  /** Full immutable source/policy declarations; not a validated source receipt. */
  plan: PhrasePlanV1;
}

export function phraseBackingNotes(notes: readonly Note[], report: PhraseProtectionReport | undefined): Note[] {
  if (!report || report.status !== "preserved") throw new Error("source-backed Chords requires preserved phrase selections");
  const roles = new Map(report.plan.phrases.flatMap(p => p.events.map(e => [
    JSON.stringify([e.sourceOriginId, e.sourceOccurrence ?? null]), e.role,
  ] as const)));
  const backing = notes.filter(note => note.sourceOrigins?.length && note.sourceOrigins.every(origin => {
    const role = roles.get(JSON.stringify([origin.id, origin.occurrence ?? null]))
      ?? roles.get(JSON.stringify([origin.id, null]));
    return role === "bass" || role === "harmony" || role === "accompaniment";
  }));
  if (!backing.length) throw new Error("source-backed Chords has no explicitly selected backing events");
  return backing;
}

export function phrasePianoBacking(notes: readonly Note[], report: PhraseProtectionReport | undefined): {
  notes: Note[]; changes: PhraseProtectionReport["changes"];
} {
  const selected = structuredClone(phraseBackingNotes(notes, report)).sort((a, b) => a.start - b.start || a.midi - b.midi);
  const entries = new Map(report!.plan.phrases.flatMap(phrase => phrase.events.map(event => [
    JSON.stringify([event.sourceOriginId, event.sourceOccurrence ?? null]), { phrase, event },
  ] as const)));
  const changes: PhraseProtectionReport["changes"] = [];
  const retained: Note[] = [];
  let lastBass: { midi: number; start: number } | undefined;
  for (const note of selected) {
    const origins = note.sourceOrigins!.map(origin => entries.get(JSON.stringify([origin.id, origin.occurrence ?? null]))
      ?? entries.get(JSON.stringify([origin.id, null])));
    const declarations = origins.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    if (declarations.length !== origins.length) throw new Error("piano backing has an undeclared source origin");
    const sourceMidi = note.midi, bass = declarations.every(entry => entry.event.role === "bass");
    const permits = (policy: PhraseTransformation) => declarations.every(entry => !entry.event.required
      && entry.event.allowedTransformations.includes(policy));
    const before = structuredClone(note);
    const recordChange = (after: Note[]) => { for (const entry of declarations) changes.push({
      eventId: entry.event.id, phraseId: entry.phrase.id, occurrenceId: entry.phrase.occurrenceId,
      role: "bass", operation: "permitted-transformation", before: [structuredClone(before)], after: structuredClone(after) }); };
    if (bass && sourceMidi < 36 && lastBass?.midi === sourceMidi && note.start - lastBass.start < 1 - 1e-9 && permits("omit")) {
      recordChange([]);
      continue;
    }
    if (bass && sourceMidi < 36 && permits("octave-displacement")) { note.midi += 12; recordChange([note]); }
    if (bass) lastBass = { midi: sourceMidi, start: note.start };
    retained.push(note);
  }
  const ends = new Map<number, number>();
  for (const note of retained) {
    if (note.start < (ends.get(note.midi) ?? -Infinity) - 1e-9) throw new Error(`piano backing overlap on MIDI ${note.midi}`);
    ends.set(note.midi, note.start + note.dur);
  }
  return { notes: retained, changes };
}

const ROLES: readonly string[] = ["melody", "hook", "bass", "harmony", "accompaniment", "unknown"];
const AUTHORITIES: readonly string[] = ["unknown", "model-estimate", "self-authored", "human-validated"];
const TRANSFORMS: readonly string[] = ["omit", "octave-displacement", "onset-change", "release-change", "hand-reassignment", "velocity-change"];
const HASH = /^[a-f0-9]{64}$/;
const EPS = 1e-9;
const fail = (message: string): never => { throw new Error(`phrase plan: ${message}`); };
function check(condition: unknown, message: string): asserts condition { if (!condition) fail(message); }
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const close = (a: number, b: number) => Math.abs(a - b) <= EPS;
const MAX_PLAN_BYTES = 2 * 1024 * 1024;

/** Canonical semantic JSON; callers can SHA-256 this without ordering ambiguity. */
export function canonicalPhrasePlan(value: unknown): string {
  let nodes = 0;
  const encode = (item: unknown, depth: number): string => {
    check(depth <= 32, "semantic JSON nesting exceeds 32");
    check(++nodes <= 1_000_000, "semantic JSON workload exceeds 1000000 values");
    if (Array.isArray(item)) return `[${item.map(child => encode(child, depth + 1)).join(",")}]`;
    if (record(item)) return `{${Object.keys(item).sort().filter(k => item[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${encode(item[k], depth + 1)}`).join(",")}}`;
    check(item === null || typeof item === "string" || typeof item === "boolean" || finite(item), "non-JSON or nonfinite value");
    check(typeof item !== "string" || item.length <= MAX_PLAN_BYTES, "semantic JSON exceeds 2 MiB");
    return JSON.stringify(item);
  };
  const encoded = encode(value, 0);
  check(new TextEncoder().encode(encoded).length <= MAX_PLAN_BYTES, "semantic JSON exceeds 2 MiB");
  return encoded;
}
function freeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    if (visited.has(value)) return value;
    visited.add(value);
    for (const child of Object.values(value)) freeze(child, visited);
    Object.freeze(value);
  }
  return value;
}

/** Source musical beats and native performance clock, before constant-clock reduction. */
export function sourcePhraseClock(source: ParsedMidi) {
  return structuredClone({ timebase: "source-quarter-beats" as const, division: source.division,
    tempoBpm: source.tempoBpm, durationBeats: source.durationBeats, timeSig: source.timeSig,
    tempoEvents: source.tempoEvents ?? [], timeSigEvents: source.timeSigEvents ?? [],
    measures: source.notationMeasures ?? [] });
}
const originMatches = (note: Note, event: PhraseEvent) => note.sourceOrigins?.some(o => o.id === event.sourceOriginId
  && (event.sourceOccurrence === undefined || o.occurrence === event.sourceOccurrence)) ?? false;
const sameMusic = (a: Note, b: Note) => a.midi === b.midi && close(a.start, b.start) && close(a.dur, b.dur)
  && a.hand === b.hand && a.vel === b.vel;
type OriginIndex = Map<string, Note[]>;
function indexOrigins(notes: readonly Note[]): OriginIndex {
  const index = new Map<string, Note[]>();
  for (const note of notes) for (const id of new Set(note.sourceOrigins?.map(o => o.id) ?? [])) {
    const list = index.get(id) ?? []; list.push(note); index.set(id, list);
  }
  return index;
}
function descendants(index: OriginIndex, event: PhraseEvent): Note[] {
  return (index.get(event.sourceOriginId) ?? []).filter(n => originMatches(n, event));
}
type Interval = { start: number; end: number };
function intervalIndex(notes: readonly Note[], pedal: ParsedMidi["sourcePedal"]): Interval[] {
  const spans = notes.map(n => ({ start: n.start, end: pedal ? sourcePedalEnd(n, pedal) : n.start + n.dur }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return mergeIntervals(spans);
}
function mergeIntervals(spans: readonly Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.start <= last.end + EPS) last.end = Math.max(last.end, span.end);
    else merged.push(span);
  }
  return merged;
}
function firstIntersection(spans: readonly Interval[], start: number, end: number): Interval | undefined {
  let lo = 0, hi = spans.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (spans[mid]!.end <= start + EPS) lo = mid + 1; else hi = mid; }
  const span = spans[lo];
  return span && span.start < end - EPS ? span : undefined;
}
function intersects(spans: readonly Interval[], start: number, end: number): boolean {
  let lo = 0, hi = spans.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (spans[mid]!.start < end - EPS) lo = mid + 1; else hi = mid; }
  return lo > 0 && spans[lo - 1]!.end > start + EPS;
}

interface BoundEvent { phrase: SourcePhrase; event: PhraseEvent; source: Note; assignedHand: Hand; inferredHand: boolean }
export interface CompiledPhrasePlan {
  readonly plan: PhrasePlanV1;
  readonly source: ParsedMidi;
  readonly events: readonly BoundEvent[];
}

/** The host must compute sourceSha256 from the actual supplied bytes. */
export function compilePhrasePlan(source: ParsedMidi, value: PhrasePlanV1, sourceSha256: string | undefined): CompiledPhrasePlan {
  check(record(value) && value.schemaVersion === 1 && value.kind === "keyspilli-phrase-plan", "unsupported schema");
  check(record(value.source) && typeof sourceSha256 === "string" && HASH.test(sourceSha256)
    && value.source.sha256 === sourceSha256, "source hash mismatch or missing verified hash");
  check(text(value.source.compositionId) && text(value.source.performanceId), "missing composition/performance identity");
  check(record(value.source.clock) && canonicalPhrasePlan(value.source.clock) === canonicalPhrasePlan(sourcePhraseClock(source)), "source clock mismatch");
  check(Array.isArray(value.levels) && value.levels.length > 0 && value.levels.length <= 6
    && new Set(value.levels).size === value.levels.length && value.levels.every(l => LEVEL_ORDER.includes(l)), "invalid target levels");
  check(Array.isArray(value.phrases) && value.phrases.length > 0 && value.phrases.length <= 200, "invalid phrase inventory");
  // Enforce the serialized boundary and inventory budget before duplicating any
  // caller-owned graph. Shared references must not amplify freeze traversal.
  canonicalPhrasePlan(value);
  check(Array.isArray(source.notes) && source.notes.length > 0 && source.notes.length <= 20000, "source note workload exceeds 20000");
  const sourceOrigins = source.notes.reduce((sum, n) => sum + (n.sourceOrigins?.length ?? 0), 0);
  check(sourceOrigins <= 40000, "source origin workload exceeds 40000");
  check(value.phrases.every(p => Array.isArray(p.events) && Array.isArray(p.rests))
    && value.phrases.reduce((sum, p) => sum + p.events.length + p.rests.length, 0) <= 20000, "event/rest workload exceeds 20000");
  check(source.notes.length * (source.tempoEvents?.length ?? 0) <= 40_000_000, "source tempo mapping workload exceeds 40000000");
  if (source.sourcePedal) check(!sourcePedalErrors(source.notes, source.sourcePedal).length, "unsupported source pedal evidence");
  const plan = structuredClone(value);
  const sourceCopy = structuredClone(source);
  const originIndex = indexOrigins(sourceCopy.notes);
  const split = splitHands(sourceCopy.notes);
  const handByPitch = new Map([...split.rh, ...split.lh].map(n => [n.midi, n.hand!]));
  const events: BoundEvent[] = [];
  const ids = new Set<string>(), phrases = new Set<string>(), origins = new Set<string>();
  const assignedSources = new Set<Note>();
  let count = 0;
  for (const phrase of plan.phrases) {
    check(record(phrase) && text(phrase.id) && text(phrase.occurrenceId), "invalid phrase identity");
    const key = `${phrase.id}\0${phrase.occurrenceId}`;
    check(!phrases.has(key), "duplicate phrase occurrence"); phrases.add(key);
    check(finite(phrase.startBeat) && finite(phrase.endBeat) && phrase.startBeat >= 0
      && phrase.endBeat > phrase.startBeat && phrase.endBeat <= source.durationBeats + EPS, "invalid phrase bounds");
    const evidence = phrase.evidence;
    check(record(evidence) && AUTHORITIES.includes(evidence.authority) && text(evidence.basis)
      && (evidence.confidence === null || finite(evidence.confidence) && evidence.confidence >= 0 && evidence.confidence <= 1), "invalid evidence/confidence");
    check(evidence.validationReceiptSha256 === undefined || HASH.test(evidence.validationReceiptSha256), "invalid receipt pin");
    check(evidence.authority !== "human-validated" || typeof evidence.validationReceiptSha256 === "string", "human authority requires a receipt pin; receipt is not verified here");
    check(Array.isArray(phrase.events) && Array.isArray(phrase.rests), "invalid event/rest inventory");
    count += phrase.events.length + phrase.rests.length;
    check(count <= 20000, "event/rest workload exceeds 20000");
    for (const event of phrase.events) {
      check(record(event) && text(event.id) && !ids.has(event.id) && text(event.sourceOriginId), "invalid or duplicate event id"); ids.add(event.id);
      check(ROLES.includes(event.role) && finite(event.priority) && event.priority >= 0 && event.priority <= 100
        && typeof event.required === "boolean", "invalid role/priority/protection");
      check(event.sourceOccurrence === undefined || event.sourceOccurrence === 1 || event.sourceOccurrence === 2, "invalid source occurrence");
      const originKey = `${event.sourceOriginId}\0${event.sourceOccurrence ?? "any"}`;
      check(!origins.has(originKey), "source origin assigned more than once"); origins.add(originKey);
      check(Array.isArray(event.allowedTransformations) && event.allowedTransformations.every(t => TRANSFORMS.includes(t))
        && new Set(event.allowedTransformations).size === event.allowedTransformations.length, "unsupported transformation policy");
      check(!event.required || event.allowedTransformations.length === 0, "required events use exact preservation in this pilot");
      const expected = event.expected;
      check(record(expected) && Number.isInteger(expected.midi) && expected.midi >= 0 && expected.midi <= 127
        && finite(expected.startBeat) && finite(expected.durationBeats) && expected.durationBeats > 0
        && expected.startBeat >= phrase.startBeat - EPS && expected.startBeat + expected.durationBeats <= phrase.endBeat + EPS
        && (expected.hand === undefined || expected.hand === "L" || expected.hand === "R"), "invalid expected event/bounds");
      const candidates = descendants(originIndex, event);
      check(candidates.length === 1, `missing/ambiguous origin ${event.sourceOriginId}`);
      const note = candidates[0]!;
      check(!assignedSources.has(note), "resolved source event assigned more than once"); assignedSources.add(note);
      check(note.midi === expected.midi && close(note.start, expected.startBeat) && close(note.dur, expected.durationBeats)
        && (expected.hand === undefined || note.hand === expected.hand), `changed source event ${event.id}`);
      check(!event.required || note.midi >= 21 && note.midi <= 108, `protected event ${event.id} is outside piano range`);
      const hand = note.hand ?? handByPitch.get(note.midi);
      check(hand === "L" || hand === "R", `source hand could not be assigned for ${event.id}`);
      events.push({ phrase, event, source: note, assignedHand: hand, inferredHand: note.hand === undefined });
    }
    for (const rest of phrase.rests) {
      check(record(rest) && text(rest.id) && !ids.has(rest.id), "invalid/duplicate rest id"); ids.add(rest.id);
      check(finite(rest.startBeat) && finite(rest.endBeat) && rest.startBeat >= phrase.startBeat - EPS
        && rest.endBeat > rest.startBeat && rest.endBeat <= phrase.endBeat + EPS && (rest.scope === "all" || ROLES.includes(rest.scope)), "invalid rest scope/bounds");
    }
  }
  check(events.some(e => e.event.required), "at least one explicitly selected required event is necessary; role proposals alone are not protection");
  // Roles belong to source identities across the entire plan; phrase order and
  // overlapping phrase boundaries do not hide a known sounding event.
  const roleSpans = new Map<string, Interval[]>([["all", intervalIndex(sourceCopy.notes, sourceCopy.sourcePedal)]]);
  for (const role of ROLES) roleSpans.set(role, intervalIndex(events.filter(e => e.event.role === role).map(e => e.source), sourceCopy.sourcePedal));
  for (const phrase of plan.phrases) for (const rest of phrase.rests) {
    check(!intersects(roleSpans.get(rest.scope)!, rest.startBeat, rest.endBeat), `rest ${rest.id} contradicts source evidence`);
  }
  return freeze({ plan, source: sourceCopy, events });
}

/** Uncertain inspection packet only. A caller must select actual protections before use. */
export function suggestPhrasePlan(source: ParsedMidi, identity: Pick<PhrasePlanV1["source"], "sha256" | "compositionId" | "performanceId">): PhrasePlanV1 {
  check(HASH.test(identity.sha256) && text(identity.compositionId) && text(identity.performanceId), "invalid source identity");
  check(source.notes.length > 0 && source.notes.length <= 20000 && source.durationBeats > 0, "invalid source inventory");
  const proposal = splitPianoRoles(source.notes);
  return { schemaVersion: 1, kind: "keyspilli-phrase-plan", levels: ["advanced"],
    source: { ...identity, clock: sourcePhraseClock(source) },
    phrases: [{ id: "full-source", occurrenceId: "performance-1", startBeat: 0, endBeat: source.durationBeats,
      evidence: { authority: "unknown", confidence: null, basis: "Existing piano-role selector proposal; uncalibrated and not source validation." },
      rests: [], events: source.notes.map((note, index) => {
        const origin = note.sourceOrigins?.[0];
        check(origin && text(origin.id), "source inspection requires parsed source origins");
        return { id: `event-${index}`, sourceOriginId: origin.id,
          ...(origin.occurrence === undefined ? {} : { sourceOccurrence: origin.occurrence }),
          role: proposal.melodyMask[index] ? "melody" : "unknown", priority: proposal.melodyMask[index] ? 75 : 25,
          expected: { midi: note.midi, startBeat: note.start, durationBeats: note.dur, ...(note.hand ? { hand: note.hand } : {}) },
          required: false, allowedTransformations: [...TRANSFORMS] as PhraseTransformation[] };
      }) }] };
}

function permitted(source: Note, candidates: Note[], policy: readonly PhraseTransformation[]): boolean {
  if (!candidates.length) return policy.includes("omit");
  // A split/repeated descendant is not one source attack. This pilot refuses it.
  if (candidates.length !== 1) return false;
  const actual = candidates[0]!;
  return (actual.midi === source.midi || policy.includes("octave-displacement") && (actual.midi - source.midi) % 12 === 0)
    && (close(actual.start, source.start) || policy.includes("onset-change"))
    && (close(actual.start + actual.dur, source.start + source.dur) || policy.includes("release-change"))
    && (actual.hand === source.hand || policy.includes("hand-reassignment"))
    && (actual.vel === source.vel || policy.includes("velocity-change"));
}

function exactLineage(a: Note, b: Note): Pick<Note, "identitySource" | "sourceOrigins"> {
  const sourceOrigins = [...new Map([...(a.sourceOrigins ?? []), ...(b.sourceOrigins ?? [])]
    .map(o => [JSON.stringify([o.id, o.occurrence ?? null]), o])).values()]
    .sort((x, y) => x.id.localeCompare(y.id) || (x.occurrence ?? 0) - (y.occurrence ?? 0));
  check(sourceOrigins.length <= 256, "physical unison source workload exceeds 256");
  return { ...mergedNoteLineage(a, b), sourceOrigins };
}

/** Applies only exact source-supported restoration; no new pitch or source repair. */
export function applyPhrasePlan(variants: Variant[], compiled: CompiledPhrasePlan,
  options: { sourceTempoBpm?: number; maxDurBeats?: number | null } = {}): Variant[] {
  const { plan, source, events } = compiled;
  const required = events.filter(e => e.event.required);
  const sourceTempoBpm = options.sourceTempoBpm ?? source.tempoBpm;
  check(finite(sourceTempoBpm) && sourceTempoBpm >= 20 && sourceTempoBpm <= 300, "invalid constant source clock tempo");
  // Playback tempo overrides alter speed, not the established source beat
  // coordinates of ordinary notes and measure maps. Map every source only once.
  const beat = (value: number) => midiBeatToNativeSeconds(source, value) * sourceTempoBpm / 60;
  const split = splitHands(source.notes);
  const handByPitch = new Map([...split.rh, ...split.lh].map(n => [n.midi, n.hand!]));
  const mappedNotes = new Map(source.notes.map(n => [n, { ...structuredClone(n), start: beat(n.start),
    dur: beat(n.start + n.dur) - beat(n.start), hand: n.hand ?? handByPitch.get(n.midi)! }]));
  const sourceIndex = indexOrigins(source.notes);
  const eventBySource = new Map(events.map(e => [e.source, e]));
  const optionalPolicy = (note: Note, policy: PhraseTransformation) => !!note.sourceOrigins?.length
    && note.sourceOrigins.every(origin => {
      const peers = descendants(sourceIndex, { sourceOriginId: origin.id, sourceOccurrence: origin.occurrence } as PhraseEvent);
      const entry = peers.length === 1 ? eventBySource.get(peers[0]!) : undefined;
      return !!entry && !entry.event.required && entry.event.allowedTransformations.includes(policy);
    });
  const rests = new Map(["all", ...ROLES].map(role => [role, mergeIntervals(plan.phrases.flatMap(p => p.rests
    .filter(r => r.scope === role).map(r => ({ start: beat(r.startBeat), end: beat(r.endBeat) })))
    .sort((a, b) => a.start - b.start || a.end - b.end))]));
  const result = variants.map(variant => {
    const report: PhraseProtectionReport = { schemaVersion: 1, sourceSha256: plan.source.sha256,
      status: plan.levels.includes(variant.level) ? "preserved" : "not-targeted", protectedEvents: 0,
      selectionAccuracy: "not-established", musicalAcceptance: "not-established", inferredHands: 0,
      outputClock: { timebase: "variant-quarter-beats", sourceTempoBpm, playbackTempoBpm: variant.tempoBpm },
      changes: [], plan: structuredClone(plan) };
    if (report.status === "not-targeted") return { ...variant, phraseProtection: report };
    check(variant.notes.length <= 20000 && variant.notes.every(n => (n.sourceOrigins?.length ?? 0) <= 256), "variant lineage workload exceeded");
    const initialIndex = indexOrigins(variant.notes);
    const beforeByEvent = new Map(required.map(e => [e, descendants(initialIndex, e.event)]));
    const removed = new Set([...beforeByEvent.values()].flat());
    let notes = variant.notes.filter(n => !removed.has(n)).map(n => structuredClone(n));
    const unisonKey = (n: Note) => `${n.midi}:${n.start.toFixed(8)}:${n.dur.toFixed(8)}`;
    const unisons = new Map<string, Note[]>();
    const addUnison = (n: Note) => { const key = unisonKey(n), bucket = unisons.get(key) ?? []; bucket.push(n); unisons.set(key, bucket); };
    notes.forEach(addUnison);
    for (const entry of required) {
      const desired = structuredClone(mappedNotes.get(entry.source)!);
      const before = beforeByEvent.get(entry)!;
      // Removing a merged descendant must not erase unrelated source evidence.
      // Compatible original unisons share the restored event. Distinct required
      // attacks are restored separately; mixed unlisted collisions are refused.
      for (const previous of before) for (const origin of previous.sourceOrigins ?? []) {
        const peers = descendants(sourceIndex, { sourceOriginId: origin.id, sourceOccurrence: origin.occurrence } as PhraseEvent);
        check(peers.length === 1, `${variant.level}: ambiguous merged source lineage ${origin.id}`);
        const peer = peers[0]!;
        if (peer === entry.source || eventBySource.get(peer)?.event.required) continue;
        const peerNote = mappedNotes.get(peer)!;
        const compatible = sameMusic(peerNote, desired) && peerNote.sourceMidiChannel === desired.sourceMidiChannel;
        const peerEntry = eventBySource.get(peer);
        if (!compatible && peerEntry && !peerEntry.event.required && peerEntry.event.allowedTransformations.includes("omit")) {
          continue;
        }
        check(compatible,
          `${variant.level}: incompatible unlisted merged source lineage ${origin.id}`);
        Object.assign(desired, exactLineage(desired, peerNote));
      }
      const unison = unisons.get(unisonKey(desired))?.find(n => close(n.start, desired.start) && close(n.dur, desired.dur));
      if (unison) {
        check(unison.hand === desired.hand && unison.vel === desired.vel && unison.sourceMidiChannel === desired.sourceMidiChannel,
          `${variant.level}: conflicting physical unison ${entry.event.id}`);
        Object.assign(unison, exactLineage(unison, desired));
      } else { notes.push(desired); addUnison(desired); }
      report.protectedEvents++;
      if (entry.inferredHand) report.inferredHands++;
      if (before.length !== 1 || !sameMusic(before[0]!, desired)) report.changes.push({ eventId: entry.event.id,
        phraseId: entry.phrase.id, occurrenceId: entry.phrase.occurrenceId, role: entry.event.role,
        operation: "restored-source", before: structuredClone(before), after: [structuredClone(desired)] });
    }
    for (let i = notes.length - 1; i >= 0; i--) {
      const note = notes[i]!;
      const entries = (note.sourceOrigins ?? []).flatMap(origin => descendants(sourceIndex, {
        sourceOriginId: origin.id, sourceOccurrence: origin.occurrence,
      } as PhraseEvent).map(peer => eventBySource.get(peer)));
      if (!entries.length || entries.length !== note.sourceOrigins?.length || entries.some(e => !e || e.event.required)) continue;
      const optional = entries.filter((e): e is BoundEvent => e !== undefined);
      const scopes = new Set(["all", ...optional.map(e => e.event.role)]);
      const rest = [...scopes].flatMap(scope => {
        const span = firstIntersection(rests.get(scope)!, note.start, note.start + note.dur);
        return span ? [span] : [];
      }).sort((a, b) => a.start - b.start)[0];
      if (!rest) continue;
      if (note.start < rest.start - EPS && optional.every(e => e.event.allowedTransformations.includes("release-change"))) {
        note.dur = rest.start - note.start;
      } else if (optional.every(e => e.event.allowedTransformations.includes("omit"))) notes.splice(i, 1);
    }
    notes.sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur || (a.hand ?? "").localeCompare(b.hand ?? ""));
    const heldKeys = new Map<number, Note>();
    const omitted = new Set<Note>();
    for (const note of notes) {
      const previous = heldKeys.get(note.midi);
      if (previous && previous.start + previous.dur > note.start + EPS) {
        if (previous.start < note.start - EPS && optionalPolicy(previous, "release-change")) {
          previous.dur = note.start - previous.start;
        } else if (optionalPolicy(note, "omit")) { omitted.add(note); continue; }
        else if (optionalPolicy(previous, "omit")) omitted.add(previous);
        else fail(`${variant.level}: protected restoration creates overlapping MIDI ${note.midi}`);
      }
      heldKeys.set(note.midi, note);
    }
    notes = notes.filter(note => !omitted.has(note));
    const finalIndex = indexOrigins(notes);
    const roleNotes = new Map(ROLES.map(role => [role, new Set<Note>()]));
    for (const entry of events) {
      const actual = descendants(finalIndex, entry.event);
      const expected = mappedNotes.get(entry.source)!;
      check(entry.event.required ? actual.length === 1 && sameMusic(actual[0]!, expected)
        : permitted(expected, actual, entry.event.allowedTransformations), `${variant.level}: unpermitted transformation of ${entry.event.id}`);
      if (!entry.event.required && (actual.length !== 1 || !sameMusic(actual[0]!, expected))) report.changes.push({
        eventId: entry.event.id, phraseId: entry.phrase.id, occurrenceId: entry.phrase.occurrenceId,
        role: entry.event.role, operation: "permitted-transformation", before: [expected], after: structuredClone(actual) });
      for (const n of actual) roleNotes.get(entry.event.role)!.add(n);
    }
    // A physical key cannot support overlapping independently struck holds.
    const lastByPitch = new Map<number, Note>();
    for (const n of notes) {
      const previous = lastByPitch.get(n.midi);
      check(!previous || previous.start + previous.dur <= n.start + EPS,
        `${variant.level}: protected restoration creates overlapping MIDI ${n.midi}`);
      lastByPitch.set(n.midi, n);
    }
    if (variant.sourcePedal) {
      const pedalErrors = sourcePedalErrors(notes, variant.sourcePedal);
      check(!pedalErrors.length, `${variant.level}: restored keys conflict with retained source pedal: ${pedalErrors.join("; ")}`);
    }
    const roleSpans = new Map<string, Interval[]>([["all", intervalIndex(notes, variant.sourcePedal)]]);
    for (const role of ROLES) roleSpans.set(role, intervalIndex([...roleNotes.get(role)!], variant.sourcePedal));
    for (const phrase of plan.phrases) for (const rest of phrase.rests) {
      check(!intersects(roleSpans.get(rest.scope)!, beat(rest.startBeat), beat(rest.endBeat)), `${variant.level}: protected rest ${rest.id} violated`);
    }
    return { ...variant, notes, phraseProtection: report,
      warnings: [...(variant.warnings ?? []), "Explicit phrase plan preserved selected source events; role accuracy, keyboard suitability and musical acceptance remain unestablished."] };
  });
  // Keep the established mechanical gates. Sparse test/API material has no
  // catalog completeness claim, so the ordinary minimum-note gate stays at intake.
  const errors = validateVariants(result, { maxDurBeats: options.maxDurBeats }).filter(e => !/only \d+ notes/.test(e));
  check(errors.length === 0, `protected events conflict with existing variant limits: ${errors.join("; ")}`);
  return result;
}
