"use client";
import type { MeasureInfo } from "@keyspilli/midi";
import { MidiTakePanel,type MidiTakeInput } from "./MidiTakePanel";
import { RhythmCoach } from "./RhythmCoach";
import { LearningInspection } from "./LearningInspection";
import {activeExportDigest,activeExportVariant,type ActiveExportSelection} from "./active-arrangement-export";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { microphonePitchEdge } from "./microphone-pitch";
import {
  AudioEngine,
  OrganAudioEngine,
  SamplerAudioEngine,
  ChordGrader,
  buildMelodyAccompaniment,
  detectPitch,
  filterAccompanimentChords,
  KeyboardInput,
  keyboardReachability,
  noteLabel,
  noteMatchesHand,
  selectHandNotes,
  isNativeKeyboardEvent,
  MidiInput,
  midiSupported,
  PlaybackEngine,
  loadJson,
  loadStringList,
  loadSettings,
  loadTimingCalibration,
  saveTimingCalibration,
  clearTimingCalibrations,
  loadSongPrefs,
  loadPracticeState,
  passageAvailable,
  restoredMelodyChoice,
  savePracticeState,
  recordAttempt,
  savedGradeDiagnostics,
  gradeProblemWindows,
  microphoneEligibility,
  practiceFingerprint,
  measureIndex,
  passageMidiRange,
  playbackMeasures,
  playbackTiming,
  resolveTimedNotes,
  resolveSourcePedalNotes,
  sourceNoteIds,
  validateSparseBackingTiming,
  saveJson,
  saveAccompanimentStyleIntent,
  saveSettings,
  saveSongPrefs,
  secPerBeat,
  DEFAULT_SETTINGS,
  TRANSPOSE_MIN,
  TRANSPOSE_MAX,
  type LoopRegion,
  type InputEventMetadata,
  type MelodyPhraseOverride,
  type MelodyAccompanimentResolution,
  type MelodyHarmonicSupportPolicy,
  type MelodySelection,
  type SourceBackingMode,
  type SparseBackingTiming,
  HeldChordGrader,
  type ChordPracticeSnapshot,
  type PlayerSettings,
  type ViewMode,
  type SongData,
  type GradeResult,
  type PracticeTarget,
  type PracticeAttempt,
  type SavedPassage,
  type Section as SongSection,
} from "@keyspilli/player-core";
import { SourceArrangementNotice } from "./SourceArrangementNotice";
import type { SourceArrangement } from "@keyspilli/catalog/src/source-arrangement.js";
import type { SongRow } from "@keyspilli/catalog";
import { PUBLIC_DIFFICULTY_ORDER, isPublicDifficultyLevel } from "@keyspilli/midi";
import { FallingCanvas } from "./FallingCanvas";
import { ChordPracticePanel } from "./ChordPracticePanel";
import { buildChordPracticeTargets, displayChordName, projectActionableChordShapes, selectPracticeChords } from "./chord-practice";
import {
  buildMelodyArrangementOptions,
  auditionNotesForRole,
  melodyArrangementExecution,
  melodyArrangementResolutionFingerprint,
  MELODY_WORKER_NOTE_THRESHOLD,
  traceMelodyArrangement,
} from "./melody-arrangement-runtime";
import { BeginnerView } from "./BeginnerView";
import { LeadSheetView } from "./LeadSheetView";
import { OwnerDeletion } from "../OwnerDeletion";
import { OfflinePackControl } from "../OfflinePack";
import { OwnerMetadata } from "../OwnerMetadata";
import { SheetMusicView, type SheetReaderPosition } from "./SheetMusicView";
import { SoundControls, type MelodyAuditionRole, type MelodyPhraseOverrideAction, type MelodyPreviewStatus } from "./SoundControls";
import { reviewedSourceBacking } from "./reviewed-source-backing";
import { bassChordsBackground, playerArrangementEnd, playerChordSources } from "./chords-backing";
import { melodyArrangementOutcome } from "./melody-arrangement-status";
import { usePianoInput } from "./usePianoInput";
import { createHeldInput } from "./held-input";
import { InputStatus } from "./InputStatus";
import { PlayerTools, type PlayerTool } from "./PlayerTools";
import { DownloadDialog } from "./DownloadDialog";
import { GradingPanel } from "./GradingPanel";
import { PracticeWorkspace } from "./PracticeWorkspace";
import { KeyboardRangeControls } from "./KeyboardRangeControls";
import { PracticeSetupDialog, type PracticeSetup } from "./PracticeSetupDialog";
import { useAnimatedSwitch, usePresence } from "./player-motion";
import { levelLabel } from "../level-labels";
import { loopFromBars, practiceContext, resolvePracticeRange } from "./player-ui-context";
import { APP_THEME_EVENT, applyAppTheme } from "../app-theme";
import {
  melodyHarmonicSupportPolicy,
  selectChordSource,
  type ChordSourceId,
} from "./chord-sources";

export interface PlayerDetail {
  publicationRevision: string | null;
  sourceArrangement?: SourceArrangement;
  song: SongRow;
  data: SongData;
  /** Advanced source on other levels; Advanced already has it in `data`. */
  chordData: SongData | null;
  chordUnavailableReason: string | null;
  variants: SongRow[];
}

/** Metadata-only payload used while a direct sheet route loads its player data. */
export interface PlayerShell {
  publicationRevision: string | null;
  sourceArrangement?: SourceArrangement;
  song: SongRow;
  variants: SongRow[];
}

export type PlayerInitial = PlayerDetail | PlayerShell;

const MODES: { id: ViewMode; label: string; hint: string }[] = [
  { id: "falling", label: "Fall Down", hint: "Notes fall onto the keyboard" },
  { id: "beginner", label: "Note letters", hint: "Pitch letters, octaves, and hand cues" },
  { id: "sheet", label: "Sheet Music", hint: "Engraved score" },
  { id: "leadsheet", label: "Lead Sheet", hint: "Melody and available chords or lyrics" },
];

type SoundPreviewSession = MelodyPreviewStatus & {
  token: number;
  restoreTime: number;
  wasPlaying: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

const PREVIEW_TAIL_MS = 650;

function playerVariantsForDisplay(song: Pick<SongRow, "difficulty">, variants: readonly SongRow[]): SongRow[] {
  const byDifficulty = new Map(
    variants.filter((variant) => isPublicDifficultyLevel(variant.difficulty)).map((variant) => [variant.difficulty, variant]),
  );
  const publicVariants = PUBLIC_DIFFICULTY_ORDER.flatMap((difficulty) => {
    const variant = byDifficulty.get(difficulty);
    return variant ? [variant] : [];
  });
  if (song.difficulty !== "very-easy") return publicVariants;

  const legacy = variants.find((variant) => variant.difficulty === "very-easy");
  if (!legacy) return publicVariants;
  const easyIndex = publicVariants.findIndex((variant) => variant.difficulty === "easy");
  publicVariants.splice(easyIndex < 0 ? publicVariants.length : easyIndex, 0, legacy);
  return publicVariants;
}

const TEMPO_SEMANTICS_NOTICE_KEY = "keyspilli.tempo-semantics.v1";
const MELODY_SELECTION_PREFIX = "keyspilli.melody-accompaniment.v2:";
const LEGACY_MELODY_SELECTION_PREFIX = "keyspilli.melody-accompaniment.v1:";
interface MelodySelectionSidecar {
  schemaVersion: 2;
  generatorVersion: "melody-accompaniment.v2";
  sourceFingerprint: string;
  selection: MelodySelection;
  sourceBackingMode?: SourceBackingMode;
  phraseOverrides?: readonly MelodyPhraseOverride[];
  provenance: MelodyAccompanimentResolution["provenance"];
}

function melodySelectionKey(songId: string): string {
  return MELODY_SELECTION_PREFIX + songId;
}

function legacyMelodySelectionKey(songId: string): string {
  return LEGACY_MELODY_SELECTION_PREFIX + songId;
}

function validPhraseOverrides(
  value: unknown,
): MelodyPhraseOverride[] {
  if (!Array.isArray(value)) return [];
  // Keep records that are structurally safe for the core validator. It owns
  // overlap, source-id, bounds, and fingerprint review; dropping them here
  // would hide `needs-review` and make the original melody look accepted.
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const override = candidate as Partial<MelodyPhraseOverride>;
    const sourceIdsAreSafe = Array.isArray(override.sourceNoteIds)
      && override.sourceNoteIds.every((id): id is string => typeof id === "string");
    return [{
      startBeat: typeof override.startBeat === "number" ? override.startBeat : Number.NaN,
      endBeat: typeof override.endBeat === "number" ? override.endBeat : Number.NaN,
      sourceNoteIds: sourceIdsAreSafe ? [...(override.sourceNoteIds ?? [])] : [],
      sourceFingerprint: sourceIdsAreSafe && typeof override.sourceFingerprint === "string"
        ? override.sourceFingerprint
        : null,
    }];
  });
}

function sourceFingerprintForPlayer(data: SongData, songId: string): string | null {
  if (data.sourceFingerprint) return data.sourceFingerprint;
  // Legacy payloads have no manifest hash. Keep the complete deterministic
  // source identity so any middle-note edit invalidates a saved override.
  const ids = sourceNoteIds(data.notes);
  if (!ids.length) return null;
  return `legacy:${songId}:${JSON.stringify(ids)}`;
}

function sourceMelodyArrangement(
  sourceNotes: SongData["notes"],
  chords: MelodyAccompanimentResolution["displayChords"],
  durationBeats: number,
  sourceFingerprint: string | null,
  selection: MelodySelection,
): MelodyAccompanimentResolution {
  const ids = sourceNoteIds(sourceNotes);
  const events = sourceNotes.map((note, index) => ({
    id: `source:${ids[index] ?? index}`,
    note,
    role: "retained-unclassified" as const,
    sourceNoteIds: [ids[index] ?? `source:${index}`],
  }));
  return {
    style: "melody-accompaniment",
    notes: [...sourceNotes],
    chords: [],
    displayChords: [...chords],
    guidanceNotes: [...sourceNotes],
    fallbackSpans: [],
    melody: [],
    protectedMelody: [],
    events,
    phrases: [],
    changeSummary: {
      durationBeats,
      changedBeats: 0,
      unchangedBeats: durationBeats,
      silentBeats: 0,
      reviewBeats: 0,
      addedNotes: 0,
      removedNotes: 0,
      alteredNotes: 0,
    },
    provenance: {
      schemaVersion: 1,
      generatorVersion: "melody-accompaniment.v2",
      sourceFingerprint,
      selection,
      selectionProvenance: "inferred",
      sourceNoteCount: sourceNotes.length,
      melodyNoteIds: [],
      unresolvedSpans: [],
      sourceSupportNoteCount: 0,
      generatedNoteCount: 0,
      generatedBeats: 0,
      soundingReattackCount: 0,
      fallbackBeats: 0,
      supportModes: ["fallback"],
    },
  };
}

function melodyArrangementRequestKey(
  sourceNotes: SongData["notes"],
  chords: MelodyAccompanimentResolution["displayChords"],
  durationBeats: number,
  sourceFingerprint: string | null,
  selection: MelodySelection,
  phraseOverrides: readonly MelodyPhraseOverride[],
  harmonicSupport: MelodyHarmonicSupportPolicy,
  sourceBackingMode: SourceBackingMode,
  sparseBackingTiming?: SparseBackingTiming,
): string {
  return JSON.stringify({
    sourceNotes,
    chords,
    durationBeats,
    sourceFingerprint,
    selection,
    phraseOverrides,
    harmonicSupport,
    sourceBackingMode,
    sparseBackingTiming,
    allowRests: true,
    soundingPolicy: "coherent-phrase",
  });
}

function FullPlayer({ initial, mode, focusTarget, sheetPosition }: { initial: PlayerDetail; mode: ViewMode | null; focusTarget?: "practice"; sheetPosition?: SheetReaderPosition }) {
  const [settings, setSettings] = useState<PlayerSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...(mode ? { mode } : {}),
  }));
  const [settingsRestored, setSettingsRestored] = useState(false);
  const activeData = settings.backgroundMode === "chord" ? initial.chordData ?? initial.data : initial.data;
  const sourceBackingNotes = useMemo(
    () => reviewedSourceBacking(initial.chordData ?? initial.data),
    [initial.chordData, initial.data],
  );
  const [time, setTime] = useState(0);
  const [seekVersion, setSeekVersion] = useState(0);
  const [engineReady, setEngineReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(time);
  const playingRef = useRef(playing);
  // Client-only preferences: initialize false for SSR, then sync from
  // localStorage after mount. Avoids hydration mismatch on class names.
  const [sectionsCollapsed, setSectionsCollapsed] = useState(false);
  const [fullWidth, setFullWidth] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [soundPreviewStatus, setSoundPreviewStatus] = useState<MelodyPreviewStatus | null>(null);
  useEffect(() => {
    setSectionsCollapsed(loadJson("keyspilli.sectionsCollapsed", false));
    setFullWidth(loadJson("keyspilli.fullWidth", false));
  }, []);
  useEffect(() => {
    const s = loadSettings();
    if (s.backgroundMode === "chord" && initial.chordUnavailableReason) s.backgroundMode = "piano";
    if (s.backgroundMode === "chord" && sourceBackingNotes) s.accompanimentStyle = "bass-chords";
    // Per-song practice settings override global defaults for this song.
    const songPrefs = loadSongPrefs(initial.song.id);
    if (songPrefs.speed !== undefined) s.speed = songPrefs.speed;
    if (songPrefs.transpose !== undefined) s.transpose = songPrefs.transpose;
    if (songPrefs.mode !== undefined) s.mode = songPrefs.mode;
    if (songPrefs.hand !== undefined) s.hand = songPrefs.hand;
    if (mode) s.mode = mode;
    setSettings(s);
    setSettingsRestored(true);
  }, [initial.chordData, initial.song.id, mode, sourceBackingNotes]);
  useEffect(() => {
    const syncTheme = () => setSettings(current => ({ ...current, stageTheme: document.documentElement.dataset.theme === "charcoal" ? "charcoal" : "light" }));
    window.addEventListener(APP_THEME_EVENT, syncTheme);
    return () => window.removeEventListener(APP_THEME_EVENT, syncTheme);
  }, []);
  const downloadTriggerRef = useRef<HTMLButtonElement>(null);
  const practiceTriggerRef = useRef<HTMLButtonElement>(null);
  const modeMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const sectionsExitRef = useRef<HTMLDivElement>(null);
  const modeMenuPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusTarget !== "practice") return undefined;
    const frame = window.requestAnimationFrame(() => practiceTriggerRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [focusTarget]);
  // Store loop anchors in musical time (beats); seconds are derived from the
  // current speed so tempo changes automatically reproject the region.
  const [loopBeats, setLoopBeats] = useState<{ startBeat: number; endBeat: number } | null>(null);
  const [loopDraft, setLoopDraft] = useState<{ start: string; end: string } | null>(null);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [readingWindow, setReadingWindow] = useState<2 | 3.2 | 5>(3.2);
  const [showLyrics, setShowLyrics] = useState(true);
  const loop = useMemo<LoopRegion | null>(() => {
    if (!loopBeats) return null;
    const spb = secPerBeat(activeData.tempoBpm, settings.speed);
    return { startSec: loopBeats.startBeat * spb, endSec: loopBeats.endBeat * spb };
  }, [loopBeats, activeData.tempoBpm, settings.speed]);
  const sections: SongSection[] = activeData.sections ?? [];
  const displayVariants = playerVariantsForDisplay(initial.song, initial.variants);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [openTool, setOpenTool] = useState<PlayerTool | null>(null);
  const toolOpenRef = useRef(openTool !== null);
  const showDownloadRef = useRef(showDownload);
  const showModeMenuRef = useRef(showModeMenu);
  toolOpenRef.current = openTool !== null;
  showDownloadRef.current = showDownload;
  showModeMenuRef.current = showModeMenu;
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const modeMenuPresence = usePresence(showModeMenu);
  const modeSwitch = useAnimatedSwitch(settings.mode);
  const sectionsSwitch = useAnimatedSwitch(sectionsCollapsed);
  const playingNoticePresence = usePresence(playing);
  const [showTempoSemanticsNotice, setShowTempoSemanticsNotice] = useState(false);
  const tempoNoticePresence = usePresence(showTempoSemanticsNotice);
  const [grading, setGrading] = useState(false);
  const gradingRef = useRef(false);
  gradingRef.current = grading;
  const [showPracticeSetup, setShowPracticeSetup] = useState(false);
  const showPracticeSetupRef = useRef(false);
  showPracticeSetupRef.current = showPracticeSetup;
  const defaultPracticeSetup: PracticeSetup = {
    input: "keyboard",
    wait: settings.backgroundMode === "chord",
    scope: settings.backgroundMode === "chord" ? (loop ? "loop" : "bars") : "current",
    countInBeats: 0,
  };
  const [practiceSetup, setPracticeSetup] = useState<PracticeSetup>(defaultPracticeSetup);
  const practiceSetupRef = useRef(practiceSetup);
  practiceSetupRef.current = practiceSetup;
  const lastAttemptRef = useRef<{ setup: PracticeSetup; range: LoopRegion } | null>(null);
  const gradedInputOffsetRef = useRef(0);
  const gradedTimingRef = useRef({ bpm: initial.data.tempoBpm, speed: 1 });
  const storedAttemptRef = useRef<PracticeAttempt | null>(null);
  const [recall,setRecall]=useState<{passage:SavedPassage;demonstrated:boolean;guided:boolean;reduced:boolean}|null>(null);
  const activeTempoPlanRef = useRef<{ passageId: string; policyId: string } | null>(null);
  const [practiceSaveNotice, setPracticeSaveNotice] = useState("");
  const repeatRangeRef = useRef<LoopRegion | null>(null);
  const [practiceError, setPracticeError] = useState("");
  const [countIn, setCountIn] = useState<number | null>(null);
  const countInRef = useRef<number | null>(null);
  const countInTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micCleanupRef = useRef<(() => void) | null>(null);
  const micRequestRef = useRef(0);
  const [micReady, setMicReady] = useState(false);
  const [micPending, setMicPending] = useState(false);
  const [micError, setMicError] = useState("");
  const [chordPracticeActive, setChordPracticeActive] = useState(false);
  const chordPracticePresence = usePresence(chordPracticeActive);
  const [modeMenuIdx, setModeMenuIdx] = useState(-1);
  const [chordPracticeSnapshot, setChordPracticeSnapshot] = useState<ChordPracticeSnapshot | null>(null);
  const [waitMode, setWaitMode] = useState(false);
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [pressedKeys, setPressedKeys] = useState<Map<number, number>>(new Map());
  const interruptRef = useRef<(reason: string) => void>(() => {});
  const [micSignal, setMicSignal] = useState("Unknown signal quality");
  const [midiConnected, setMidiConnected] = useState(false);
  const [midiDevices, setMidiDevices] = useState<Array<{ id: string; name: string }>>([]);
  const [midiSelection, setMidiSelection] = useState<{ device: string | null; channel: number | null }>({ device: null, channel: null });
  const [timingOffsets, setTimingOffsets] = useState<{ keyboard: number | null; midi: number | null }>({ keyboard: null, midi: null });
  const [samplePolicy, setSamplePolicy] = useState<"fallback" | "wait">("fallback");
  const samplePolicyRef = useRef(samplePolicy); samplePolicyRef.current = samplePolicy;
  const [sampleStatus, setSampleStatus] = useState({ readiness: "uninitialized", timbre: "fallback", latencyMs: null as number | null });
  const inputSoundBinding = `${settings.soundSource}:${settings.organStyle}:${settings.organRegistration}`;
  const timingBindings = { keyboard: `keyboard:${inputSoundBinding}`, midi: midiSelection.device ? `midi:${midiSelection.device}:${midiSelection.channel ?? "*"}:${inputSoundBinding}` : "" };
  const liveTimingRef = useRef({ selection: midiSelection, bindings: timingBindings });
  liveTimingRef.current = { selection: midiSelection, bindings: timingBindings };
  function effectiveTimingBinding(input: "keyboard" | "midi") {
    const binding = liveTimingRef.current.bindings[input];
    const audio = engineRef.current?.audio;
    return binding && audio instanceof SamplerAudioEngine ? `${binding}:${audio.playbackTimbre}` : binding;
  }
  useEffect(() => { setTimingOffsets({ keyboard: loadTimingCalibration(effectiveTimingBinding("keyboard")), midi: timingBindings.midi ? loadTimingCalibration(effectiveTimingBinding("midi")) : null }); }, [timingBindings.keyboard, timingBindings.midi, sampleStatus.timbre]);
  useEffect(() => {
    const invalidate = () => { clearTimingCalibrations(); setTimingOffsets({ keyboard: null, midi: null }); interruptRef.current("Input/output device setup changed. Timing calibration reset."); };
    navigator.mediaDevices?.addEventListener?.("devicechange", invalidate);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", invalidate);
  }, []);
  function selectMidi(device: string | null, channel: number | null) {
    if (gradingRef.current) return;
    midiInputRef.current?.select(device, channel); heldInputRef.current?.releaseAll();
    setMidiSelection({ device, channel }); setMidiConnected((midiInputRef.current?.connectedCount ?? 0) > 0);
  }
  function setTimingOffset(input: "keyboard" | "midi", value: number | null) {
    if (gradingRef.current) return;
    const binding = effectiveTimingBinding(input);
    if (!binding || !saveTimingCalibration(binding, value)) { setPracticeSaveNotice("Timing calibration could not be saved."); return; }
    setTimingOffsets(current => ({ ...current, [input]: value }));
  }
  const [inputOctave, setInputOctave] = useState(2);
  const [midiPending, setMidiPending] = useState(false);
  const [midiError, setMidiError] = useState("");
  const keyboardInputRef = useRef<KeyboardInput | null>(null);
  const midiInputRef = useRef<MidiInput | null>(null);

  const songKeyLabel = displayChordName(activeData.key, settings.transpose);
  const provisionalTempo = initial.sourceArrangement?.sourceKind === "tutorial-preview";
  const contextLabel = practiceContext(activeData.key, activeData.tempoBpm, settings, provisionalTempo);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [learned, setLearned] = useState<string[]>([]);
  const [chordSourcePreference, setChordSourcePreference] = useState<ChordSourceId>("auto");
  const [melodySelection, setMelodySelection] = useState<MelodySelection>("automatic");
  const [melodySourceBackingMode, setMelodySourceBackingMode] = useState<SourceBackingMode>("default");
  const [melodyPhraseOverrides, setMelodyPhraseOverrides] = useState<MelodyPhraseOverride[]>([]);
  const [melodySelectionSaved, setMelodySelectionSaved] = useState(false);
  const melodySourceFingerprint = useMemo(
    () => sourceFingerprintForPlayer(activeData, settings.backgroundMode === "chord" ? `${initial.song.baseId}-a` : initial.song.id),
    [activeData, initial.song.baseId, initial.song.id, settings.backgroundMode],
  );
  const sparseBackingTiming = useMemo(
    () => validateSparseBackingTiming(activeData.sourceTiming, melodySourceFingerprint),
    [activeData.sourceTiming, melodySourceFingerprint],
  );

  useEffect(() => {
    setFavorites(loadStringList("keyspilli.favorites"));
    setLearned(loadStringList("keyspilli.learned"));
    const value = loadJson("keyspilli.chordSource", "auto" as ChordSourceId);
    if (value === "ug" || value === "generated" || value === "auto") setChordSourcePreference(value);
  }, []);

  useEffect(() => {
    const saved = loadJson<MelodySelectionSidecar | null>(melodySelectionKey(initial.song.id), null);
    const sidecarShapeValid = saved?.schemaVersion === 2
      && saved.generatorVersion === "melody-accompaniment.v2";
    if (sidecarShapeValid) {
      const sourceMatches = typeof saved.sourceFingerprint === "string"
        && saved.sourceFingerprint === melodySourceFingerprint;
      const phraseOverrides = validPhraseOverrides(
        saved.phraseOverrides,
      ).map((override) => sourceMatches ? override : { ...override, sourceFingerprint: null });
      setMelodySelection(sourceMatches && (saved.selection === "automatic" || saved.selection === "right-hand")
        ? saved.selection
        : "automatic");
      setMelodySourceBackingMode(sourceMatches && saved.sourceBackingMode === "conservative" ? "conservative" : "default");
      setMelodyPhraseOverrides(phraseOverrides);
      setMelodySelectionSaved(sourceMatches || phraseOverrides.length > 0);
      return;
    }
    const restored = restoredMelodyChoice(initial.song.id, melodySourceFingerprint);
    if (restored) {
      setMelodySelection(restored.selection); setMelodySourceBackingMode(restored.sourceBackingMode);
      setMelodyPhraseOverrides(validPhraseOverrides(restored.phraseOverrides)); setMelodySelectionSaved(true); return;
    }
    // v1 provenance is deliberately ignored. A matching old whole-RH choice
    // remains a user preference, while the current producer recomputes v2.
    const legacy = loadJson<{ sourceFingerprint?: string; selection?: MelodySelection } | null>(legacyMelodySelectionKey(initial.song.id), null);
    const legacyValid = legacy?.sourceFingerprint === melodySourceFingerprint
      && (legacy.selection === "automatic" || legacy.selection === "right-hand");
    setMelodySelection(legacyValid ? legacy.selection! : "automatic");
    setMelodySourceBackingMode("default");
    setMelodyPhraseOverrides([]);
    setMelodySelectionSaved(legacyValid);
  }, [activeData, initial.song.id, melodySourceFingerprint]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px), (max-width: 1000px) and (max-height: 500px)");
    const update = () => setIsNarrowViewport(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const layer = sectionsExitRef.current;
    if (layer) layer.setAttribute("inert", "");
  }, [sectionsSwitch.previous]);

  useEffect(() => {
    const menu = modeMenuPanelRef.current;
    if (!menu) return;
    if (!showModeMenu) menu.setAttribute("inert", "");
    else menu.removeAttribute("inert");
  }, [modeMenuPresence.mounted, showModeMenu]);

  // Tempo semantics changed from rewriting beat coordinates to controlling
  // playback speed. Keep acknowledgement in versioned UI state so a future
  // semantics change can show a new notice without touching artifact data.
  useEffect(() => {
    setShowTempoSemanticsNotice(loadJson<boolean>(TEMPO_SEMANTICS_NOTICE_KEY, false) !== true);
  }, []);

  function dismissTempoSemanticsNotice() {
    saveJson(TEMPO_SEMANTICS_NOTICE_KEY, true);
    setShowTempoSemanticsNotice(false);
    window.requestAnimationFrame(() => modeMenuTriggerRef.current?.focus());
  }

  const engineRef = useRef<PlaybackEngine | null>(null);
  const soundPreviewRef = useRef<SoundPreviewSession | null>(null);
  const soundPreviewTokenRef = useRef(0);
  const cancelSoundPreview = useCallback(() => {
    const session = soundPreviewRef.current;
    if (session && session.timer !== null) clearTimeout(session.timer);
    if (session) engineRef.current?.audio.cancelAll();
    soundPreviewRef.current = null;
    soundPreviewTokenRef.current += 1;
    setSoundPreviewStatus(null);
  }, []);
  const finishSoundPreview = useCallback((phase: "complete" | "stopped") => {
    const session = soundPreviewRef.current;
    if (!session) return;
    if (session.timer !== null) clearTimeout(session.timer);
    engineRef.current?.audio.cancelAll();
    soundPreviewRef.current = null;
    soundPreviewTokenRef.current += 1;
    const engine = engineRef.current;
    if (engine) {
      engine.seek(session.restoreTime);
      if (session.wasPlaying) engine.start();
      syncTransportState();
    }
    setSoundPreviewStatus({
      role: session.role,
      phase,
      rangeLabel: session.rangeLabel,
      startSec: session.startSec,
      endSec: session.endSec,
    });
  }, []);
  const takeInputRef=useRef<MidiTakeInput|null>(null);
  const auxiliaryRef=useRef<"take"|"rhythm"|null>(null),[auxiliary,setAuxiliary]=useState<"take"|"rhythm"|null>(null);
  const heldInputRef = useRef<ReturnType<typeof createHeldInput> | null>(null);
  if (!heldInputRef.current) heldInputRef.current = createHeldInput(soundInputNote, midi => {
    engineRef.current?.handleNoteOff(midi);
    setPressedKeys(current => { const next = new Map(current); next.delete(midi); return next; });
  });
  const audioSwapStateRef = useRef<{ time: number; playing: boolean } | null>(null);
  const chordPracticeRef = useRef<ChordGrader | HeldChordGrader | null>(null);
  const heldChordInputRef=useRef<{input:"keyboard"|"midi";binding:string}|null>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const chordPracticeActiveRef = useRef(chordPracticeActive);
  const skipChordPracticeRef = useRef(skipChordPractice);
  const hearChordPracticeRef = useRef(hearChordPractice);

  // Latest-ref pattern: assign during render instead of subscribing effects
  // that re-fire every render because function declarations get new identities.
  chordPracticeActiveRef.current = chordPracticeActive;
  skipChordPracticeRef.current = skipChordPractice;
  hearChordPracticeRef.current = hearChordPractice;

  const arrangementEnd = useMemo(
    () => playerArrangementEnd(activeData),
    [activeData],
  );
  const playbackTimingForPlayer = useMemo(
    () => playbackTiming({ ...activeData, sourceTiming: sparseBackingTiming }),
    [activeData, sparseBackingTiming],
  );
  const [verifiedScoreMap, setVerifiedScoreMap] = useState<{ fingerprint: string; revision: string; measures: MeasureInfo[] } | null>(null);
  const navigationMeasures = useMemo(
    () => settings.backgroundMode === "piano" && settings.transpose === 0
      && verifiedScoreMap?.fingerprint === initial.data.sourceFingerprint
      && verifiedScoreMap?.revision === initial.publicationRevision
      ? verifiedScoreMap.measures
      : playbackMeasures({ ...activeData, sourceTiming: playbackTimingForPlayer }),
    [activeData, playbackTimingForPlayer, verifiedScoreMap, initial.data.sourceFingerprint, initial.publicationRevision, settings.backgroundMode, settings.transpose],
  );

  const chordSources = useMemo(
    () => playerChordSources(activeData, arrangementEnd),
    [activeData, arrangementEnd],
  );
  const selectedChordSource = useMemo(
    () => selectChordSource(chordSources, chordSourcePreference),
    [chordSources, chordSourcePreference],
  );
  const melodySupportPolicy = useMemo(
    () => melodyHarmonicSupportPolicy(selectedChordSource.source),
    [selectedChordSource.source],
  );
  // Existing artifacts still carry per-grid-slice chord spam; collapse runs of
  // the same chord before rendering. (New ingests dedupe in chordsAt.) The
  // source timeline keeps its supplied names/voicings intact.
  const chords = useMemo(
    () => selectedChordSource.source?.chords ?? [],
    [selectedChordSource.source],
  );
  const melodyArrangementRequested = settings.backgroundMode === "chord"
    && settings.accompanimentStyle === "melody-accompaniment";
  const workerAvailable = typeof Worker !== "undefined";
  const melodyArrangementExecutionMode = melodyArrangementExecution(
    activeData.notes.length,
    melodyArrangementRequested,
    workerAvailable,
  );
  const melodyArrangementWorkerRequired = melodyArrangementRequested
    && activeData.notes.length >= MELODY_WORKER_NOTE_THRESHOLD;
  const melodyArrangementRequestKeyValue = useMemo(
    () => melodyArrangementRequestKey(
      activeData.notes,
      chords,
      arrangementEnd,
      melodySourceFingerprint,
      melodySelection,
      melodyPhraseOverrides,
      melodySupportPolicy,
      melodySourceBackingMode,
      playbackTimingForPlayer,
    ),
    [arrangementEnd, chords, activeData.notes, melodyPhraseOverrides, melodySelection, melodySourceBackingMode, melodySourceFingerprint, melodySupportPolicy, playbackTimingForPlayer],
  );
  const melodyArrangementOptions = useMemo(
    () => buildMelodyArrangementOptions({
      durationBeats: arrangementEnd,
      sourceFingerprint: melodySourceFingerprint,
      selection: melodySelection,
      phraseOverrides: melodyPhraseOverrides,
      harmonicSupport: melodySupportPolicy,
      sourceBackingMode: melodySourceBackingMode,
      sparseBackingTiming: playbackTimingForPlayer,
    }),
    [arrangementEnd, melodyPhraseOverrides, melodySelection, melodySourceBackingMode, melodySourceFingerprint, melodySupportPolicy, playbackTimingForPlayer],
  );
  const sourceMelodyView = useMemo(
    () => sourceMelodyArrangement(activeData.notes, chords, arrangementEnd, melodySourceFingerprint, melodySelection),
    [arrangementEnd, chords, activeData.notes, melodySelection, melodySourceFingerprint],
  );
  const synchronousMelodyArrangement = useMemo<MelodyAccompanimentResolution>(() => {
    if (melodyArrangementExecutionMode !== "sync") {
      traceMelodyArrangement({
        phase: "source-view",
        execution: melodyArrangementExecutionMode,
        noteCount: activeData.notes.length,
        key: melodyArrangementRequestKeyValue,
      });
      return sourceMelodyView;
    }
    traceMelodyArrangement({
      phase: "sync-start",
      execution: "sync",
      noteCount: activeData.notes.length,
      key: melodyArrangementRequestKeyValue,
    });
    const resolution = buildMelodyAccompaniment(activeData.notes, chords, melodyArrangementOptions);
    traceMelodyArrangement(() => ({
      phase: "sync-complete",
      execution: "sync",
      noteCount: activeData.notes.length,
      key: melodyArrangementRequestKeyValue,
      resolutionFingerprint: melodyArrangementResolutionFingerprint(resolution),
    }));
    return resolution;
  }, [chords, activeData.notes, melodyArrangementExecutionMode, melodyArrangementOptions, melodyArrangementRequestKeyValue, sourceMelodyView]);
  const [workerMelodyArrangement, setWorkerMelodyArrangement] = useState<{ key: string; resolution: MelodyAccompanimentResolution } | null>(null);
  const [workerState, setWorkerState] = useState<{
    key: string;
    status: "pending" | "ready" | "error";
    error?: string;
  } | null>(null);
  const [workerRetry, setWorkerRetry] = useState(0);
  useEffect(() => {
    setWorkerMelodyArrangement(null);
    setWorkerState(null);
    if (melodyArrangementExecutionMode !== "worker") {
      if (melodyArrangementRequested && activeData.notes.length >= MELODY_WORKER_NOTE_THRESHOLD && !workerAvailable) {
        const error = "Background arrangement workers are unavailable; Original playback is retained.";
        setWorkerState({ key: melodyArrangementRequestKeyValue, status: "error", error });
        traceMelodyArrangement({ phase: "worker-error", execution: "source", noteCount: activeData.notes.length, key: melodyArrangementRequestKeyValue, error });
      }
      return undefined;
    }
    let active = true;
    const requestId = Date.now() + Math.random();
    setWorkerState({ key: melodyArrangementRequestKeyValue, status: "pending" });
    let worker: Worker;
    const fail = (message: string) => {
      if (!active) return;
      setWorkerState({ key: melodyArrangementRequestKeyValue, status: "error", error: message });
      traceMelodyArrangement({ phase: "worker-error", execution: "worker", noteCount: activeData.notes.length, key: melodyArrangementRequestKeyValue, error: message });
    };
    try {
      traceMelodyArrangement({ phase: "worker-create", execution: "worker", noteCount: activeData.notes.length, key: melodyArrangementRequestKeyValue });
      worker = new Worker(new URL("../../workers/melody-accompaniment.worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      fail(error instanceof Error ? error.message : "The background arrangement worker could not start; Original playback is retained.");
      return () => { active = false; };
    }
    worker.onmessage = (event: MessageEvent<{ requestId: number; requestKey: string; resolution?: MelodyAccompanimentResolution; error?: string }>) => {
      if (!active || event.data.requestId !== requestId || event.data.requestKey !== melodyArrangementRequestKeyValue) return;
      if (event.data.error) {
        fail(event.data.error);
        return;
      }
      if (!event.data.resolution) {
        fail("The background arrangement returned no result; Original playback is retained.");
        return;
      }
      const resolution = event.data.resolution;
      setWorkerMelodyArrangement({ key: event.data.requestKey, resolution });
      setWorkerState({ key: melodyArrangementRequestKeyValue, status: "ready" });
      traceMelodyArrangement(() => ({
        phase: "worker-ready",
        execution: "worker",
        noteCount: activeData.notes.length,
        key: melodyArrangementRequestKeyValue,
        resolutionFingerprint: melodyArrangementResolutionFingerprint(resolution),
      }));
    };
    worker.onerror = () => fail("The background arrangement failed; Original playback is retained.");
    worker.onmessageerror = () => fail("The background arrangement response was invalid; Original playback is retained.");
    try {
      traceMelodyArrangement({ phase: "worker-request", execution: "worker", noteCount: activeData.notes.length, key: melodyArrangementRequestKeyValue });
      worker.postMessage({
        requestId,
        requestKey: melodyArrangementRequestKeyValue,
        sourceNotes: activeData.notes,
        chordTimeline: chords,
        options: melodyArrangementOptions,
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "The background arrangement could not start; Original playback is retained.");
    }
    return () => {
      active = false;
      worker.terminate();
    };
  }, [chords, activeData.notes, melodyArrangementExecutionMode, melodyArrangementOptions, melodyArrangementRequested, melodyArrangementRequestKeyValue, workerAvailable, workerRetry]);
  const workerResolution = workerMelodyArrangement?.key === melodyArrangementRequestKeyValue
    ? workerMelodyArrangement.resolution
    : null;
  const activeWorkerState = workerState?.key === melodyArrangementRequestKeyValue ? workerState : null;
  const workerError = activeWorkerState?.error ?? null;
  const melodyArrangement = workerResolution ?? synchronousMelodyArrangement;
  const melodyArrangementPending = melodyArrangementWorkerRequired
    && melodyArrangementExecutionMode === "worker"
    && workerResolution === null
    && activeWorkerState?.status !== "error";
  const melodyArrangementFailed = melodyArrangementWorkerRequired
    && (melodyArrangementExecutionMode === "source" || activeWorkerState?.status === "error");
  const accompaniment = useMemo(
    () => {
      if (settings.backgroundMode !== "chord") {
        return { style: settings.accompanimentStyle, notes: activeData.notes, chords: [], displayChords: [], guidanceNotes: activeData.notes, fallbackSpans: [] };
      }
      return settings.accompanimentStyle === "melody-accompaniment"
        ? melodyArrangement
        : bassChordsBackground(activeData, chords, arrangementEnd, sourceBackingNotes);
    },
    [arrangementEnd, chords, activeData, melodyArrangement, settings.accompanimentStyle, settings.backgroundMode, sourceBackingNotes],
  );
  const displayChords = settings.backgroundMode === "chord" ? accompaniment.displayChords : chords;
  const actionableChords = useMemo(
    () => settings.backgroundMode === "chord"
      ? filterAccompanimentChords(accompaniment.chords, settings.hand)
      : [],
    [accompaniment.chords, settings.backgroundMode, settings.hand],
  );
  const audioChords = useMemo(
    () => settings.accompanimentStyle === "bass-chords"
      ? settings.audibleSupport ? accompaniment.chords : actionableChords
      : [],
    [actionableChords, accompaniment.chords, settings.accompanimentStyle, settings.audibleSupport],
  );
  const guidanceData = useMemo(() => ({
    ...activeData,
    notes: selectHandNotes(accompaniment.guidanceNotes, settings.hand),
  }), [accompaniment.guidanceNotes, activeData, settings.hand]);
  const notes = useMemo(
    () =>
      selectHandNotes((settings.backgroundMode==="piano"?resolveSourcePedalNotes:resolveTimedNotes)({ ...activeData, notes: accompaniment.notes }, settings.speed, settings.transpose, settings.renderedExpression), settings.hand, settings.audibleSupport),
    [accompaniment.notes, activeData, settings.speed, settings.transpose, settings.hand, settings.audibleSupport, settings.renderedExpression, settings.backgroundMode],
  );

  const guidanceNotes = useMemo(
    () => resolveTimedNotes(guidanceData, settings.speed, settings.transpose, settings.renderedExpression),
    [guidanceData, settings.speed, settings.transpose, settings.renderedExpression],
  );
  const activeExportSelection:ActiveExportSelection={backgroundMode:settings.backgroundMode,accompanimentStyle:settings.accompanimentStyle,
    hand:settings.hand,audibleSupport:settings.audibleSupport??false,speed:settings.speed,transpose:settings.transpose,renderedExpression:settings.renderedExpression??"source",
    chordSource:chordSourcePreference,melodySelection,sourceBackingMode:melodySourceBackingMode,phraseOverrides:melodyPhraseOverrides};
  const practiceDescriptor = useMemo(() => ({
    publicationRevision: initial.publicationRevision, sourceFingerprint: melodySourceFingerprint, source: activeData, data: guidanceData,
    chordSource: selectedChordSource.source,
    hand: settings.hand, backgroundMode: settings.backgroundMode, accompanimentStyle: settings.accompanimentStyle,
  }), [initial.publicationRevision, melodySourceFingerprint, activeData, guidanceData, selectedChordSource.source, settings.hand, settings.backgroundMode, settings.accompanimentStyle]);
  const [practiceTarget, setPracticeTarget] = useState<PracticeTarget | null>(null);
  const selectedPassageIdRef = useRef<string | null>(null);
  useEffect(() => {
    let current = true;
    setPracticeTarget(null);
    void practiceFingerprint(practiceDescriptor).then(fingerprint => {
      if (current) setPracticeTarget({ baseId: initial.song.baseId, variantId: initial.song.id, fingerprint });
    }).catch(() => { if (current) setPracticeSaveNotice("Saved passages and history are unavailable in this browser. Playback still works."); });
    return () => { current = false; };
  }, [practiceDescriptor, initial.song.baseId, initial.song.id]);

  useEffect(()=>{setRecall(null);},[practiceTarget?.fingerprint,settings.mode,settings.speed,settings.transpose,settings.hand,settings.backgroundMode,settings.accompanimentStyle,settings.soundSource]);
  useEffect(()=>{if(soundPreviewStatus?.phase==="complete" && soundPreviewStatus.role==="full")setRecall(current=>current&&Math.abs(soundPreviewStatus.startSec-current.passage.startBeat*secPerBeat(activeData.tempoBpm,settings.speed))<1e-6&&Math.abs(soundPreviewStatus.endSec-current.passage.endBeat*secPerBeat(activeData.tempoBpm,settings.speed))<1e-6?{...current,demonstrated:true}:current);},[soundPreviewStatus,activeData.tempoBpm,settings.speed]);
  function revealRecall(){
    if(storedAttemptRef.current?.context.assistance && recall?.reduced){const assistance=storedAttemptRef.current.context.assistance;assistance.reveals=Math.min(1000,assistance.reveals+1);if(!recordAttempt(storedAttemptRef.current))setPracticeSaveNotice("Recall history could not be saved.");}
    setRecall(current=>current?{...current,reduced:false}:null);
  }
  function storeAttemptEnd(outcome: PracticeAttempt["outcome"], result: GradeResult | null) {
    const attempt = storedAttemptRef.current;
    if (!attempt) return;
    storedAttemptRef.current = null;
    if(attempt.context.assistance)setRecall(current=>current?{...current,reduced:false,guided:current.guided||outcome==="completed"&&attempt.context.assistance?.mode==="guided"}:null);
    const counts = result ? { total: result.total, hit: result.hit, missed: result.missed, wrong: result.wrong, late: result.late, accuracyPct: result.accuracyPct, diagnostics: savedGradeDiagnostics(result.diagnostics), ...(result.articulation?{articulation:result.articulation}:{}) } : null;
    if (!recordAttempt({ ...attempt, outcome, result: counts, finishedAt: new Date().toISOString() })) {
      setPracticeSaveNotice("Practice history could not be saved. Browser storage may be unavailable or full.");
    }
    const state = loadPracticeState();
    if (state.resume?.target.fingerprint === attempt.target.fingerprint && state.resume.target.variantId === attempt.target.variantId) {
      state.resume.positionBeat = (engineRef.current?.time ?? 0) / secPerBeat(attempt.context.bpm, attempt.context.speed);
      state.resume.updatedAt = new Date().toISOString();
      if (!savePracticeState(state)) setPracticeSaveNotice("Saved position could not be updated.");
    }
  }
  function interruptPlayback(reason: string) {
    setRecall(current=>current?{...current,reduced:false}:null);
    const engine = engineRef.current;
    const active = gradingRef.current || engine?.playing || countInRef.current !== null || soundPreviewStatus?.phase === "playing" || micReady;
    if (!active) return;
    const wasCounting = countInRef.current !== null;
    gradingRef.current = false;
    cancelCountIn(); cancelSoundPreview();
    engine?.stop();
    const result = engine?.finishGrading() ?? null;
    storeAttemptEndRef.current("interrupted", wasCounting ? null : result);
    setGrading(false); setWaitMode(false); setGradeResult(null);
    keyboardInputRef.current?.releaseAll(); midiInputRef.current?.releaseAll(); heldInputRef.current?.releaseAll();
    releaseMicrophone(); syncTransportState();
    if (active) setPracticeSaveNotice(`${reason} Resume deliberately from the saved position.`);
  }
  interruptRef.current = interruptPlayback;
  const storeAttemptEndRef = useRef(storeAttemptEnd);
  storeAttemptEndRef.current = storeAttemptEnd;
  useEffect(() => {
    const pageHide = () => interruptRef.current("Page navigation interrupted playback/practice.");
    window.addEventListener("pagehide", pageHide);
    return () => {
      window.removeEventListener("pagehide", pageHide);
      gradingRef.current=false;
      storeAttemptEndRef.current("interrupted", engineRef.current?.finishGrading() ?? null);
    };
  }, []);
  const positionBindingRef = useRef({ target: practiceTarget, bpm: activeData.tempoBpm, speed: settings.speed });
  positionBindingRef.current = { target: practiceTarget, bpm: activeData.tempoBpm, speed: settings.speed };
  const savePosition = useCallback(() => {
    const binding = positionBindingRef.current, state = loadPracticeState();
    if (!binding.target || !state.resume || state.resume.target.fingerprint !== binding.target.fingerprint
        || state.resume.target.variantId !== binding.target.variantId) return;
    state.resume.positionBeat = Math.max(0, (engineRef.current?.time ?? 0) / secPerBeat(binding.bpm, binding.speed));
    state.resume.updatedAt = new Date().toISOString();
    if (!savePracticeState(state)) setPracticeSaveNotice("Saved position could not be updated.");
  }, []);
  useEffect(() => { if (!playing) savePosition(); }, [playing, seekVersion, savePosition]);
  useEffect(() => () => savePosition(), [savePosition]);

  // Preview notes are scheduled directly on the audio graph, outside the
  // transport timeline. Tear that graph down whenever its source, routing,
  // external seek changes; cleanup also covers navigation/unmount. Closing
  // Tools does not end an audition: the stage status owns its Stop command.
  useEffect(() => {
    return cancelSoundPreview;
  }, [cancelSoundPreview, chordSourcePreference, initial.song.id, loop, melodyArrangement,
    melodyArrangementRequestKeyValue, melodyPhraseOverrides, melodySelection,
    melodySourceBackingMode, settings.accompanimentStyle, settings.backgroundMode,
    settings.hand, settings.mode, settings.metronome, settings.organDrive,
    settings.organRotary, settings.organSpace, settings.organStyle, settings.organRegistration, settings.pianoGain,
    settings.soundSource, settings.speed, settings.sustainPedal, settings.transpose,
    settings.voiceGain, settings.audibleSupport, settings.renderedExpression, seekVersion]);

  const duration = useMemo(
    () => Math.max(
      notes.reduce((m, n) => Math.max(m, n.startSec + n.durSec), 0),
      arrangementEnd * secPerBeat(activeData.tempoBpm, settings.speed),
      8,
    ),
    [arrangementEnd, activeData.tempoBpm, notes, settings.speed],
  );

  const currentMeasure = measureIndex(
    time,
    activeData.tempoBpm,
    settings.speed,
    activeData.timeSig,
    navigationMeasures.length,
    navigationMeasures,
  );
  // Freeze chord-practice targets at session start: a seek changes the
  // current measure but must not silently discard accumulated progress.
  const chordPracticeTargetsRef = useRef<{
    sourceChords: typeof displayChords;
    transpose: number;
    targets: ReturnType<typeof buildChordPracticeTargets>;
  } | null>(null);
  const lastChordPracticeTargetsRef = useRef<ReturnType<typeof buildChordPracticeTargets> | null>(null);
  const [chordPracticeNotice, setChordPracticeNotice] = useState("");
  const chordPracticeTargets = useMemo(
    () => {
      const sourceChords = settings.backgroundMode === "chord" ? actionableChords : displayChords;
      const previous = chordPracticeTargetsRef.current;
      if (chordPracticeActive && previous?.sourceChords === sourceChords && previous.transpose === settings.transpose) return previous.targets;
      const next = buildChordPracticeTargets(selectPracticeChords(sourceChords, navigationMeasures, currentMeasure), settings.transpose);
      chordPracticeTargetsRef.current = { sourceChords, transpose: settings.transpose, targets: next };
      return next;
    },
    [actionableChords, displayChords, navigationMeasures, currentMeasure, settings.backgroundMode, settings.transpose, chordPracticeActive],
  );
  // Playback applies transpose inside PlaybackEngine. Keep the visual chord
  // keys in the same transposed coordinate space as the falling notes without
  // feeding already-transposed values back into the audio scheduler.
  const visualChords = useMemo(
    () => settings.backgroundMode === "chord"
      ? projectActionableChordShapes(displayChords, actionableChords, settings.transpose)
      : displayChords.map((c) => ({ ...c, name: displayChordName(c.name, settings.transpose), notes: c.notes.map((midi) => midi + settings.transpose) })),
    [actionableChords, displayChords, settings.backgroundMode, settings.transpose],
  );

  useEffect(() => {
    if (!chordPracticeActive) {
      lastChordPracticeTargetsRef.current = null;
      return;
    }
    if (lastChordPracticeTargetsRef.current && lastChordPracticeTargetsRef.current !== chordPracticeTargets) {
      setChordPracticeNotice("Chord tones restarted for the selected hand or sound.");
    }
    lastChordPracticeTargetsRef.current = chordPracticeTargets;
    const session = new ChordGrader(chordPracticeTargets);
    chordPracticeRef.current = session;
    setChordPracticeSnapshot(session.snapshot());
  }, [chordPracticeActive, chordPracticeTargets]);

  // Fit the full arrangement once; seeking, speed and hand changes keep keys in place.
  const midiRange = useMemo(
    () => settings.showAllKeys
      ? { lowMidi: 21, highMidi: 108 }
      : passageMidiRange(resolveTimedNotes(guidanceData, 1, settings.transpose)),
    [guidanceData, settings.showAllKeys, settings.transpose],
  );

  // Engine lifecycle: one PlaybackEngine per mount, disposed on unmount.
  useEffect(() => {
    if (!settingsRestored) return;
    const previous = audioSwapStateRef.current;
    audioSwapStateRef.current = null;
    const audio = settings.soundSource === "sampled"
      ? new SamplerAudioEngine()
      : settings.soundSource === "organ"
        ? new OrganAudioEngine(settings.organDrive, settings.organRotary, settings.organStyle, settings.organSpace, settings.organRegistration)
        : new AudioEngine();
    const engine = new PlaybackEngine(
      audio,
      notes,
      duration,
      {
        tempoBpm: activeData.tempoBpm,
        timeSig: activeData.timeSig,
        measureStarts: navigationMeasures.map((measure) => measure.startBeat),
      },
      settings,
      audioChords,
      guidanceNotes,
    );
    engine.onChange = (snap) => {
      // Per-frame updates go to a ref consumed by the canvas rAF loop.
      // React state changes are reserved for discrete events (play/pause,
      // seek, grading start/finish), which call the setters directly.
      timeRef.current = snap.time;
      playingRef.current = snap.playing;
      if (gradingRef.current && !engine.grader && engine.gradeResult) {
        storeAttemptEndRef.current("completed", engine.gradeResult);
        gradingRef.current = false;
        setGrading(false);
        setWaitMode(false);
        setGradeResult(engine.gradeResult);
        setTime(engine.time);
        setPlaying(false);
        releaseMicrophone();
      }
    };
    audio.onStateChange = state => {
      if (engineRef.current === engine && state !== "running" && (gradingRef.current || engine.playing || countInRef.current !== null)) interruptRef.current("Audio output was interrupted.");
    };
    engineRef.current = engine;
    if (audio instanceof SamplerAudioEngine) {
      audio.samplePolicy = samplePolicyRef.current;
      const refresh = () => { if (engineRef.current === engine) setSampleStatus({ readiness: audio.readiness, timbre: audio.playbackTimbre, latencyMs: audio.loadLatencyMs }); };
      audio.onReadinessChange = refresh; refresh();
      audio.ensure(false);
    }
    setEngineReady(true);
    if (previous) {
      engine.seek(previous.time);
      if (previous.playing) engine.start();
      setTime(engine.time);
      setPlaying(engine.playing);
    }
    return () => {
      audioSwapStateRef.current = { time: engine.time, playing: engine.playing };
      keyboardInputRef.current?.releaseAll(); midiInputRef.current?.releaseAll(); heldInputRef.current?.releaseAll();
      engineRef.current = null;
      audio.onStateChange = null;
      if (audio instanceof SamplerAudioEngine) audio.onReadinessChange = null;
      engine.audio.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsRestored, settings.soundSource, settings.organStyle, settings.organRegistration, activeData.tempoBpm]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const speedChanged = engine.settings.speed !== settings.speed;
    const position = engine.time * engine.settings.speed / settings.speed;
    const wasPlaying = engine.playing;
    // Seconds change with speed; the musical beat must not. Install the new
    // timeline before seeking so the old duration cannot clamp the position.
    if (speedChanged) engine.stop();
    engine.setSettings(settings);
    engine.setTimeline(notes, duration, audioChords, guidanceNotes);
    engine.setLoop(loop);
    if (speedChanged) {
      engine.seek(position);
      if (wasPlaying) engine.start();
      syncTransportState();
    }
  }, [audioChords, duration, guidanceNotes, loop, notes, settings]);

  // Discrete events (play/pause/seek) still update React state so buttons
  // and progress bar re-render; per-frame engine ticks only touch refs.
  function syncTransportState() {
    if (!engineRef.current) return;
    timeRef.current = engineRef.current.time;
    playingRef.current = engineRef.current.playing;
    setTime(timeRef.current);
    setPlaying(playingRef.current);
  }

  useEffect(() => {
    engineRef.current?.setWaitMode(waitMode);
  }, [waitMode]);

  // Main rAF loop. The engine owns playback state; this just feeds it dt.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    // React-rendered transport UI (progress bar, timer, chord/section
    // highlights) refreshes at 10Hz; the canvas reads the live ref at 60fps.
    let lastSync = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const eng = engineRef.current;
      if (!eng) return;
      if (eng.audio.state && eng.audio.state !== "running") { interruptRef.current("Audio output was interrupted."); return; }
      eng.tick(dt);
      if (now - lastSync >= 100) {
        lastSync = now;
        setTime(eng.time);
      }
      if (eng.playing) {
        raf = requestAnimationFrame(tick);
      } else {
        // PlaybackEngine stops and seeks to zero when a song reaches its end.
        // Mirror that terminal state in React so the canvas animation loop is
        // also torn down instead of continuing after transport has stopped.
        setPlaying(false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const startPlayback = useCallback(() => {
    if (!engineRef.current || auxiliaryRef.current || chordPracticeActive || showPracticeSetupRef.current || countInRef.current !== null || (gradingRef.current && practiceSetupRef.current.wait)) return;
    cancelSoundPreview();
    heldInputRef.current?.releaseAll();
    engineRef.current?.start();
    if (!engineRef.current?.playing && engineRef.current?.audio instanceof SamplerAudioEngine) setPracticeError("Piano samples are not ready. Wait or choose synthesis fallback in Sound.");
    syncTransportState();
    void fetch(`/api/songs/${encodeURIComponent(initial.song.id)}/play`, { method: "POST" }).catch(() => {});
  }, [chordPracticeActive, initial.song.id]);

  const stopPlayback = useCallback(() => {
    cancelSoundPreview();
    engineRef.current?.stop();
    syncTransportState();
  }, [cancelSoundPreview]);

  const seek = useCallback((t: number) => {
    if (auxiliaryRef.current || gradingRef.current || showPracticeSetupRef.current) return;
    cancelSoundPreview();
    engineRef.current?.seek(t);
    setSeekVersion(version => version + 1);
    syncTransportState();
  }, [cancelSoundPreview]);

  function togglePlay() {
    if (playing) stopPlayback();
    else startPlayback();
  }
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  usePianoInput({ keyboardRef: keyboardInputRef, midiRef: midiInputRef,
    onNote: handleNote, onOctaveChange: setInputOctave,
    onPedal: (down, scope, event) => {if(!takeInputRef.current?.pedal(scope,event))heldInputRef.current?.setPedal(scope,down);},
    onRelease: () => {takeInputRef.current?.interrupt();heldInputRef.current?.releaseAll();if(chordPracticeRef.current instanceof HeldChordGrader){chordPracticeRef.current.clearKeys();setChordPracticeSnapshot(chordPracticeRef.current.snapshot());}},
    onInterrupt: reason => interruptRef.current(reason),
    onState: (devices, count) => {
      setMidiConnected(count > 0);
      setMidiDevices(current => JSON.stringify(devices) === JSON.stringify(current) ? current : devices);
      if(!count)takeInputRef.current?.interrupt();
      if (!count && gradingRef.current && practiceSetupRef.current.input === "midi") interruptRef.current("Selected MIDI input disconnected.");
    },
    onKey: (e, ki) => {
      if (isNativeKeyboardEvent(e)) return;
      if (showPracticeSetupRef.current || toolOpenRef.current || showDownloadRef.current) return;
      if (e.key === "Escape") {
        if (showModeMenuRef.current) {
          setShowModeMenu(false);
          window.requestAnimationFrame(() => modeMenuTriggerRef.current?.focus());
        }
      } else if (e.key === " " && e.type === "keydown") {
        // Space = play/pause, but never hijack typing or focused controls.
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.tagName === "BUTTON" || t.isContentEditable)) return;
        e.preventDefault();
        togglePlayRef.current();
      } else {
        const t = e.target as HTMLElement | null;
        const tagName = t?.tagName;
        if (toolOpenRef.current || showDownloadRef.current || t?.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || tagName === "BUTTON" || tagName === "A") return;
        if (chordPracticeActiveRef.current) {
          // Chord practice shortcuts
          if (e.key === "n" || e.key === "N") {
            e.preventDefault();
            skipChordPracticeRef.current?.();
          } else if (e.shiftKey && e.key.toLowerCase() === "h") {
            e.preventDefault();
            hearChordPracticeRef.current?.();
          } else ki.handleKey(e);
        } else {
          ki.handleKey(e);
        }
      }
    },
  });

  // Outside-click closes the mode menu.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (showModeMenu && modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        const hadFocus = modeMenuRef.current.contains(document.activeElement);
        setShowModeMenu(false);
        if (hadFocus) window.requestAnimationFrame(() => modeMenuTriggerRef.current?.focus());
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [showModeMenu]);

  // Reset mode menu index when menu opens/closes.
  useEffect(() => {
    if (!showModeMenu) {
      setModeMenuIdx(-1);
    } else {
      const selectedIndex = MODES.findIndex((m) => m.id === settings.mode);
      setModeMenuIdx(selectedIndex);
      const frame = window.requestAnimationFrame(() => {
        const item = MODES[selectedIndex];
        if (item) document.getElementById(`mode-menu-${item.id}`)?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [showModeMenu, settings.mode]);

  function focusModeMenuItem(index: number) {
    const nextIndex = (index + MODES.length) % MODES.length;
    setModeMenuIdx(nextIndex);
    const item = MODES[nextIndex];
    if (item) window.requestAnimationFrame(() => document.getElementById(`mode-menu-${item.id}`)?.focus());
  }

  function handleModeMenuKey(e: React.KeyboardEvent) {
    if (!showModeMenu) return;
    const len = MODES.length;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusModeMenuItem(modeMenuIdx + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusModeMenuItem(modeMenuIdx - 1);
        break;
      case "Home":
        e.preventDefault();
        focusModeMenuItem(0);
        break;
      case "End":
        e.preventDefault();
        focusModeMenuItem(len - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (modeMenuIdx >= 0) {
          const m = MODES[modeMenuIdx]!;
          modeMenuTriggerRef.current?.focus();
          updateSettings({ mode: m.id });
          setShowModeMenu(false);
          const modePath = m.id === "falling" ? "" : `/${m.id}`;
          window.history.replaceState(null, "", `/player/${encodeURIComponent(initial.song.id)}${modePath}`);
        }
        break;
      case "Escape":
        e.preventDefault();
        setShowModeMenu(false);
        modeMenuTriggerRef.current?.focus();
        break;
    }
  }

  async function connectMidi() {
    const input = midiInputRef.current;
    if (!input || midiPending) return;
    setMidiPending(true); setMidiError("");
    const connected = await input.connect();
    if (midiInputRef.current !== input) return;
    setMidiPending(false); setMidiConnected(input.connectedCount > 0); setMidiDevices(input.devices);
    if (!connected) setMidiError("No MIDI keyboard available. Check its connection and browser permission, then retry.");
  }

  useEffect(() => {
    keyboardInputRef.current?.releaseAll(); midiInputRef.current?.releaseAll(); heldInputRef.current?.releaseAll();
  }, [openTool, showPracticeSetup, settings.soundSource, settings.organStyle, settings.organRegistration, grading]);

  function handleNote(midi: number, on: boolean, source: "keyboard" | "midi" = "keyboard", identity = `${source}:${midi}`, event?: InputEventMetadata) {
    if(auxiliaryRef.current==="rhythm"||takeInputRef.current?.note(midi,on,source,identity,event))return;
    const heldChord=chordPracticeRef.current instanceof HeldChordGrader?chordPracticeRef.current:null;
    if (!on) {
      if(heldChord && source===heldChordInputRef.current?.input){if(event?.timingSource==="event")heldChord.release(identity,event.timestampMs);else heldChord.clearKeys();setChordPracticeSnapshot(heldChord.snapshot());}
      if(source==="midi"&&practiceSetupRef.current.articulation)engineRef.current?.observeKeyRelease(identity,event); heldInputRef.current?.release(identity); return; }
    if (showPracticeSetupRef.current || toolOpenRef.current || countInRef.current !== null || (gradingRef.current && practiceSetupRef.current.input !== source)) return;
    if(heldChord && source===heldChordInputRef.current?.input && event?.timingSource==="event"){heldChord.press(midi,identity,event.timestampMs);setChordPracticeSnapshot(heldChord.snapshot());}
    if (heldInputRef.current?.press(identity, midi, event)) {
      if(source==="midi"&&practiceSetupRef.current.articulation)engineRef.current?.observeKeyPress(identity,event,gradedInputOffsetRef.current);
      syncTransportState();
    }
  }

  function soundInputNote(midi: number, event?: InputEventMetadata): boolean {
    const eng = engineRef.current;
    const timing = liveTimingRef.current;
    const binding = event?.deviceId ? (event.deviceId === timing.selection.device ? effectiveTimingBinding("midi") : "") : event ? effectiveTimingBinding("keyboard") : "";
    if (!eng || !eng.handleNoteOn(midi, event, gradingRef.current ? gradedInputOffsetRef.current : binding ? loadTimingCalibration(binding) ?? 0 : 0)) return false;
    if (chordPracticeRef.current instanceof ChordGrader) {
      chordPracticeRef.current.play(midi);
      setChordPracticeSnapshot(chordPracticeRef.current.snapshot());
    }
    setPressedKeys(current => new Map(current).set(midi, performance.now()));
    return true;
  }

  function releaseMicrophone() {
    micRequestRef.current++;
    micCleanupRef.current?.();
    micCleanupRef.current = null;
    setMicReady(false);
    setMicPending(false);
  }

  async function enableMicrophone() {
    if (micPending || micReady) return;
    const request = ++micRequestRef.current;
    setMicPending(true);
    setMicError("");
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not support microphone capture.");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (request !== micRequestRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      let raf = 0;
      let lastMidi: number | null = null;
      let lastFire = 0;
      let lastSignalUpdate = 0;
      const tick = () => {
        if (request !== micRequestRef.current) return;
        analyser.getFloatTimeDomainData(buffer);
        const midi = detectPitch(buffer, ctx!.sampleRate);
        const now = performance.now();
        if (now - lastSignalUpdate >= 250) {
          lastSignalUpdate = now;
          const rms = Math.sqrt(buffer.reduce((sum, value) => sum + value * value, 0) / buffer.length);
          setMicSignal(rms < 0.01 ? "Quiet / no reliable pitch" : midi === null ? "Signal present; pitch unresolved" : "Single pitch detected (beta)");
        }
        const edge = microphonePitchEdge(midi, lastMidi, now - lastFire);
        lastMidi = edge.lastMidi;
        if (edge.fire && midi !== null) {
          lastFire = now;
          if (gradingRef.current && countInRef.current === null && practiceSetupRef.current.input === "microphone") {
            engineRef.current?.handleMicNote(midi);
            syncTransportState();
          }
        }
        raf = requestAnimationFrame(tick);
      };
      micCleanupRef.current = () => {
        cancelAnimationFrame(raf);
        stream?.getTracks().forEach((track) => track.stop());
        void ctx?.close();
      };
      stream.getTracks().forEach((track) => track.addEventListener("ended", () => {
        if (request !== micRequestRef.current) return;
        releaseMicrophone();
        setMicError("Microphone disconnected.");
        if (gradingRef.current) interruptRef.current("Microphone disconnected; this run is incomplete.");
      }, { once: true }));
      raf = requestAnimationFrame(tick);
      setMicReady(true);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      void ctx?.close();
      if (request === micRequestRef.current) setMicError(`Microphone unavailable: ${error instanceof Error ? error.message : "permission denied"}`);
    } finally {
      if (request === micRequestRef.current) setMicPending(false);
    }
  }

  function cancelCountIn() {
    if (countInTimerRef.current !== null) clearTimeout(countInTimerRef.current);
    countInTimerRef.current = null;
    countInRef.current = null;
    setCountIn(null);
    engineRef.current?.audio.cancelAll();
  }

  useEffect(() => () => {
    if (countInTimerRef.current !== null) clearTimeout(countInTimerRef.current);
    micRequestRef.current++;
    micCleanupRef.current?.();
  }, []);

  function toggleLoop() {
    if (gradingRef.current) return;
    if (loop) {
      setLoopBeats(null);
      setLoopDraft(null);
      return;
    }
    loopCurrentBars(4);
  }

  function loopCurrentBars(count: number) {
    if (gradingRef.current) return;
    const start = navigationMeasures[currentMeasure];
    const end = navigationMeasures[Math.min(navigationMeasures.length - 1, currentMeasure + count - 1)];
    if (start && end) { setLoopBeats({ startBeat: start.startBeat, endBeat: end.endBeat }); setLoopDraft(null); }
  }

  function seekToSection(s: SongSection) {
    seek(s.startBeat * secPerBeat(activeData.tempoBpm, settings.speed));
  }

  function loopSection(s: SongSection) {
    if (gradingRef.current) return;
    setLoopBeats({ startBeat: s.startBeat, endBeat: s.endBeat });
    setLoopDraft(null);
  }

  const loopStartBar = loopBeats ? Math.max(0, navigationMeasures.findIndex((m) => m.endBeat > loopBeats.startBeat)) + 1 : currentMeasure + 1;
  const loopEndBar = loopBeats ? Math.max(0, navigationMeasures.findIndex((m) => m.endBeat >= loopBeats.endBeat)) + 1 : Math.min(navigationMeasures.length, currentMeasure + 4);
  const draftLoopBeats = loopDraft ? loopFromBars(Number(loopDraft.start), Number(loopDraft.end), navigationMeasures) : null;
  function editLoopBar(anchor: "start" | "end", value: string) {
    setLoopDraft(previous => ({ start: previous?.start ?? String(loopStartBar), end: previous?.end ?? String(loopEndBar), [anchor]: value }));
  }
  function applyLoopDraft() {
    if (gradingRef.current || !draftLoopBeats) return;
    setLoopBeats(draftLoopBeats);
    setLoopDraft(null);
  }

  function toggleFavorite() {
    const id = initial.song.id;
    const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
    setFavorites(next);
    saveJson("keyspilli.favorites", next);
  }

  function toggleLearned() {
    const id = initial.song.id;
    const next = learned.includes(id) ? learned.filter((f) => f !== id) : [...learned, id];
    setLearned(next);
    saveJson("keyspilli.learned", next);
  }

  function stopSoundPreview() {
    finishSoundPreview("stopped");
  }

  function previewSound(role: MelodyAuditionRole = "full") {
    if(auxiliaryRef.current)return;
    const eng = engineRef.current;
    if (!eng) return;
    const previous = soundPreviewRef.current;
    const restoreTime = previous?.restoreTime ?? eng.time;
    const wasPlaying = previous?.wasPlaying ?? (playing || eng.playing || playingRef.current);
    cancelSoundPreview();
    eng.stop();
    syncTransportState();
    eng.audio.cancelAll();
    eng.audio.ensure();
    heldInputRef.current?.releaseAll();
    if (eng.audio.prepareTimbre?.() === false) { setPracticeError("Piano samples are not ready. Wait or choose synthesis fallback."); return; }
    const secondsPerBeat = secPerBeat(activeData.tempoBpm, settings.speed);
    const previewMeasureIndex = measureIndex(
      eng.time,
      activeData.tempoBpm,
      settings.speed,
      activeData.timeSig,
      navigationMeasures.length,
      navigationMeasures,
    );
    const currentMeasureForPreview = navigationMeasures[previewMeasureIndex];
    const startSec = loop?.startSec ?? (currentMeasureForPreview
      ? currentMeasureForPreview.startBeat * secondsPerBeat
      : eng.time);
    const endSec = loop?.endSec ?? (currentMeasureForPreview
      ? currentMeasureForPreview.endBeat * secondsPerBeat
      : Math.min(duration, eng.time + secondsPerBeat));
    const boundedStartSec = Math.max(0, Math.min(duration, startSec));
    const boundedEndSec = Math.max(boundedStartSec, Math.min(duration, endSec));
    const startBarIndex = navigationMeasures.findIndex((measure) => measure.startBeat <= boundedStartSec / secondsPerBeat
      && boundedStartSec / secondsPerBeat < measure.endBeat);
    const endBarIndex = navigationMeasures.findIndex((measure) => measure.endBeat >= boundedEndSec / secondsPerBeat - 1e-6);
    const rangeLabel = startBarIndex >= 0 && endBarIndex >= 0
      ? startBarIndex === endBarIndex ? `bar ${startBarIndex + 1}` : `bars ${startBarIndex + 1}–${endBarIndex + 1}`
      : "current passage";
    const token = ++soundPreviewTokenRef.current;
    const status: MelodyPreviewStatus = {
      role,
      phase: "playing",
      rangeLabel,
      startSec: boundedStartSec,
      endSec: boundedEndSec,
    };
    const session: SoundPreviewSession = {
      ...status,
      token,
      restoreTime,
      wasPlaying,
      timer: null,
    };
    soundPreviewRef.current = session;
    setSoundPreviewStatus(status);
    const preview = role === "full"
      ? eng.previewPlan(boundedStartSec, boundedEndSec)
      : (() => {
        const auditionNotes = role === "original"
          ? initial.data.notes
          : role === "melody"
            ? melodyArrangement.events.filter((event) => event.role === "melody").map((event) => event.note)
            : auditionNotesForRole(settings.accompanimentStyle, melodyArrangement.events, accompaniment.notes);
        const chords = role === "accompaniment"
          && settings.backgroundMode === "chord"
          && settings.accompanimentStyle === "bass-chords"
          ? eng.previewPlan(boundedStartSec, boundedEndSec).chords
          : [];
        return {
          notes: (role==="original"?resolveSourcePedalNotes:resolveTimedNotes)({ ...activeData, ...(role==="original"?{sourcePedal:initial.data.sourcePedal}:{}), notes: auditionNotes }, settings.speed, settings.transpose)
            .filter((note) => noteMatchesHand(note, settings.hand) && Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127)
            .flatMap((note) => {
              const noteEnd = note.startSec + (note.soundingDurSec ?? note.durSec);
              const visibleStart = Math.max(boundedStartSec, note.startSec);
              const visibleEnd = Math.min(boundedEndSec, noteEnd);
              return visibleEnd > visibleStart + 1e-6
                ? [{ when: visibleStart - boundedStartSec, note: { ...note, startSec: visibleStart - boundedStartSec, durSec: visibleEnd - visibleStart } }]
                : [];
            }),
          chords,
        };
      })();
    for (const { note, when } of preview.notes) eng.audio.noteOn(note, when);
    if ((role === "full" || role === "accompaniment") && settings.backgroundMode === "chord" && eng.audio.playChord) {
      for (const chord of preview.chords) eng.audio.playChord(chord.notes, chord.when, chord.durationSec);
    }
    session.timer = setTimeout(() => {
      const active = soundPreviewRef.current;
      if (!active || active.token !== token) return;
      finishSoundPreview("complete");
    }, Math.max(50, (boundedEndSec - boundedStartSec) * 1000 + PREVIEW_TAIL_MS));
  }

  function updateSettings(p: Partial<PlayerSettings>) {
    if (gradingRef.current && (p.speed !== undefined || p.hand !== undefined || p.transpose !== undefined || p.soundSource !== undefined || p.organStyle !== undefined || p.organRegistration !== undefined || p.backgroundMode !== undefined || p.accompanimentStyle !== undefined || p.physicalKeyboard !== undefined || p.audibleSupport !== undefined || p.renderedExpression !== undefined)) return;
    if (p.mode !== undefined && p.mode !== settings.mode) {
      if (gradingRef.current) finishGrading(false);
      releaseMicrophone();
      cancelCountIn();
      setShowPracticeSetup(false);
    }
    if (p.speed !== undefined || p.hand !== undefined || p.transpose !== undefined || p.physicalKeyboard !== undefined) {
      setGradeResult(null);
      lastAttemptRef.current = null;
      if (engineRef.current) engineRef.current.gradeResult = null;
    }
    if (p.backgroundMode === "chord" && initial.chordUnavailableReason) return;
    if (p.accompanimentStyle === "melody-accompaniment" && sourceBackingNotes) return;
    const next = { ...settings, ...p };
    if (p.speed !== undefined || p.hand !== undefined || p.transpose !== undefined || p.backgroundMode !== undefined || p.accompanimentStyle !== undefined || p.audibleSupport !== undefined || p.renderedExpression !== undefined) activeTempoPlanRef.current = null;
    if (p.transpose !== undefined) next.transpose = Number.isFinite(p.transpose)
      ? Math.max(TRANSPOSE_MIN, Math.min(TRANSPOSE_MAX, Math.trunc(p.transpose))) : settings.transpose;
    if (next.backgroundMode === "chord" && sourceBackingNotes) next.accompanimentStyle = "bass-chords";
    setSettings(next);
    engineRef.current?.audio.setGains(next.voiceGain, next.pianoGain);
    // The timeline effect needs the old speed to preserve the musical position.
    if (p.accompanimentStyle !== undefined) saveAccompanimentStyleIntent(p.accompanimentStyle);
    saveSettings(next);
    if (p.stageTheme !== undefined) applyAppTheme(next.stageTheme);
    // Persist practice-relevant settings per song so switching songs restores them.
    saveSongPrefs(initial.song.id, {
      speed: next.speed,
      transpose: next.transpose,
      mode: next.mode,
      hand: next.hand,
    });
  }

  function updateChordSource(source: ChordSourceId) {
    if (gradingRef.current) return;
    setChordSourcePreference(source);
    saveJson("keyspilli.chordSource", source);
  }

  function updateMelodySelection(selection: MelodySelection) {
    setMelodySelection(selection);
    if (melodySourceFingerprint) {
      saveJson(melodySelectionKey(initial.song.id), {
        schemaVersion: 2,
        generatorVersion: "melody-accompaniment.v2",
        sourceFingerprint: melodySourceFingerprint,
        selection,
        sourceBackingMode: melodySourceBackingMode,
        phraseOverrides: melodyPhraseOverrides,
        // The cached provenance is informational only; the current producer
        // result is recomputed by the sync or worker path for this selection.
        provenance: { ...melodyArrangement.provenance, selection, selectionProvenance: "user-confirmed", sourceBackingMode: melodySourceBackingMode === "conservative" ? "conservative" : undefined },
      } satisfies MelodySelectionSidecar);
      setMelodySelectionSaved(true);
    }
  }

  function updateSourceBackingMode(sourceBackingMode: SourceBackingMode) {
    setMelodySourceBackingMode(sourceBackingMode);
    if (melodySourceFingerprint) {
      saveJson(melodySelectionKey(initial.song.id), {
        schemaVersion: 2,
        generatorVersion: "melody-accompaniment.v2",
        sourceFingerprint: melodySourceFingerprint,
        selection: melodySelection,
        sourceBackingMode,
        phraseOverrides: melodyPhraseOverrides,
        provenance: { ...melodyArrangement.provenance, sourceBackingMode: sourceBackingMode === "conservative" ? "conservative" : undefined },
      } satisfies MelodySelectionSidecar);
      setMelodySelectionSaved(true);
    }
  }

  function updateMelodyPhraseOverride(action: MelodyPhraseOverrideAction) {
    const phrase = activeMelodyPhrase;
    if (!phrase || !melodySourceFingerprint) return;
    const ids = sourceNoteIds(activeData.notes);
    const sourceIndexById = new Map(ids.map((id, index) => [id, index]));
    const overlapsActivePhrase = (override: MelodyPhraseOverride) =>
      Number.isFinite(override.startBeat) && Number.isFinite(override.endBeat)
      && override.endBeat > override.startBeat + 1e-7
      && override.startBeat < phrase.endBeat - 1e-7
      && override.endBeat > phrase.startBeat + 1e-7;
    const sourceIdsInRange = (override: MelodyPhraseOverride, startBeat: number, endBeat: number) => override.sourceNoteIds.filter((id) => {
      const sourceIndex = sourceIndexById.get(id);
      if (sourceIndex === undefined) return false;
      const note = activeData.notes[sourceIndex];
      return note !== undefined && note.start >= startBeat - 1e-7 && note.start < endBeat - 1e-7;
    });
    const splitOverrideAroundPhrase = (override: MelodyPhraseOverride): MelodyPhraseOverride[] => {
      const ranges = [
        { startBeat: override.startBeat, endBeat: Math.min(override.endBeat, phrase.startBeat) },
        { startBeat: Math.max(override.startBeat, phrase.endBeat), endBeat: override.endBeat },
      ].filter(({ startBeat, endBeat }) => endBeat > startBeat + 1e-7);
      return ranges.map(({ startBeat, endBeat }) => ({
        ...override,
        startBeat,
        endBeat,
        sourceNoteIds: sourceIdsInRange(override, startBeat, endBeat),
      }));
    };
    const nextOverrides = melodyPhraseOverrides.flatMap((override) =>
      overlapsActivePhrase(override) ? splitOverrideAroundPhrase(override) : [override],
    );
    if (action !== "automatic") {
      const sourceIndices = activeData.notes.map((note, index) => ({ note, index }))
        .filter(({ note }) => note.start >= phrase.startBeat - 1e-7 && note.start < phrase.endBeat - 1e-7);
      const selectedIds = action === "rest"
        ? []
        : sourceIndices
          .filter(({ note }) => note.hand === (action === "right-hand" ? "R" : "L"))
          .map(({ index }) => ids[index]!);
      if (action !== "rest" && selectedIds.length === 0) return;
      nextOverrides.push({
        startBeat: phrase.startBeat,
        endBeat: phrase.endBeat,
        sourceNoteIds: selectedIds,
        sourceFingerprint: melodySourceFingerprint,
      });
      nextOverrides.sort((a, b) => a.startBeat - b.startBeat || a.endBeat - b.endBeat);
    }
    setMelodyPhraseOverrides(nextOverrides);
    if (melodySourceFingerprint) {
      saveJson(melodySelectionKey(initial.song.id), {
        schemaVersion: 2,
        generatorVersion: "melody-accompaniment.v2",
        sourceFingerprint: melodySourceFingerprint,
        selection: melodySelection,
        sourceBackingMode: melodySourceBackingMode,
        phraseOverrides: nextOverrides,
        // Phrase choices are user-selected source candidates, not melody proof.
        provenance: { ...melodyArrangement.provenance, selectionProvenance: "user-confirmed", sourceBackingMode: melodySourceBackingMode === "conservative" ? "conservative" : undefined },
      } satisfies MelodySelectionSidecar);
      setMelodySelectionSaved(true);
    }
  }

  function resetMelodySelection() {
    setMelodySelection("automatic");
    setMelodySourceBackingMode("default");
    setMelodyPhraseOverrides([]);
    setMelodySelectionSaved(false);
    try {
      localStorage.removeItem(melodySelectionKey(initial.song.id));
      localStorage.removeItem(legacyMelodySelectionKey(initial.song.id));
    } catch { /* unavailable storage */ }
  }

  function toggleSectionsCollapsed() {
    setSectionsCollapsed((v) => {
      saveJson("keyspilli.sectionsCollapsed", !v);
      return !v;
    });
  }

  function toggleFullWidth() {
    setFullWidth((v) => {
      saveJson("keyspilli.fullWidth", !v);
      return !v;
    });
  }

  function openPracticeSetup(scope?:PracticeSetup["scope"]) {
    if(auxiliaryRef.current)return;
    cancelSoundPreview();
    if (chordPracticeActive) exitChordPractice(false);
    engineRef.current?.stop();
    syncTransportState();
    setOpenTool(null);
    setShowModeMenu(false);
    setPracticeError("");
    setMicError("");
    repeatRangeRef.current = null;
    setPracticeSetup(scope ? {...defaultPracticeSetup,scope} : activeTempoPlanRef.current ? { ...defaultPracticeSetup, scope: "loop", wait: false } : defaultPracticeSetup);
    showPracticeSetupRef.current = true;
    setShowPracticeSetup(true);
  }

  function closePracticeSetup() {
    revealRecall();
    releaseMicrophone();
    showPracticeSetupRef.current = false;
    setShowPracticeSetup(false);
    window.requestAnimationFrame(() => practiceTriggerRef.current?.focus());
  }

  function practiceKeyboardTarget(setup: PracticeSetup, repeatRange?: LoopRegion) {
    const range = repeatRange ?? (repeatRangeRef.current && setup.scope === practiceSetupRef.current.scope ? repeatRangeRef.current : null) ??
      resolvePracticeRange(setup.scope, navigationMeasures, currentMeasure, engineRef.current?.time ?? time, duration, activeData.tempoBpm, settings.speed, loop);
    return keyboardReachability(guidanceNotes, range ?? {startSec:0,endSec:0}, .25*secPerBeat(activeData.tempoBpm,settings.speed), midiRange, setup.input === "keyboard" ? null : settings.physicalKeyboard ?? null);
  }

  function selectSavedPassage(passage: SavedPassage) {
    if (!practiceTarget || gradingRef.current || !passageAvailable(passage, practiceTarget, duration / secPerBeat(activeData.tempoBpm, settings.speed))) return false;
    selectedPassageIdRef.current = passage.id;
    engineRef.current?.stop();
    setLoopBeats({ startBeat: passage.startBeat, endBeat: passage.endBeat });
    seek(passage.startBeat * secPerBeat(activeData.tempoBpm, settings.speed));
    syncTransportState();
    return true;
  }

  function beginPractice(setup: PracticeSetup, repeatRange?: LoopRegion) {
    const eng = engineRef.current;
    if (!eng || gradingRef.current || (setup.input === "microphone" && !micReady) || (setup.input === "midi" && !midiConnected)) return;
    const range = repeatRange ?? (repeatRangeRef.current && setup.scope === practiceSetupRef.current.scope ? repeatRangeRef.current : null) ??
      resolvePracticeRange(setup.scope, navigationMeasures, currentMeasure, eng.time, duration, activeData.tempoBpm, settings.speed, loop);
    if (!range) { setPracticeError(setup.scope === "loop" ? "Select a loop before practicing it." : "No measured passage is available here."); return; }
    const recallRange=recall && loadPracticeState().passages.some(p=>p.id===recall.passage.id&&p.target.fingerprint===recall.passage.target.fingerprint&&p.startBeat===recall.passage.startBeat&&p.endBeat===recall.passage.endBeat) && recall.passage.target.fingerprint===practiceTarget?.fingerprint && settings.mode==="beginner" && settings.backgroundMode==="piano" && Math.abs(range.startSec/secPerBeat(activeData.tempoBpm,settings.speed)-recall.passage.startBeat)<1e-6 && Math.abs(range.endSec/secPerBeat(activeData.tempoBpm,settings.speed)-recall.passage.endBeat)<1e-6;
    if(recall && (!recallRange || !recall.demonstrated)){setPracticeError("Demonstrate the exact saved recall passage, then choose Selected loop (once).");return;}
    const reach = practiceKeyboardTarget(setup, range);
    if ((reach.overflow || reach.physicalUnavailable) && !setup.allowUnsupportedRange) { setPracticeError("Review the targets outside your keyboard range before starting."); return; }
    if (setup.input === "microphone") {
      const eligibility = microphoneEligibility(guidanceNotes, range);
      if (!eligibility.eligible) { setPracticeError(eligibility.reason); return; }
    }
    cancelSoundPreview();
    heldInputRef.current?.releaseAll();
    gradedInputOffsetRef.current=setup.input==="microphone"?0:loadTimingCalibration(effectiveTimingBinding(setup.input))??0;
    if(setup.articulation&&(setup.input!=="midi"||setup.wait||!midiSelection.device||midiSelection.channel===null)){setPracticeError("Hold/release assessment requires timed practice on one selected MIDI device and channel.");return;}
    try { eng.startGrading(setup.wait, range, setup.articulation?setup.articulationToleranceMs??150:undefined); }
    catch (error) { setPracticeError(error instanceof Error ? error.message : "Unable to start practice"); return; }
    gradedTimingRef.current = { bpm: activeData.tempoBpm, speed: settings.speed };
    const tempoPassage = loadPracticeState().passages.find(p => p.id === activeTempoPlanRef.current?.passageId);
    const tempoPlan = tempoPassage?.tempoPlan;
    const planContext = tempoPassage && tempoPlan && !tempoPlan.paused && tempoPlan.status === "active" && tempoPlan.policyId === activeTempoPlanRef.current?.policyId
      && tempoPassage.target.fingerprint === practiceTarget?.fingerprint && tempoPassage.target.variantId === initial.song.id
      && Math.abs(range.startSec/secPerBeat(activeData.tempoBpm,settings.speed)-tempoPassage.startBeat)<1e-6
      && Math.abs(range.endSec/secPerBeat(activeData.tempoBpm,settings.speed)-tempoPassage.endBeat)<1e-6
      && Math.abs(activeData.tempoBpm*settings.speed-tempoPlan.currentBpm)<1e-6 ? activeTempoPlanRef.current! : null;
    if (practiceTarget) {
      const spb = secPerBeat(activeData.tempoBpm, settings.speed);
      const attempt: PracticeAttempt = {
        id: crypto.randomUUID(), target: practiceTarget, startBeat: range.startSec / spb, endBeat: range.endSec / spb,
        startedAt: new Date().toISOString(), finishedAt: null, outcome: "incomplete", countInCompleted: false, result: null,
        context: { mode: settings.mode, difficulty: initial.song.difficulty, input: setup.input, wait: setup.wait,
          speed: settings.speed, transpose: settings.transpose, hand: settings.hand, soundSource: settings.soundSource,
          backgroundMode: settings.backgroundMode, accompanimentStyle: settings.accompanimentStyle, bpm: activeData.tempoBpm,
          timingCalibrationMs: setup.input === "microphone" ? null : effectiveTimingBinding(setup.input) ? loadTimingCalibration(effectiveTimingBinding(setup.input)) : null,
          assessment:setup.articulation?"key-hold":"onset", articulationToleranceMs:setup.articulation?setup.articulationToleranceMs??150:undefined, renderedExpression: settings.renderedExpression ?? "source", audibleSupport: settings.audibleSupport ?? false, physicalKeyboard: settings.physicalKeyboard ?? null, rangeAcknowledged: setup.allowUnsupportedRange ?? false,
          effectiveTimbre: eng.audio instanceof SamplerAudioEngine ? eng.audio.playbackTimbre : settings.soundSource,
          ...(recallRange?{assistance:{mode:recall.reduced?"reduced-pitch" as const:"guided" as const,passageId:recall.passage.id,reveals:0,review:"owner-confirmed-trial" as const}}:{}),
          ...(planContext && !recallRange ? { tempoPlan: planContext } : {}),
          midiDevice: setup.input === "midi" ? midiSelection.device : null, midiChannel: setup.input === "midi" ? midiSelection.channel : null },
      };
      storedAttemptRef.current = attempt;
      const saved = recordAttempt(attempt);
      const state = loadPracticeState();
      const passage = state.passages.find(p => p.id === (selectedPassageIdRef.current ?? state.resume?.passageId) && passageAvailable(p, practiceTarget, duration / spb)
        && Math.abs(p.startBeat - attempt.startBeat) < 1e-6 && Math.abs(p.endBeat - attempt.endBeat) < 1e-6);
      state.resume = { target: practiceTarget, positionBeat: attempt.startBeat, updatedAt: attempt.startedAt, ...(passage ? {passageId: passage.id} : {}) };
      if (!savePracticeState(state) || !saved) setPracticeSaveNotice("Practice history could not be saved. Browser storage may be unavailable or full.");
    } else setPracticeSaveNotice("This run has no saved history; its arrangement could not yet be checked.");
    setGradeResult(null);
    setPracticeError("");
    setPracticeSetup(setup);
    practiceSetupRef.current = setup;
    lastAttemptRef.current = { setup, range: eng.gradingRange! };
    repeatRangeRef.current = null;
    showPracticeSetupRef.current = false;
    setShowPracticeSetup(false);
    gradingRef.current = true;
    setGrading(true);
    setWaitMode(setup.wait);
    syncTransportState();
    const ready = () => {
      if (storedAttemptRef.current) {
        storedAttemptRef.current.countInCompleted = true;
        if (!recordAttempt(storedAttemptRef.current)) setPracticeSaveNotice("Practice history could not be saved.");
      }
      countInRef.current = null;
      countInTimerRef.current = null;
      setCountIn(null);
      if (!setup.wait) { eng.start(); syncTransportState(); }
      // React must unmount the modal before the stage ceases to be inert.
      window.requestAnimationFrame(() => {
        if (gradingRef.current && countInRef.current === null) document.querySelector<HTMLElement>(".player-stage")?.focus();
      });
    };
    if (setup.countInBeats === 4) {
      let remaining = 4;
      const beat = () => {
        countInRef.current = remaining;
        setCountIn(remaining);
        eng.audio.ensure();
        eng.audio.metronomeClick(remaining === 4 ? 0 : 1);
        countInTimerRef.current = setTimeout(() => {
          remaining--;
          if (remaining > 0) beat(); else ready();
        }, secPerBeat(activeData.tempoBpm, settings.speed) * 1000);
      };
      beat();
    } else ready();
  }

  function finishGrading(restoreFocus = true) {
    const wasCounting = countInRef.current !== null;
    gradingRef.current = false;
    cancelCountIn();
    const result = engineRef.current?.finishGrading();
    storeAttemptEnd(wasCounting ? "cancelled" : "incomplete", wasCounting ? null : result ?? null);
    if (!wasCounting && result) setGradeResult(result);
    else setGradeResult(null);
    releaseMicrophone();
    syncTransportState();
    setGrading(false);
    setWaitMode(false);
    if (restoreFocus) window.requestAnimationFrame(() => practiceTriggerRef.current?.focus());
  }

  function repeatPractice() {
    const attempt = lastAttemptRef.current;
    if (!attempt) return;
    cancelSoundPreview();
    if (attempt.setup.input === "keyboard" || (attempt.setup.input === "midi" && midiConnected)) { beginPractice(attempt.setup, attempt.range); return; }
    setPracticeSetup(attempt.setup);
    setPracticeError("");
    repeatRangeRef.current = attempt.range;
    showPracticeSetupRef.current = true;
    setShowPracticeSetup(true);
  }

  function startChordPractice() {
    if(auxiliaryRef.current)return;
    heldChordInputRef.current=null;
    cancelSoundPreview();
    if (gradingRef.current) finishGrading(false);
    releaseMicrophone();
    setGradeResult(null);
    setChordPracticeNotice("");
    engineRef.current?.stop();
    chordPracticeTargetsRef.current = null; // recompute for the new session
    const session = new ChordGrader(chordPracticeTargets);
    chordPracticeRef.current = session;
    setChordPracticeActive(true);
    setChordPracticeSnapshot(session.snapshot());
    syncTransportState();
    setOpenTool(null);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".player-stage")?.focus());
  }

  function chooseChordExercise(exercise:"discovery"|"held"|"transition",windowMs:number,holdMs:number,input:"keyboard"|"midi"){
    if(exercise!=="discovery"&&input==="midi"&&(!midiSelection.device||midiSelection.channel===null)){setChordPracticeNotice("Select one MIDI device and channel first.");return;}
    try{
      keyboardInputRef.current?.releaseAll();midiInputRef.current?.releaseAll();heldInputRef.current?.releaseAll();
      const session=exercise==="discovery"?new ChordGrader(chordPracticeTargets):new HeldChordGrader(chordPracticeTargets,exercise,windowMs,holdMs);
      heldChordInputRef.current={input,binding:JSON.stringify(midiSelection)};chordPracticeRef.current=session;setChordPracticeSnapshot(session.snapshot());
      setChordPracticeNotice(exercise==="discovery"?"Chord-tone discovery restarted.":`Physical ${input} exercise restarted. Exact pitches are owner-selected reference targets; playability is unverified.`);
      window.requestAnimationFrame(()=>document.querySelector<HTMLElement>(".player-stage")?.focus());
    }catch{setChordPracticeNotice("Choose at most 256 bounded voicings and valid rolling/hold durations.");}
  }
  useEffect(()=>{
    if(!chordPracticeActive)return;
    const timer=window.setInterval(()=>{const session=chordPracticeRef.current;if(session instanceof HeldChordGrader){session.tick(performance.now());setChordPracticeSnapshot(session.snapshot());}},50);
    return ()=>window.clearInterval(timer);
  },[chordPracticeActive]);
  useEffect(()=>{
    if(chordPracticeRef.current instanceof HeldChordGrader && heldChordInputRef.current?.input==="midi" && heldChordInputRef.current.binding!==JSON.stringify(midiSelection)){
      chordPracticeRef.current=new ChordGrader(chordPracticeTargets);setChordPracticeSnapshot(chordPracticeRef.current.snapshot());setChordPracticeNotice("MIDI selection changed; held-shape exercise stopped. Confirm the new input and targets again.");
    }
  },[midiSelection,chordPracticeTargets]);

  function exitChordPractice(restoreFocus = true) {
    heldChordInputRef.current=null;
    chordPracticeRef.current = null;
    chordPracticeTargetsRef.current = null;
    setChordPracticeActive(false);
    setChordPracticeSnapshot(null);
    setChordPracticeNotice("");
    if (restoreFocus) window.requestAnimationFrame(() => practiceTriggerRef.current?.focus());
  }

  function skipChordPractice() {
    const session = chordPracticeRef.current;
    if (!session) return;
    session.skip();
    setChordPracticeSnapshot(session.snapshot());
  }

  function hearChordPractice() {
    const target = chordPracticeRef.current?.currentTarget;
    const audio = engineRef.current?.audio;
    if (!target || !audio?.playChord) return;
    audio.ensure();
    audio.playChord(target.notes, 0, 1.5);
  }

  const waitNotes = grading && waitMode ? engineRef.current?.waitNotes ?? [] : [];
  const activeModeLabel = MODES.find((m) => m.id === settings.mode)?.label ?? settings.mode;
  const chordReviewReason = !sourceBackingNotes && settings.accompanimentStyle === "bass-chords"
    ? selectedChordSource.source?.chords.find(chord => chord.reviewReason)?.reviewReason : undefined;
  const chordModeBadge = settings.backgroundMode !== "chord"
    ? null
    : sourceBackingNotes && settings.accompanimentStyle === "bass-chords"
      ? "Advanced backing pilot"
    : selectedChordSource.source
      ? selectedChordSource.fallback && selectedChordSource.source.id === "generated"
        ? "Chords estimated from notes"
        : selectedChordSource.source.label === "Generated fallback"
          ? "Chords estimated from notes"
          : selectedChordSource.source.label
      : "Piano fallback";
  const currentBeat = time / secPerBeat(activeData.tempoBpm, settings.speed);
  const phraseCounts = melodyArrangement.phrases.reduce(
    (counts, phrase) => {
      counts[phrase.change] += 1;
      if (phrase.review === "needs-review") counts.review += 1;
      return counts;
    },
    { changed: 0, unchanged: 0, review: 0 },
  );
  const activeMelodyPhrase = melodyArrangement.phrases.find((phrase) =>
    currentBeat >= phrase.startBeat - 1e-7 && currentBeat < phrase.endBeat - 1e-7,
  );
  const activePhraseSourceCandidates = useMemo(() => {
    if (!activeMelodyPhrase) return { rightHand: [] as string[], leftHand: [] as string[] };
    const ids = sourceNoteIds(activeData.notes);
    const candidates = { rightHand: [] as string[], leftHand: [] as string[] };
    activeData.notes.forEach((note, index) => {
      if (note.start < activeMelodyPhrase.startBeat - 1e-7 || note.start >= activeMelodyPhrase.endBeat - 1e-7) return;
      const id = ids[index];
      if (!id) return;
      if (note.hand === "R") candidates.rightHand.push(id);
      if (note.hand === "L") candidates.leftHand.push(id);
    });
    return candidates;
  }, [activeMelodyPhrase, activeData.notes]);
  const activePhraseOverrideConflict = useMemo(() => {
    if (!activeMelodyPhrase) return false;
    return melodyPhraseOverrides.some((override) => {
      const exact = Math.abs(override.startBeat - activeMelodyPhrase.startBeat) < 1e-7
        && Math.abs(override.endBeat - activeMelodyPhrase.endBeat) < 1e-7;
      return !exact
        && Number.isFinite(override.startBeat)
        && Number.isFinite(override.endBeat)
        && override.endBeat > override.startBeat + 1e-7
        && override.startBeat < activeMelodyPhrase.endBeat - 1e-7
        && override.endBeat > activeMelodyPhrase.startBeat + 1e-7;
    });
  }, [activeMelodyPhrase, melodyPhraseOverrides]);
  const activePhraseOverrideAction = useMemo<MelodyPhraseOverrideAction | null>(() => {
    if (!activeMelodyPhrase) return null;
    if (activePhraseOverrideConflict) return null;
    const override = melodyPhraseOverrides.find((candidate) =>
      Math.abs(candidate.startBeat - activeMelodyPhrase.startBeat) < 1e-7
      && Math.abs(candidate.endBeat - activeMelodyPhrase.endBeat) < 1e-7,
    );
    if (!override) return "automatic";
    const sourceIndexById = new Map(sourceNoteIds(activeData.notes).map((id, index) => [id, index]));
    const exactOverrideIsValid = override.sourceFingerprint === melodySourceFingerprint
      && Number.isFinite(override.startBeat)
      && Number.isFinite(override.endBeat)
      && new Set(override.sourceNoteIds).size === override.sourceNoteIds.length
      && override.sourceNoteIds.every((id) => {
        const sourceIndex = sourceIndexById.get(id);
        const note = sourceIndex === undefined ? undefined : activeData.notes[sourceIndex];
        return note !== undefined
          && note.start >= activeMelodyPhrase.startBeat - 1e-7
          && note.start < activeMelodyPhrase.endBeat - 1e-7;
      });
    if (!exactOverrideIsValid) return null;
    if (override.sourceNoteIds.length === 0) return "rest";
    if (override.sourceNoteIds.length === activePhraseSourceCandidates.rightHand.length
      && override.sourceNoteIds.every((id) => activePhraseSourceCandidates.rightHand.includes(id))) return "right-hand";
    if (override.sourceNoteIds.length === activePhraseSourceCandidates.leftHand.length
      && override.sourceNoteIds.every((id) => activePhraseSourceCandidates.leftHand.includes(id))) return "left-hand";
    return null;
  }, [activeMelodyPhrase, activePhraseOverrideConflict, activePhraseSourceCandidates, activeData.notes, melodyPhraseOverrides, melodySourceFingerprint]);
  const activeAccompanimentFallback = accompaniment.fallbackSpans.find((span) =>
    currentBeat >= span.startBeat && currentBeat < span.endBeat,
  );
  const accompanimentFallbackDetail = activeAccompanimentFallback
    ? ({
      "no source notes": "no source notes are available here.",
      "unsupported chord": "this chord symbol is not supported.",
      "explicit no-chord": selectedChordSource.source?.chords.find(chord => chord.reviewReason
        && currentBeat >= chord.beat && currentBeat < chord.beat + (chord.durationBeats ?? 0))?.reviewReason
        ?? "this span is marked as no chord.",
      "no chord coverage": "the chord chart does not cover this passage.",
      "accompaniment ownership unavailable": "accompaniment could not be separated reliably.",
      "no owned source notes to replace": "no owned accompaniment notes are available here.",
      "no source notes to replace": "no source notes can be replaced here.",
      "sustained source note crosses accompaniment boundary": "a sustained note crosses this chord boundary.",
      "ambiguous melody": "choose a melody source before replacing this phrase.",
      "right-hand part unavailable": "this source has no right-hand part label.",
      "unverified chord source": "notes-derived harmony is label-only here.",
      "no playable support voicing": "no collision-safe support voicing fits this phrase.",
    } as Record<string, string>)[activeAccompanimentFallback.reason]
    : null;
  const accompanimentFallbackMessage = accompanimentFallbackDetail
    ? settings.accompanimentStyle === "bass-chords"
      ? `Backing unavailable — source melody omitted: ${accompanimentFallbackDetail}`
      : `Original passage retained — ${accompanimentFallbackDetail}`
    : null;
  const accompanimentFallbackSlotMessage = accompanimentFallbackMessage ?? (settings.accompanimentStyle === "bass-chords"
    ? "Backing unavailable — source melody omitted: accompaniment fallback requires review."
    : "Original passage retained — accompaniment fallback requires review.");
  const hasAccompanimentFallbackSlot = settings.backgroundMode === "chord" && accompaniment.fallbackSpans.length > 0;
  const melodyArrangementState = melodyArrangementFailed ? "failed" : melodyArrangementPending ? "pending" : "ready";
  const melodyArrangementOutcomeText = melodyArrangementOutcome(melodyArrangementState, melodyArrangement);
  const melodyArrangementCoverageText = melodyArrangement.provenance.sourceSupportNoteCount > 0
    ? `${melodyArrangement.provenance.sourceSupportNoteCount} source support notes`
    : melodyArrangement.provenance.generatedNoteCount > 0
      ? `${melodyArrangement.provenance.generatedNoteCount} sparse backing notes`
      : "no added support";
  const melodyArrangementStatusText = melodyArrangementState !== "ready"
    ? melodyArrangementOutcomeText
    : `${melodyArrangement.provenance.selectionProvenance === "user-confirmed" ? "User melody" : "Inferred melody"} · whole-part selection · ${melodyArrangementOutcomeText} · ${melodyArrangementCoverageText}`;
  const activeSection = sections.find((s) => {
    const spb = secPerBeat(activeData.tempoBpm, settings.speed);
    return time >= s.startBeat * spb && time < s.endBeat * spb;
  });
  const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  function describePracticeSetup(setup: PracticeSetup) {
    const range = (repeatRangeRef.current && setup.scope === practiceSetupRef.current.scope ? repeatRangeRef.current : null) ??
      resolvePracticeRange(setup.scope, navigationMeasures, currentMeasure, engineRef.current?.time ?? time, duration, activeData.tempoBpm, settings.speed, loop);
    if (!range) return "No passage selected";
    const spb = secPerBeat(activeData.tempoBpm, settings.speed);
    const first = Math.max(0, navigationMeasures.findIndex(m => m.endBeat > range.startSec / spb));
    const last = Math.max(first, navigationMeasures.findIndex(m => m.endBeat >= range.endSec / spb - 1e-6));
    return `Bars ${first + 1}–${last + 1} · ${settings.hand === "both" ? "Both hands" : settings.hand === "L" ? "Left hand" : "Right hand"} · ${contextLabel}`;
  }
  const previewMeasure = seekPreview === null ? null : measureIndex(seekPreview, activeData.tempoBpm, settings.speed, activeData.timeSig, navigationMeasures.length, navigationMeasures);
  const previewSection = seekPreview === null ? null : sections.find(section => seekPreview / secPerBeat(activeData.tempoBpm, settings.speed) >= section.startBeat && seekPreview / secPerBeat(activeData.tempoBpm, settings.speed) < section.endBeat);
  const renderSectionContent = (collapsed: boolean) => collapsed ? (
    <span className="text-xs text-zinc-500 truncate">{activeSection?.label ?? "Sections hidden"}</span>
  ) : (
    sections.map((s) => {
      const spb = secPerBeat(activeData.tempoBpm, settings.speed);
      const startSec = s.startBeat * spb;
      const endSec = s.endBeat * spb;
      const active = time >= startSec && time < endSec;
      const isLooping = loop && loop.startSec === startSec && loop.endSec === endSec;
      return (
        <span key={s.id} className="inline-flex items-center rounded-full border text-xs min-h-9 overflow-hidden shrink-0">
          <button
            onClick={() => seekToSection(s)}
            aria-current={active ? "true" : undefined}
            className={`px-2.5 py-1 font-medium transition-colors ${active ? "bg-zinc-900 text-white border-zinc-900" : "hover:bg-zinc-100 border-transparent"}`}
          >
            {s.label}
          </button>
          <button
            onClick={() => loopSection(s)}
            aria-pressed={!!isLooping}
            title={`Loop ${s.label}`}
            className={`px-1.5 py-1 border-l ${isLooping ? "bg-indigo-100 border-indigo-300 text-indigo-700" : "border-zinc-200 hover:bg-zinc-50 text-zinc-500"}`}
          >
            ⟳
          </button>
        </span>
      );
    })
  );
  const viewReach = useMemo(()=>keyboardReachability(guidanceNotes,{startSec:0,endSec:duration},.25*secPerBeat(activeData.tempoBpm,settings.speed),midiRange,null),[guidanceNotes,duration,activeData.tempoBpm,settings.speed,midiRange]);
  function prepareAuxiliary(kind:"take"|"rhythm"){if(auxiliaryRef.current)return false;cancelSoundPreview();engineRef.current?.stop();keyboardInputRef.current?.releaseAll();midiInputRef.current?.releaseAll();heldInputRef.current?.releaseAll();releaseMicrophone();syncTransportState();auxiliaryRef.current=kind;setAuxiliary(kind);return true;}
  function releaseAuxiliary(kind:"take"|"rhythm"){if(auxiliaryRef.current===kind){auxiliaryRef.current=null;setAuxiliary(null);}}
  const rhythmRange=loop ?? resolvePracticeRange("bars",navigationMeasures,currentMeasure,time,duration,activeData.tempoBpm,settings.speed,null) ?? {startSec:0,endSec:duration};
  const sheetSource = useMemo(()=>({notes:initial.data.notes,measures:initial.data.measures,sourceFingerprint:initial.data.sourceFingerprint}),[initial.data]);
  const renderModeView = (viewMode: ViewMode) => (
    <>
      {viewReach.overflow > 0 && <p role="status" aria-label="Piano view overflow" className="text-xs text-amber-800">{viewReach.overflow} arrangement onset targets are outside the piano view: {viewReach.overflowPitches.map(pitch=>noteLabel(pitch,true)).join(", ")}. They remain in practice grading. Review range or transpose in View.</p>}
      {viewMode === "falling" && (
        <FallingCanvas sourceKey={activeData.key} readingWindow={readingWindow} showLyrics={showLyrics} timeSig={activeData.timeSig} measures={navigationMeasures} countIn={countIn} inputEnabled={!openTool && !showPracticeSetup && countIn === null && (!grading || practiceSetup.input === "keyboard")}
                onKeyDown={(pointerId, midi) => handleNote(midi, true, "keyboard", `pointer:${pointerId}`)}
                onKeyUp={pointerId => heldInputRef.current?.release(`pointer:${pointerId}`)} inputOctave={inputOctave} midiConnected={midiConnected} onResetOctave={() => keyboardInputRef.current?.setOctave(2)}
          notes={guidanceNotes}
          time={time}
          timeRef={timeRef}
          playing={playing}
          settings={settings}
          pressedKeys={pressedKeys}
          chords={visualChords}
          tempoBpm={activeData.tempoBpm}
          lowMidi={midiRange.lowMidi}
          highMidi={midiRange.highMidi}
          loop={loop}
          waitNotes={waitNotes}
        />
      )}
      {viewMode === "beginner" && <BeginnerView data={guidanceData} time={time} settings={settings} chords={displayChords} provisionalTempo={provisionalTempo} pitchCues={!recall?.reduced} />}
      {viewMode === "leadsheet" && <LeadSheetView data={guidanceData} time={time} settings={settings} chords={displayChords} />}
      {viewMode === "sheet" && (
        <div>
          {settings.transpose !== 0 && (
            <p className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">
              Sheet Music stays in the original key; playback is transposed {settings.transpose > 0 ? `+${settings.transpose}` : settings.transpose} semitones.
            </p>
          )}
          {settings.backgroundMode === "chord" && (
            <p className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">
              Sheet Music shows the stored Original arrangement while Chord mode is selected. Use Fall Down or Note letters for the active guidance.
            </p>
          )}
          <SheetMusicView publicationRevision={initial.publicationRevision} songId={initial.song.id} initialPosition={sheetPosition}
            interaction={{source:sheetSource,enabled:settings.backgroundMode==="piano"&&settings.transpose===0,canNavigate:!grading&&countIn===null,beat:currentBeat,
              onVerifiedMeasures:measures=>{if(!gradingRef.current&&countInRef.current===null&&initial.data.sourceFingerprint&&initial.publicationRevision)setVerifiedScoreMap(current=>current?.measures===measures?current:{fingerprint:initial.data.sourceFingerprint!,revision:initial.publicationRevision!,measures});},
              onSeek:beat=>seek(beat*secPerBeat(activeData.tempoBpm,settings.speed)),onLoop:(startBeat,endBeat)=>{setLoopBeats({startBeat,endBeat});seek(startBeat*secPerBeat(activeData.tempoBpm,settings.speed));}}} />
        </div>
      )}
    </>
  );

  return (
    <div className={`${fullWidth ? "w-full px-4 py-6" : "max-w-6xl mx-auto px-4 py-6"} page-shell player-page ${focusMode ? "player-focus" : ""}`}>
      <div className="player-workspace" data-falling={settings.mode === "falling" && !chordPracticeActive}>
      <div className="player-song-header mb-3 flex items-center gap-2 flex-wrap">
        <Link href="/" className="player-library-link" aria-label="Return to library" title="Return to library">←</Link>
        <div className="player-song-identity min-w-0">
          <h1 className="text-xl font-bold leading-tight truncate max-w-[70vw]" title={initial.song.title}>{initial.song.title}</h1>
          <div className="text-sm text-zinc-500">by {initial.song.artist}</div>
          <p className="player-context" aria-label="Practice key and tempo">{contextLabel}</p>
          <SourceArrangementNotice source={initial.sourceArrangement} />
        </div>
        <div className={`player-song-metadata ml-auto flex min-w-0 max-w-full flex-wrap items-start justify-end gap-2 text-xs ${settings.backgroundMode === "chord" ? "player-song-metadata--mobile" : ""}`}>
          <span className="px-2 py-1 rounded-full bg-zinc-100 text-zinc-700 font-medium">{settings.backgroundMode === "chord" ? "Song-wide backing" : levelLabel(initial.song.difficulty)}</span>
          {settings.backgroundMode === "chord" && (
            <span
              className={`px-2 py-1 rounded-full font-medium ${!sourceBackingNotes && (selectedChordSource.fallback || chordReviewReason) ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}
              data-testid="chord-mode-status"
              role="status"
              title={sourceBackingNotes ? "Excerpt-tested Advanced accompaniment source, with fewer repeated bass attacks" : chordReviewReason ?? selectedChordSource.fallbackReason ?? selectedChordSource.source?.provenance ?? undefined}
            >
              {chordReviewReason ? "Chords · review needed" : chordModeBadge}
            </span>
          )}
          {settings.backgroundMode === "chord" && chordReviewReason && (
            <p role="status" data-testid="chord-review-reason" className="w-full text-right text-amber-800">
              {chordReviewReason}
            </p>
          )}
          {settings.backgroundMode === "chord" && settings.accompanimentStyle === "melody-accompaniment" && (
            <>
              <span
                className={`px-2 py-1 rounded-full font-medium ${melodyArrangementFailed ? "bg-amber-100 text-amber-800" : melodyArrangementPending ? "bg-zinc-100 text-zinc-700" : melodyArrangement.provenance.selectionProvenance === "user-confirmed" ? "bg-indigo-100 text-indigo-800" : "bg-violet-100 text-violet-800"}`}
                data-testid="melody-accompaniment-status"
                role="status"
                title={melodyArrangementFailed ? workerError ?? undefined : melodyArrangement.provenance.unresolvedSpans.length ? "One or more melody phrases need confirmation." : undefined}
              >
                {melodyArrangementStatusText}
              </span>
              <details className="basis-full min-w-0 text-xs text-zinc-600" data-testid="melody-phrase-summary">
                <summary className="cursor-pointer rounded-full px-2 py-1 hover:bg-zinc-100">
                  Phrases: {phraseCounts.changed} changed · {phraseCounts.unchanged} unchanged{phraseCounts.review ? ` · ${phraseCounts.review} need review` : ""}
                </summary>
                {activeMelodyPhrase && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <span>
                      Current phrase {activeMelodyPhrase.startBeat.toFixed(1)}–{activeMelodyPhrase.endBeat.toFixed(1)} beats · {activeMelodyPhrase.strategy} · {activeMelodyPhrase.change}
                    </span>
                    <button type="button" className="min-h-8 rounded-md border border-zinc-300 bg-white px-2" onClick={() => seek(activeMelodyPhrase.startBeat * secPerBeat(activeData.tempoBpm, settings.speed))}>Seek</button>
                    <button type="button" className="min-h-8 rounded-md border border-zinc-300 bg-white px-2" onClick={() => setLoopBeats({ startBeat: activeMelodyPhrase.startBeat, endBeat: activeMelodyPhrase.endBeat })}>Loop</button>
                    <span className="basis-full text-[11px] text-zinc-500">Use whole-part selection to inherit the current automatic or right-hand choice; the other actions apply only to this phrase.</span>
                  </div>
                )}
              </details>
            </>
          )}
          {midiConnected && <span className="px-2 py-1 rounded-full bg-green-100 text-green-800">MIDI connected</span>}
        </div>
        {settings.mode === "falling" && <button className="player-mobile-range min-h-11 px-2 rounded-full border text-xs" disabled={grading} onClick={() => updateSettings({ showAllKeys: !settings.showAllKeys })}>{settings.showAllKeys ? "Fit keys" : "88 keys"}</button>}
        <details className="player-song-actions text-xs" open={!isNarrowViewport}>
          <summary className="player-song-menu min-h-11 rounded-full border border-zinc-300 px-3 cursor-pointer">Song</summary>
          <div className="player-song-action-buttons flex flex-wrap gap-2">
            <button
              onClick={toggleFavorite}
              aria-pressed={favorites.includes(initial.song.id)}
              className={`pressable min-h-11 px-3 py-2 rounded-full border text-sm ${favorites.includes(initial.song.id) ? "bg-rose-100 border-rose-300" : "border-zinc-300 hover:bg-zinc-100"}`}
              title="Add to favorites"
            >
              {favorites.includes(initial.song.id) ? "♥ Favorited" : "♡ Favorite"}
            </button>
            <button
              onClick={toggleLearned}
              aria-pressed={learned.includes(initial.song.id)}
              className={`pressable min-h-11 px-3 py-2 rounded-full border text-sm ${learned.includes(initial.song.id) ? "bg-green-100 border-green-300" : "border-zinc-300 hover:bg-zinc-100"}`}
              title="Mark as learned"
            >
              {learned.includes(initial.song.id) ? "✓ Learned" : "Learned?"}
            </button></div></details>
      </div>

      {settings.backgroundMode === "chord" && settings.accompanimentStyle === "melody-accompaniment" && melodyArrangementFailed && (
        <div className="flex flex-wrap items-center gap-2 py-2 text-sm text-amber-800" data-testid="melody-accompaniment-error" role="alert">
          <span>{workerError ? `${workerError}${workerError.includes("Original playback") ? "" : " Original playback is retained."}` : "Original playback remains available."}</span>
          <button type="button" className="min-h-11 rounded-md border border-amber-300 bg-white px-3" onClick={() => setWorkerRetry(value => value + 1)}>Retry arrangement</button>
        </div>
      )}

      {tempoNoticePresence.mounted && (
        <div
          className="player-tempo-notice motion-presence mb-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
          data-state={tempoNoticePresence.visible ? "open" : "closed"}
          // Keep the closing notice in the accessibility tree until the
          // presence hook unmounts it; hiding a focused button mid-exit leaves
          // keyboard and screen-reader focus in an aria-hidden subtree.
          aria-hidden={false}
          role="status"
        >
          <div className="flex items-start gap-3">
            <p className="flex-1">
              Speed changes how fast you practice. It does not change the arrangement’s notes.
            </p>
            <button onClick={dismissTempoSemanticsNotice} className="shrink-0 rounded-lg border border-indigo-300 px-2 py-1 text-xs font-medium hover:bg-indigo-100">
              Got it
            </button>
          </div>
        </div>
      )}

      {hasAccompanimentFallbackSlot && (
        <div className="player-fallback-slot mb-3" data-testid="accompaniment-fallback-slot">
          <div
            className={`rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 ${accompanimentFallbackMessage ? "" : "invisible"}`}
            data-testid="accompaniment-fallback"
            data-active={accompanimentFallbackMessage ? "true" : "false"}
            aria-hidden={accompanimentFallbackMessage ? undefined : true}
            role={accompanimentFallbackMessage ? "status" : undefined}
            aria-live={accompanimentFallbackMessage ? "polite" : undefined}
            aria-atomic={accompanimentFallbackMessage ? "true" : undefined}
          >
            {accompanimentFallbackSlotMessage}
          </div>
        </div>
      )}

      <div className="player-surface rounded-2xl border border-zinc-200 bg-white mb-4">
        <div className="player-toolbar">
        <div className="player-control-strip flex items-center gap-3 px-4 py-3 border-b border-zinc-100 flex-wrap">
          <button onClick={togglePlay} disabled={!engineReady || auxiliary!==null || chordPracticeActive || countIn !== null || (grading && waitMode)} className="pressable w-12 h-12 rounded-full bg-zinc-900 text-white text-lg shadow-sm hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed" aria-label={playing ? "Pause" : "Play"} title={chordPracticeActive ? "Exit chord practice to play the arrangement" : undefined}>
            <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
          </button>
          <button
            ref={practiceTriggerRef}
            disabled={auxiliary!==null}
            onClick={() => grading ? finishGrading() : openPracticeSetup()}
            className={`pressable player-practice-button min-h-11 px-3 py-1.5 rounded-full border font-medium text-sm ${grading ? "bg-amber-100 border-amber-300" : "border-zinc-300 hover:bg-zinc-100"}`}
          >
            {grading ? "Finish practice" : "Practice"}
          </button>

          <div className="flex gap-1" role="group" aria-label="Hands">
          {(["L", "R", "both"] as const).map((h) => (
            <button
              key={h}
              disabled={grading} onClick={() => updateSettings({ hand: h })}
              aria-pressed={settings.hand === h}
              aria-label={h === "L" ? "Left hand" : h === "R" ? "Right hand" : "Both hands"}
              className={`pressable min-w-11 min-h-11 px-3 py-2 rounded-full text-sm border ${settings.hand === h ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
            >
              {h === "both" ? "All" : h}
            </button>
          ))}
          </div>
          {isNarrowViewport && <select className="player-mobile-speed min-h-11 rounded-lg border border-zinc-300 text-xs" aria-label="Practice speed" disabled={grading} value={settings.speed} onChange={event => updateSettings({ speed: Number(event.target.value) })}>
            {[...new Set([settings.speed, ...Array.from({ length: 36 }, (_, i) => +(0.25 + i * 0.05).toFixed(2))])].sort((a, b) => a - b).map(speed => <option key={speed} value={speed}>{Math.round(speed * 100)}%</option>)}
          </select>}
          <div className="player-speed-controls flex items-center gap-1" aria-label="Practice speed">
            <span className="text-xs text-zinc-600">Speed</span>
            <button disabled={grading || settings.speed <= 0.25} onClick={() => updateSettings({ speed: Math.max(0.25, +(settings.speed - 0.1).toFixed(2)) })} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Decrease speed">−</button>
            <span className="px-2 text-xs font-medium" title="Practice speed">{Math.round(settings.speed * 100)}%</span>
            <button disabled={grading || settings.speed >= 2} onClick={() => updateSettings({ speed: Math.min(2, +(settings.speed + 0.1).toFixed(2)) })} className="min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Increase speed">+</button>
            <div className="player-speed-presets flex gap-1">{[0.5, 0.75, 1].map((speed) => <button key={speed} disabled={grading} aria-pressed={settings.speed === speed} className={`min-h-11 px-2 rounded-lg text-xs ${settings.speed === speed ? "bg-zinc-100 font-semibold" : "text-zinc-600 hover:bg-zinc-100"}`} onClick={() => updateSettings({ speed })}>{speed * 100}%</button>)}</div>
          </div>

        </div>
        <div className="player-secondary-controls">

      <div className="player-options flex flex-wrap items-center gap-2 mb-4">
        <div className="player-primary-controls flex flex-wrap items-center gap-2">
          <div className="relative" ref={modeMenuRef}>
          <button
            ref={modeMenuTriggerRef}
            onClick={() => setShowModeMenu((s) => !s)}
            className="pressable min-h-11 px-3 py-2 rounded-full border border-zinc-300 text-sm flex items-center gap-2"
            aria-haspopup="menu"
            aria-controls="player-view-menu"
            onKeyDown={handleModeMenuKey}
            aria-expanded={showModeMenu}
          >
            <span className="text-zinc-500">View</span>
            <span className="font-medium">{MODES.find((m) => m.id === settings.mode)?.label}</span>
          </button>
          {modeMenuPresence.mounted && (
            <div
              ref={modeMenuPanelRef}
              id="player-view-menu"
              className="motion-presence absolute z-30 mt-2 w-64 rounded-xl border border-zinc-200 bg-white shadow-lg p-2"
              data-state={modeMenuPresence.visible ? "open" : "closed"}
              aria-hidden={!showModeMenu}
              role="menu"
              onKeyDown={handleModeMenuKey}
              tabIndex={-1}>
              {MODES.map((m) => (
                <button
                  key={m.id}
                  role="menuitemradio"
                  id={`mode-menu-${m.id}`}
                  tabIndex={-1}
                  aria-checked={settings.mode === m.id}
                  onClick={() => {
                    modeMenuTriggerRef.current?.focus();
                    updateSettings({ mode: m.id });
                    setShowModeMenu(false);
                    const modePath = m.id === "falling" ? "" : `/${m.id}`;
                    window.history.replaceState(null, "", `/player/${initial.song.id}${modePath}`);
                  }}
                  className="pressable w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-100"
                >
                  <div className="text-sm font-medium">{m.label}</div>
                  <div className="text-xs text-zinc-500">{m.hint}</div>
                </button>
              ))}
            </div>
          )}
          </div>

          <button ref={downloadTriggerRef} onClick={() => setShowDownload(true)} className="pressable min-h-11 px-3 py-2 rounded-md border border-zinc-300 text-sm hover:bg-zinc-100" aria-label="Download sheet music and MIDI">Download</button>
          <PlayerTools soundLabel={`${settings.soundSource === "organ" ? "Organ" : settings.soundSource === "sampled" ? "Piano" : "Synth"}${settings.soundSource !== "organ" && settings.sustainPedal ? " · sustain" : ""}`} open={openTool} onOpen={tool => { setShowModeMenu(false); setOpenTool(tool); }}>
            {tool => tool === "display" ? <div className="flex flex-wrap gap-2">
          <button
            hidden={settings.mode !== "falling"}
            onClick={() => updateSettings({ chordKeys: !settings.chordKeys })}
            aria-pressed={settings.chordKeys}
            aria-describedby="chord-guide-description"
            className={`pressable min-h-11 px-3 py-2 rounded-full text-sm border ${settings.chordKeys ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
          >
            Chord guide
          </button>
          <button
            hidden={settings.mode !== "falling"}
            onClick={() => updateSettings({ showAllKeys: !settings.showAllKeys })}
            aria-pressed={settings.showAllKeys}
            className={`pressable min-h-11 px-3 py-2 rounded-full text-sm border ${settings.showAllKeys ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
          >
            {settings.showAllKeys ? "88 keys" : "Fit passage"}
          </button>
          <button
            onClick={toggleFullWidth}
            aria-pressed={fullWidth}
            className={`pressable min-h-11 px-3 py-2 rounded-full text-sm border ${fullWidth ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
          >
            Full width
          </button>
          <div className="player-advanced-inline flex items-center gap-1" aria-label="Transpose">
            <button disabled={grading || settings.transpose <= TRANSPOSE_MIN} onClick={() => updateSettings({ transpose: settings.transpose - 1 })} className="pressable min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Transpose down">−</button>
            <span className="px-2 text-xs font-medium">
              Key {songKeyLabel} {settings.transpose ? `(${settings.transpose > 0 ? "+" : ""}${settings.transpose})` : ""}
            </span>
            <button disabled={grading || settings.transpose >= TRANSPOSE_MAX} onClick={() => updateSettings({ transpose: settings.transpose + 1 })} className="pressable min-w-11 min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs" aria-label="Transpose up">+</button>
            {settings.transpose !== 0 && (
              <button disabled={grading} onClick={() => updateSettings({ transpose: 0 })} className="pressable min-h-11 px-2 py-1.5 rounded-lg border border-zinc-300 text-xs text-zinc-500" aria-label="Reset transpose">
                Reset
              </button>
            )}
          </div>

          {settings.mode === "falling" && <p id="chord-guide-description" className="order-last w-full text-xs text-zinc-600">
            Chord guide dots show the current chord’s voicing in its assigned octaves, not notes to press now. Check the chord label for inferred harmony. Colored strips at the top of keys show upcoming notes.
          </p>}

              {settings.mode === "falling" && <>
              <label className="w-full text-sm">Reading window<select aria-label="Reading window" value={readingWindow} onChange={event => setReadingWindow(Number(event.target.value) as 2 | 3.2 | 5)}><option value={2}>2 seconds</option><option value={3.2}>3.2 seconds</option><option value={5}>5 seconds</option></select></label>
              <label className="flex items-center gap-2 min-h-11 text-sm"><input type="checkbox" checked={showLyrics} onChange={event => setShowLyrics(event.target.checked)} />Lyrics</label>
              <label className="w-full text-sm">Key labels<select aria-label="Key labels" value={settings.keyboardLabels} onChange={event => updateSettings({ keyboardLabels: event.target.value as PlayerSettings["keyboardLabels"] })}><option value="notes">Note names</option><option value="octaves">Octaves only</option><option value="off">Off</option></select></label>
              <label className="flex items-center gap-2 min-h-11 text-sm"><input type="checkbox" checked={settings.showKeyBindings} onChange={event => updateSettings({ showKeyBindings: event.target.checked })} />Computer-key hints</label>
              </>}
              <KeyboardRangeControls value={settings.physicalKeyboard??null} disabled={grading} onChange={physicalKeyboard=>updateSettings({physicalKeyboard})}/>
              <label className="w-full text-sm">App appearance<select aria-label="App appearance" value={settings.stageTheme} onChange={event => updateSettings({ stageTheme: event.target.value as PlayerSettings["stageTheme"] })}><option value="light">Light</option><option value="charcoal">Charcoal</option></select></label>
              {settings.mode === "sheet" && <button className="min-h-11 px-3 border border-zinc-300 rounded-md text-sm" onClick={() => {
                setOpenTool(null);
                window.requestAnimationFrame(() => document.querySelector<HTMLSelectElement>('.player-mode-layer-enter [aria-label="Score zoom"]')?.focus());
              }}>Score zoom &amp; fit width</button>}
            </div> : tool === "sound" ? <fieldset disabled={grading||auxiliary!==null}>
                        <button
            onClick={() => updateSettings({ metronome: !settings.metronome })}
            aria-pressed={settings.metronome}
            className={`pressable min-h-11 px-3 py-2 rounded-full text-sm border ${settings.metronome ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
          >
            Metronome
          </button>

              <p className="mb-3 text-xs text-zinc-600">Visual bar progress is always available. Metronome clicks follow the active arrangement.</p>
              <SoundControls settings={settings} onChange={updateSettings} onPreview={previewSound}
                sampleStatus={sampleStatus} samplePolicy={samplePolicy} sampleBusy={grading || playing || countIn !== null || soundPreviewStatus?.phase === "playing"}
                onSamplePolicy={policy => { if (gradingRef.current) return; setSamplePolicy(policy); const audio = engineRef.current?.audio; if (audio instanceof SamplerAudioEngine) audio.samplePolicy = policy; }}
                onSampleRetry={() => { const audio = engineRef.current?.audio; if (audio instanceof SamplerAudioEngine && !audio.retrySamples()) setPracticeError("Sample retries are exhausted. Choose synthesis fallback or reload."); }}
                previewStatus={soundPreviewStatus} onPreviewStop={stopSoundPreview}
                chordUnavailableReason={initial.chordUnavailableReason}
                sourceBacking={Boolean(sourceBackingNotes)}
                chordSource={chordSourcePreference} chordSources={sourceBackingNotes ? undefined : chordSources}
                chordSourceStatus={selectedChordSource.fallbackReason} onChordSourceChange={updateChordSource}
                melodyArrangement={melodyArrangement}
                activeMelodyPhrase={activeMelodyPhrase}
                phraseSourceCandidates={activePhraseSourceCandidates}
                phraseOverrideAction={activePhraseOverrideAction}
                phraseOverrideConflict={activePhraseOverrideConflict}
                sourceBackingMode={melodySourceBackingMode}
                rightHandAvailable={activeData.notes.some((note) => note.hand === "R")}
                hasSavedMelodySelection={melodySelectionSaved}
                onMelodySelectionChange={updateMelodySelection}
                onMelodyPhraseOverrideChange={updateMelodyPhraseOverride}
                onSourceBackingModeChange={updateSourceBackingMode}
                onMelodySelectionReset={resetMelodySelection} />
            </fieldset> : <InputStatus locked={grading} octave={inputOctave} midiConnected={midiConnected} pending={midiPending} error={midiError} supported={midiSupported()} onOctaveChange={octave => keyboardInputRef.current?.setOctave(octave)} onConnectMidi={connectMidi} devices={midiDevices} selection={midiSelection} onSelection={selectMidi} offsets={timingOffsets} onTimingOffset={setTimingOffset} />}
          </PlayerTools>

          <button disabled={auxiliary!==null} className="min-h-11 rounded-full border border-zinc-300 px-3 text-sm" aria-pressed={focusMode} onClick={() => { setFocusMode(!focusMode); setOpenTool(null); window.scrollTo({ top: 0 }); }}>{focusMode ? "Exit focus" : "Focus"}</button>
        </div>

      </div>

        </div>

        </div>
        <div className="player-navigation">
        <div className="player-timeline">
          <output role="timer" aria-label="Elapsed time" className="ml-auto text-xs text-zinc-500 font-mono tabular-nums text-right select-none flex items-center gap-1.5">
            <span>{fmtTime(time)}</span>
            <span className="text-zinc-300">/</span>
            <span>{fmtTime(duration)}</span>
            <span className="text-zinc-500">(-{fmtTime(Math.max(0, duration - time))})</span>
          </output><details className="player-loop-controls text-xs" data-active={!!loop}>
          <summary className="cursor-pointer min-h-11 flex items-center rounded-full border border-zinc-300 px-3">{loopBeats ? `Loop · Bars ${loopStartBar}–${loopEndBar}` : "Loop"}</summary>
          <div className="player-loop-editor">
            <p className="w-full text-sm text-zinc-600">Repeat a small passage until it feels comfortable.</p>
            <div className="flex flex-wrap gap-2 w-full">
              <button disabled={grading} onClick={() => loopCurrentBars(1)} className="min-h-11 rounded-lg border border-zinc-300 px-3">Loop current bar</button>
              <button disabled={grading} onClick={() => loopCurrentBars(4)} className="min-h-11 rounded-lg border border-zinc-300 px-3">Loop next 4 bars</button>
            </div>
            <label>Start bar <input type="number" aria-label="Loop start bar" min={1} max={navigationMeasures.length} value={loopDraft?.start ?? loopStartBar} disabled={grading} onChange={e => editLoopBar("start", e.target.value)} /></label>
            <label>End bar <input type="number" aria-label="Loop end bar" min={1} max={navigationMeasures.length} value={loopDraft?.end ?? loopEndBar} disabled={grading} onChange={e => editLoopBar("end", e.target.value)} /></label>
            <button disabled={grading || !draftLoopBeats} onClick={applyLoopDraft} className="min-h-11 rounded-lg border border-zinc-300 px-3">Apply loop</button>
            <button disabled={grading || !loopDraft} onClick={() => setLoopDraft(null)} className="min-h-11 rounded-lg border border-zinc-300 px-3">Cancel loop edits</button>
            {loopDraft && !draftLoopBeats && <p className="w-full text-sm text-amber-800" role="status">Choose whole bars from 1 to {navigationMeasures.length}, with the end at or after the start.</p>}
            <button disabled={grading} onClick={toggleLoop} className="min-h-11 rounded-lg border border-zinc-300 px-3">{loop ? "Clear loop" : "Enable loop"}</button>
          </div>
        </details></div>
        <div className="player-seek-track px-4 pb-3 border-b border-zinc-100">
          <output className="player-seek-preview" aria-label="Seek destination" aria-live="off">{previewMeasure === null ? `Bar ${currentMeasure + 1}${activeSection ? ` · ${activeSection.label}` : ""}` : `Bar ${previewMeasure + 1}${previewSection ? ` · ${previewSection.label}` : ""} · ${fmtTime(seekPreview!)}`}</output>
          <div className="player-seek-rail">
          {(loop || draftLoopBeats) && <div className="player-loop-track">
            {loop && <div role="img" aria-label={`Loop range: bars ${loopStartBar}–${loopEndBar}`} className="player-loop-range"
              style={{ left: `${loop.startSec / Math.max(1, duration) * 100}%`, width: `${(loop.endSec - loop.startSec) / Math.max(1, duration) * 100}%` }} />
            }
            {draftLoopBeats && loopDraft && <div role="img" aria-label={`Draft loop range: bars ${loopDraft.start}–${loopDraft.end}`} className="player-loop-range player-loop-draft"
              style={{ left: `${draftLoopBeats.startBeat * secPerBeat(activeData.tempoBpm, settings.speed) / Math.max(1, duration) * 100}%`, width: `${(draftLoopBeats.endBeat - draftLoopBeats.startBeat) * secPerBeat(activeData.tempoBpm, settings.speed) / Math.max(1, duration) * 100}%` }} />}
          </div>}
          {sections.length > 1 && <div className="player-section-marks" aria-label="Timeline sections">{sections.slice(0, 12).map(section => <button key={section.id} type="button" disabled={grading} title={section.label} aria-label={`Seek to ${section.label}`} onClick={() => seekToSection(section)} style={{ left: `${Math.min(99, Math.max(1, section.startBeat * secPerBeat(activeData.tempoBpm, settings.speed) / Math.max(1, duration) * 100))}%` }} />)}</div>}
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={0.01}
            value={Math.min(time, duration)}
            onChange={(e) => { const value = Number(e.target.value); setSeekPreview(value); seek(value); }}
            onFocus={() => setSeekPreview(time)} onBlur={() => setSeekPreview(null)}
            onPointerMove={event => { if (grading) return; const rect = event.currentTarget.getBoundingClientRect(); setSeekPreview(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * duration); }}
            onPointerLeave={event => { if (document.activeElement !== event.currentTarget) setSeekPreview(null); }}
            className="block w-full h-2 rounded-lg appearance-none cursor-pointer accent-zinc-900"
            style={{
              background: `linear-gradient(to right, #18181b 0%, #18181b ${(time / Math.max(1, duration)) * 100}%, #e4e4e7 ${(time / Math.max(1, duration)) * 100}%, #e4e4e7 100%)`,
            }}
            disabled={!engineReady || grading}
            aria-label="Seek"
            aria-valuetext={`Bar ${currentMeasure + 1} of ${navigationMeasures.length}, ${fmtTime(time)} of ${fmtTime(duration)}`}
          />
          </div>
        </div>
        {sections.length > 1 && (
          <div role="navigation" aria-label="Song sections" className="player-section-navigation px-4 py-2 border-b border-zinc-100 flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={toggleSectionsCollapsed}
              aria-expanded={!sectionsCollapsed}
              className={`min-h-9 px-2 py-1 rounded-full border text-xs font-medium shrink-0 ${sectionsCollapsed ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300 hover:bg-zinc-100"}`}
              title={sectionsCollapsed ? "Expand sections" : "Collapse sections"}
            >
              {sectionsCollapsed ? "▸ Sections" : "▾ Sections"}
            </button>
            <div className="player-sections-switch">
              {sectionsSwitch.previous !== null && (
                <div ref={sectionsExitRef} className="player-sections-layer-exit" aria-hidden="true">
                  {renderSectionContent(sectionsSwitch.previous)}
                </div>
              )}
              <div key={String(sectionsSwitch.current)} className="player-sections-layer-enter">
                {renderSectionContent(sectionsSwitch.current)}
              </div>
            </div>
          </div>
        )}

        </div>
        {recall && <section className="border rounded-xl p-3 text-sm" aria-label="Passage recall trial"><p>{recall.passage.name}: {recall.reduced?"Reduced pitch cues":"Guidance visible"}. Source uncertainty and failure feedback remain visible. This owner-confirmed trial does not establish memory or mastery.</p><button disabled={auxiliary!==null||grading||showPracticeSetup||playing} className="min-h-11 underline mr-3" onClick={()=>previewSound("full")}>1. Demonstrate saved passage</button><button disabled={auxiliary!==null||grading||!recall.demonstrated||showPracticeSetup||playing} className="min-h-11 underline mr-3" onClick={()=>{setRecall({...recall,reduced:false});openPracticeSetup("loop");}}>2. Guided passage attempt</button><button disabled={auxiliary!==null||grading||!recall.guided||showPracticeSetup||playing} className="min-h-11 underline mr-3" onClick={()=>{setRecall({...recall,reduced:true});openPracticeSetup("loop");}}>3. Try reduced pitch cues</button><button className="min-h-11 underline mr-3" onClick={revealRecall}>Reveal / Restore guidance</button><button className="min-h-11 underline" onClick={()=>{if(gradingRef.current)finishGrading(false);cancelSoundPreview();engineRef.current?.stop();syncTransportState();setRecall(null);}}>End recall trial</button></section>}
        {(grading || gradeResult) && <GradingPanel pitchCues={!recall?.reduced} waitMode={waitMode} waitNotes={waitNotes} result={gradeResult}
          countIn={countIn} input={practiceSetup.input} onExit={finishGrading} onRepeat={repeatPractice}
          problems={gradeResult ? gradeProblemWindows(gradeResult, navigationMeasures, gradedTimingRef.current.bpm, gradedTimingRef.current.speed) : []}
          onRevisit={range => { engineRef.current?.stop(); setLoopBeats(range); engineRef.current?.seek(range.startBeat * secPerBeat(activeData.tempoBpm, settings.speed)); setGradeResult(null); setSeekVersion(version => version + 1); syncTransportState(); }}
          onDismiss={() => { setGradeResult(null); if (engineRef.current) engineRef.current.gradeResult = null; }} />}

        <div className="player-stage-status" aria-label="Playback status">
          <span role={soundPreviewStatus && !grading ? "status" : undefined}>
            {countIn !== null ? `Count-in · ${countIn} beats remaining` : grading ? `${waitMode ? "Waiting for notes" : "Play-along practice"} · ${practiceSetup.input}` : soundPreviewStatus ? `Preview · ${soundPreviewStatus.role === "full" ? "Arrangement" : soundPreviewStatus.role} · ${soundPreviewStatus.rangeLabel} · ${soundPreviewStatus.phase === "playing" ? "Playing" : soundPreviewStatus.phase === "complete" ? "Complete" : "Stopped"}` : gradeResult ? "Practice result" : playing ? "Playing" : "Ready"}
          </span>
          {!openTool && !grading && soundPreviewStatus?.phase === "playing" && <button onClick={stopSoundPreview}>Stop preview</button>}
        </div>

        <div
          className={`player-stage relative ${playing && !grading ? "cursor-pointer" : ""}`}
          tabIndex={0}
          onKeyDown={(event) => {
            if (!playing || grading || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            event.stopPropagation();
            stopPlayback();
          }}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button, summary, input, select, a")) return;
            if (playing && !grading) stopPlayback();
          }}
          role="region"
          aria-label={`Player stage — ${activeModeLabel}`}
        >
          {!chordPracticeActive && settings.mode === "leadsheet" && settings.hand === "L" && <div className="player-selection-notice" aria-label="View selection notice">
            <p>Lead Sheet displays right-hand attacks. Left hand is selected.</p>
            <button disabled={grading} onClick={() => updateSettings({ hand: "both" })}>Show both hands</button>
            <button onClick={() => updateSettings({ mode: "beginner" })}>Use Note letters</button>
          </div>}
          {!chordPracticeActive && guidanceNotes.length === 0 && displayChords.length === 0 && settings.mode !== "sheet" && <div className="player-selection-notice" aria-label="Arrangement availability">
            <p>{settings.backgroundMode === "chord" ? "No playable guidance is available for this backing selection." : "No note targets are available for the selected hand."}</p>
            <button disabled={grading} onClick={() => updateSettings({ hand: "both" })}>Show both hands</button>
            {settings.backgroundMode === "chord" && <button disabled={grading} onClick={() => updateSettings({ backgroundMode: "piano" })}>Use Original arrangement</button>}
          </div>}
          {chordPracticePresence.mounted ? (
            <ChordPracticePanel
              scope="passage"
              inputStatus={midiConnected ? "MIDI connected · computer keyboard also available" : "Computer keyboard · A–K, Z/X octave"}
              targets={chordPracticeTargets}
              snapshot={chordPracticeSnapshot ?? new ChordGrader(chordPracticeTargets).snapshot()}
              notice={chordPracticeNotice}
              active={chordPracticeActive}
              onStart={startChordPractice}
            onExercise={chooseChordExercise} midiShapeEligible={!!midiSelection.device&&midiSelection.channel!==null}
              onHear={hearChordPractice}
              onSkip={skipChordPractice}
              onExit={exitChordPractice}
              presenceVisible={chordPracticePresence.visible}
            />
          ) : (
            <div className="player-mode-stack">
              {modeSwitch.previous && (
                <div className="player-mode-layer-exit" aria-hidden="true">
                  {renderModeView(modeSwitch.previous)}
                </div>
              )}
              <div key={modeSwitch.current} className="player-mode-layer-enter">
                {renderModeView(modeSwitch.current)}
              </div>
            </div>
          )}
          {playingNoticePresence.mounted && !grading && (
            <div
              className="motion-presence absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-zinc-900/80 text-white text-xs"
              data-state={playingNoticePresence.visible ? "open" : "closed"}
              aria-hidden={!playing}
            >
              Playing — click anywhere to pause
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {activeModeLabel} view active
          </p>
          <p className="sr-only">When playback is active, press Enter or Space on the stage to pause. Computer keys A through semicolon play notes. Z/X changes input octave.</p>
        </div>
      </div>

      </div>

      <div className="player-secondary-tools">
      <LearningInspection songId={initial.song.id} revision={initial.publicationRevision}/>
      <OwnerMetadata song={initial.song} revision={initial.publicationRevision}/>
      <OfflinePackControl id={initial.song.id} revision={initial.publicationRevision}/>
      <OwnerDeletion baseId={initial.song.baseId} revision={initial.publicationRevision} disabled={grading||playing||countIn!==null||auxiliary!==null}/>
        <PracticeWorkspace onRecall={settings.mode==="beginner"&&settings.backgroundMode==="piano"?passage=>{if(auxiliaryRef.current||gradingRef.current||!practiceTarget||passage.target.fingerprint!==practiceTarget.fingerprint)return;if(passage.endBeat-passage.startBeat>16){setPracticeSaveNotice("Recall trials support up to 16 beats; save a shorter reviewed passage.");return;}if(!selectSavedPassage(passage))return;cancelSoundPreview();activeTempoPlanRef.current=null;setRecall({passage,demonstrated:false,guided:false,reduced:false});}:undefined} publicationRevision={initial.publicationRevision} target={practiceTarget} variantId={initial.song.id} range={loopBeats}
          bpm={activeData.tempoBpm}
          onUseTempoPlan={passage => {
            if (gradingRef.current || !passage.tempoPlan || passage.tempoPlan.paused || passage.tempoPlan.status !== "active" || passage.target.fingerprint !== practiceTarget?.fingerprint) return;
            const speed=passage.tempoPlan.currentBpm/activeData.tempoBpm;
            if (speed<.25 || speed>4) { setPracticeSaveNotice("Plan tempo no longer fits this arrangement."); return; }
            if (!selectSavedPassage(passage)) return;
            updateSettings({speed}); activeTempoPlanRef.current={passageId:passage.id,policyId:passage.tempoPlan.policyId};
            setPracticeSaveNotice(`Tempo plan selected at ${passage.tempoPlan.currentBpm} BPM. Start Play-along Practice when ready; changes apply between runs.`);
          }}
          endBeat={duration / secPerBeat(activeData.tempoBpm, settings.speed)} positionBeat={time / secPerBeat(activeData.tempoBpm, settings.speed)} disabled={grading || showPracticeSetup}
          onSelect={selectSavedPassage}
          onSaved={passage => { selectedPassageIdRef.current = passage.id; }}
          onResume={beat => { engineRef.current?.stop(); seek(beat * secPerBeat(activeData.tempoBpm, settings.speed)); syncTransportState(); }} />
        {activeData.sourcePedal && <p className="px-4 text-xs" role="note">{settings.backgroundMode==="piano"?"Source-file CC64 controls resonance separately from key holds. Simulated background sustain is disabled; your live input pedal stays separate.":"Derived Chords playback omits source-file pedal changes."} MusicXML retains channel-bound pedal metadata for Keyspilli; other score players may ignore it. Musical review remains unverified.</p>}
        <MidiTakePanel inputRef={takeInputRef} target={practiceTarget} revision={initial.publicationRevision} targets={guidanceNotes}
          startBeat={rhythmRange.startSec/secPerBeat(activeData.tempoBpm,settings.speed)} endBeat={rhythmRange.endSec/secPerBeat(activeData.tempoBpm,settings.speed)} bpm={activeData.tempoBpm} speed={settings.speed} transpose={settings.transpose}
          device={midiConnected?midiSelection.device:null} channel={midiSelection.channel} disabled={grading||showPracticeSetup||chordPracticeActive||playing||auxiliary==="rhythm"}
          onPrepare={()=>prepareAuxiliary("take")} onDone={()=>releaseAuxiliary("take")}/>
        <RhythmCoach data={guidanceData} startBeat={rhythmRange.startSec/secPerBeat(activeData.tempoBpm,settings.speed)}
          endBeat={rhythmRange.endSec/secPerBeat(activeData.tempoBpm,settings.speed)} speed={settings.speed} disabled={grading||showPracticeSetup||chordPracticeActive||playing||auxiliary==="take"} onPrepare={()=>prepareAuxiliary("rhythm")} onDone={()=>releaseAuxiliary("rhythm")}/>
        {practiceSaveNotice && <p role="status" className="px-4 text-xs">{practiceSaveNotice}</p>}
      </div>

      {displayVariants.length > 1 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-zinc-500 mb-2">Same song, other levels</h2>
          <div className="flex flex-wrap gap-2">
            {displayVariants.map((v) => (
              <Link
                key={v.id}
                href={`/player/${v.id}`}
                className={`px-3 py-2 rounded-full text-sm border ${v.id === initial.song.id ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300 hover:bg-zinc-100"}`}
              >
                {levelLabel(v.difficulty)}
              </Link>
            ))}
          </div>
        </section>
      )}

      {showPracticeSetup && <PracticeSetupDialog articulationEligible={!!midiSelection.device&&midiSelection.channel!==null} keyboardTarget={practiceKeyboardTarget} describeSetup={describePracticeSetup} onChordPractice={chordPracticeTargets.length ? () => { showPracticeSetupRef.current = false; setShowPracticeSetup(false); startChordPractice(); } : undefined} initialSetup={practiceSetup} hasLoop={!!loop && loop.endSec > loop.startSec}
        midiConnected={midiConnected} micReady={micReady} micPending={micPending} micError={micError} error={practiceError} micSignal={micSignal}
        microphoneTarget={setup => { const range = resolvePracticeRange(setup.scope, navigationMeasures, currentMeasure, engineRef.current?.time ?? time, duration, activeData.tempoBpm, settings.speed, loop); return range ? microphoneEligibility(guidanceNotes, range) : { eligible: false, reason: "Choose a measured passage." }; }}
        onEnableMic={() => void enableMicrophone()} onInputChange={(input) => { if (input !== "microphone") releaseMicrophone(); }}
        onStart={beginPractice} onCancel={closePracticeSetup} />}
      {showDownload && <DownloadDialog publicationRevision={initial.publicationRevision} songId={initial.song.id} hasSheetXml={initial.song.hasSheetXml === 1} backgroundMode={settings.backgroundMode} transpose={settings.transpose}
        activeExport={melodyArrangementRequested&&(melodyArrangementPending||melodyArrangementFailed)?undefined:{selection:activeExportSelection,sourceFingerprint:melodySourceFingerprint,
          digest:()=>activeExportDigest(activeExportVariant(activeData,{...accompaniment,displayChords},activeExportSelection))}} onClose={() => {
        setShowDownload(false);
        window.requestAnimationFrame(() => downloadTriggerRef.current?.focus());
      }} />}

      <section className="mt-8 text-sm text-zinc-600">
        <h2 className="font-semibold text-zinc-800 mb-2">About this arrangement</h2>
        <p>
          Key of {activeData.key} · {activeData.tempoBpm} BPM · {activeData.timeSig[0]}/{activeData.timeSig[1]} ·
          {" "}{settings.backgroundMode === "chord" && activeData.notes.length === 0
            ? `chord backing · ${displayChords.length} chords`
            : `${sourceBackingNotes && settings.backgroundMode === "chord" ? "source accompaniment" : `${initial.song.bassPattern} bass`} · ${sourceBackingNotes && settings.backgroundMode === "chord" ? sourceBackingNotes.length : activeData.notes.length} notes`}
        </p>
        <p className="mt-2 text-zinc-500">
          Practice tips: slow it to 50% first, loop tricky measures, and use Practice mode to get graded feedback.
        </p>
      </section>
    </div>
  );
}

function isPlayerDetail(initial: PlayerInitial): initial is PlayerDetail {
  return "data" in initial && initial.data != null;
}

/**
 * Keep direct sheet navigation useful before the large player payload arrives.
 * The sheet renderer only needs the song id, while practice controls and the
 * other views explicitly request the complete detail JSON from the API.
 */
function PlayerShellView({ initial, mode }: { initial: PlayerShell; mode: ViewMode | null }) {
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [requestedMode, setRequestedMode] = useState<ViewMode>(mode ?? "sheet");
  const [showModeMenu, setShowModeMenu] = useState(false);
  const modeMenuPresence = usePresence(showModeMenu);
  const [showDownload, setShowDownload] = useState(false);
  const [savedTranspose, setSavedTranspose] = useState(0);
  const [savedSpeed, setSavedSpeed] = useState(1);
  const sheetPositionRef = useRef<SheetReaderPosition | undefined>(undefined);
  useEffect(() => {
    setSavedTranspose(loadSongPrefs(initial.song.id).transpose ?? loadSettings().transpose);
    setSavedSpeed(loadSongPrefs(initial.song.id).speed ?? loadSettings().speed);
  }, [initial.song.id]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modeMenuIdx, setModeMenuIdx] = useState(-1);
  const downloadTriggerRef = useRef<HTMLButtonElement>(null);
  const loadControlsTriggerRef = useRef<HTMLButtonElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const modeMenuPanelRef = useRef<HTMLDivElement>(null);
  const modeMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const shellExitRef = useRef<HTMLDivElement>(null);
  const loadRequestRef = useRef<AbortController | null>(null);
  const detailSwitch = useAnimatedSwitch(Boolean(detail));
  const shellLoadingPresence = usePresence(loading);
  const shellErrorPresence = usePresence(Boolean(error));

  useEffect(() => {
    const layer = shellExitRef.current;
    if (layer) layer.setAttribute("inert", "");
  }, [detailSwitch.previous]);

  useEffect(() => {
    const menu = modeMenuPanelRef.current;
    if (!menu) return;
    if (!showModeMenu) menu.setAttribute("inert", "");
    else menu.removeAttribute("inert");
  }, [modeMenuPresence.mounted, showModeMenu]);

  useEffect(() => () => {
    loadRequestRef.current?.abort();
    loadRequestRef.current = null;
  }, []);

  useEffect(() => {
    if (!showModeMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const hadFocus = modeMenuRef.current?.contains(document.activeElement) ?? false;
      if (!modeMenuRef.current?.contains(event.target as Node)) {
        setShowModeMenu(false);
        setModeMenuIdx(-1);
        if (hadFocus) window.requestAnimationFrame(() => modeMenuTriggerRef.current?.focus());
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showModeMenu]);

  useEffect(() => {
    if (!showModeMenu) {
      setModeMenuIdx(-1);
      return undefined;
    }
    const selectedIndex = MODES.findIndex((item) => item.id === requestedMode);
    setModeMenuIdx(selectedIndex);
    const frame = window.requestAnimationFrame(() => {
      const item = MODES[selectedIndex];
      if (item) document.getElementById(`shell-mode-menu-${item.id}`)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedMode, showModeMenu]);

  function focusShellModeMenuItem(index: number) {
    const nextIndex = (index + MODES.length) % MODES.length;
    setModeMenuIdx(nextIndex);
    const item = MODES[nextIndex];
    if (item) window.requestAnimationFrame(() => document.getElementById(`shell-mode-menu-${item.id}`)?.focus());
  }

  function handleShellModeMenuKey(event: React.KeyboardEvent) {
    if (!showModeMenu) return;
    const len = MODES.length;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusShellModeMenuItem(modeMenuIdx + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusShellModeMenuItem(modeMenuIdx - 1);
        break;
      case "Home":
        event.preventDefault();
        focusShellModeMenuItem(0);
        break;
      case "End":
        event.preventDefault();
        focusShellModeMenuItem(len - 1);
        break;
      case "Escape":
        event.preventDefault();
        setShowModeMenu(false);
        setModeMenuIdx(-1);
        modeMenuTriggerRef.current?.focus();
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (modeMenuIdx >= 0) {
          const item = MODES[modeMenuIdx]!;
          modeMenuTriggerRef.current?.focus();
          setShowModeMenu(false);
          setModeMenuIdx(-1);
          if (item.id === "sheet") {
            loadRequestRef.current?.abort();
            setLoading(false);
            setError("");
            setRequestedMode("sheet");
            window.history.replaceState(null, "", `/player/${encodeURIComponent(initial.song.id)}/sheet`);
          } else {
            void loadDetail(item.id);
          }
        }
        break;
    }
  }

  const loadDetail = useCallback(async (nextMode: ViewMode) => {
    // Remember the requested target before the network round-trip so a failed
    // mode switch can be retried with the same target instead of silently
    // falling back to the sheet route.
    setRequestedMode(nextMode);
    if (detail) {
      if (nextMode !== "sheet") {
        window.history.replaceState(null, "", `/player/${encodeURIComponent(initial.song.id)}/${nextMode}`);
      }
      return;
    }
    loadRequestRef.current?.abort();
    const controller = new AbortController();
    loadRequestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/songs/${encodeURIComponent(initial.song.id)}?revision=${encodeURIComponent(initial.publicationRevision ?? "unpinned")}`, {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (controller.signal.aborted) return;
      const value = await response.json().catch(() => null) as Partial<PlayerDetail> | null;
      if (controller.signal.aborted || loadRequestRef.current !== controller) return;
      if (!response.ok || !value || !value.song || !value.data || !Array.isArray(value.variants)) {
        throw new Error(response.status === 409 ? "This arrangement changed. Reload the page before continuing." : "The player arrangement could not be loaded.");
      }
      const score = document.querySelector<HTMLElement>(".sheet-svg");
      const page = Number(score?.dataset.activePage ?? 1);
      const pageNode = score?.querySelector<HTMLElement>(`[data-page="${page}"]`);
      const zoom = document.querySelector<HTMLSelectElement>('[aria-label="Score zoom"]');
      if (score && pageNode && zoom) sheetPositionRef.current = { zoom: Number(zoom.value), page, offset: pageNode.getBoundingClientRect().top, scrollLeft: score.scrollLeft };
      setDetail(value as PlayerDetail);
      if (nextMode !== "sheet") {
        window.history.replaceState(null, "", `/player/${encodeURIComponent(initial.song.id)}/${nextMode}`);
      }
    } catch (cause) {
      if (loadRequestRef.current === controller && !(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "The player arrangement could not be loaded.");
      }
    } finally {
      if (loadRequestRef.current === controller) {
        loadRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [detail, initial.song.id]);

  const activeMode = requestedMode === "sheet" ? "Sheet Music" : MODES.find((item) => item.id === requestedMode)?.label ?? requestedMode;
  const displayVariants = playerVariantsForDisplay(initial.song, initial.variants);

  const shell = (
    <div className="page-shell player-page max-w-6xl mx-auto px-4 py-6">
      <div className="player-song-header mb-3 flex items-center gap-2 flex-wrap">
        <Link href="/" className="player-library-link" aria-label="Return to library" title="Return to library">←</Link>
        <div className="player-song-identity">
          <h1 className="text-xl font-bold leading-tight truncate max-w-[70vw]" title={initial.song.title}>{initial.song.title}</h1>
          <div className="text-sm text-zinc-500">by {initial.song.artist}</div>
          <p className="player-context">{practiceContext(initial.song.key, initial.song.tempo, { transpose: savedTranspose, speed: savedSpeed }, initial.sourceArrangement?.sourceKind === "tutorial-preview")}</p>
          <SourceArrangementNotice source={initial.sourceArrangement} />
        </div>
        <div className="player-song-metadata ml-auto flex gap-2 text-xs">
          <span className="px-2 py-1 rounded-full bg-zinc-100 text-zinc-700 font-medium">{levelLabel(initial.song.difficulty)}</span>
        </div>
      </div>

      <LearningInspection songId={initial.song.id} revision={initial.publicationRevision}/>
      <OwnerMetadata song={initial.song} revision={initial.publicationRevision}/>
      <OwnerDeletion baseId={initial.song.baseId} revision={initial.publicationRevision}/>
      <div className="player-secondary-controls flex flex-wrap items-center gap-2 mb-4">
        <div className="relative" ref={modeMenuRef}>
          <button
            ref={modeMenuTriggerRef}
            onClick={() => {
              setShowModeMenu((visible) => !visible);
              setModeMenuIdx(-1);
            }}
            className="min-h-11 px-3 py-2 rounded-full border border-zinc-300 text-sm flex items-center gap-2"
            aria-haspopup="menu"
            aria-controls="shell-player-view-menu"
            aria-expanded={showModeMenu}
            onKeyDown={handleShellModeMenuKey}
          >
            <span className="text-zinc-500">View</span>
            <span className="font-medium">{activeMode}</span>
          </button>
          {modeMenuPresence.mounted && (
            <div
              ref={modeMenuPanelRef}
              id="shell-player-view-menu"
              className="motion-presence absolute z-30 mt-2 w-64 rounded-xl border border-zinc-200 bg-white shadow-lg p-2"
              data-state={modeMenuPresence.visible ? "open" : "closed"}
              aria-hidden={!showModeMenu}
              role="menu"
              tabIndex={-1}
              onKeyDown={handleShellModeMenuKey}
            >
              {MODES.map((item) => (
                <button
                  key={item.id}
                  role="menuitemradio"
                  id={`shell-mode-menu-${item.id}`}
                  aria-checked={requestedMode === item.id}
                  tabIndex={-1}
                  onClick={() => {
                    modeMenuTriggerRef.current?.focus();
                    setShowModeMenu(false);
                    setModeMenuIdx(-1);
                    if (item.id === "sheet") {
                      loadRequestRef.current?.abort();
                      setLoading(false);
                      setError("");
                      setRequestedMode("sheet");
                      window.history.replaceState(null, "", `/player/${encodeURIComponent(initial.song.id)}/sheet`);
                    } else {
                      void loadDetail(item.id);
                    }
                  }}
                  className="pressable w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-100"
                >
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="text-xs text-zinc-500">{item.hint}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          ref={downloadTriggerRef}
          onClick={() => setShowDownload(true)}
          className="min-h-11 px-3 py-2 rounded-md border border-zinc-300 text-sm hover:bg-zinc-100"
          aria-label="Download sheet music and MIDI"
        >
          Download
        </button>
        <button
          ref={loadControlsTriggerRef}
          onClick={() => void loadDetail("sheet")}
          disabled={loading}
          className="min-h-11 px-4 py-2 rounded-full border border-zinc-300 font-medium hover:bg-zinc-100 disabled:opacity-50"
        >
          {loading ? "Loading controls…" : "Load practice controls"}
        </button>
      </div>

      {shellErrorPresence.mounted && (
        <div
          className="motion-presence mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          data-state={shellErrorPresence.visible ? "open" : "closed"}
          aria-hidden={!error}
          role="alert"
        >
          <p>{error}</p>
          <button onClick={() => {
            void loadDetail(requestedMode);
            window.requestAnimationFrame(() => loadControlsTriggerRef.current?.focus());
          }} className="mt-2 rounded-lg border border-red-300 px-3 py-1.5 font-medium hover:bg-red-100">
            Retry
          </button>
        </div>
      )}

      <div className="player-surface rounded-2xl border border-zinc-200 bg-white mb-4">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 flex-wrap">
          <span className="text-sm text-zinc-600">Sheet Music</span>
          {shellLoadingPresence.mounted && (
            <span
              className="motion-presence text-xs text-zinc-500"
              data-state={shellLoadingPresence.visible ? "open" : "closed"}
              aria-hidden={!loading}
              role="status"
            >
              Loading practice controls…
            </span>
          )}
        </div>
        <div className="player-stage relative" role="region" aria-label="Player stage — Sheet Music">
          {savedTranspose !== 0 && <p className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">
            Sheet Music stays in the original key; playback is transposed {savedTranspose > 0 ? `+${savedTranspose}` : savedTranspose} semitones.
          </p>}
          <SheetMusicView suspended={detail !== null} publicationRevision={initial.publicationRevision} songId={initial.song.id} />
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Sheet Music view active</p>
        </div>
      </div>

      {displayVariants.length > 1 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-zinc-500 mb-2">Same song, other levels</h2>
          <div className="flex flex-wrap gap-2">
            {displayVariants.map((variant) => (
              <Link
                key={variant.id}
                href={`/player/${variant.id}`}
                className={`px-3 py-2 rounded-full text-sm border ${variant.id === initial.song.id ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300 hover:bg-zinc-100"}`}
              >
                {levelLabel(variant.difficulty)}
              </Link>
            ))}
          </div>
        </section>
      )}

      {showDownload && <DownloadDialog publicationRevision={initial.publicationRevision} songId={initial.song.id} hasSheetXml={initial.song.hasSheetXml === 1} transpose={savedTranspose} onClose={() => {
        setShowDownload(false);
        window.requestAnimationFrame(() => downloadTriggerRef.current?.focus());
      }} />}

      <section className="mt-8 text-sm text-zinc-600">
        <h2 className="font-semibold text-zinc-800 mb-2">About this arrangement</h2>
        <p>Key of {initial.song.key} · {initial.song.tempo} BPM · {initial.song.bassPattern} bass</p>
        <p className="mt-2 text-zinc-500">Load practice controls to play, transpose, or switch to another learning view.</p>
      </section>
    </div>
  );

  if (detailSwitch.current && detail) {
    return (
      <div className="player-shell-swap">
        {detailSwitch.previous === false && (
          <div ref={shellExitRef} className="player-shell-swap-exit" aria-hidden="true">
            {shell}
          </div>
        )}
        <div className="player-shell-swap-enter">
          <FullPlayer initial={detail} mode={requestedMode} sheetPosition={sheetPositionRef.current} focusTarget={detailSwitch.previous === false ? "practice" : undefined} />
        </div>
      </div>
    );
  }
  return shell;
}

export function Player({ initial, mode }: { initial: PlayerInitial; mode: ViewMode | null }) {
  return isPlayerDetail(initial)
    ? <FullPlayer initial={initial} mode={mode} />
    : <PlayerShellView key={`${initial.song.id}:${mode ?? "sheet"}`} initial={initial} mode={mode} />;
}
