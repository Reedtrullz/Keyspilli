"use client";

import { useEffect, useRef } from "react";
import { noteLabel, pitchColor, type PlayerSettings, type TimedNote } from "@keyspilli/player-core";

interface Props {
  notes: TimedNote[];
  timeRef: React.MutableRefObject<number>;
  settings: PlayerSettings;
  pressedKeys: Set<number>;
  chords: { beat: number; name: string; notes: number[] }[];
  tempoBpm: number;
}

export function FallingCanvas({ notes, timeRef, settings, pressedKeys, chords, tempoBpm }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ notes, settings, pressedKeys, chords, tempoBpm });
  propsRef.current = { notes, settings, pressedKeys, chords, tempoBpm };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const W = 960;
    const H = 500;
    const KB_H = 140;
    const LEFT_MARGIN = 70;
    const RIGHT_MARGIN = 16;
    const CHORD_ZONE_RATIO = 0.38;
    const DIVIDER_GAP = 6;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = "100%";

    const draw = () => {
      const { notes, settings: s, pressedKeys: pk, chords: ch, tempoBpm: bpm } = propsRef.current;
      const now = timeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, W, H);

      const speed = s.speed;
      const lookahead = 3.2;
      const areaHeight = H - KB_H - 10;
      const pxPerSec = areaHeight / lookahead;

      // Split notes by hand
      const leftNotes = notes.filter((n) => n.hand === "L");
      const rightNotes = notes.filter((n) => n.hand !== "L");

      // Zone layout
      const totalW = W - LEFT_MARGIN - RIGHT_MARGIN;
      const chordW = Math.round(totalW * CHORD_ZONE_RATIO);
      const melodyX = LEFT_MARGIN + chordW + DIVIDER_GAP;
      const melodyW = W - RIGHT_MARGIN - melodyX;

      // Pitch ranges for each zone
      const leftMidi = leftNotes.length > 0
        ? { lo: Math.min(...leftNotes.map((n) => n.midi)) - 1, hi: Math.max(...leftNotes.map((n) => n.midi)) + 1 }
        : { lo: 48, hi: 60 };
      const rightMidi = rightNotes.length > 0
        ? { lo: Math.min(...rightNotes.map((n) => n.midi)) - 1, hi: Math.max(...rightNotes.map((n) => n.midi)) + 1 }
        : { lo: 60, hi: 84 };
      if (leftMidi.hi <= leftMidi.lo) leftMidi.hi = leftMidi.lo + 12;
      if (rightMidi.hi <= rightMidi.lo) rightMidi.hi = rightMidi.lo + 12;

      // Helper: map MIDI to zone-local x
      const localX = (midi: number, zoneX: number, zoneW: number, lo: number, hi: number) => {
        const t = (midi - lo) / (hi - lo);
        return zoneX + t * (zoneW - 24) + 12;
      };

      // --- Determine current chord ---
      const beatSec = 60 / (bpm * speed);
      const currentBeat = now / beatSec;
      let activeChordNotes: Set<number> = new Set();
      for (let i = ch.length - 1; i >= 0; i--) {
        if (currentBeat >= ch[i]!.beat) {
          activeChordNotes = new Set(ch[i]!.notes);
          break;
        }
      }

      // --- Zone divider ---
      const dividerX = LEFT_MARGIN + chordW + DIVIDER_GAP / 2;
      ctx.strokeStyle = "#e4e4e7";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(dividerX, 0);
      ctx.lineTo(dividerX, areaHeight);
      ctx.stroke();
      ctx.setLineDash([]);

      // --- Zone labels ---
      ctx.font = "600 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#a1a1aa";
      ctx.fillText("CHORDS", LEFT_MARGIN + chordW / 2, 14);
      ctx.fillText("MELODY", melodyX + melodyW / 2, 14);

      // --- Chord labels on the left margin ---
      for (const c of ch) {
        const cSec = (c.beat * 60) / (bpm * speed);
        const bottom = areaHeight - (cSec - now) * pxPerSec;
        if (bottom < -30 || bottom > areaHeight + 30) continue;
        const y = Math.max(24, Math.min(areaHeight - 6, bottom - 4));
        ctx.font = "700 12px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#18181b";
        ctx.fillText(c.name, LEFT_MARGIN - 8, y);
      }

      // --- Draw lyrics (right side) ---
      for (const n of notes) {
        if (!n.lyrics) continue;
        const bottom = areaHeight - (n.startSec - now) * pxPerSec;
        if (bottom < -20 || bottom > areaHeight + 20) continue;
        const y = Math.max(14, Math.min(areaHeight - 4, bottom - 4));
        ctx.font = "13px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#52525b";
        ctx.fillText(n.lyrics, W - RIGHT_MARGIN + 4, y);
      }

      // --- Draw left-hand bars (chord zone) ---
      for (const n of leftNotes) {
        if (n.startSec > now + lookahead || n.startSec + n.durSec < now - 0.05) continue;
        const x = localX(n.midi, LEFT_MARGIN, chordW, leftMidi.lo, leftMidi.hi);
        const bottom = areaHeight - (n.startSec - now) * pxPerSec;
        const height = Math.max(8, n.durSec * pxPerSec - 2);
        const y = bottom - height;
        const col = pitchColor(n.midi);
        // Wide, semi-transparent ghost bar
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(x - 10, y, 24, height, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        // Note label on longer bars
        if (height >= 14) {
          ctx.font = "600 10px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = col;
          ctx.fillText(noteLabel(n.midi), x + 2, Math.min(y + height / 2, areaHeight - 4));
        }
      }

      // --- Draw right-hand bars (melody zone) ---
      for (const n of rightNotes) {
        if (n.startSec > now + lookahead || n.startSec + n.durSec < now - 0.05) continue;
        const x = localX(n.midi, melodyX, melodyW, rightMidi.lo, rightMidi.hi);
        const bottom = areaHeight - (n.startSec - now) * pxPerSec;
        const height = Math.max(8, n.durSec * pxPerSec - 2);
        const y = bottom - height;
        const col = pitchColor(n.midi);
        const barW = Math.min(28, melodyW / (rightMidi.hi - rightMidi.lo + 1) * 0.7);
        // Vivid bar with note label
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(x - barW / 2, y, barW, height, 4);
        ctx.fill();
        if (height >= 11) {
          const fs = Math.min(12, Math.max(9, height - 6));
          ctx.font = `600 ${fs}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.strokeStyle = "rgba(0,0,0,0.4)";
          ctx.lineWidth = 3;
          ctx.strokeText(noteLabel(n.midi), x, Math.min(y + height / 2, areaHeight - 4));
          ctx.fillStyle = "#ffffff";
          ctx.fillText(noteLabel(n.midi), x, Math.min(y + height / 2, areaHeight - 4));
        }
      }

      // --- Keyboard ---
      const allMidi = [...leftNotes.map((n) => n.midi), ...rightNotes.map((n) => n.midi)];
      const kbLow = allMidi.length > 0 ? Math.min(...allMidi) - 3 : 48;
      const kbHigh = allMidi.length > 0 ? Math.max(...allMidi) + 3 : 72;
      const kbX = LEFT_MARGIN;
      const kbW = W - LEFT_MARGIN - RIGHT_MARGIN;
      const whiteKeys: { midi: number; x: number; w: number }[] = [];
      const blackKeys: { midi: number; x: number; w: number }[] = [];
      const WHITE = [0, 2, 4, 5, 7, 9, 11];
      const whites: number[] = [];
      for (let m = kbLow; m <= kbHigh; m++) {
        if (WHITE.includes(m % 12)) whites.push(m);
        else blackKeys.push({ midi: m, x: 0, w: 0 });
      }
      const ww = kbW / Math.max(whites.length, 1);
      for (let i = 0; i < whites.length; i++) {
        whiteKeys.push({ midi: whites[i]!, x: kbX + i * ww, w: ww });
      }
      for (const bk of blackKeys) {
        const prevWhite = bk.midi - 1;
        const idx = whites.indexOf(prevWhite);
        if (idx < 0) continue;
        bk.x = kbX + idx * ww + ww - ww * 0.3;
        bk.w = ww * 0.6;
      }

      // Render white keys
      for (const w of whiteKeys) {
        const isChord = activeChordNotes.has(w.midi) && !pk.has(w.midi);
        ctx.fillStyle = pk.has(w.midi) ? pitchColor(w.midi) : "#ffffff";
        ctx.fillRect(w.x, H - KB_H, w.w - 1, KB_H);
        ctx.strokeStyle = "#d4d4d8";
        ctx.strokeRect(w.x, H - KB_H, w.w - 1, KB_H);
        if (isChord) {
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = pitchColor(w.midi);
          ctx.fillRect(w.x, H - KB_H, w.w - 1, KB_H);
          ctx.globalAlpha = 1;
          ctx.fillStyle = pitchColor(w.midi);
          ctx.fillRect(w.x, H - 36, w.w - 1, 36);
          ctx.strokeStyle = pitchColor(w.midi);
          ctx.lineWidth = 2;
          ctx.strokeRect(w.x + 1, H - KB_H, w.w - 3, KB_H);
          ctx.fillStyle = "#ffffff";
          ctx.font = "700 13px system-ui, sans-serif";
        } else {
          ctx.fillStyle = pk.has(w.midi) ? "#ffffff" : "#52525b";
          ctx.font = "600 12px system-ui, sans-serif";
        }
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(noteLabel(w.midi), w.x + w.w / 2, H - 18);
      }
      // Render black keys
      for (const bk of blackKeys) {
        if (bk.w === 0) continue;
        const isChordB = activeChordNotes.has(bk.midi) && !pk.has(bk.midi);
        ctx.fillStyle = pk.has(bk.midi) ? pitchColor(bk.midi) : "#27272a";
        ctx.fillRect(bk.x, H - KB_H, bk.w, KB_H * 0.62);
        if (isChordB) {
          ctx.fillStyle = pitchColor(bk.midi);
          ctx.fillRect(bk.x, H - KB_H * 0.62, bk.w, KB_H * 0.62);
          ctx.strokeStyle = pitchColor(bk.midi);
          ctx.lineWidth = 2;
          ctx.strokeRect(bk.x, H - KB_H * 0.62, bk.w, KB_H * 0.62);
        }
        if (bk.w >= 17) {
          ctx.font = "600 9px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          ctx.fillStyle = pk.has(bk.midi) || isChordB ? "#ffffff" : "#d4d4d8";
          ctx.fillText(noteLabel(bk.midi), bk.x + bk.w / 2, H - 16);
        }
      }

      // --- Playhead line ---
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(LEFT_MARGIN, areaHeight);
      ctx.lineTo(W - RIGHT_MARGIN, areaHeight);
      ctx.stroke();
      ctx.fillStyle = "#18181b";
      ctx.font = "12px monospace";
      ctx.fillText(`${now.toFixed(1)}s`, LEFT_MARGIN + 4, areaHeight - 6);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [timeRef]);

  return (
    <div className="relative">
      <canvas ref={canvasRef} aria-label="Falling notes player" className="w-full h-auto" style={{ aspectRatio: "960/500", width: "100%" }} />
      <div className="absolute bottom-2 left-3 text-[11px] text-zinc-400 pointer-events-none">
        Keys: A–K / ; play · Z / X shift octave · practice graded
      </div>
    </div>
  );
}
