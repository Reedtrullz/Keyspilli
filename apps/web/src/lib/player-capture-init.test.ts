import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("initializes the real recorder after tsx serializes its named inner functions", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const helper = new URL("../../e2e/player-audio-capture.ts", import.meta.url).href;
  const code = `
    import { installPlayerPcmProbe } from ${JSON.stringify(helper)};
    import vm from 'node:vm';
    let script;
    await installPlayerPcmProbe({ addInitScript: async (value, arg) => {
      script = typeof value === 'function' ? '(' + value.toString() + ')(' + JSON.stringify(arg) + ')' :
        typeof value === 'string' ? value : value.content;
    } }, true);
    const realm = vm.createContext({});
    vm.runInContext('class AudioNode { connect() {} }; class AudioBufferSourceNode extends AudioNode { start() {} }; class OscillatorNode extends AudioNode { start() {} }; class AudioContext {}; globalThis.window = globalThis; Object.assign(globalThis, { AudioNode, AudioBufferSourceNode, OscillatorNode, AudioContext });', realm);
    vm.runInContext(script, realm);
    console.log(JSON.stringify(vm.runInContext('[typeof __playerCaptureStart, typeof __playerCaptureStop, typeof __playerCaptureClockControl]', realm)));
  `;
  const output = execFileSync(process.execPath, ["--import", fileURLToPath(new URL("../../../../node_modules/tsx/dist/loader.mjs", import.meta.url)), "--input-type=module", "-e", code],
    { cwd: root, encoding: "utf8", timeout: 4000 });
  expect(JSON.parse(output)).toEqual(["function", "function", "function"]);
});
