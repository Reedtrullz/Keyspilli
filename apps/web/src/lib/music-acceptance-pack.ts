import { assertMusic, isHash } from '@keyspilli/catalog/src/acoustic-receipt.js';

export interface AcceptanceFormsInput {
  schemaVersion: 1;
  kind: 'keyspilli-music-acceptance-forms' | 'music-evidence-owner-review';
  pieces: Array<{
    id: string;
    title: string;
    sourceSha256: string;
    arrangementSha256: string;
    phraseSha256: string;
    sourceAuthority: 'unknown' | 'self-authored' | 'human-validated';
    clips: Array<{ id: string; mode: 'original' | 'chords'; status: 'captured' | 'silent-playback-diagnostic'; captureSha256: string; audioSha256: string }>;
    acceptance: Record<'sourceRoles' | 'recognizable' | 'original' | 'backingOnlyChords' | 'qualifiedKeyboard', string | null>;
  }>;
  priorObservations?: unknown[];
  providerCalls?: number;
}

export interface AcceptancePack {
  schemaVersion: 1;
  kind: 'keyspilli-music-acceptance-pack';
  sourceManifestSha256: string;
  pieces: AcceptanceFormsInput['pieces'];
  observations: Array<{ pieceId: string; clipId: string; mode: 'original' | 'chords'; reviewerRole: string | null; humanListening: string | null; sourceJudgment: string | null; keyboardJudgment: string | null; timestamp: string | null }>;
  priorObservations?: unknown[];
  autoplay: false;
  musicalAcceptance: 'not-established';
  providerCalls: 0;
}

const ACCEPTANCE_KEYS = ['sourceRoles', 'recognizable', 'original', 'backingOnlyChords', 'qualifiedKeyboard'] as const;

export function buildMusicAcceptancePack(input: AcceptanceFormsInput): AcceptancePack {
  assertMusic(input && input.schemaVersion === 1 && ['keyspilli-music-acceptance-forms', 'music-evidence-owner-review'].includes(input.kind), 'unsupported acceptance forms');
  assertMusic(Array.isArray(input.pieces) && input.pieces.length === 10 && new Set(input.pieces.map((piece) => piece.id)).size === 10, 'ten unique review pieces required');
  const observations: AcceptancePack['observations'] = [];
  for (const piece of input.pieces) {
    assertMusic(typeof piece.id === 'string' && piece.id.length > 0 && typeof piece.title === 'string' && isHash(piece.sourceSha256) && isHash(piece.arrangementSha256) && isHash(piece.phraseSha256), 'stale source/arrangement/phrase identity');
    assertMusic(['unknown', 'self-authored', 'human-validated'].includes(piece.sourceAuthority), 'invalid source authority');
    assertMusic(Array.isArray(piece.clips) && piece.clips.length === 2 && new Set(piece.clips.map((clip) => clip.mode)).size === 2, 'Original and Chords clips required');
    for (const clip of piece.clips) {
      assertMusic(isHash(clip.captureSha256) && isHash(clip.audioSha256) && ['captured', 'silent-playback-diagnostic'].includes(clip.status), 'stale capture identity');
      observations.push({ pieceId: piece.id, clipId: clip.id, mode: clip.mode, reviewerRole: null, humanListening: null, sourceJudgment: null, keyboardJudgment: null, timestamp: null });
    }
    assertMusic(ACCEPTANCE_KEYS.every((key) => Object.hasOwn(piece.acceptance, key) && piece.acceptance[key] === null), 'acceptance fields must remain blank');
  }
  return { schemaVersion: 1, kind: 'keyspilli-music-acceptance-pack', sourceManifestSha256: hashJson(input), pieces: JSON.parse(JSON.stringify(input.pieces)), observations, priorObservations: input.priorObservations ?? [], autoplay: false, musicalAcceptance: 'not-established', providerCalls: 0 };
}

function hashJson(value: unknown): string {
  const bytes = Buffer.from(JSON.stringify(value));
  let hash = 0x811c9dc5;
  for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(8);
}
