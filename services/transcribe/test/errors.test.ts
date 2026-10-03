import { describe, expect, it } from "vitest";
import {
  isYoutubeBotChallenge,resourceFailure,RESOURCE_BLOCKED_MESSAGE,withResourceAccounting,
  redactSensitiveText,
  sanitizeProcessError,
  YOUTUBE_BOT_BLOCK_MESSAGE,
} from "../src/errors.js";

describe("worker subprocess error handling", () => {
  it("uses stderr instead of Node's command-bearing error message", () => {
    const result = sanitizeProcessError({
      message: "Command failed: yt-dlp --proxy https://user:secret@example.test:8443 -- https://youtube.test/video",
      stderr: "ERROR: sign in to confirm you’re not a bot",
    });
    expect(result.message).toBe("ERROR: sign in to confirm you’re not a bot");
    expect(result.message).not.toContain("secret");
  });

  it("redacts proxy credentials and sensitive yt-dlp flags", () => {
    expect(redactSensitiveText("proxy https://user:secret@example.test:8443")).toBe("proxy https://[redacted]@example.test:8443");
    expect(redactSensitiveText("proxy socks5h://user:secret@example.test:1080")).toBe("proxy socks5h://[redacted]@example.test:1080");
    expect(redactSensitiveText("--cookies /run/secrets/youtube.txt --proxy=http://user:secret@example.test")).toBe("--cookies [redacted] --proxy [redacted]");
  });

  it("recognizes bot challenges and exposes one actionable terminal message", () => {
    expect(isYoutubeBotChallenge(new Error("LOGIN_REQUIRED: sign in to confirm you're not a bot"))).toBe(true);
    expect(isYoutubeBotChallenge(new Error("network timeout"))).toBe(false);
    expect(isYoutubeBotChallenge(new Error(YOUTUBE_BOT_BLOCK_MESSAGE))).toBe(true);
  });
});

it("classifies measured capacity pressure, preserving timeout/cancel and unknown SIGKILL",async()=>{
 const before={oomKill:2,pidsMax:5};
 expect(resourceFailure(Error("allocation failed"),{...before,oom:2},{...before,oom:3})?.message).toBe(RESOURCE_BLOCKED_MESSAGE);
 expect(resourceFailure({code:"ENOMEM"},{oomKill:null,pidsMax:null},{oomKill:null,pidsMax:null})?.message).toBe(RESOURCE_BLOCKED_MESSAGE);
 for(const after of [{oomKill:3,pidsMax:5},{oomKill:2,pidsMax:6}])expect(resourceFailure(Error("failed"),before,after)?.message).toBe(RESOURCE_BLOCKED_MESSAGE);
 for(const error of [{signal:"SIGKILL",code:137},{code:"ETIMEDOUT"},{code:"ABORT_ERR"},{killed:true},Error("SOURCE_REVIEW_REQUIRED: tutorial operation timed out")])expect(resourceFailure(error,before,{oomKill:2,pidsMax:5})).toBeNull();
 expect(resourceFailure({killed:true},before,{oomKill:3,pidsMax:6})).toBeNull();
 expect(resourceFailure({code:"EAGAIN"},{oomKill:null,pidsMax:null},{oomKill:null,pidsMax:null})?.message).toBe(RESOURCE_BLOCKED_MESSAGE);
 expect(resourceFailure({code:137},{oomKill:null,pidsMax:null},{oomKill:null,pidsMax:null})).toBeNull();
 await expect(withResourceAccounting(async()=>{throw {code:"EAGAIN"};})).rejects.toThrow(RESOURCE_BLOCKED_MESSAGE);
 const controller=new AbortController();controller.abort();const original={code:"EAGAIN"};await expect(withResourceAccounting(async()=>{throw original;},controller.signal)).rejects.toBe(original);
});
