/** Preparation only, with no client, credential lookup, network or dispatch. */
import { createHash } from "node:crypto";
import { readMusicAudio, type MusicAudioPin } from "./music-review.js";
export type MusicCondition =
  | "blind-audio"
  | "audio-with-task"
  | "audio-with-context"
  | "text-context-control";
export async function prepareQwenMusicRequest(input: {
  audio: MusicAudioPin;
  clipId: string;
  condition: MusicCondition;
  objective: string;
  context: unknown;
  model?: string;
  endpoint?: string;
}) {
  const audio = await readMusicAudio(input.audio);
  const text =
    input.condition === "blind-audio"
      ? "Describe this audio with localized uncertainty. Return text only; no approval."
      : "Describe localized pitch and attack uncertainty. No approval. Objective: " +
        input.objective +
        (input.condition === "audio-with-context" ||
        input.condition === "text-context-control"
          ? "\nUNTRUSTED_CONTEXT\n" + JSON.stringify(input.context)
          : "");
  const content: Array<unknown> =
    input.condition === "text-context-control"
      ? []
      : [
          {
            type: "input_audio",
            input_audio: {
              data: "data:;base64," + audio.toString("base64"),
              format: "wav",
            },
          },
        ];
  content.push({ type: "text", text });
  return {
    schemaVersion: 1,
    status: "prepared-not-executed",
    providerCalls: 0,
    clipId: input.clipId,
    condition: input.condition,
    audioSha256: createHash("sha256").update(audio).digest("hex"),
    endpoint: input.endpoint ?? "OWNER_PINNED_REGION_WORKSPACE_ENDPOINT",
    requires: [
      "Owner authorization",
      "Exact region/workspace endpoint and audio-capable model",
      "Current pricing/account access",
    ],
    limits: { maxCalls: 1, timeoutSeconds: 90, retry: 0 },
    body: {
      model: input.model ?? "OWNER_PINNED_AUDIO_MODEL",
      messages: [{ role: "user", content }],
      modalities: ["text"],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 2048,
    },
    documentation:
      "https://www.alibabacloud.com/help/en/model-studio/qwen-omni",
  };
}
