import { expect, test, type Page } from "@playwright/test";

type GainSnapshot = {
  context: number;
  targets: [number[], number[]];
  current: [number | null, number | null];
};

type ProbeWindow = Window & {
  __keyspilliOrganGainProbe: () => GainSnapshot[];
};

async function installGainProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const states: Array<{
      id: number;
      gainCount: number;
      params: [AudioParam | null, AudioParam | null];
      targets: [number[], number[]];
    }> = [];
    const stateByContext = new WeakMap<BaseAudioContext, (typeof states)[number]>();
    const paramToBus = new WeakMap<AudioParam, { state: (typeof states)[number]; bus: 0 | 1 }>();
    const originalCreateGain = AudioContext.prototype.createGain;
    const originalSetTargetAtTime = AudioParam.prototype.setTargetAtTime;

    Object.defineProperty(AudioContext.prototype, "createGain", {
      configurable: true,
      value: function (this: AudioContext): GainNode {
        const node = Reflect.apply(originalCreateGain, this, []) as GainNode;
        let state = stateByContext.get(this);
        if (!state) {
          state = {
            id: states.length,
            gainCount: 0,
            params: [null, null],
            targets: [[], []],
          };
          states.push(state);
          stateByContext.set(this, state);
        }
        if (state.gainCount < 2) {
          const bus = state.gainCount as 0 | 1;
          state.params[bus] = node.gain;
          paramToBus.set(node.gain, { state, bus });
        }
        state.gainCount++;
        return node;
      },
    });
    Object.defineProperty(AudioParam.prototype, "setTargetAtTime", {
      configurable: true,
      value: function (this: AudioParam, target: number, startTime: number, timeConstant: number): AudioParam {
        const tracked = paramToBus.get(this);
        if (tracked) tracked.state.targets[tracked.bus].push(Number(target));
        return Reflect.apply(originalSetTargetAtTime, this, [target, startTime, timeConstant]) as AudioParam;
      },
    });

    (window as unknown as ProbeWindow).__keyspilliOrganGainProbe = () => states.map((state) => ({
      context: state.id,
      targets: [state.targets[0].slice(), state.targets[1].slice()],
      current: [state.params[0]?.value ?? null, state.params[1]?.value ?? null],
    }));
  });
}

async function openSound(page: Page): Promise<void> {
  const panel = page.locator("#player-tool-panel");
  if (!(await panel.isVisible())) {
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.getByRole("button", { name: "Sound", exact: true }).click();
  }
}

test("reports real Cathedral gain buses across Oops engine recreation", async ({ page }) => {
  await installGainProbe(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({
      soundSource: "organ",
      organStyle: "cathedral",
      voiceGain: 1,
      pianoGain: 1,
    }));
  });

  await page.goto("/player/britney-spears-oops-i-did-it-again-a-scratch");
  await expect(page.getByText("Oops I Did It Again", { exact: true }).first()).toBeVisible();
  await openSound(page);
  await expect(page.getByRole("radio", { name: "Original arrangement", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Cathedral", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Right hand / input volume")).toHaveValue("100");
  await expect(page.getByLabel("Left hand / accompaniment volume")).toHaveValue("100");
  await page.getByRole("button", { name: "Close tools", exact: true }).click();

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  const snapshots: GainSnapshot[] = [];
  snapshots.push(...await page.evaluate(() => (window as unknown as ProbeWindow).__keyspilliOrganGainProbe()));

  for (const style of ["rock", "cathedral"]) {
    await openSound(page);
    await page.getByRole("radio", { name: style === "rock" ? "Rock" : "Cathedral", exact: true }).click();
    await page.getByRole("button", { name: "Close tools", exact: true }).click();
    await page.waitForTimeout(250);
    snapshots.push(...await page.evaluate(() => (window as unknown as ProbeWindow).__keyspilliOrganGainProbe()));
  }

  const unique = [...new Map(snapshots.map((snapshot) => [snapshot.context, snapshot])).values()];
  console.log(`GAIN_PROBE ${JSON.stringify(unique)}`);
  expect(unique.length).toBeGreaterThanOrEqual(3);
  for (const snapshot of unique) {
    expect(snapshot.targets[0]).not.toHaveLength(0);
    expect(snapshot.targets[1]).not.toHaveLength(0);
  }
});
