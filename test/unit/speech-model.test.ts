import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSpeechCancellation,
  MAX_SPEECH_TEXT_LENGTH,
  resolveSpeechRequest,
  SpeechInterruptedError,
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
        provider: "system",
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
        provider: "system",
        voice: "marin",
        speed: 1,
      },
    );
  });

  it("normalizes settings for a localhost neural provider", () => {
    assert.deepEqual(
      resolveSpeechRequest(
        { text: "  Explain this branch.  " },
        {
          ...settings,
          provider: "local",
          localEndpoint: " http://127.0.0.1:8080/v1/audio/speech ",
          localModel: " kokoro ",
          localVoice: " af_heart ",
        },
      ),
      {
        text: "Explain this branch.",
        provider: "local",
        voice: "marin",
        localEndpoint: "http://127.0.0.1:8080/v1/audio/speech",
        localModel: "kokoro",
        localVoice: "af_heart",
        instructions: "Speak naturally.",
        speed: 1,
      },
    );
  });

  it("requires complete localhost neural settings", () => {
    assert.throws(
      () => resolveSpeechRequest(
        { text: "Explain this branch." },
        {
          ...settings,
          provider: "local",
          localEndpoint: "",
          localModel: "kokoro",
          localVoice: "af_heart",
        },
      ),
      /Local TTS endpoint is required/,
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

describe("speech cancellation", () => {
  it("treats learner barge-in as an intentional speech stop", () => {
    assert.equal(isSpeechCancellation(new SpeechInterruptedError()), true);
  });
});
