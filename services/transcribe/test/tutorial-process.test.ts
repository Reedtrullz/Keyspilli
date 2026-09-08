import {describe,it,expect} from 'vitest';
import {runTutorialProcess} from '../src/tutorial-route.js';
describe('tutorial subprocess boundary',()=>{
 it('returns output and redacts subprocess diagnostics',async()=>{
  expect(await runTutorialProcess(process.execPath,['-e','process.stdout.write("ok")'],2000)).toBe('ok');
  await expect(runTutorialProcess(process.execPath,['-e','process.stderr.write("private-token");process.exit(1)'],2000)).rejects.toThrow('tutorial subprocess failed');
 });
 it('aborts a running subprocess and respects lease loss',async()=>{
  const controller=new AbortController();
  const pending=runTutorialProcess(process.execPath,['-e','setInterval(()=>{},1000)'],5000,{signal:controller.signal});
  controller.abort();
  await expect(pending).rejects.toThrow('cancelled');
  let active=true;
  const lease=runTutorialProcess(process.execPath,['-e','setInterval(()=>{},1000)'],5000,{checkActive(){if(!active)throw Error('lease lost');}});
  active=false;
  await expect(lease).rejects.toThrow('cancelled');
 });
 it('bounds subprocess duration',async()=>{
  await expect(runTutorialProcess(process.execPath,['-e','setInterval(()=>{},1000)'],50)).rejects.toThrow('timed out');
 });
});

it('retains only safe failure classifications and private redacted diagnostics',async()=>{
 const {tutorialFailure,tutorialIdentity}=await import('../src/tutorial-route.js');
 expect(tutorialFailure(Error('SOURCE_REVIEW_REQUIRED: insufficient free disk space; at least 30GiB required')).reason).toContain('insufficient free disk space');
 expect(()=>tutorialIdentity({title:'Unresolved'})).toThrow('unresolved song identity');
 try{tutorialIdentity({title:'Unresolved'});}catch(error){expect(tutorialFailure(error).reason).toContain('unresolved song identity');}
 const stderr='decoder failed https://name:password@host --cookies /private/cookies Authorization: Bearer abc123 token=secret-token';
 const error=await runTutorialProcess(process.execPath,['-e',`process.stderr.write(${JSON.stringify(stderr)});process.exit(1)`],2000).catch(error=>error);
 const receipt=JSON.stringify({attempts:[tutorialFailure(error)]});
 expect(receipt).toContain('decoder failed');
 for(const secret of ['password','/private/cookies','abc123','secret-token'])expect(receipt).not.toContain(secret);
 expect(error.message).toBe('SOURCE_REVIEW_REQUIRED: tutorial subprocess failed');
 expect(tutorialFailure(Error('SOURCE_REVIEW_REQUIRED: token=secret')).reason).toBe('SOURCE_REVIEW_REQUIRED: tutorial resolution failed');
});
