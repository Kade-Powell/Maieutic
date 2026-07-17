import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_SPEECH_TEXT_LENGTH,
  resolveSpeechRequest,
} from "../../src/speech-model.js";

const settings = {
  voice: "marin",
  instructions: "Speak naturally.",
  speed: 1,
};

describe("resolveSpeechRequest", () => {
  it("normalizes narration and configured voice settings", () => {
    assert.deepEqual(
      resolveSpeechRequest({ text: "  Explain this branch.  " }, settings),
      {
        text: "Explain this branch.",
        voice: "marin",
        instructions: "Speak naturally.",
        speed: 1,
      },
    );
  });

  it("omits empty style instructions", () => {
    assert.deepEqual(
      resolveSpeechRequest(
        { text: "Explain this branch." },
        { ...settings, instructions: "   " },
      ),
      {
        text: "Explain this branch.",
        voice: "marin",
        speed: 1,
      },
    );
  });

  it("counts Unicode code points for the narration limit", () => {
    const text = "a".repeat(MAX_SPEECH_TEXT_LENGTH - 1) + "🙂";
    assert.equal(resolveSpeechRequest({ text }, settings).text, text);
    assert.throws(
      () => resolveSpeechRequest({ text: `${text}a` }, settings),
      /cannot exceed 4096 characters/,
    );
  });

  it("rejects empty narration", () => {
    assert.throws(
      () => resolveSpeechRequest({ text: "  " }, settings),
      /Speech text is required/,
    );
  });

  it("rejects an unknown voice", () => {
    assert.throws(
      () => resolveSpeechRequest(
        { text: "Explain this branch." },
        { ...settings, voice: "unknown" },
      ),
      /OpenAI voice must be one of/,
    );
  });

  it("rejects speech speed outside OpenAI's supported range", () => {
    assert.throws(
      () => resolveSpeechRequest(
        { text: "Explain this branch." },
        { ...settings, speed: 0.24 },
      ),
      /between 0.25 and 4/,
    );
    assert.throws(
      () => resolveSpeechRequest(
        { text: "Explain this branch." },
        { ...settings, speed: 4.01 },
      ),
      /between 0.25 and 4/,
    );
  });
});
