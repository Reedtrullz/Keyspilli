import type { SongData } from "@keyspilli/player-core";

const fixYouFingerprint = "variant:katherine-cordova-coldplay-fix-you-advanced-piano-cover-mslws0x0:a:katherine-cordova-coldplay-fix-you-advanced-piano-cover-mslws0x0-a:1e867afd1e1a389672199ebef7c355d0674b9995a40d655f7425f86b9967c851:notes:f251038e1ab8bdb0c5b23026d670fa819d5784580cf139db00e81ad1d09b2e9b";

/** Backing lanes from the exact user-reviewed colored-key tutorials. */
export function reviewedSourceBacking(data: SongData): SongData["notes"] | null {
  if (data.chordProvenance?.provider === "owner-candidate") return null;
  if (data.sourceFingerprint === fixYouFingerprint && data.tempoBpm === 68) {
    return data.notes.filter((note) => note.sourceLane === "blue keys" || note.sourceLane === "green keys");
  }
  return null;
}
