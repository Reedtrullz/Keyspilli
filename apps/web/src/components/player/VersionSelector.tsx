import type { PlayerVersion } from "../../lib/player-versions";

export function VersionSelector({ versions, selected, disabled, onChange }: {
  versions?: PlayerVersion[];
  selected: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  if (!versions || versions.length < 2) return null;
  return (
    <label className="inline-flex items-center gap-2 mt-2 text-sm">
      Version
      <select aria-label="Version" value={selected} disabled={disabled} onChange={event => onChange(event.target.value)} className="min-h-11 rounded-full border border-zinc-300 bg-transparent px-3 py-2">
        {versions.map(version => <option key={version.id} value={version.id}>{version.label}</option>)}
      </select>
    </label>
  );
}
