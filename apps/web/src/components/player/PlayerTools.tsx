"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type PlayerTool = "display" | "sound" | "input";
const names = { display: "Display", sound: "Sound", input: "Input" };

/** One out-of-flow panel; native modal behavior supplies phone focus/inertness. */
export function PlayerTools({ open, onOpen, children, soundLabel }: {
  soundLabel: string;
  open: PlayerTool | null;
  onOpen: (tool: PlayerTool | null) => void;
  children: (tool: PlayerTool) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [mobile, setMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef(() => onOpen(null));
  closeRef.current = () => onOpen(null);
  useEffect(() => {
    setMounted(true);
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => setMobile(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const node = panel.current;
    if (!node || !open) return;
    if (mobile) { node.style.top = ""; node.style.maxHeight = ""; node.style.maxWidth = ""; node.showModal(); } else node.show();
    const position = () => {
      const box = root.current?.getBoundingClientRect();
      if (box && !mobile) {
        const scale = node.getBoundingClientRect().width / node.offsetWidth || 1;
        const height = Math.min(560 * scale, window.innerHeight - 24);
        const top = Math.max(12, Math.min(box.bottom + 8, window.innerHeight - height - 12));
        node.style.top = `${top / scale}px`;
        node.style.maxHeight = `${height / scale}px`;
        node.style.maxWidth = `${(window.innerWidth - 24) / scale}px`;
        node.style.right = `${Math.max(12, window.innerWidth - box.right) / scale}px`;
      }
    };
    position();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!mobile && !node.contains(target) && !root.current?.contains(target)) closeRef.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      node.close();
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, mobile]);
  const previous = useRef(open);
  useEffect(() => {
    if (previous.current && !open) trigger.current?.focus({ preventScroll: true });
    previous.current = open;
  }, [open]);
  return <div className="player-tools" ref={root}>
    <div className="player-tool-triggers">
      {(Object.keys(names) as PlayerTool[]).map(tool => <button key={tool}
        className="pressable min-h-11 px-3 rounded-full border border-zinc-300 text-sm"
        aria-label={tool === "sound" ? names[tool] : undefined} title={tool === "sound" && mounted ? soundLabel : undefined} aria-description={tool === "sound" && mounted ? soundLabel : undefined} aria-expanded={open === tool} aria-controls="player-tool-panel"
        onClick={event => { trigger.current = event.currentTarget; onOpen(open === tool ? null : tool); }}>{names[tool]}{tool === "sound" && mounted && <span className="block text-[10px] leading-3 text-zinc-500">{soundLabel.split(" · ")[0]}</span>}</button>)}
    </div>
    <button className="player-tools-compact min-h-11 px-3 rounded-full border border-zinc-300 text-sm"
      title={mounted ? soundLabel : undefined} aria-description={mounted ? soundLabel : undefined} aria-expanded={open !== null} aria-controls="player-tool-panel"
      onClick={event => { trigger.current = event.currentTarget; onOpen(open ? null : "display"); }}>Tools</button>
    {mounted && open && createPortal(<dialog ref={panel} id="player-tool-panel" className="player-tool-panel"
      aria-label={`${names[open]} settings`} aria-modal={mobile ? true : undefined}
      onCancel={event => { event.preventDefault(); onOpen(null); }}
      onClick={event => { if (event.target === event.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onOpen(null);
      } }}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex gap-1" aria-label="Player tools">
          {(Object.keys(names) as PlayerTool[]).map(tool => <button key={tool} aria-pressed={open === tool}
            className={`min-h-11 px-3 rounded-lg text-sm ${open === tool ? "bg-zinc-900 text-white" : "hover:bg-zinc-100"}`}
            onClick={() => onOpen(tool)}>{names[tool]}</button>)}
        </div>
        <button className="min-h-11 min-w-11 rounded-lg hover:bg-zinc-100" aria-label="Close tools" onClick={() => onOpen(null)}>×</button>
      </div>
      {children(open)}
    </dialog>, document.body)}
  </div>;
}
