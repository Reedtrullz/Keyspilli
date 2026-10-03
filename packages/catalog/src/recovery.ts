import {opendir,stat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {dataDir} from "./paths.js";
import {readRecoveryDocument,reconcileBaseArtifact,validateStagedArtifactTree,type RecoveryReceipt} from "./publish.js";
import {parseArrangementManifest} from "./artifact-manifest.js";
import {commitCatalogPublication,commitCatalogDeletion,type CatalogPublication,type CatalogDeletion} from "./reconcile.js";
export interface RecoveryEntry {baseId:string;journalSha256:string|null;operation:"publish"|"delete"|"unknown";state:"reviewable"|"blocked";installed:boolean;rollback:boolean;staged:boolean;reason:string}
/** Read-only, redacted inventory. A snapshot is not proof that recovery can commit. */
export async function catalogRecoveryInventory(artifactsRoot=join(dataDir(),"artifacts")):Promise<{entries:RecoveryEntry[];truncated:boolean}>{
 const entries:RecoveryEntry[]=[];let scanned=0,truncated=false;
 let directory;try{directory=await opendir(artifactsRoot);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {entries,truncated};throw error;}
 for await(const file of directory){
  if(++scanned>10000||entries.length>=100){truncated=true;break;}
  const match=/^\.([a-z0-9][a-z0-9-]{0,119})\.reconciliation\.json$/.exec(file.name);if(!match)continue;
  const baseId=match[1]!,present=async(name:string)=>{try{return(await stat(join(artifactsRoot,name))).isDirectory();}catch{return false;}};
  const entry:RecoveryEntry={baseId,journalSha256:null,operation:"unknown",state:"blocked",installed:await present(baseId),rollback:await present(`.${baseId}.old`),staged:await present(`.${baseId}.new`),reason:"Unreadable or malformed journal. Preserve evidence for operator investigation."};
  try{const bytes=await readRecoveryDocument(join(artifactsRoot,file.name));entry.journalSha256=createHash("sha256").update(bytes).digest("hex");const journal=JSON.parse(bytes.toString("utf8"));
   if(journal.version===1&&["publish","delete"].includes(journal.operation)&&(journal.requiresCommit===undefined||typeof journal.requiresCommit==="boolean")
    &&(journal.operation==="delete"||typeof journal.token==="string"&&journal.token.length>0&&journal.token.length<=256)){
     entry.operation=journal.operation;entry.state="reviewable";entry.reason=journal.operation==="delete"?"Retry the recorded deletion and catalog commit. This can remove the affected artifact tree.":"Check the recorded publication, restore an uncommitted swap or retry its catalog commit. Ownership and full artifacts are checked under lock.";
   }
  }catch{/* Display no filesystem paths, source bodies or raw error text. */}
  entries.push(entry);
 }
 return {entries:entries.sort((a,b)=>a.baseId.localeCompare(b.baseId)),truncated};
}
export async function recoverCatalogPublication(baseId:string,expectedJournalSha256:string):Promise<RecoveryReceipt|null>{
 const artifactsRoot=join(dataDir(),"artifacts");
 return reconcileBaseArtifact(baseId,{artifactsRoot,expectedJournalSha256},async(data,operation)=>{
  if(operation==="delete"){if((data as CatalogDeletion)?.baseId!==baseId)throw new Error("reconciliation base mismatch");await commitCatalogDeletion(data);return;}
  if((data as CatalogPublication)?.baseId!==baseId)throw new Error("reconciliation base mismatch");
  const root=join(artifactsRoot,baseId),manifest=parseArrangementManifest(JSON.parse((await readRecoveryDocument(join(root,"manifest.json"))).toString("utf8")));
  const issues=await validateStagedArtifactTree(root,manifest);if(issues.length)throw new Error("artifact verification failed");
  await commitCatalogPublication(data);
 });
}
