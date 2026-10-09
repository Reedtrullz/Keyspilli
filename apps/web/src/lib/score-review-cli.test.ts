import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { scoreFixture } from "./score-review-test-fixture.js";
const run = promisify(execFile), cli = new URL("../../scripts/review-score.mts", import.meta.url).pathname;
it("offline review works with Anti absent and yields a diagnosis without approval", async () => {
    const f = await scoreFixture([{ midi: 60, start: 0, dur: 1, vel: 90 }], [{ midi: 61, start: 0, dur: 1, vel: 90 }]);
    try {
        const input = await f.pin("input.json", f.input), out = join(f.root, "output");
        const r = await run(process.execPath, ["--import", "tsx", cli, input.path, out, "--offline"], { env: { ...process.env, ANTI_BASE_URL: "http://127.0.0.1:1", ANTI_SCRIPT: "/absent" } });
        expect(JSON.parse(r.stdout).status).toBe("diagnosis-complete");
        const report = JSON.parse(await readFile(join(out, "report.json"), "utf8"));
        expect(report.lanes.audio.status).toBe("not-run");
        expect(report.findings).toHaveLength(1);
        expect(report.productionAdmission).toBe(false);
    }
    finally {
        await f.cleanup();
    }
});
it("capabilities needs no inputs", async () => { const r = await run(process.execPath, ["--import", "tsx", cli, "capabilities"]); expect(JSON.parse(r.stdout).offline).toBe(true); });
it("retains the local diagnosis when live media prerequisites fail without dispatch", async () => {
    const f = await scoreFixture();
    try {
        const input = await f.pin("input.json", f.input), out = join(f.root, "blocked");
        await expect(run(process.execPath, ["--import", "tsx", cli, input.path, out, "--send-audio", "--max-requests", "1", "--anti-python", "/absent/python", "--anti-script", "/absent/anti.py", "--base-url", "http://127.0.0.1:1/v1", "--model", "gemini-3.1-pro", "--account-binding-json", "/absent/binding.json"])).rejects.toMatchObject({ code: 2 });
        const report = JSON.parse(await readFile(join(out, "report.json"), "utf8"));
        expect(report.lanes.audio.status).toBe("blocked");
        expect(report.lanes.audio.attemptsReserved).toBe(0);
        expect(report.symbolic.modes.original.scoreConformance.status).toBe("passed");
    }
    finally {
        await f.cleanup();
    }
});
it("rejects upload options in offline mode and repeated or conflicting flags", async () => {
    const f = await scoreFixture();
    try {
        const input = await f.pin("input.json", f.input);
        for (const flags of [["--offline", "--max-requests", "1"], ["--offline", "--offline"], ["--offline", "--send-audio"]])
            await expect(run(process.execPath, ["--import", "tsx", cli, input.path, join(f.root, "unused"), ...flags])).rejects.toMatchObject({ code: 2 });
    }
    finally {
        await f.cleanup();
    }
});
