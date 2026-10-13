/** Bounded deterministic preparation, distinct from any experimental arranging driver. */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { preparationCapabilities, prepareWorkflow, resumePreparation, verifyPreparation } from "../src/lib/prepare-workflow.js";
import { requireThat } from "../src/lib/prepare-workflow-pins.js";

const usage = `Usage: node --import tsx apps/web/scripts/prepare-workflow.mts COMMAND

  capabilities
  prepare REQUEST.json NEW_RUN [--until prepared]
  resume RUN [--until prepared]
  verify RUN

Version 1 accepts one explicitly SHA-256-pinned MIDI, optional selected PhrasePlan,
1–8 explicitly pinned instruction files, and title/artist. NEW_RUN must be new and
below this checkout's output/song-prep. Preparation uses no providers. Completion
seals provisional structural artifacts; source/listening/keyboard/music acceptance
is not established. Verify hashes bytes without stage/catalog/database writes.

At most three preparation attempts total, one per invocation. Known failures and
handled interruptions can resume only after owned child-group cleanup. Abandoned
locks or ambiguous running states require a new run; there is no force/reset mode.`;

async function main() {
  const { values, positionals, tokens } = parseArgs({ allowPositionals: true, tokens: true,
    options: { until: { type: "string" }, help: { type: "boolean", short: "h" } } });
  if (values.help) { console.log(usage); return; }
  requireThat(tokens.filter(token => token.kind === "option" && token.name === "until").length <= 1, "--until may appear only once");
  requireThat(values.until === undefined || values.until === "prepared", "only --until prepared is supported");
  const [command, ...args] = positionals, root = process.cwd();
  requireThat(root === resolve(fileURLToPath(new URL("../../../", import.meta.url))), "run the host from its own checkout root");
  requireThat(command === "prepare" ? args.length === 2 : command === "capabilities" ? args.length === 0 : ["resume", "verify"].includes(command ?? "") && args.length === 1, usage);
  requireThat(values.until === undefined || command === "prepare" || command === "resume", "--until is supported only by prepare/resume");
  if (command === "capabilities") { console.log(JSON.stringify(preparationCapabilities(root))); return; }
  if (command === "verify") { console.log(JSON.stringify(verifyPreparation(root, args[0]!))); return; }
  if (command === "prepare") requireThat(!args[0]!.split(/[\\/]/).some(part => part === "." || part === ".."), "request path must not contain traversal");
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  try {
    const options = { signal: controller.signal, ...(values.until ? { until: "prepared" as const } : {}) };
    const result = command === "prepare" ? await prepareWorkflow(root, resolve(args[0]!), args[1]!, options) : await resumePreparation(root, args[0]!, options);
    console.log(JSON.stringify(result)); if (result.status === "incomplete" || result.status === "invalid") process.exitCode = 1;
  } finally { process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); }
}
try { await main(); }
catch (error) { console.error(JSON.stringify({ schemaVersion: 1, status: "invalid", error: `prepare-workflow: ${(error as Error).message}` })); process.exitCode = 1; }
