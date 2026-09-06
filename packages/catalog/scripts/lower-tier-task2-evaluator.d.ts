export type Note = { midi: number; start: number; dur: number; vel: number; hand?: string; identitySource?: string };
export declare function groupOnsets(notes: Note[]): Note[][];
export declare function selectAnchors(notes: Note[], windowBeats: number): Array<{ window: number; first: Note; alternatives: Note[] }>;
export declare function structuralClass(note: Note, trusted: boolean, allowDirectPianoEvidence?: boolean): string;
type Gate = { pass: boolean; [key: string]: unknown };
export declare function evaluateBeginnerGates(notes: Note[], tempo: number, validationErrors?: string[]): { checks: Record<string, Gate>; grid: Gate; density: Gate; allPass: boolean };
export declare function fixtureHashGate(expected: string | null, actual: string): { expected: string | null; actual: string; matches: boolean };
export declare function resolveOutputPath(argv?: string[]): string;
