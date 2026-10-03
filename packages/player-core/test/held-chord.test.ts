import {expect,it} from 'vitest';
import {ChordGrader} from '../src/chord-practice.js';
import {HeldChordGrader} from '../src/held-chord.js';
const targets=[{name:'C',notes:[60,64,67]},{name:'F/C',notes:[60,65,69]}];
it('separates discovery, physical exact voicings, bounded rolling holds and transition overlap',()=>{
 const discovery=new ChordGrader(targets),held=new HeldChordGrader(targets,'held',200,250);
 for(const [i,midi] of targets[0]!.notes.entries()){discovery.play(midi);held.press(midi,`key:${midi}`,1000+i*80);held.release(`key:${midi}`,1050+i*80);}
 expect(discovery.snapshot().completed).toBe(1);held.tick(2000);expect(held.snapshot().completed).toBe(0);
 held.press(72,'high-C',2100);held.press(64,'E',2150);held.press(67,'G',2200);held.tick(3000);expect(held.snapshot().completed).toBe(0);held.clearKeys();
 held.press(60,'C',3100);held.press(64,'E',3150);held.press(67,'G',3301);held.tick(4000);expect(held.snapshot().completed).toBe(0);held.clearKeys();
 held.press(60,'C',4100);held.press(64,'E',4150);held.press(67,'G',4200);held.tick(4450);expect(held.snapshot().completed).toBe(1);
 const transition=new HeldChordGrader(targets,'transition',200,250);
 transition.press(60,'C',1000);transition.press(64,'E',1050);transition.press(67,'G',1100);transition.tick(1350);
 transition.press(65,'F',1400);transition.press(69,'A',1450);transition.release('E',1460);transition.release('G',1480);transition.tick(1730);
 expect(transition.snapshot().completed).toBe(2);expect(transition.snapshot().transitionMetrics).toEqual([{gapMs:0,overlapMs:80}]);
 const slash=new HeldChordGrader([{name:'C/E',notes:[52,60,64,67,72]}],'held',200,250);
 for(const midi of [48,60,64,67,72])slash.press(midi,`${midi}`,1000);slash.tick(2000);expect(slash.snapshot().completed).toBe(0);
 slash.release('48',2100);slash.press(52,'52',2100);slash.tick(2400);expect(slash.snapshot().completed).toBe(0); // roll needs a fresh shape after the late bass
 slash.clearKeys();for(const midi of [52,60,64,67,72])slash.press(midi,`${midi}`,3000);slash.tick(3250);expect(slash.snapshot().completed).toBe(1);
 const repeated=new HeldChordGrader([targets[0]!,targets[0]!],'transition',200,250);for(const midi of [60,64,67])repeated.press(midi,`${midi}`,1000);repeated.tick(2000);repeated.tick(3000);expect(repeated.snapshot().completed).toBe(1);
 const reattack=new HeldChordGrader(targets,'transition',200,250);for(const midi of [60,64,67])reattack.press(midi,`${midi}`,1000);reattack.tick(1250);
 for(const midi of [60,64,67])reattack.release(`${midi}`,1300);reattack.press(60,'60',2000);reattack.press(65,'65',2301);reattack.press(69,'69',2301);reattack.tick(3000);expect(reattack.snapshot().completed).toBe(1);
 expect(()=>new HeldChordGrader(targets,'held',0,250)).toThrow();
});
