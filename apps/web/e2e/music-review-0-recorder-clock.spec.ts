import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { installPlayerPcmProbe } from "./player-audio-capture";
test("recorder PCM origin is an audio frame clock independent of score", async ({
  page,
}) => {
  const bundle = JSON.parse(
    readFileSync(
      join(
        process.env.KEYSPILLI_MUSIC_REVIEW_RUN!,
        "capture-fixtures/bundle.json",
      ),
      "utf8",
    ),
  );
  const first = Object.values(bundle.captures)[0] as { songId: string };
  await installPlayerPcmProbe(page);
  await page.goto("/player/" + first.songId);
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  // Match the Player readiness boundary used by real captures; initial settings restoration may recreate the context.
  await page.waitForLoadState("networkidle", { timeout: 60000 });
  await page.waitForTimeout(2000);
  const result = await page.evaluate(async () => {
    const p = window as unknown as {
      __playerCaptureStart: () => Promise<void>;
      __playerCaptureStop: () => Promise<{
        wav: number[];
        sampleRate: number;
        firstSampleContextSeconds: number;
      }>;
      __playerCaptureClockControl: () => number;
    };
    await p.__playerCaptureStart();
    const scheduled = p.__playerCaptureClockControl();
    await new Promise((r) => setTimeout(r, 500));
    const capture = await p.__playerCaptureStop();
    return { scheduled, ...capture };
  });
  expect(Number.isFinite(result.firstSampleContextSeconds)).toBe(true);
  const wav = Buffer.from(result.wav);
  let peakIndex = 0,
    peak = 0;
  for (let i = 44; i < wav.length; i += 2) {
    const n = Math.abs(wav.readInt16LE(i));
    if (n > peak) {
      peak = n;
      peakIndex = (i - 44) / 2;
    }
  }
  expect(peak).toBeGreaterThan(1000);
  const measured =
    result.firstSampleContextSeconds + peakIndex / result.sampleRate;
  expect(Math.abs(measured - result.scheduled)).toBeLessThanOrEqual(
    2 / result.sampleRate,
  );
});
