import { spawnSync } from "node:child_process";

/** Darwin kill(2) can return EPERM for a zombie-only group. Observe its
 * process-table membership instead; zombies remain present until reaped. */
export function darwinGroupPresent(group: number, timeoutMs = 250): boolean {
  const snapshot = spawnSync("/bin/sh", ["-c",
    'exec /bin/ps -g "$1" -p "$2,$$" -o pid=,pgid=', "keyspilli-group", String(group), String(process.pid)], {
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", NODE_ENV: "production" },
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024,
    timeout: Math.max(1, Math.ceil(timeoutMs)), killSignal: "SIGKILL",
  });
  if (snapshot.error) throw snapshot.error;
  if (snapshot.status !== 0 || snapshot.signal !== null || snapshot.stderr !== "" || !snapshot.stdout.endsWith("\n")) {
    throw new Error("unable to observe Darwin process groups");
  }
  const processes = new Map<number, number>();
  for (const line of snapshot.stdout.slice(0, -1).split("\n")) {
    const row = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!row) throw new Error("invalid Darwin process-group observation");
    const pid = Number(row[1]), pgid = Number(row[2]);
    if (!Number.isSafeInteger(pid) || pid < 1 || !Number.isSafeInteger(pgid) || processes.has(pid)) {
      throw new Error("invalid Darwin process-group identity");
    }
    if (pgid !== group && pid !== snapshot.pid && pid !== process.pid) {
      throw new Error("unexpected Darwin process-group observation");
    }
    processes.set(pid, pgid);
  }
  // exec preserves the observer PID; both sentinels must survive group selection.
  if (!processes.has(snapshot.pid) || !processes.has(process.pid)) throw new Error("incomplete Darwin process-group observation");
  return [...processes.values()].includes(group);
}

export function groupPresent(group: number, timeoutMs = 250): boolean {
  if (process.platform === "darwin") return darwinGroupPresent(group, timeoutMs);
  try { process.kill(-group, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
