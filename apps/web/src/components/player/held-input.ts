/** Physical owners share an input voice. The last release ends it. */
export function createHeldInput(on: (midi: number) => boolean, off: (midi: number) => void) {
  const owners = new Map<string, number>();
  const counts = new Map<number, number>();
  const release = (token: string) => {
    const midi = owners.get(token);
    if (midi === undefined) return;
    owners.delete(token);
    const remaining = (counts.get(midi) ?? 1) - 1;
    if (remaining) counts.set(midi, remaining);
    else { counts.delete(midi); off(midi); }
  };
  return {
    press(token: string, midi: number): boolean {
      if (!Number.isInteger(midi) || midi < 0 || midi > 127) return false;
      if (owners.get(token) === midi) return true;
      release(token);
      const count = counts.get(midi) ?? 0;
      if (!count && !on(midi)) return false;
      owners.set(token, midi); counts.set(midi, count + 1);
      return true;
    },
    release,
    releaseAll() { for (const token of owners.keys()) release(token); },
  };
}
