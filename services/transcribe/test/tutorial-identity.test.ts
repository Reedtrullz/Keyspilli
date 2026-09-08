import {expect,it} from 'vitest';
import {tutorialIdentity,matchesTutorialIdentity} from '../src/tutorial-route.js';
it('uses song metadata or explicit title identity, never the tutorial or broadcaster channel',()=>{
 for(const title of ['The Pretty Reckless - Just Tonight - Piano tutorial and cover (Sheets + MIDI)','The Pretty Reckless (Taylor Momsen) - Just Tonight - Le Live']){
  expect(tutorialIdentity({title,uploader:'Cat piano tutorials'})).toMatchObject({artist:'The Pretty Reckless',title:'Just Tonight'});
 }
 expect(tutorialIdentity({title:'Anything',artist:'Metallica',track:'Nothing Else Matters'})).toMatchObject({artist:'Metallica',title:'Nothing Else Matters'});
 expect(()=>tutorialIdentity({title:'Unknown song',uploader:'Broadcaster'})).toThrow('unresolved song identity');
});

it('uses a title-supported description to resolve Song - Artist tutorials',()=>{
 expect(tutorialIdentity({title:'Just Tonight - The Pretty Reckless | PIANO tutorial',description:'Learn how to play Just Tonight by The Pretty Reckless on the piano.'})).toMatchObject({artist:'The Pretty Reckless',title:'Just Tonight'});
 expect(tutorialIdentity({title:'Artist - Song',description:'Learn how to play Something Else by Someone Else on the piano.'})).toMatchObject({artist:'Artist',title:'Song'});
});

it('recognizes double separators and quoted songs in broadcast titles',()=>{
 for(const title of ['The Pretty Reckless || For I Am Death || (Lyrics)','The Pretty Reckless "For I Am Death", live at Hellfest Open Air 2026 – ARTE Concert'])
  expect(tutorialIdentity({title})).toMatchObject({artist:'The Pretty Reckless',title:'For I Am Death'});
});

it('recognizes artist-colon-song official titles without artist metadata',()=>{
 expect(tutorialIdentity({title:'Metallica: Nothing Else Matters (Official Music Video)'})).toMatchObject({artist:'Metallica',title:'Nothing Else Matters'});
});

it('resolves reversed official titles only with matching artist or channel evidence',()=>{
 for(const metadata of [{artist:'Linkin Park'},{channel:'Linkin Park'},{uploader:'Linkin Park'}]) {
  for(const title of ['Numb [4K UPGRADE] - Linkin Park','In The End [Official HD Music Video] - Linkin Park']) {
   expect(tutorialIdentity({title,...metadata})).toMatchObject({artist:'Linkin Park',title:title.startsWith('Numb')?'Numb':'In The End'});
  }
 }
 expect(tutorialIdentity({title:'Artist - Song',channel:'Unrelated broadcaster'})).toMatchObject({artist:'Artist',title:'Song'});
 expect(tutorialIdentity({title:'Artist - Song',artist:'Actual Artist',track:'Actual Song',channel:'Song'})).toMatchObject({artist:'Actual Artist',title:'Actual Song'});
});

it('requires whole song and artist phrases when selecting tutorial candidates',()=>{
 const target={artist:'Metallica',title:'Nothing Else Matters'};
 expect(matchesTutorialIdentity('Metallica - Nothing Else Matters (Piano Cover)',target)).toBe(true);
 expect(matchesTutorialIdentity('Metallica - Nothing Matters piano tutorial',target)).toBe(false);
 expect(matchesTutorialIdentity('NotMetallica - Nothing Else Matters piano',target)).toBe(false);
 expect(matchesTutorialIdentity('Guns N’ Roses – Sweet Child O’ Mine Piano Cover',{artist:"Guns N' Roses",title:"Sweet Child O' Mine"})).toBe(true);
 expect(matchesTutorialIdentity('Queen - We Are The Champions piano',{artist:'Queen',title:'We Are The Champions Of The World'})).toBe(false);
});

it('rejects labelled excerpts without rejecting songs whose actual title contains a part number',()=>{
 const target={artist:'Metallica',title:'One'};
 for(const suffix of ['chorus only','part 1','short version','excerpt'])expect(matchesTutorialIdentity('Metallica One piano tutorial '+suffix,target)).toBe(false);
 expect(matchesTutorialIdentity('Pink Floyd Another Brick In The Wall Part 2 Piano Tutorial',{artist:'Pink Floyd',title:'Another Brick In The Wall Part 2'})).toBe(true);
});

it('removes recording edition suffixes from track metadata without stripping song subtitles',()=>{
 for(const title of ['For Whom The Bell Tolls (Remastered)','Metallica - For Whom The Bell Tolls'])
  expect(tutorialIdentity({title,artist:'Metallica',track:'For Whom The Bell Tolls (Remastered)'})).toMatchObject({title:'For Whom The Bell Tolls',artist:'Metallica'});
 expect(tutorialIdentity({title:'Artist - Song',artist:'Artist',track:'Song (Part 2)'}).title).toBe('Song (Part 2)');
});
