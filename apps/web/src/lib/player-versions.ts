import {join} from 'node:path';
import {dataDir,getDb,getSong,readRecoveryDocument,type SongRow} from '@keyspilli/catalog';

export interface PlayerVersion { id: string; label: string }

async function reviewLink(baseId:string):Promise<{sourceBaseId:string;version:string}|null>{
  try {
    const value:unknown=JSON.parse((await readRecoveryDocument(join(dataDir(),'artifacts',baseId,'review-provenance.json'),16384)).toString('utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const {sourceBaseId,version}=value as Record<string,unknown>;
    return typeof sourceBaseId==='string'&&/^[a-z0-9][a-z0-9-]{0,119}$/.test(sourceBaseId)
      &&typeof version==='string'&&/^[A-Z][A-Z0-9 -]{0,19}$/.test(version)
      ? {sourceBaseId,version}:null;
  } catch { return null; }
}

export async function getPlayerVersions(song:SongRow):Promise<PlayerVersion[]>{
  if(song.level!=='a'||!song.sourceYoutubeUrl)return [];
  const own=await reviewLink(song.baseId),sourceBaseId=own?.sourceBaseId??song.baseId;
  const original=getSong(sourceBaseId+'-a');
  if(!original||original.sourceYoutubeUrl!==song.sourceYoutubeUrl)return [];
  const candidates=getDb().prepare("SELECT id FROM songs WHERE level='a' AND source_youtube_url=? ORDER BY id LIMIT 17").all(song.sourceYoutubeUrl) as {id:string}[];
  if(candidates.length>16)return [];
  const versions:PlayerVersion[]=[{id:original.id,label:'Original'}];
  for(const candidate of candidates){
    const row=getSong(candidate.id);
    if(!row||row.id===original.id)continue;
    const link=await reviewLink(row.baseId);
    if(link?.sourceBaseId===sourceBaseId&&link.version!=='Original')versions.push({id:row.id,label:link.version});
  }
  if(versions.length<2||!versions.some(v=>v.id===song.id)||new Set(versions.map(v=>v.label)).size!==versions.length)return [];
  return [versions[0]!,...versions.slice(1).sort((a,b)=>a.label.localeCompare(b.label))];
}
