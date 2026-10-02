import { pathToFileURL } from "node:url";
import { assessWorkerHealthFile, defaultWorkerHealthFilePath } from "./worker-health.js";

export function checkWorkerHealth(path = defaultWorkerHealthFilePath()) {
  return assessWorkerHealthFile(path);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkWorkerHealth();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.healthy) process.exitCode = 1;
}
