import { blockedLearnerBases, disabledManifestBases, getDb, getSongsByBase, quarantinedBaseIds, summarizeMusicalReviews, bindMusicalReviews, type MusicalReviewMode } from "@keyspilli/catalog";
import { loadSongArtifact, withStablePublication } from "./catalog-api";
import {musicalOutput,readMusicalReviews,readMusicalBinding} from "./owner-admission";

/** Read-only inventory; admission imports never change learner visibility. */
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
        const records=await readMusicalReviews(baseId);
        const publicationBinding=await readMusicalBinding(baseId);
        const revision=(await withStablePublication(baseId,undefined,async()=>null)).publicationRevision;
        async function decision(id:string,mode:MusicalReviewMode) {
          try {
            if (!revision) throw new Error("Unpinned publication");
            const output=await musicalOutput(baseId,id,mode,revision);
            return {...summarizeMusicalReviews(bindMusicalReviews(records,output.identity,publicationBinding),output.identity,output.endBeat),identity:output.identity,endBeat:output.endBeat};
          } catch {return {mode,status:"unavailable" as const,source:"pending" as const,listening:"pending" as const,keyboard:"pending" as const,receiptCount:0,staleCount:0,identity:null,endBeat:null};}
        }
        const chords=await decision(`${baseId}-a`,"Chords");
        if (rows.length > 16) throw new Error("variant limit exceeded");
        const variants = [];
        for (const row of rows) {
          const loaded = await loadSongArtifact(row), manifest = loaded.artifact.manifest;
          variants.push({ id:row.id, tier:row.difficulty, sourceFingerprint:loaded.data?.sourceFingerprint ?? null,
            structural:loaded.artifact.status === "valid" ? "notes-and-manifest-validated" : loaded.artifact.status,
            noteCount:loaded.data?.notes.length ?? null,
            sourceHash:manifest?.sourceArtifactHash ?? null, profile:manifest?.arrangementProfile ?? null,
            sourceKind:manifest?.source?.kind ?? null, rightsAttested:manifest?.symbolicIntent?.rightsAttested ?? null,
            decisions:[await decision(row.id,"Original"),chords] });
        }
        return {title:rows[0]?.title ?? baseId,artist:rows[0]?.artist ?? "",variants,receipts:records.map(({receiptSha256,receipt})=>({receiptSha256,...receipt})),publicationBinding};
      });
      entries.push({baseId,excluded:blocked.has(baseId)||disabled.has(baseId)||quarantined.has(baseId),state:"inspectable" as const,publicationRevision:snapshot.publicationRevision,...snapshot.value});
    } catch {
      entries.push({baseId,excluded:blocked.has(baseId)||disabled.has(baseId)||quarantined.has(baseId),state:"unavailable" as const,publicationRevision:null,title:baseId,artist:"",variants:[],receipts:[],publicationBinding:null});
    }
  }
  return {entries,next:bases.length>25?bases[24]!.base_id:null,admissionImport:"available" as const};
}
export type OwnerReviewList = Awaited<ReturnType<typeof ownerReviewList>>;
