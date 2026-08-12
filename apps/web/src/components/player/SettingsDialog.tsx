"use client";

import type { PlayerSettings } from "@keyspilli/player-core";

export function SettingsDialog({
  settings,
  onChange,
  onClose,
}: {
  settings: PlayerSettings;
  onChange: (p: Partial<PlayerSettings>) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Player settings"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold">Settings</h2>
          <button autoFocus onClick={onClose} className="px-2 py-1 rounded-lg hover:bg-zinc-100" aria-label="Close settings">×</button>
        </div>

        <div className="mb-4">
          <h3 className="text-sm font-medium mb-2">Background sound</h3>
          <div className="flex gap-2">
            {(["piano", "chord"] as const).map((b) => (
              <button
                key={b}
                onClick={() => onChange({ backgroundMode: b })}
                aria-pressed={settings.backgroundMode === b}
                className={`flex-1 px-3 py-2 rounded-xl text-sm border ${settings.backgroundMode === b ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-300"}`}
              >
                {b === "piano" ? "Piano background" : "Chord mode"}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            {settings.backgroundMode === "piano" ? "Plays the left hand as recorded" : "Synthesizes a chord on each change"}
          </p>
        </div>

        <div className="mb-2">
          <label className="flex justify-between text-sm mb-1">
            <span>Voice</span>
            <span className="font-mono text-xs">{Math.round(settings.voiceGain * 100)}%</span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.voiceGain * 100)}
            onChange={(e) => onChange({ voiceGain: Number(e.target.value) / 100 })}
            className="w-full"
            aria-label="Voice volume"
          />
        </div>
        <div className="mb-4">
          <label className="flex justify-between text-sm mb-1">
            <span>Piano</span>
            <span className="font-mono text-xs">{Math.round(settings.pianoGain * 100)}%</span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.pianoGain * 100)}
            onChange={(e) => onChange({ pianoGain: Number(e.target.value) / 100 })}
            className="w-full"
            aria-label="Piano volume"
          />
        </div>
        <label className="flex items-center gap-2 text-sm mb-4">
          <input
            type="checkbox"
            checked={settings.sustainPedal}
            onChange={(e) => onChange({ sustainPedal: e.target.checked })}
          />
          Sustain pedal
          <span className="text-xs text-zinc-500 ml-auto">Let notes ring past their written length</span>
        </label>

        <label className="flex items-center gap-2 text-sm mb-4">
          <input
            type="checkbox"
            checked={settings.showAllKeys}
            onChange={(e) => onChange({ showAllKeys: e.target.checked })}
          />
          Show all 88 keys
          <span className="text-xs text-zinc-500 ml-auto">Full piano instead of zoomed view</span>
        </label>

        <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-zinc-900 text-white text-sm font-medium">
          Done
        </button>
      </div>
    </div>
  );
}
