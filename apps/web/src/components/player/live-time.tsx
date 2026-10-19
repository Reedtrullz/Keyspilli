"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/**
 * Playback clock as an external store. The player publishes the engine time
 * here at 10 Hz; only components that read it subscribe, so a tick no longer
 * re-renders the whole player.
 */
export interface TimeStore {
  get(): number;
  set(time: number): void;
  subscribe(listener: () => void): () => void;
}

export function createTimeStore(initial = 0): TimeStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Subscribe to a primitive derived from the clock; re-renders only when it changes. */
export function useTimeSelector<T extends string | number | boolean>(store: TimeStore, select: (time: number) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}

/** Re-renders its render-prop child on every clock tick, leaving the parent untouched. */
export function TimeValue({ store, children }: { store: TimeStore; children: (time: number) => ReactNode }) {
  const time = useTimeSelector(store, (t) => t);
  return <>{children(time)}</>;
}
