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

export function musicXmlElementFidelity(name: string, attributes: Readonly<Record<string, string>>): string[] {
  const local = name.split(":").at(-1)!.toLowerCase();
  if (local === "transpose" || local === "octave-shift") {
    // Even zero declarations are refused: this bounded importer does not track
    // part/staff state or resets. Never suggest deleting a declaration alone.
    throw new UnsupportedMusicXmlSemanticsError(`Unsupported MusicXML <${local}>: sounding-pitch conversion is unavailable; export concert-pitch MusicXML with transposition applied to the notes, or concert-pitch MIDI`);
  }
  const warnings: string[] = [];
  if (local === "dynamics" || ((local === "sound" || local === "note") && "dynamics" in attributes)) {
    warnings.push("MusicXML dynamics are not converted to note velocities");
  }
  if (local === "wedge") warnings.push("MusicXML wedge changes are not converted to a velocity curve");
  if (["articulations", "ornaments", "slur", "fermata"].includes(local)) {
    warnings.push(`MusicXML ${local} markings are not interpreted for expressive playback`);
  }
  if (local === "note" && ["attack", "release"].some(key => key in attributes && Number(attributes[key]) !== 0)) {
    throw new UnsupportedMusicXmlSemanticsError("Unsupported MusicXML note attack/release timing offsets; export a MIDI performance with those offsets applied, or a score with explicit supported event timing");
  }
  return warnings;
}
