import type { InputEventMetadata } from "@keyspilli/player-core";

/** Physical owners share an input voice. The last release ends it. */
export function createHeldInput(on: (midi: number, event?: InputEventMetadata) => boolean, off: (midi: number) => void) {
  const owners = new Map<string, number>();
  const counts = new Map<number, number>();
  const pedals = new Set<string>(), released = new Set<string>();
  const release = (token: string, force = false) => {
    const midi = owners.get(token);
    if (midi === undefined) return;
    if (!force && [...pedals].some(scope => token.startsWith(scope))) { released.add(token); return; }
    released.delete(token); owners.delete(token);
    const remaining = (counts.get(midi) ?? 1) - 1;
    if (remaining) counts.set(midi, remaining);
    else { counts.delete(midi); off(midi); }
  };
  return {
    press(token: string, midi: number, event?: InputEventMetadata): boolean {
      if (!Number.isInteger(midi) || midi < 0 || midi > 127) return false;
      if (owners.get(token) === midi && !released.has(token)) return true;
      release(token, true);
      const count = counts.get(midi) ?? 0;
      if (!count && !(event ? on(midi, event) : on(midi))) return false;
      owners.set(token, midi); counts.set(midi, count + 1);
      return true;
    },
    release,
    setPedal(scope: string, down: boolean) {
      if (down) pedals.add(scope);
      else { pedals.delete(scope); for (const token of released) if (token.startsWith(scope)) release(token, true); }
    },
    releaseAll() { pedals.clear(); for (const token of owners.keys()) release(token, true); },
  };
}
