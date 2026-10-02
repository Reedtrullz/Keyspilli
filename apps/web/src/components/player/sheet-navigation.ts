import { parseMusicXmlNotes, type Note, type MeasureInfo } from "@keyspilli/midi";
export interface ScoreMeasure extends MeasureInfo { elementId: string }
export function prepareScoreNavigation(xml: string, source: { notes: readonly Note[]; measures: readonly MeasureInfo[]; sourceFingerprint?: string }, revision: string | null | undefined, responseRevision: string | null): { xml: string; measures: ScoreMeasure[] } {
  if (!revision || responseRevision !== revision || !source.sourceFingerprint) throw new Error("Score interaction needs an exact current source and publication.");
  if (xml.length > 8 * 1024 * 1024 || source.notes.length > 20000 || source.measures.length > 2048 || !source.measures.length
    || source.notes.some(n=>!Number.isInteger(n.midi)||n.midi<0||n.midi>127||!Number.isFinite(n.start)||n.start<0||!Number.isFinite(n.dur)||n.dur<=0)
    || source.measures.some(m=>!Number.isFinite(m.startBeat)||m.startBeat<0||!Number.isFinite(m.endBeat)||m.endBeat<=m.startBeat)
    || (xml.match(/<part(?=[\s>])/g) ?? []).length !== 1) throw new Error("This notation is outside the supported interactive subset.");
  const parsed = parseMusicXmlNotes(xml);
  const shape = (notes: readonly Note[]) => notes.map(n => [n.midi,n.start,n.dur]).sort((a,b)=>a[1]!-b[1]!||a[0]!-b[0]!||a[2]!-b[2]!);
  const expected = shape(source.notes), actual = shape(parsed.notes);
  if (actual.length !== expected.length || actual.some((note,i)=>note.some((value,j)=>Math.abs(value!-expected[i]![j]!)>1e-6))
    || parsed.notationMeasures?.length !== source.measures.length
    || source.measures.some((m,i)=>m.index!==i || Math.abs(m.startBeat-parsed.notationMeasures![i]!.startBeat)>1e-6 || Math.abs(m.endBeat-parsed.notationMeasures![i]!.endBeat)>1e-6))
    throw new Error("Score notes or measure timing differ from playback. Following and seeking are unavailable.");
  const measures = source.measures.map((m,i)=>({...m,elementId:`keyspilli-score-${i}`}));
  let index = 0;
  // IDs are a renderer-only copy. Source bytes and exported notation remain untouched.
  const interactive = xml.replace(/<measure(?=[\s>])([^>]*)>/g,(_match,attrs:string)=>`<measure${attrs.replace(/\s+id\s*=\s*(?:"[^"]*"|'[^']*')/g,"")} id="${measures[index++]!.elementId}">`);
  if (index !== measures.length) throw new Error("Notation measure identity is unavailable.");
  return {xml:interactive,measures};
}
