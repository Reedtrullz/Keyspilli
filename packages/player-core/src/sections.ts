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

  const densities = measures.map((m) => {
    const measureNotes = notes.filter(
      (n) => n.start >= m.startBeat && n.start < m.endBeat,
    );
    return measureNotes.length;
  });

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
  const typeLabels: Array<NonNullable<Section["type"]>> = ["intro", "verse", "chorus", "bridge", "outro"];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const startIdx = boundaries[i]!;
    const endIdx = boundaries[i + 1]!;
    const startMeasure = measures[startIdx]!;
    const endMeasure = measures[endIdx - 1] ?? measures[measures.length - 1]!;

    const sectionNotes = notes.filter(
      (n) => n.start >= startMeasure.startBeat && n.start < endMeasure.endBeat,
    );
    const sectionDensity = sectionNotes.length / Math.max(1, endIdx - startIdx);

    let type: NonNullable<Section["type"]> = "custom";
    if (i === 0 && sectionDensity < avg(densities) * 0.6) {
      type = "intro";
    } else if (i === boundaries.length - 2 && sectionDensity < avg(densities) * 0.5) {
      type = "outro";
    } else {
      type = typeLabels[i % typeLabels.length] ?? "custom";
    }

    sections.push({
      id: "section-" + (i + 1),
      label: type.charAt(0).toUpperCase() + type.slice(1) + " " + (i + 1),
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
