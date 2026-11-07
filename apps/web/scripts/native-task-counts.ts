import { readFileSync, readdirSync } from "node:fs";

export type TaskRole = "guard" | "app-node" | "automation-node" | "chromium" | "crashpad" | "unknown";
export type TaskRow = { pid: number; ppid: number; name: string; threads: number };
export type RoleCount = { processes: number; threads: number };
export type TaskCounts = {
  processes: number;
  threads: number;
  vanished: number;
  roles: Record<TaskRole, RoleCount>;
};

const ROLES: TaskRole[] = ["guard", "app-node", "automation-node", "chromium", "crashpad", "unknown"];

export function summarizeTaskCounts(rows: TaskRow[], selfPid: number, guardPid: number, vanished = 0): TaskCounts {
  if (!Number.isSafeInteger(selfPid) || selfPid < 1 || !Number.isSafeInteger(guardPid) || guardPid < 1) throw new Error("invalid owned process identity");
  if (!Number.isSafeInteger(vanished) || vanished < 0) throw new Error("invalid vanished process count");
  const byPid = new Map<number, TaskRow>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.pid) || row.pid < 1 || !Number.isSafeInteger(row.ppid) || row.ppid < 0
        || typeof row.name !== "string" || row.name.length === 0 || row.name.length > 64
        || !Number.isSafeInteger(row.threads) || row.threads < 1) throw new Error("invalid process row or threads");
    if (byPid.has(row.pid)) throw new Error("duplicate process identity");
    byPid.set(row.pid, row);
  }
  if (!byPid.has(guardPid)) throw new Error("guard process missing from owned tree");
  if (!byPid.has(selfPid)) throw new Error("automation process missing from owned tree");

  const classify = (row: TaskRow): TaskRole => {
    if (row.pid === guardPid) return "guard";
    if (row.pid === selfPid) return "automation-node";
    if (row.ppid === guardPid && row.name === "node") return "app-node";
    if (/crashpad/i.test(row.name)) return "crashpad";
    if (/^(chrome|chromium|headless_shell|chrome-headless)/i.test(row.name)) return "chromium";
    return "unknown";
  };

  const roles = Object.fromEntries(ROLES.map(role => [role, { processes: 0, threads: 0 }])) as Record<TaskRole, RoleCount>;
  for (const row of rows) {
    const role = classify(row);
    roles[role].processes++;
    roles[role].threads += row.threads;
  }
  return { processes: rows.length, threads: rows.reduce((sum, row) => sum + row.threads, 0), vanished, roles };
}

export function collectTaskCounts(procRoot = "/proc", selfPid = process.pid, guardPid = process.ppid): TaskCounts {
  const rows: TaskRow[] = [];
  let vanished = 0;
  for (const entry of readdirSync(procRoot)) {
    if (!/^[1-9][0-9]*$/.test(entry)) continue;
    try {
      const status = readFileSync(`${procRoot}/${entry}/status`, "utf8");
      const name = status.match(/^Name:[ \t]+(.+)$/m)?.[1];
      const ppid = Number(status.match(/^PPid:[ \t]+([0-9]+)$/m)?.[1]);
      const threads = Number(status.match(/^Threads:[ \t]+([1-9][0-9]*)$/m)?.[1]);
      if (!name || !Number.isSafeInteger(ppid) || !Number.isSafeInteger(threads)) throw new Error("invalid process status");
      rows.push({ pid: Number(entry), ppid, name, threads });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "ESRCH")) {
        vanished++;
        continue;
      }
      throw error;
    }
  }
  return summarizeTaskCounts(rows, selfPid, guardPid, vanished);
}
