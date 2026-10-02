import { blockedLearnerBases, disabledManifestBases, getDb, getSongsByBase, quarantinedBaseIds } from "@keyspilli/catalog";
import { loadSongArtifact, withStablePublication } from "./catalog-api";

/** Read-only triage. The canonical version-admission import contract is not installed. */
export async function ownerReviewList(after = "") {
  if (after && !/^[a-z0-9][a-z0-9-]{0,119}$/.test(after)) throw new Error("invalid review cursor");
  const blocked = blockedLearnerBases(), disabled = disabledManifestBases(), quarantined = quarantinedBaseIds();
  const bases = getDb().prepare("SELECT DISTINCT base_id FROM songs WHERE base_id > ? ORDER BY base_id LIMIT 26").all(after) as {base_id:string}[];
  const entries = [];
  for (const {base_id:baseId} of bases.slice(0,25)) {
    if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(baseId)) throw new Error("invalid catalog identity");
    try {
      const snapshot = await withStablePublication(baseId,undefined,async()=> {
        const rows = getSongsByBase(baseId);
        if (rows.length > 16) throw new Error("variant limit exceeded");
        const variants = [];
        for (const row of rows) {
          const loaded = await loadSongArtifact(row), manifest = loaded.artifact.manifest;
          variants.push({ id:row.id, tier:row.difficulty, sourceFingerprint:loaded.data?.sourceFingerprint ?? null,
            structural:loaded.artifact.status === "valid" ? "notes-and-manifest-validated" : loaded.artifact.status,
            noteCount:loaded.data?.notes.length ?? null,
            sourceHash:manifest?.sourceArtifactHash ?? null, profile:manifest?.arrangementProfile ?? null,
            sourceKind:manifest?.source?.kind ?? null, rightsAttested:manifest?.symbolicIntent?.rightsAttested ?? null,
            decisions:[{mode:"Original",status:"unavailable",listening:"unknown",keyboard:"unknown"},{mode:"Chords",status:"unavailable",listening:"unknown",keyboard:"unknown"}] });
        }
        return {title:rows[0]?.title ?? baseId,artist:rows[0]?.artist ?? "",variants};
      });
      entries.push({baseId,excluded:blocked.has(baseId)||disabled.has(baseId)||quarantined.has(baseId),state:"inspectable" as const,publicationRevision:snapshot.publicationRevision,...snapshot.value});
    } catch {
      entries.push({baseId,excluded:blocked.has(baseId)||disabled.has(baseId)||quarantined.has(baseId),state:"unavailable" as const,publicationRevision:null,title:baseId,artist:"",variants:[]});
    }
  }
  return {entries,next:bases.length>25?bases[24]!.base_id:null,admissionImport:"unavailable" as const};
}
export type OwnerReviewList = Awaited<ReturnType<typeof ownerReviewList>>;
