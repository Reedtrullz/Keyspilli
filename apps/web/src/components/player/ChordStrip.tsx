"use client";

interface ChordStripProps {
  chords: { beat: number; name: string; notes: number[] }[];
  currentBeat: number;
}

/** Mini piano keyboard diagram for a single chord. */
function MiniKeyboard({ notes }: { notes: number[] }) {
  // Show one octave range centered on the chord's lowest note
  const low = Math.min(...notes);
  const high = Math.max(...notes);
  // Expand to cover at least an octave
  const rangeLow = Math.floor(low / 12) * 12;
  const rangeHigh = rangeLow + 12;
  const W = 56;
  const H = 28;
  const noteSet = new Set(notes.map((n) => n % 12));
  const WHITE = [0, 2, 4, 5, 7, 9, 11];
  const whites = WHITE.filter((pc) => pc + rangeLow >= low - 1 && pc + rangeLow <= high + 1);
  if (whites.length === 0) whites.push(0);
  const ww = W / (whites.length || 1);

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {whites.map((pc, i) => {
        const midi = pc + rangeLow;
        const active = noteSet.has(midi % 12);
        return (
          <rect
            key={`w${i}`}
            x={i * ww}
            y={0}
            width={ww - 1}
            height={H}
            rx={2}
            fill={active ? "#3b82f6" : "#ffffff"}
            stroke="#d4d4d8"
            strokeWidth={0.5}
          />
        );
      })}
      {whites.slice(0, -1).map((pc, i) => {
        const sharpPc = pc + 1;
        const isBlack = !WHITE.includes(sharpPc);
        if (!isBlack) return null;
        const midi = sharpPc + rangeLow;
        const active = noteSet.has(midi % 12);
        const x = (i + 1) * ww - ww * 0.3;
        const bw = ww * 0.6;
        return (
          <rect
            key={`b${i}`}
            x={x}
            y={0}
            width={bw}
            height={H * 0.6}
            rx={1}
            fill={active ? "#2563eb" : "#27272a"}
          />
        );
      })}
    </svg>
  );
}

export function ChordStrip({ chords, currentBeat }: ChordStripProps) {
  if (chords.length === 0) return null;

  // Find which chord is currently active
  let activeIdx = 0;
  for (let i = chords.length - 1; i >= 0; i--) {
    if (currentBeat >= chords[i]!.beat) {
      activeIdx = i;
      break;
    }
  }

  return (
    <div className="flex gap-2 overflow-x-auto px-3 py-2 border-b border-zinc-100 bg-white" role="list" aria-label="Chord progression">
      {chords.map((c, i) => (
        <div
          key={i}
          role="listitem"
          className={`flex flex-col items-center gap-0.5 shrink-0 px-2 py-1 rounded-lg transition-colors ${
            i === activeIdx ? "bg-blue-50 ring-1 ring-blue-300" : ""
          }`}
        >
          <span className={`text-[10px] font-semibold leading-tight ${i === activeIdx ? "text-blue-700" : "text-zinc-600"}`}>
            {c.name}
          </span>
          <MiniKeyboard notes={c.notes} />
        </div>
      ))}
    </div>
  );
}
