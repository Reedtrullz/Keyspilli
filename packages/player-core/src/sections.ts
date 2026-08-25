import type { Note, MeasureInfo, Section } from "@keyspilli/midi";

/**
 * Detect likely song sections based on note density changes across measures.
 */
export function detectSections(
  notes: Note[],
  measures: MeasureInfo[],
  timeSig: [number, number] = [4, 4],
): Section[] {
  if (measures.length === 0) return [];

  // Notes are commonly already sorted, but callers are not required to pass
  // them that way. Sorting the starts once lets every measure/section use a
  // logarithmic range count instead of scanning the complete note list.
  // NaN starts never matched the old range predicate, so omit them here.
  const sortedStarts = notes
    .map((note) => note.start)
    .filter((start) => !Number.isNaN(start))
    .sort((a, b) => a - b);

  const densities = measures.map((measure) =>
    countInRange(sortedStarts, measure.startBeat, measure.endBeat),
  );

  const boundaries: number[] = [0];
  const windowSize = Math.min(4, Math.floor(measures.length / 4) || 1);

  for (let i = windowSize; i < measures.length - windowSize; i++) {
    const beforeAvg = avg(densities.slice(Math.max(0, i - windowSize), i));
    const afterAvg = avg(densities.slice(i, i + windowSize));
    if (beforeAvg > 0 && Math.abs(afterAvg - beforeAvg) / beforeAvg > 0.4) {
      boundaries.push(i);
    }
  }

  if (!boundaries.includes(measures.length)) {
    boundaries.push(measures.length);
  }

  const sections: Section[] = [];
  const overallDensity = avg(densities);

  for (let i = 0; i < boundaries.length - 1; i++) {
    const startIdx = boundaries[i]!;
    const endIdx = boundaries[i + 1]!;
    const startMeasure = measures[startIdx]!;
    const endMeasure = measures[endIdx - 1] ?? measures[measures.length - 1]!;

    const sectionNoteCount = countInRange(
      sortedStarts,
      startMeasure.startBeat,
      endMeasure.endBeat,
    );
    const sectionDensity = sectionNoteCount / Math.max(1, endIdx - startIdx);

    let type: NonNullable<Section["type"]> = "custom";
    // Only label intro/outro when density evidence supports a sparse bookend.
    // Interior sections get the honest generic label instead of cycling through
    // verse/chorus/bridge guesses that imply structure we cannot detect.
    if (i === 0 && sectionDensity < overallDensity * 0.6) {
      type = "intro";
    } else if (i === boundaries.length - 2 && sectionDensity < overallDensity * 0.5) {
      type = "outro";
    }

    sections.push({
      id: "section-" + (i + 1),
      label: type === "custom"
        ? "Section " + (i + 1)
        : type.charAt(0).toUpperCase() + type.slice(1) + " " + (i + 1),
      startBeat: startMeasure.startBeat,
      endBeat: endMeasure.endBeat,
      type,
    });
  }

  return sections;
}

function avg(nums: number[]): number {
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

/** Count sorted note starts in the half-open interval [start, end). */
function countInRange(sortedStarts: number[], start: number, end: number): number {
  // This also preserves the old filter's result for malformed/reversed ranges:
  // no value can satisfy both comparisons in that case.
  if (!(start <= end)) return 0;
  return lowerBound(sortedStarts, end) - lowerBound(sortedStarts, start);
}

function lowerBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = low + ((high - low) >>> 1);
    if (values[mid]! < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}
