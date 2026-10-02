import {validArticulationResult,type ArticulationResult} from "./articulation.js";
import { validKeyboardRange, type KeyboardRange } from "./keyboard-range.js";
import { preferenceStorage } from "./prefs.js";
import type { GradeResult, GradeDiagnostics } from "./grading.js";
import type { PlayerSettings, PracticeAnnotation } from "./types.js";

export const PRACTICE_STATE_KEY = "keyspilli.practice.v1";
export const PRACTICE_STATE_EVENT = "keyspilli-practice-state";
export const PRACTICE_STATE_MAX_BYTES = 1_048_576;
export interface PracticeTarget { baseId: string; variantId: string; fingerprint: string }
export interface PassageTempoPlan { policyId: string; startBpm: number; stepBpm: number; currentBpm: number; completedAtTempo: number; thresholdPct: number; paused: boolean; status: "active" | "complete" }
export interface SavedPassage extends PracticeAnnotation {
  id: string; name: string; target: PracticeTarget; startBeat: number; endBeat: number; createdAt: string;
  tempoPlan?: PassageTempoPlan;
}
export interface PracticeAttempt {
  id: string; target: PracticeTarget; startBeat: number; endBeat: number; startedAt: string; finishedAt: string | null;
  outcome: "completed" | "incomplete" | "cancelled" | "interrupted"; countInCompleted: boolean;
  context: Pick<PlayerSettings, "mode" | "speed" | "transpose" | "hand" | "soundSource" | "backgroundMode" | "accompanimentStyle">
    & { difficulty: string; input: "keyboard" | "midi" | "microphone"; wait: boolean; bpm: number; timingCalibrationMs?: number | null; midiDevice?: string | null; midiChannel?: number | null; effectiveTimbre?: "synth" | "sampled" | "fallback" | "organ"; assessment?: "onset"|"key-hold"; articulationToleranceMs?:number; audibleSupport?: boolean; renderedExpression?: "source"|"meter-accents"; physicalKeyboard?: KeyboardRange | null; rangeAcknowledged?: boolean; assistance?:{mode:"guided"|"reduced-pitch";passageId:string;reveals:number;review:"owner-confirmed-trial"}; tempoPlan?: { passageId: string; policyId: string } };
  result: Pick<GradeResult, "total" | "hit" | "missed" | "wrong" | "late" | "accuracyPct"> & { diagnostics?: GradeDiagnostics; articulation?:ArticulationResult } | null;
}
export interface PracticeResume { target: PracticeTarget; positionBeat: number; passageId?: string; updatedAt: string }
export interface PracticeState { version: 1; passages: SavedPassage[]; attempts: PracticeAttempt[]; resume: PracticeResume | null }
const empty = (): PracticeState => ({ version: 1, passages: [], attempts: [], resume: null });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const id = (v: unknown): v is string => text(v, 128) && /^[A-Za-z0-9_-]+$/.test(v);
const finite = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const date = (v: unknown): v is string => text(v, 64) && Number.isFinite(Date.parse(v));
const keys = (v: Record<string, unknown>, allowed: string) => Object.keys(v).every(key => allowed.split(" ").includes(key));
const target = (v: unknown): v is PracticeTarget => object(v) && keys(v, "baseId variantId fingerprint")
  && id(v.baseId) && id(v.variantId) && text(v.fingerprint, 71) && /^sha256:[a-f0-9]{64}$/.test(v.fingerprint);
const range = (v: Record<string, unknown>) => finite(v.startBeat, 0, 1e7) && finite(v.endBeat, 0, 1e7) && v.endBeat > v.startBeat;
const member = (v: unknown, choices: string) => typeof v === "string" && choices.split(" ").includes(v);

function passage(v: unknown): v is SavedPassage {
  return object(v) && keys(v, "id name target startBeat endBeat createdAt sectionId targetTempo repeatTarget note tempoPlan")
    && id(v.id) && text(v.name, 80) && !!v.name.trim() && target(v.target) && range(v) && date(v.createdAt)
    && text(v.sectionId, 128) && (v.note === undefined || text(v.note, 500))
    && (v.targetTempo === undefined || finite(v.targetTempo, 20, 400))
    && (v.repeatTarget === undefined || finite(v.repeatTarget, 1, 100) && Number.isInteger(v.repeatTarget))
    && (v.tempoPlan === undefined || object(v.tempoPlan) && keys(v.tempoPlan, "policyId startBpm stepBpm currentBpm completedAtTempo thresholdPct paused status")
      && id(v.tempoPlan.policyId) && finite(v.targetTempo,20,400) && finite(v.repeatTarget,1,100)
      && finite(v.tempoPlan.startBpm,20,v.targetTempo) && finite(v.tempoPlan.currentBpm,v.tempoPlan.startBpm,v.targetTempo)
      && finite(v.tempoPlan.stepBpm,1,50) && finite(v.tempoPlan.completedAtTempo,0,v.repeatTarget) && Number.isInteger(v.tempoPlan.completedAtTempo)
      && finite(v.tempoPlan.thresholdPct,50,100) && typeof v.tempoPlan.paused === "boolean" && member(v.tempoPlan.status,"active complete")
      && (v.tempoPlan.status !== "complete" || v.tempoPlan.currentBpm === v.targetTempo && v.tempoPlan.completedAtTempo === v.repeatTarget));
}
function diagnostics(v: unknown): v is GradeDiagnostics {
  return object(v) && keys(v, "events omitted") && finite(v.omitted, 0, 1e6) && Number.isInteger(v.omitted)
    && Array.isArray(v.events) && v.events.length <= 12 && v.events.every(event => object(event)
      && keys(event, "targetIndex expectedPitch startSec hand playedPitch playedSec errorSec outcome rawSec offsetMs")
      && (event.targetIndex === null || finite(event.targetIndex, 0, 1e6) && Number.isInteger(event.targetIndex))
      && (event.expectedPitch === null || finite(event.expectedPitch, 0, 127) && Number.isInteger(event.expectedPitch))
      && (event.playedPitch === null || finite(event.playedPitch, 0, 127) && Number.isInteger(event.playedPitch))
      && (event.startSec === null || finite(event.startSec, 0, 1e7))
      && (event.playedSec === null || finite(event.playedSec, -1e7, 1e7))
      && (event.errorSec === null || finite(event.errorSec, -1e7, 1e7))
      && (event.rawSec === undefined || event.rawSec === null || finite(event.rawSec, -1e7, 1e7))
      && (event.offsetMs === undefined || finite(event.offsetMs, -250, 250))
      && (event.hand === null || member(event.hand, "R L")) && member(event.outcome, "hit late missed wrong unmatched"));
}
/** Retain at most twelve problem events per stored attempt; aggregate scores are complete. */
export function savedGradeDiagnostics(value: GradeDiagnostics | undefined): GradeDiagnostics | undefined {
  if (!value) return undefined;
  const events = value.events.filter(event => event.outcome !== "hit").slice(0, 12);
  return { events, omitted: value.omitted + value.events.length - events.length };
}
function result(v: unknown): v is PracticeAttempt["result"] {
  if (v === null) return true;
  return object(v) && keys(v, "total hit missed wrong late accuracyPct diagnostics articulation")
    && ["total", "hit", "missed", "wrong", "late"].every(key => finite(v[key], 0, 1e6) && Number.isInteger(v[key]))
    && finite(v.accuracyPct, 0, 100)
    && (v.articulation === undefined || validArticulationResult(v.articulation))
    && (v.diagnostics === undefined || diagnostics(v.diagnostics))
    && v.total === (v.hit as number) + (v.missed as number) + (v.wrong as number) + (v.late as number);
}
function attempt(v: unknown): v is PracticeAttempt {
  if (!object(v) || !keys(v, "id target startBeat endBeat startedAt finishedAt outcome countInCompleted context result")
      || !id(v.id) || !target(v.target) || !range(v) || !date(v.startedAt) || !(v.finishedAt === null || date(v.finishedAt))
      || !member(v.outcome, "completed incomplete cancelled interrupted") || typeof v.countInCompleted !== "boolean"
      || !result(v.result) || v.outcome === "completed" && (!v.countInCompleted || v.result === null || v.finishedAt === null)) return false;
  const c = v.context;
  return object(c) && keys(c, "mode speed transpose hand soundSource backgroundMode accompanimentStyle difficulty input wait bpm timingCalibrationMs midiDevice midiChannel effectiveTimbre tempoPlan physicalKeyboard rangeAcknowledged audibleSupport renderedExpression assessment articulationToleranceMs assistance")
    && member(c.mode, "falling beginner sheet leadsheet") && finite(c.speed, 0.25, 4)
    && finite(c.transpose, -24, 24) && Number.isInteger(c.transpose) && member(c.hand, "L R both")
    && member(c.soundSource, "synth sampled organ") && member(c.backgroundMode, "piano chord")
    && member(c.accompanimentStyle, "bass-chords melody-accompaniment") && text(c.difficulty, 64)
    && member(c.input, "keyboard midi microphone") && typeof c.wait === "boolean" && finite(c.bpm, 20, 400)
    && (c.timingCalibrationMs === undefined || c.timingCalibrationMs === null || finite(c.timingCalibrationMs, -250, 250))
    && (c.midiDevice === undefined || c.midiDevice === null || text(c.midiDevice, 256))
    && (c.midiChannel === undefined || c.midiChannel === null || finite(c.midiChannel, 0, 15) && Number.isInteger(c.midiChannel))
    && (c.effectiveTimbre === undefined || member(c.effectiveTimbre, "synth sampled fallback organ"))
    && (c.assessment === undefined || member(c.assessment,"onset key-hold"))
    && (c.articulationToleranceMs === undefined || c.assessment === "key-hold" && finite(c.articulationToleranceMs,50,400))
    && (c.assessment !== "key-hold" || c.input === "midi" && c.wait === false && c.midiDevice !== null && c.midiDevice !== undefined && c.midiChannel !== null && c.midiChannel !== undefined && c.articulationToleranceMs !== undefined)
    && (v.result?.articulation === undefined || c.assessment === "key-hold" && v.result.articulation.total === v.result.total && v.result.articulation.toleranceMs === c.articulationToleranceMs)
    && (c.assessment !== "key-hold" || v.result === null || v.result.articulation !== undefined)
    && (c.renderedExpression === undefined || member(c.renderedExpression,"source meter-accents"))
    && (c.audibleSupport === undefined || typeof c.audibleSupport === "boolean")
    && (c.physicalKeyboard === undefined || validKeyboardRange(c.physicalKeyboard))
    && (c.rangeAcknowledged === undefined || typeof c.rangeAcknowledged === "boolean")
    && (c.assistance===undefined || object(c.assistance) && keys(c.assistance,"mode passageId reveals review") && member(c.assistance.mode,"guided reduced-pitch") && id(c.assistance.passageId) && finite(c.assistance.reveals,0,1000) && Number.isInteger(c.assistance.reveals) && c.assistance.review==="owner-confirmed-trial" && c.mode==="beginner" && c.backgroundMode==="piano")
    && (c.tempoPlan === undefined || object(c.tempoPlan) && keys(c.tempoPlan,"passageId policyId") && id(c.tempoPlan.passageId) && id(c.tempoPlan.policyId));
}
function resume(v: unknown): v is PracticeResume | null {
  return v === null || object(v) && keys(v, "target positionBeat passageId updatedAt") && target(v.target)
    && finite(v.positionBeat, 0, 1e7) && date(v.updatedAt) && (v.passageId === undefined || id(v.passageId));
}
export function validPracticeState(v: unknown): v is PracticeState {
  return object(v) && keys(v, "version passages attempts resume") && v.version === 1
    && Array.isArray(v.passages) && v.passages.length <= 100 && v.passages.every(passage)
    && new Set(v.passages.map(p => p.id)).size === v.passages.length
    && Array.isArray(v.attempts) && v.attempts.length <= 200 && v.attempts.every(attempt)
    && new Set(v.attempts.map(a => a.id)).size === v.attempts.length && resume(v.resume);
}
export function loadPracticeState(): PracticeState {
  try {
    const raw = preferenceStorage()?.getItem(PRACTICE_STATE_KEY);
    if (!raw || raw.length > PRACTICE_STATE_MAX_BYTES || new TextEncoder().encode(raw).length > PRACTICE_STATE_MAX_BYTES) return empty();
    const value: unknown = JSON.parse(raw);
    return validPracticeState(value) ? value : empty();
  } catch { return empty(); }
}
export function savePracticeState(value: PracticeState): boolean {
  try {
    if (!validPracticeState(value)) return false;
    const raw = JSON.stringify(value), storage = preferenceStorage();
    if (!storage || new TextEncoder().encode(raw).length > PRACTICE_STATE_MAX_BYTES) return false;
    storage.setItem(PRACTICE_STATE_KEY, raw);
    if (typeof window !== "undefined") window.dispatchEvent(new Event(PRACTICE_STATE_EVENT));
    return true;
  } catch { return false; }
}
export function recordAttempt(value: PracticeAttempt): boolean {
  const state = loadPracticeState();
  // ponytail: retries are deduplicated within the latest 200 runs; retain per-plan receipts if older run IDs can be replayed.
  const alreadyCompleted = state.attempts.some(item => item.id === value.id && item.outcome === "completed");
  const passage = state.passages.find(item => item.id === value.context.tempoPlan?.passageId), plan = passage?.tempoPlan;
  if (!alreadyCompleted && passage && plan && plan.policyId === value.context.tempoPlan?.policyId && !plan.paused && plan.status === "active"
      && !value.context.assistance && value.outcome === "completed" && value.countInCompleted && !value.context.wait && value.context.assessment !== "key-hold" && value.context.input !== "microphone"
      && value.result && value.result.accuracyPct >= plan.thresholdPct && value.target.baseId === passage.target.baseId
      && value.target.variantId === passage.target.variantId && value.target.fingerprint === passage.target.fingerprint
      && Math.abs(value.startBeat-passage.startBeat) < 1e-6 && Math.abs(value.endBeat-passage.endBeat) < 1e-6
      && Math.abs(value.context.bpm*value.context.speed-plan.currentBpm) < 1e-6) {
    plan.completedAtTempo++;
    if (plan.completedAtTempo >= passage.repeatTarget!) {
      if (plan.currentBpm >= passage.targetTempo!) plan.status = "complete";
      else { plan.currentBpm = Math.min(passage.targetTempo!,plan.currentBpm+plan.stepBpm); plan.completedAtTempo = 0; }
    }
  }
  state.attempts = [value, ...state.attempts.filter(item => item.id !== value.id)].slice(0, 200);
  return savePracticeState(state);
}
export function passageAvailable(passage: SavedPassage, current: PracticeTarget, endBeat: number): boolean {
  return passage.target.variantId === current.variantId && passage.target.baseId === current.baseId
    && passage.target.fingerprint === current.fingerprint && passage.startBeat >= 0 && passage.endBeat <= endBeat && passage.endBeat > passage.startBeat;
}
/** Hash the complete source/target descriptor, including middle-note changes. */
export async function practiceFingerprint(descriptor: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(descriptor)));
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
