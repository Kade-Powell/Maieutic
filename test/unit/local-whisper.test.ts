import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeWhisperTranscript,
  parseRecorderEvents,
  WHISPER_CPP_VERSION,
  WHISPER_MODEL,
} from "../../src/local-whisper-model.js";

describe("local Whisper", () => {
  it("pins the runtime and verifies the official base.en model", () => {
    assert.equal(WHISPER_CPP_VERSION, "1.9.1");
    assert.equal(WHISPER_MODEL.fileName, "ggml-base.en.bin");
    assert.equal(WHISPER_MODEL.sha1, "137c40403d78fd54d454da0f9bd998f78703390c");
    assert.equal(WHISPER_MODEL.sha256, "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002");
    assert.equal(WHISPER_MODEL.byteLength, 147_964_211);
    assert.match(WHISPER_MODEL.downloadUrl, /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\//);
  });

  it("parses only recorder protocol events", () => {
    assert.deepEqual(parseRecorderEvents([
      '{"event":"started"}',
      "not json",
      '{"event":"error","message":"denied"}',
      '{"event":"recorded"}',
    ].join("\n")), [
      { event: "started" },
      { event: "error", message: "denied" },
      { event: "recorded" },
    ]);
  });

  it("normalizes speech and rejects common silence hallucinations", () => {
    assert.equal(normalizeWhisperTranscript("  Walk me   through this.\n"), "Walk me through this.");
    assert.equal(normalizeWhisperTranscript("[BLANK_AUDIO]"), "");
    assert.equal(normalizeWhisperTranscript("[MUSIC PLAYING]"), "");
    assert.equal(normalizeWhisperTranscript("[background music]"), "");
    assert.equal(normalizeWhisperTranscript("(silence)"), "");
  });
});
