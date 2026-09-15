import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { dataDir } from "../src/paths.js";
import { deleteBaseRows } from "../src/db.js";
import { reconcileBaseArtifact, validateStagedArtifactTree } from "../src/publish.js";
import { parseArrangementManifest } from "../src/artifact-manifest.js";
import { commitCatalogPublication, type CatalogPublication } from "../src/reconcile.js";

const baseId = process.argv[2];
if (!baseId || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(baseId) || process.argv.length !== 3) {
  throw new Error("Usage: npm run reconcile-artifacts -w @keyspilli/catalog -- BASE_ID (set KEYSPILLI_DATA_DIR to the affected data directory)");
}
const artifactsRoot = join(dataDir(), "artifacts");
await reconcileBaseArtifact(baseId, { artifactsRoot }, async (data, operation) => {
  if (operation === "delete") { deleteBaseRows(baseId); return; }
  if ((data as CatalogPublication)?.baseId !== baseId) throw new Error("reconciliation base mismatch");
  const root = join(artifactsRoot, baseId);
  const manifest = parseArrangementManifest(JSON.parse(await readFile(join(root, "manifest.json"), "utf8")));
  const issues = await validateStagedArtifactTree(root, manifest);
  if (issues.length) throw new Error(`artifact verification failed: ${issues.join("; ")}`);
  await commitCatalogPublication(data);
});
console.log(`Reconciled ${baseId}`);
