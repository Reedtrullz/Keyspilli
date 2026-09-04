import type { GenericSourceCandidate, GenericSongTarget } from "@keyspilli/catalog";

/** Provider-neutral seam. Production stays empty until an approved search
 * provider is integrated; tests/local alpha may inject ranked metadata. */
export type SourceCandidateProvider = (target: GenericSongTarget) => readonly GenericSourceCandidate[];

let provider: SourceCandidateProvider | null = null;

export function setSourceCandidateProviderForTests(next: SourceCandidateProvider | null): void {
  provider = next;
}

export function hasSourceCandidateProvider(): boolean {
  return provider !== null;
}

export function discoverSourceCandidates(target: GenericSongTarget): GenericSourceCandidate[] {
  if (!provider) return [];
  return [...provider(target)]
    .filter((candidate) => candidate.targetId === target.id)
    .sort((left, right) =>
      (left.searchRank - right.searchRank) ||
      (left.rankingTier - right.rankingTier) ||
      (left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0),
    )
    .slice(0, 3);
}
