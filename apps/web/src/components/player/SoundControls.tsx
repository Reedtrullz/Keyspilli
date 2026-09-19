"use client";

import React, { useEffect, useRef } from "react";
import type { MelodyAccompanimentResolution, MelodySelection, PlayerSettings, SourceBackingMode } from "@keyspilli/player-core";
import type { ChordSourceId, ChordSourceOption } from "./chord-sources";
import { usePresence } from "./player-motion";

export type MelodyAuditionRole = "full" | "original" | "melody" | "accompaniment";
export type MelodyPhraseOverrideAction = "automatic" | "right-hand" | "left-hand" | "rest";
export type MelodyPreviewStatus = {
  role: MelodyAuditionRole;
  phase: "playing" | "complete" | "stopped";
  rangeLabel: string;
  startSec: number;
  endSec: number;
};

function previewLabel(role: MelodyAuditionRole, backgroundMode: PlayerSettings["backgroundMode"]): string {
  if (role === "original") return "Original";
  if (role === "full") return backgroundMode === "chord" ? "Chord arrangement" : "Original arrangement";
  return role === "melody" ? "Melody" : "Accompaniment";
}

export function SoundControls({
  settings,
  onChange,
  chordSource = "auto",
  chordSources,
  chordSourceStatus = null,
  onChordSourceChange,
  melodyArrangement,
  activeMelodyPhrase,
  phraseSourceCandidates,
  phraseOverrideAction = "automatic",
  phraseOverrideConflict = false,
  sourceBackingMode = "default",
  rightHandAvailable = false,
  hasSavedMelodySelection = false,
  onMelodySelectionChange,
  onMelodyPhraseOverrideChange,
  onSourceBackingModeChange,
  onMelodySelectionReset,
  onPreview,
  previewStatus,
  onPreviewStop,
}: {
  settings: PlayerSettings;
  onChange: (p: Partial<PlayerSettings>) => void;
  chordSource?: ChordSourceId;
  chordSources?: { ug: ChordSourceOption | null; generated: ChordSourceOption; auto: ChordSourceOption };
  chordSourceStatus?: string | null;
  onChordSourceChange?: (source: ChordSourceId) => void;
  melodyArrangement?: Pick<MelodyAccompanimentResolution, "provenance" | "events"> | null;
  activeMelodyPhrase?: MelodyAccompanimentResolution["phrases"][number] | null;
  phraseSourceCandidates?: { rightHand: readonly string[]; leftHand: readonly string[] };
  phraseOverrideAction?: MelodyPhraseOverrideAction | null;
  phraseOverrideConflict?: boolean;
  sourceBackingMode?: SourceBackingMode;
  rightHandAvailable?: boolean;
  hasSavedMelodySelection?: boolean;
  onMelodySelectionChange?: (selection: MelodySelection) => void;
  onMelodyPhraseOverrideChange?: (action: MelodyPhraseOverrideAction) => void;
  onSourceBackingModeChange?: (mode: SourceBackingMode) => void;
  onMelodySelectionReset?: () => void;
  onPreview?: (role?: MelodyAuditionRole) => void;
  previewStatus?: MelodyPreviewStatus | null;
  onPreviewStop?: () => void;
}) {

  const chordSourcePanelRef = useRef<HTMLDivElement>(null);
  const chordSourcePresent = settings.backgroundMode === "chord" && Boolean(chordSources && onChordSourceChange);
  const chordSourcePresence = usePresence(chordSourcePresent);

  useEffect(() => {
    const panel = chordSourcePanelRef.current;
    if (!panel) return;
    if (!chordSourcePresent) panel.setAttribute("inert", "");
    else panel.removeAttribute("inert");
  }, [chordSourcePresent, chordSourcePresence.mounted]);

  return (
    <>
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-2">Background sound</h3>
          <div className="flex gap-2" role="radiogroup" aria-label="Background sound">
            {(["piano", "chord"] as const).map((b) => (
              <button
                key={b}
                onClick={() => onChange({ backgroundMode: b })}
                role="radio"
                aria-checked={settings.backgroundMode === b}
                className={`flex-1 px-3 py-2 rounded-xl text-sm border ${settings.backgroundMode === b ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
              >
                {b === "piano" ? "Original arrangement" : "Chord mode"}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            {settings.backgroundMode === "piano"
              ? "Original arrangement is retained"
              : settings.accompanimentStyle === "bass-chords"
                ? "Backing only: generated bass and chords play where the chart is supported; source melody is omitted and unsupported spans are silent."
                : "A selected melody is retained while sparse harmonic support is generated"}
          </p>
          {settings.backgroundMode === "chord" && (
            <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
              <span className="text-xs font-medium text-zinc-700">Accompaniment style</span>
              <div className="grid grid-cols-2 gap-2 mt-2" role="radiogroup" aria-label="Accompaniment style">
                {(["melody-accompaniment", "bass-chords"] as const).map((style) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => onChange({ accompanimentStyle: style })}
                    role="radio"
                    aria-checked={settings.accompanimentStyle === style}
                    className={`px-2 py-2 rounded-lg text-xs border ${settings.accompanimentStyle === style ? "bg-zinc-700 text-white border-zinc-700" : "border-zinc-300 bg-white"}`}
                  >
                    {style === "bass-chords" ? "Bass + chords" : "Melody + accompaniment"}
                  </button>
                ))}
              </div>
          <p className="text-[11px] text-zinc-600 mt-2">
            {settings.accompanimentStyle === "bass-chords"
              ? "Backing only for accompanying singing or another musician: source melody is omitted; unsupported chart spans are silent and marked unavailable."
              : "Keeps the selected melody and adds sparse support. Original passage is retained where the chart is unavailable."}
          </p>
          <details data-testid="advanced-arrangement-controls" className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-zinc-700">Advanced arrangement controls</summary>
            <div className="mt-3">
            {settings.accompanimentStyle === "melody-accompaniment" && melodyArrangement && onMelodySelectionChange && (
                <div className="mt-3 border-t border-zinc-200 pt-3" data-testid="melody-accompaniment-controls">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-zinc-700">Melody selection</span>
                    <span className="text-[11px] text-zinc-500" data-testid="melody-accompaniment-coverage">
                      {melodyArrangement.provenance.selectionProvenance === "user-confirmed" ? "User-selected" : "Inferred"}
                      {" · "}{melodyArrangement.provenance.sourceSupportNoteCount > 0
                        ? `${melodyArrangement.provenance.sourceSupportNoteCount} source support notes`
                        : "No source support"}
                      {melodyArrangement.provenance.generatedNoteCount > 0
                        && ` · ${melodyArrangement.provenance.generatedNoteCount} sparse backing notes`}
                      {melodyArrangement.provenance.fallbackBeats > 0 && ` · ${melodyArrangement.provenance.fallbackBeats.toFixed(1)} retained`}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2" role="radiogroup" aria-label="Melody selection">
                    <button
                      type="button"
                      onClick={() => onMelodySelectionChange("automatic")}
                      role="radio"
                      aria-checked={melodyArrangement.provenance.selection === "automatic"}
                      className={`px-2 py-2 rounded-lg text-xs border ${melodyArrangement.provenance.selection === "automatic" ? "bg-indigo-700 text-white border-indigo-700" : "border-zinc-300 bg-white"}`}
                    >
                      Automatic melody
                    </button>
                    <button
                      type="button"
                      onClick={() => onMelodySelectionChange("right-hand")}
                      disabled={!rightHandAvailable}
                      role="radio"
                      aria-checked={melodyArrangement.provenance.selection === "right-hand"}
                      className={`px-2 py-2 rounded-lg text-xs border ${melodyArrangement.provenance.selection === "right-hand" ? "bg-indigo-700 text-white border-indigo-700" : "border-zinc-300 bg-white"} disabled:opacity-50 disabled:cursor-not-allowed`}
                      title={rightHandAvailable ? "Retains the source right-hand part; it may include chords." : "This source has no right-hand part label."}
                    >
                      Use right-hand part
                    </button>
                  </div>
                  {onSourceBackingModeChange && (
                    <div className="mt-3 border-t border-zinc-200 pt-3" data-testid="source-backing-controls">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-zinc-700">Source backing</span>
                        <span className="text-[11px] text-zinc-500">
                          {sourceBackingMode === "conservative" ? "Source-only preview" : "Current source path"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2" role="radiogroup" aria-label="Source backing">
                        <button
                          type="button"
                          onClick={() => onSourceBackingModeChange("default")}
                          role="radio"
                          aria-checked={sourceBackingMode === "default"}
                          className={`px-2 py-2 rounded-lg text-xs border ${sourceBackingMode === "default" ? "bg-zinc-700 text-white border-zinc-700" : "border-zinc-300 bg-white"}`}
                        >
                          Current source backing
                        </button>
                        <button
                          type="button"
                          onClick={() => onSourceBackingModeChange("conservative")}
                          role="radio"
                          aria-checked={sourceBackingMode === "conservative"}
                          className={`px-2 py-2 rounded-lg text-xs border ${sourceBackingMode === "conservative" ? "bg-amber-700 text-white border-amber-700" : "border-zinc-300 bg-white"}`}
                        >
                          Conservative source-only preview (whole song)
                        </button>
                      </div>
                      <p className="text-[11px] text-zinc-600 mt-2">
                        Whole-song preview only: removes narrowly repeated short source voicing members, keeps unresolved spans source-only, and never adds inferred pitches. It does not repair the attack grid or prove physical playability; review before practice.
                      </p>
                      <p className="text-[11px] text-amber-700 mt-1" role="note" data-testid="source-backing-temporal-limit">
                        Temporal backing reduction is unavailable without reviewed source lane or phrase identity; this preview stays source-timed.
                      </p>
                    </div>
                  )}
                  {melodyArrangement.provenance.unresolvedSpans.length > 0 && (
                    <p className="text-[11px] text-amber-700 mt-2" role="status" data-testid="melody-accompaniment-ambiguity">
                      {melodyArrangement.provenance.unresolvedSpans.some((span) => span.reason === "right-hand part unavailable")
                        ? "No right-hand part is available; the automatic melody is retained."
                        : `Ambiguous phrase at ${melodyArrangement.provenance.unresolvedSpans.map((span) => `${span.startBeat.toFixed(1)}–${span.endBeat.toFixed(1)} beats`).join(", ")}. Use right-hand part to correct it.`}
                    </p>
                  )}
                  {activeMelodyPhrase && onMelodyPhraseOverrideChange && phraseSourceCandidates && (
                    <div className="mt-3 border-t border-zinc-200 pt-3" data-testid="melody-phrase-actions">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-zinc-700">Current phrase correction</span>
                        <span className="text-[11px] text-zinc-500">{activeMelodyPhrase.review === "needs-review" ? "Needs review" : "Phrase-local"}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2" role="radiogroup" aria-label="Current phrase melody choice">
                        <button
                          type="button"
                          onClick={() => onMelodyPhraseOverrideChange("automatic")}
                          role="radio"
                          aria-checked={phraseOverrideAction === "automatic"}
                          aria-disabled="false"
                          className={`px-2 py-2 rounded-lg text-xs border ${phraseOverrideAction === "automatic" ? "bg-indigo-700 text-white border-indigo-700" : "border-zinc-300 bg-white"}`}
                        >
                          Use whole-part selection
                        </button>
                        <button
                          type="button"
                          onClick={() => onMelodyPhraseOverrideChange("right-hand")}
                          disabled={!phraseSourceCandidates.rightHand.length}
                          role="radio"
                          aria-checked={phraseOverrideAction === "right-hand"}
                          aria-disabled={phraseSourceCandidates.rightHand.length > 0 ? "false" : "true"}
                          className={`px-2 py-2 rounded-lg text-xs border ${phraseOverrideAction === "right-hand" ? "bg-indigo-700 text-white border-indigo-700" : "border-zinc-300 bg-white"} disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={phraseSourceCandidates.rightHand.length ? "Uses source right-hand notes in this phrase; they may contain chords." : "No source right-hand notes in this phrase."}
                        >
                          Source right-hand candidate
                        </button>
                        <button
                          type="button"
                          onClick={() => onMelodyPhraseOverrideChange("left-hand")}
                          disabled={!phraseSourceCandidates.leftHand.length}
                          role="radio"
                          aria-checked={phraseOverrideAction === "left-hand"}
                          aria-disabled={phraseSourceCandidates.leftHand.length > 0 ? "false" : "true"}
                          className={`px-2 py-2 rounded-lg text-xs border ${phraseOverrideAction === "left-hand" ? "bg-indigo-700 text-white border-indigo-700" : "border-zinc-300 bg-white"} disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={phraseSourceCandidates.leftHand.length ? "Uses source left-hand notes in this phrase; they may contain chords." : "No source left-hand notes in this phrase."}
                        >
                          Source left-hand candidate
                        </button>
                        <button
                          type="button"
                          onClick={() => onMelodyPhraseOverrideChange("rest")}
                          role="radio"
                          aria-checked={phraseOverrideAction === "rest"}
                          aria-disabled="false"
                          className={`px-2 py-2 rounded-lg text-xs border ${phraseOverrideAction === "rest" ? "bg-indigo-700 text-white border-indigo-700" : "border-zinc-300 bg-white"}`}
                        >
                          Explicit rest
                        </button>
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-2">
                        Source hands may contain chords; these are user-selected choices, not proof of melody.
                      </p>
                      {activeMelodyPhrase.review === "needs-review" && (
                        <p className="text-[11px] text-amber-700 mt-1" role="status" data-testid="melody-phrase-review-reason">
                          {phraseOverrideConflict
                            ? "Needs review: a saved override overlaps this interval. Choose an option to replace only this interval; unrelated overrides stay intact."
                            : "Needs review: stale or invalid phrase data is not applied to the melody."}
                        </p>
                      )}
                    </div>
                  )}
                  {hasSavedMelodySelection && onMelodySelectionReset && (
                    <button type="button" onClick={onMelodySelectionReset} className="mt-2 min-h-9 px-2 rounded-lg border border-zinc-300 text-[11px]">
                      Reset all saved choices
                    </button>
                  )}
                  {onPreview && (
                    <div className="mt-3 border-t border-zinc-200 pt-3" data-testid="melody-audition-controls">
                      <span className="text-xs font-medium text-zinc-700">Audition</span>
                      <div className="grid grid-cols-3 gap-2 mt-2" role="group" aria-label="Arrangement audition">
                        <button type="button" onClick={() => onPreview("full")} className="px-2 py-2 rounded-lg text-xs border border-zinc-300 bg-white">Full</button>
                        <button type="button" onClick={() => onPreview("melody")} className="px-2 py-2 rounded-lg text-xs border border-zinc-300 bg-white">Melody</button>
                        <button type="button" onClick={() => onPreview("accompaniment")} className="px-2 py-2 rounded-lg text-xs border border-zinc-300 bg-white">Accompaniment</button>
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-2">
                        Accompaniment includes retained source notes when the producer could not classify them; it is not an isolated stem.
                      </p>
                    </div>
                  )}
                </div>
                  )}
            {settings.accompanimentStyle === "bass-chords" && onPreview && (
              <div className="mt-3 border-t border-zinc-200 pt-3" data-testid="backing-audition-controls">
                <span className="text-xs font-medium text-zinc-700">Backing audition</span>
                <div className="grid grid-cols-2 gap-2 mt-2" role="group" aria-label="Backing audition">
                  <button type="button" onClick={() => onPreview("full")} className="px-2 py-2 rounded-lg text-xs border border-zinc-300 bg-white">Full</button>
                  <button type="button" onClick={() => onPreview("accompaniment")} className="px-2 py-2 rounded-lg text-xs border border-zinc-300 bg-white">Accompaniment</button>
                </div>
                <p className="text-[11px] text-zinc-500 mt-2">
                  Uses the resolved backing bass and chords; uncovered spans are silent.
                </p>
              </div>
            )}
            {chordSourcePresence.mounted && chordSources && onChordSourceChange && (
            <div
              ref={chordSourcePanelRef}
              className="motion-presence mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3"
              data-state={chordSourcePresent ? "open" : "closed"}
              aria-hidden={!chordSourcePresent}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-medium text-zinc-700">Chord source</span>
                <span className="text-[11px] text-zinc-500">Labels always; explicit chart events may add support</span>
              </div>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Chord source">
                <button
                  type="button"
                  onClick={() => onChordSourceChange("auto")}
                  role="radio"
                  aria-checked={chordSource === "auto"}
                  className={`px-2 py-2 rounded-lg text-xs border ${chordSource === "auto" ? "bg-zinc-700 text-white border-zinc-700" : "border-zinc-300 bg-white"}`}
                  title={chordSources.auto.fallbackReason ?? "Use authored UG coverage with generated continuation"}
                >
                  Auto
                </button>
                <button
                  type="button"
                  onClick={() => onChordSourceChange("ug")}
                  disabled={!chordSources.ug?.chords.length}
                  role="radio"
                  aria-checked={chordSource === "ug"}
                  className={`px-2 py-2 rounded-lg text-xs border ${chordSource === "ug" ? "bg-blue-700 text-white border-blue-700" : "border-zinc-300 bg-white"} disabled:opacity-50 disabled:cursor-not-allowed`}
                  title={chordSources.ug?.provenance ?? "No UG chord timeline for this arrangement"}
                >
                  UG timeline
                </button>
                <button
                  type="button"
                  onClick={() => onChordSourceChange("generated")}
                  disabled={!chordSources.generated.chords.length}
                  role="radio"
                  aria-checked={chordSource === "generated"}
                  className={`px-2 py-2 rounded-lg text-xs border ${chordSource === "generated" ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300 bg-white"} disabled:opacity-50 disabled:cursor-not-allowed`}
                  title="Chord labels inferred from the piano arrangement"
                >
                  Generated
                </button>
              </div>
              <p className={`text-[11px] mt-2 ${chordSourceStatus ? "text-amber-700" : "text-zinc-500"}`} role={chordSourceStatus ? "status" : undefined}>
                {chordSourceStatus ?? (
                  chordSource === "auto" && chordSources.ug?.chords.length
                    ? "Use the authored UG opening and generated continuation where the chart is uncovered."
                    : chordSource === "ug"
                      ? "Using the authored UG chord timeline."
                      : "Using generated chord timeline."
                )}
              </p>
            </div>
            )}
            </div>
          </details>
        </div>
          )}
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-medium">Sound</h3>
            {onPreview && (
              <div className="flex items-center gap-2">
                {settings.backgroundMode === "chord" && (
                  <button type="button" onClick={() => onPreview("original")} className="min-h-11 px-3 rounded-lg border border-zinc-300 text-sm">Compare Original</button>
                )}
                <button type="button" onClick={() => onPreview()} className="min-h-11 px-3 rounded-lg border border-zinc-300 text-sm">{settings.backgroundMode === "chord" ? "Preview arrangement" : "Preview sound"}</button>
              </div>
            )}
          </div>
          {previewStatus && onPreview && (
            <div
              className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-950"
              data-testid="arrangement-preview-status"
              data-preview-start-sec={previewStatus.startSec}
              data-preview-end-sec={previewStatus.endSec}
            >
              <span role="status" aria-live="polite">
                {previewStatus.phase === "playing"
                  ? `Playing ${previewLabel(previewStatus.role, settings.backgroundMode)} · ${previewStatus.rangeLabel}`
                  : previewStatus.phase === "complete"
                    ? `Last preview: ${previewLabel(previewStatus.role, settings.backgroundMode)} · ${previewStatus.rangeLabel}`
                    : `Preview stopped: ${previewLabel(previewStatus.role, settings.backgroundMode)} · ${previewStatus.rangeLabel}`}
              </span>
              {previewStatus.phase === "playing"
                ? onPreviewStop && <button type="button" onClick={onPreviewStop} className="min-h-9 shrink-0 rounded-lg border border-indigo-300 bg-white px-2">Stop preview</button>
                : <button type="button" onClick={() => onPreview(previewStatus.role)} className="min-h-9 shrink-0 rounded-lg border border-indigo-300 bg-white px-2">Repeat preview</button>}
            </div>
          )}
          <div className="flex gap-2" role="radiogroup" aria-label="Sound">
            {(["synth", "sampled", "organ"] as const).map((s) => (
              <button
                key={s}
                onClick={() => onChange({ soundSource: s })}
                role="radio"
                aria-checked={settings.soundSource === s}
                className={`flex-1 px-3 py-2 rounded-xl text-sm border ${settings.soundSource === s ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
              >
                {s === "sampled" ? "Grand Piano" : s === "organ" ? "Organ" : "Synth Piano"}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            {settings.soundSource === "sampled"
              ? "Realistic multi-layer piano samples (loads on first play)"
              : settings.soundSource === "organ"
                ? settings.organStyle === "rock"
                  ? "Native tonewheel organ with rotary speaker"
                  : "Native pipe organ with large cathedral acoustics"
                : "Lightweight oscillator tone; works instantly on slow connections"}
          </p>
        </div>

        {settings.soundSource === "organ" && (
          <div className="mb-4 rounded-xl border border-zinc-200 p-3">
            <h3 className="text-sm font-medium mb-2">Organ Style</h3>
            <div className="flex gap-2 mb-3" role="radiogroup" aria-label="Organ Style">
              {(["rock", "cathedral"] as const).map((style) => (
                <button
                  key={style}
                  onClick={() => onChange({ organStyle: style })}
                  role="radio"
                  aria-checked={settings.organStyle === style}
                  className={`flex-1 px-3 py-2 rounded-xl text-sm border ${settings.organStyle === style ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
                >
                  {style === "rock" ? "Rock" : "Cathedral"}
                </button>
              ))}
            </div>
            {settings.organStyle === "rock" ? (
              <>
                <h3 className="text-sm font-medium mb-2">Rotary</h3>
                <div className="flex gap-2 mb-3" role="radiogroup" aria-label="Rotary">
                  {(["slow", "fast"] as const).map((speed) => (
                    <button
                      key={speed}
                      onClick={() => onChange({ organRotary: speed })}
                      role="radio"
                      aria-checked={settings.organRotary === speed}
                      className={`flex-1 px-3 py-2 rounded-xl text-sm border ${settings.organRotary === speed ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
                    >
                      {speed === "slow" ? "Slow" : "Fast"}
                    </button>
                  ))}
                </div>
                <label className="flex justify-between text-sm mb-1" htmlFor="organ-drive">
                  <span>Drive</span>
                  <span className="font-mono text-xs">{Math.round(settings.organDrive * 100)}%</span>
                </label>
                <input
                  id="organ-drive"
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(settings.organDrive * 100)}
                  onChange={(e) => onChange({ organDrive: Number(e.target.value) / 100 })}
                  className="w-full"
                  aria-label="Organ drive"
                />
              </>
            ) : (
              <>
                <label className="flex justify-between text-sm mb-1" htmlFor="organ-space">
                  <span>Space</span>
                  <span className="font-mono text-xs">{Math.round(settings.organSpace * 100)}%</span>
                </label>
                <input
                  id="organ-space"
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(settings.organSpace * 100)}
                  onChange={(e) => onChange({ organSpace: Number(e.target.value) / 100 })}
                  className="w-full"
                  aria-label="Organ space"
                />
              </>
            )}
          </div>
        )}

        <div className="mb-2">
          <label className="flex justify-between text-sm mb-1">
            <span>Right hand / input</span>
            <span className="font-mono text-xs">{Math.round(settings.voiceGain * 100)}%</span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.voiceGain * 100)}
            onChange={(e) => onChange({ voiceGain: Number(e.target.value) / 100 })}
            className="w-full"
            aria-label="Right hand / input volume"
          />
        </div>
        <div className="mb-4">
          <label className="flex justify-between text-sm mb-1">
            <span>Left hand / accompaniment</span>
            <span className="font-mono text-xs">{Math.round(settings.pianoGain * 100)}%</span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.pianoGain * 100)}
            onChange={(e) => onChange({ pianoGain: Number(e.target.value) / 100 })}
            className="w-full"
            aria-label="Left hand / accompaniment volume"
          />
        </div>
        {settings.soundSource !== "organ" && (
          <label className="flex items-center gap-2 text-sm mb-4">
            <input
              type="checkbox"
              checked={settings.sustainPedal}
              onChange={(e) => onChange({ sustainPedal: e.target.checked })}
              aria-label="Sustain pedal"
            />
            Sustain pedal
            <span className="text-xs text-zinc-500 ml-auto">Let notes ring past their written length</span>
          </label>
        )}

    </>
  );
}
