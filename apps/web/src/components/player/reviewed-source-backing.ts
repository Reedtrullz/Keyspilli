import type { SongData } from "@keyspilli/player-core";

const dreamerFingerprint = "variant:ozzy-osbourne-dreamer:a:ozzy-osbourne-dreamer-a:552ee76720620c3aba739c9442757f9675f99b2994a2f410471a583f250745b5:notes:6be7abe3a7498c1f8beab543dcd62cfac5c23635d42ed82764fa705b607bd020";
const fixYouFingerprint = "variant:katherine-cordova-coldplay-fix-you-advanced-piano-cover-mslws0x0:a:katherine-cordova-coldplay-fix-you-advanced-piano-cover-mslws0x0-a:1e867afd1e1a389672199ebef7c355d0674b9995a40d655f7425f86b9967c851:notes:f251038e1ab8bdb0c5b23026d670fa819d5784580cf139db00e81ad1d09b2e9b";

/** Backing lanes from the exact user-reviewed colored-key tutorials. */
export function reviewedSourceBacking(data: SongData): SongData["notes"] | null {
  if (data.sourceFingerprint === dreamerFingerprint && data.tempoBpm === 80) {
    return data.notes.filter((note) => note.sourceLane === "blue keys");
  }
  if (data.sourceFingerprint === fixYouFingerprint && data.tempoBpm === 68) {
    return data.notes.filter((note) => note.sourceLane === "blue keys" || note.sourceLane === "green keys");
  }
  return null;
}
