export const PHASE_TRACE_LIMIT_BYTES = 8192;
export const PHASE_FAILURE_RESERVE_BYTES = 256;

type PhaseState = "entry" | "exit" | "failure";
type RoleCount = { processes: number; threads: number };
type TaskCounts = {
  processes?: number;
  threads?: number;
  vanished?: number;
  roles?: Record<string, RoleCount>;
};

type PhaseTraceOptions = {
  limitBytes?: number;
  failureReserveBytes?: number;
};

export type PhaseTrace = {
  emit(name: string, state: PhaseState, counts?: TaskCounts): void;
  readonly truncated: boolean;
  readonly bytes: number;
};

const COMPACT_FAILURE = JSON.stringify({
  kind: "keyspilli-native-phase",
  phase: "failure",
  state: "failure",
  truncated: true,
}) + "\n";

export function createPhaseTrace(
  writeLine: (line: string) => void,
  options: PhaseTraceOptions = {},
): PhaseTrace {
  const limitBytes = options.limitBytes ?? PHASE_TRACE_LIMIT_BYTES;
  const failureReserveBytes = options.failureReserveBytes ?? PHASE_FAILURE_RESERVE_BYTES;
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) throw new RangeError("invalid phase trace limit");
  if (!Number.isSafeInteger(failureReserveBytes) || failureReserveBytes <= 0 || failureReserveBytes >= limitBytes) {
    throw new RangeError("invalid phase failure reserve");
  }

  const normalBudget = limitBytes - failureReserveBytes;
  let used = 0;
  let truncated = false;

  const line = (name: string, state: PhaseState, counts: TaskCounts | undefined) => {
    const { roles, ...aggregate } = counts ?? {};
    const common = { kind: "keyspilli-native-phase", phase: name, state, ...aggregate };
    return {
      full: JSON.stringify({ ...common, ...(roles ? { roles } : {}) }) + "\n",
      compact: JSON.stringify(common) + "\n",
      hasRoles: roles !== undefined,
    };
  };

  const write = (candidate: string, budget: number): boolean => {
    const bytes = Buffer.byteLength(candidate);
    if (used + bytes > budget) return false;
    try {
      writeLine(candidate);
    } catch {
      truncated = true;
      return false;
    }
    used += bytes;
    return true;
  };

  return {
    emit(name, state, counts) {
      if (typeof name !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new TypeError("invalid phase name");
      if (state !== "entry" && state !== "exit" && state !== "failure") throw new TypeError("invalid phase state");
      const candidate = line(name, state, counts);
      if (state === "failure") {
        if (write(candidate.compact, limitBytes)) {
          if (candidate.hasRoles) truncated = true;
          return;
        }
        if (write(COMPACT_FAILURE, limitBytes)) {
          truncated = true;
          return;
        }
        truncated = true;
        return;
      }
      if (write(candidate.full, normalBudget)) return;
      if (candidate.full === candidate.compact) {
        truncated = true;
        return;
      }
      if (write(candidate.compact, normalBudget)) {
        truncated = true;
        return;
      }
      truncated = true;
    },
    get truncated() {
      return truncated;
    },
    get bytes() {
      return used;
    },
  };
}
