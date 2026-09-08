import {tutorialImportsEnabled} from "../../../../../../../../packages/catalog/src/tutorial-imports";
import Database from 'better-sqlite3';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const getDb=vi.hoisted(()=>vi.fn());
vi.mock('@keyspilli/catalog',()=>({getDb,tutorialImportsEnabled}));
import {PATCH} from './route';
import {publicJobError} from '../../../../../lib/job-error';
let db:Database.Database;
const params={params:Promise.resolve({id:'job-test'})};
const request=(origin='http://localhost:3000',body:unknown={action:'cancel'})=>new Request('http://localhost:3000/api/youtube/jobs/job-test',{method:'PATCH',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{
 vi.stubEnv('NODE_ENV','development');vi.stubEnv('KEYSPILLI_TUTORIAL_PREVIEW','1');vi.stubEnv('KEYSPILLI_DATA_DIR','/isolated');
 db=new Database(':memory:');getDb.mockReturnValue(db);
 db.exec("CREATE TABLE conversion_jobs(id TEXT,status TEXT,song_id TEXT,error TEXT,finished_at TEXT,lease_owner TEXT,lease_expires_at INTEGER); INSERT INTO conversion_jobs VALUES('job-test','processing',NULL,NULL,NULL,'owner',12345)");
});
afterEach(()=>{db.close();vi.unstubAllEnvs();getDb.mockClear();});
it.each(['queued','processing'])('cancels %s while retaining evidence row and revoking its lease',async status=>{
 db.prepare('UPDATE conversion_jobs SET status=?').run(status);
 expect((await PATCH(request(),params)).status).toBe(200);
 const row=db.prepare('SELECT * FROM conversion_jobs').get() as Record<string,unknown>;
 expect(row.status).toBe('error');expect(row.error).toBe('TUTORIAL_PREVIEW_CANCELLED');expect(row.lease_owner).toBeNull();expect(row.finished_at).toBeTruthy();
 expect(publicJobError(row.error)).toContain('cancelled');
});
it.each([['done','song'],['error',null],['processing','existing-song']])('preserves terminal or existing-song jobs (%s)',async(status,song)=>{
 db.prepare('UPDATE conversion_jobs SET status=?,song_id=?').run(status,song);
 expect((await PATCH(request(),params)).status).toBe(409);
 expect((db.prepare('SELECT status FROM conversion_jobs').get() as {status:string}).status).toBe(status);
});
it('rejects production, cross-origin, malformed, and missing job requests',async()=>{
 vi.stubEnv('NODE_ENV','production');expect((await PATCH(request(),params)).status).toBe(410);
 vi.stubEnv('NODE_ENV','development');expect((await PATCH(request('https://attacker.example'),params)).status).toBe(403);
 expect((await PATCH(request(undefined,{action:'cancel',delete:true}),params)).status).toBe(400);
 expect((await PATCH(request(),{params:Promise.resolve({id:'missing'})})).status).toBe(404);
 expect((db.prepare('SELECT status FROM conversion_jobs').get() as {status:string}).status).toBe('processing');
});
it('cancels private beta in production through existing mutation auth',async()=>{
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('KEYSPILLI_TUTORIAL_BETA','1');vi.stubEnv('KEYSPILLI_API_TOKEN','fixture-token');
 expect((await PATCH(request(),params)).status).toBe(200);
 expect((db.prepare('SELECT lease_owner FROM conversion_jobs').get() as {lease_owner:unknown}).lease_owner).toBeNull();
});
