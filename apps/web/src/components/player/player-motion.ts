"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Keep player overlays present for the short exit transition instead of
 * disappearing on the same render as the close action. The callback is held
 * in a ref so parent renders (which commonly create inline callbacks) do not
 * restart an in-flight close.
 */
export const PLAYER_MOTION_MS = 200;

/**
 * Keep a transient surface mounted long enough to play its exit transition.
 * The returned `visible` flag is intentionally separate from `mounted` so
 * callers can animate both entering and leaving without changing layout
 * semantics or reaching for a third-party animation dependency.
 */
export function usePresence(present: boolean, duration = PLAYER_MOTION_MS) {
  const [mounted, setMounted] = useState(present);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (present) {
      setMounted(true);
      setVisible(false);
      const frame = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setVisible(false);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setMounted(false);
    }, prefersReducedMotion() ? 0 : duration);
    return undefined;
  }, [duration, present]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  return { mounted, visible };
}

/**
 * Keep the previous value around for one short frame window so a view can
 * cross-fade instead of disappearing at the same instant its replacement
 * mounts. The current value is updated immediately; the old layer is only a
 * visual exit layer and should never receive pointer or keyboard input.
 */
export function useAnimatedSwitch<T>(value: T, duration = PLAYER_MOTION_MS) {
  const currentRef = useRef(value);
  const [previous, setPrevious] = useState<T | null>(null);
  const timerRef = useRef<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (Object.is(value, currentRef.current)) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const outgoing = currentRef.current;
    currentRef.current = value;
    if (prefersReducedMotion()) {
      setPrevious(null);
      return;
    }
    setPrevious(outgoing);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setPrevious(null);
    }, duration);
  }, [duration, value]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  // Use the incoming value directly during render. The outgoing layer is
  // stateful because it must survive for the exit animation, but the current
  // layer should never spend a frame showing stale content during a rapid
  // state change (for example, done → queued on the YouTube route).
  return { current: value, previous, transitioning: previous !== null };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useDialogMotion(onClose: () => void) {
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Start the enter transition after the first paint. SSR and hydration both
  // begin in the closed visual state, so this does not introduce a mismatch.
  useEffect(() => {
    if (typeof window.requestAnimationFrame === "function") {
      const frame = window.requestAnimationFrame(() => setEntered(true));
      return () => window.cancelAnimationFrame(frame);
    }
    const timeout = window.setTimeout(() => setEntered(true), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    if (prefersReducedMotion()) {
      onCloseRef.current();
      return;
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onCloseRef.current();
    }, PLAYER_MOTION_MS);
  }, [closing]);

  return {
    visible: entered && !closing,
    closing,
    requestClose,
  };
}

/** Shared Tailwind classes for player overlays and floating panels. */
export function dialogMotionClasses(visible: boolean, inert = false) {
  const interaction = inert ? "pointer-events-none" : "";
  return {
    // Keep a newly mounted dialog clickable while its enter opacity catches
    // up. Pointer events are disabled only for an actual exit, when callers
    // also apply inert/aria-hidden to the retained subtree.
    overlay: `transition-opacity duration-200 ease-out motion-reduce:transition-none ${visible ? "opacity-100" : "opacity-0"} ${interaction}`,
    panel: `transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${visible ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-2 scale-95"} ${interaction}`,
  };
}
