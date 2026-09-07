import {expect,it} from 'vitest';
import {tutorialIdentity} from '../src/tutorial-route.js';
it('uses song metadata or explicit title identity, never the tutorial or broadcaster channel',()=>{
 for(const title of ['The Pretty Reckless - Just Tonight - Piano tutorial and cover (Sheets + MIDI)','The Pretty Reckless (Taylor Momsen) - Just Tonight - Le Live']){
  expect(tutorialIdentity({title,uploader:'Cat piano tutorials'})).toMatchObject({artist:'The Pretty Reckless',title:'Just Tonight'});
 }
 expect(tutorialIdentity({title:'Anything',artist:'Metallica',track:'Nothing Else Matters'})).toMatchObject({artist:'Metallica',title:'Nothing Else Matters'});
 expect(()=>tutorialIdentity({title:'Unknown song',uploader:'Broadcaster'})).toThrow('unresolved song identity');
});
