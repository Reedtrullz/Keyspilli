import { describe, expect, it } from "vitest";
import { buildVariants, parseMusicXmlNotes, writeVariantArtifacts } from "@keyspilli/midi";
import { measureIndex, resolveTimedNotes, secPerBeat } from "@keyspilli/player-core";
import { pickupFixture, pickupKinds } from "../../../../../packages/midi/test/pickup-fixtures.js";
import { playerArrangementEnd } from "./chords-backing";
import { prepareScoreNavigation } from "./sheet-navigation";

describe("imported pickup map at the Player's verified score boundary", () => {
  it.each(pickupKinds)("keeps %s bar selection and the terminal-rest clock for every physical level", kind => {
    const fixture = pickupFixture(kind, 8), parsed = parseMusicXmlNotes(fixture.xml);
    const variants = buildVariants(parsed, { title: "Pickup", artist: "Software control" }, { arrangementProfile: "source", maxDurBeats: null, chords: [] });
    expect(variants).toHaveLength(6);
    for (const variant of variants) {
      const data = { ...variant, sourceFingerprint: `synthetic-pickup-${variant.level}` };
      const artifacts = writeVariantArtifacts(variant, "Pickup", "Software control");
      const navigation = prepareScoreNavigation(artifacts.xml, data, "synthetic-revision", "synthetic-revision");
      expect(navigation.measures.map(({ elementId: _, ...measure }) => measure)).toEqual(fixture.measures);
      expect(navigation.measures.at(-1)!.elementId).toBe(`keyspilli-score-${fixture.measures.length - 1}`);
      for (const speed of [.5, 1, 1.5]) {
        const secondsPerBeat = secPerBeat(variant.tempoBpm, speed), timed = resolveTimedNotes(data, speed, 0);
        const duration = Math.max(...timed.map(n => n.startSec + n.durSec), playerArrangementEnd(data) * secondsPerBeat, 8);
        expect(playerArrangementEnd(data)).toBe(fixture.endBeat);
        expect(duration).toBeCloseTo(fixture.endBeat * secondsPerBeat, 9);
        for (const measure of fixture.measures) expect(measureIndex(measure.startBeat * secondsPerBeat + 1e-6, variant.tempoBpm, speed, variant.timeSig, navigation.measures.length, navigation.measures)).toBe(measure.index);
      }
    }
  });
});
