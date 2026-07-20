import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  openAIClientOptions,
  toOpenAISpeechPayload,
} from "../../src/openai-speech-provider.js";

describe("toOpenAISpeechPayload", () => {
  it("pins requests to OpenAI and disables SDK logging", () => {
    assert.deepEqual(openAIClientOptions("secret-key"), {
      apiKey: "secret-key",
      baseURL: "https://api.openai.com/v1",
      logLevel: "off",
      maxRetries: 1,
      organization: null,
      project: null,
      timeout: 60_000,
    });
  });

  it("uses the fixed OpenAI model and WAV response format", () => {
    assert.deepEqual(
      toOpenAISpeechPayload({
        text: "Explain this condition.",
        provider: "openai",
        voice: "cedar",
        instructions: "Sound thoughtful.",
        speed: 0.9,
      }),
      {
        model: "gpt-4o-mini-tts",
        voice: "cedar",
        input: "Explain this condition.",
        instructions: "Sound thoughtful.",
        speed: 0.9,
        response_format: "wav",
      },
    );
  });

  it("does not invent style instructions", () => {
    assert.deepEqual(
      toOpenAISpeechPayload({
        text: "Explain this condition.",
        provider: "openai",
        voice: "marin",
        speed: 1,
      }),
      {
        model: "gpt-4o-mini-tts",
        voice: "marin",
        input: "Explain this condition.",
        speed: 1,
        response_format: "wav",
      },
    );
  });
});
