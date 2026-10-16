import * as childProcess from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { darwinGroupPresent } from "./prepare-workflow-group.js";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

const observer = process.pid === 123 ? 124 : 123;
const snapshot = (stdout = `${observer} 42\n${process.pid} 42\n`) => ({ pid: observer, status: 0, signal: null,
  stdout, stderr: "", output: [] });

describe("Darwin process-group observation", () => {
  it("keeps an unreaped group present independently of kill EPERM", () => {
    const group = 2147483646;
    vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("kill EPERM"), { code: "EPERM" }); });
    vi.mocked(childProcess.spawnSync).mockReturnValue(snapshot(`${observer} 42\n${process.pid} 42\n${process.pid + 2} ${group}\n`));
    expect(darwinGroupPresent(group)).toBe(true);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("requires a complete successful snapshot to establish absence within the supplied budget", () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue(snapshot());
    expect(darwinGroupPresent(456, 17)).toBe(false);
    expect(childProcess.spawnSync).toHaveBeenCalledWith("/bin/ps", ["-A", "-o", "pid=,pgid="], {
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", NODE_ENV: "production" },
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024,
      timeout: 17, killSignal: "SIGKILL",
    });
  });

  for (const stdout of ["", "\n", "123 42", "PID PGID\n", `123 42\n${process.pid}\n`, "123 42\n",
    `${process.pid} 42\n`, `123 42\n${process.pid} 42\n123 99\n`, `123 42\n${process.pid} -1\n`,
    `123 42\n${process.pid} 42\n0 0\n`, `123 42\n${process.pid} 42\n456 999999999999999999\n`]) {
    it(`refuses incomplete or malformed process rows ${JSON.stringify(stdout)}`, () => {
      vi.mocked(childProcess.spawnSync).mockReturnValue(snapshot(stdout));
      expect(() => darwinGroupPresent(456)).toThrow();
    });
  }

  for (const failure of [
    { error: Object.assign(new Error("missing ps"), { code: "ENOENT" }) },
    { error: Object.assign(new Error("observer spawn failed"), { code: "ESRCH" }) },
    { error: Object.assign(new Error("query timed out"), { code: "ETIMEDOUT" }), signal: "SIGKILL" as const },
    { error: Object.assign(new Error("snapshot exceeds bound"), { code: "ENOBUFS" }) },
    { status: 1 }, { signal: "SIGTERM" as const }, { stderr: "Failure calling sysctl\n" },
  ]) {
    it(`refuses failed or uncertain process enumeration ${JSON.stringify(failure)}`, () => {
      vi.mocked(childProcess.spawnSync).mockReturnValue({ ...snapshot(), ...failure });
      expect(() => darwinGroupPresent(456)).toThrow();
    });
  }
});
