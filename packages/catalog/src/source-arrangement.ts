/** Actual arrangement identity, separate from the recording the user requested. */
export interface SourceArrangement {
  beta: true;
  requestedUrl: string;
  actualSourceUrl: string;
  sourceSha256: string;
  realizationSha256: string;
  sourceKind: "verified-native-midi";
  arrangementTitle: string;
  artist: string;
  title: string;
  timingOwner: "selected-arrangement";
  containsMelody: boolean;
  license: string;
  licenseEvidenceUrl: string;
  verificationEvidenceUrl: string;
  candidateSetDigest: string;
}

export function validateSourceArrangement(value: unknown): string[] {
  if (!value || typeof value !== "object") return ["sourceArrangement must be an object"];
  const s = value as SourceArrangement;
  const errors: string[] = [];
  if (s.beta !== true || s.sourceKind !== "verified-native-midi" || s.timingOwner !== "selected-arrangement" || typeof s.containsMelody !== "boolean") errors.push("invalid source arrangement kind, timing or melody status");
  for (const hash of [s.sourceSha256, s.realizationSha256, s.candidateSetDigest]) if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) errors.push("invalid source arrangement hash");
  for (const text of [s.arrangementTitle, s.artist, s.title]) if (typeof text !== "string" || !text.trim() || text.length > 500) errors.push("invalid arrangement identity");
  if (!["CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "Public-Domain"].includes(s.license)) errors.push("unverified arrangement license");
  for (const text of [s.requestedUrl, s.actualSourceUrl, s.licenseEvidenceUrl, s.verificationEvidenceUrl]) {
    try { const u = new URL(text); if (u.protocol !== "https:" || u.username || u.password) throw new Error(); }
    catch { errors.push("invalid source arrangement URL"); }
  }
  return errors;
}
