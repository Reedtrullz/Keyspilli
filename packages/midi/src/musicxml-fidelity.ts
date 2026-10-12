/** Shared policy for the playback importer and the independent notation adapter.
 * Call only for parsed XML elements, never comments, CDATA or escaped text.
 * Attribute keys must retain their exact source names: a qualified metadata key
 * or namespace declaration is not an unqualified MusicXML playback attribute. */
export class UnsupportedMusicXmlSemanticsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedMusicXmlSemanticsError";
  }
}

/** MusicXML note @dynamics is percent of MIDI forte velocity 90, not 0..127.
 * Missing means the established import default. Explicit values must describe
 * a positive, representable MIDI attack; invalid input is never clamped. */
export function musicXmlNoteVelocity(attributes: Readonly<Record<string, string>>): number {
  if (!Object.hasOwn(attributes, "dynamics")) return 80;
  const raw = attributes.dynamics!.trim();
  const percent = Number(raw);
  const velocity = Math.round(percent * 90 / 100);
  if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) || !Number.isFinite(percent)
    || percent <= 0 || percent > 127 * 100 / 90 || velocity < 1 || velocity > 127) {
    throw new UnsupportedMusicXmlSemanticsError("Unsupported MusicXML note dynamics: expected a decimal forte percentage representing MIDI attack velocity 1..127");
  }
  return velocity;
}

/** Six decimal places bound conversion error below half a MIDI integer. */
export function musicXmlVelocityPercent(velocity: number): string {
  if (!Number.isInteger(velocity) || velocity < 1 || velocity > 127) {
    throw new Error("MusicXML attack velocity must be an integer between 1 and 127");
  }
  return (velocity * 100 / 90).toFixed(6);
}

export function musicXmlElementFidelity(name: string, attributes: Readonly<Record<string, string>>, noteModel: "playback" | "notation" = "playback"): string[] {
  const local = name.split(":").at(-1)!.toLowerCase();
  if (local === "transpose" || local === "octave-shift") {
    // Even zero declarations are refused: this bounded importer does not track
    // part/staff state or resets. Never suggest deleting a declaration alone.
    throw new UnsupportedMusicXmlSemanticsError(`Unsupported MusicXML <${local}>: sounding-pitch conversion is unavailable; export concert-pitch MusicXML with transposition applied to the notes, or concert-pitch MIDI`);
  }
  const warnings: string[] = [];
  if (local === "dynamics" || (local === "sound" && Object.hasOwn(attributes, "dynamics"))) {
    warnings.push("MusicXML dynamics are not converted to note velocities");
  }
  if (local === "note" && Object.hasOwn(attributes, "dynamics")) {
    musicXmlNoteVelocity(attributes);
    if (noteModel === "notation") warnings.push("MusicXML per-note attack velocities are not represented by the native notation note model");
  }
  if (local === "note" && Object.hasOwn(attributes, "end-dynamics")) warnings.push("MusicXML note release velocities are not interpreted for expressive playback");
  if (local === "wedge") warnings.push("MusicXML wedge changes are not converted to a velocity curve");
  if (["articulations", "ornaments", "slur", "fermata"].includes(local)) {
    warnings.push(`MusicXML ${local} markings are not interpreted for expressive playback`);
  }
  if (local === "note" && ["attack", "release"].some(key => key in attributes && Number(attributes[key]) !== 0)) {
    throw new UnsupportedMusicXmlSemanticsError("Unsupported MusicXML note attack/release timing offsets; export a MIDI performance with those offsets applied, or a score with explicit supported event timing");
  }
  return warnings;
}
