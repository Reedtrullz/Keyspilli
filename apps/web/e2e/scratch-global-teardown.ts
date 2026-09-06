import { realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

export default function teardown(): void {
  const configured = process.env.KEYSPILLI_E2E_SCRATCH_DIR;
  if (!configured) return;
  const scratchRoot = resolve(tmpdir());
  const target = resolve(configured);
  const prefix = join(scratchRoot, "keyspilli-web-e2e-");
  if (!target.startsWith(prefix)) throw new Error(`refusing to remove unexpected scratch path: ${target}`);
  try {
    if (realpathSync(target) !== target) return;
  } catch {
    return;
  }
  rmSync(target, { recursive: true, force: true });
}
