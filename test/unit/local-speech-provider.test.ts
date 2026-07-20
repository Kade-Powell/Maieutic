import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LocalSpeechProvider,
  normalizeLocalSpeechEndpoint,
  toLocalSpeechPayload,
} from "../../src/local-speech-provider.js";
import type { SpeechRequest } from "../../src/speech-model.js";

const request: SpeechRequest = {
  text: "Explain this branch.",
  provider: "local",
  voice: "marin",
  localEndpoint: "http://127.0.0.1:8080/v1/audio/speech",
  localModel: "kokoro",
  localVoice: "af_heart",
  instructions: "Speak naturally.",
  speed: 0.9,
};

const wav = new Uint8Array([
  0x52, 0x49, 0x46, 0x46,
  0x04, 0x00, 0x00, 0x00,
  0x57, 0x41, 0x56, 0x45,
]);

describe("local speech endpoint", () => {
  it("normalizes common loopback OpenAI-compatible URLs", () => {
    assert.equal(
      normalizeLocalSpeechEndpoint("http://localhost:8080"),
      "http://localhost:8080/v1/audio/speech",
    );
    assert.equal(
      normalizeLocalSpeechEndpoint("http://127.0.0.1:8080/v1/"),
      "http://127.0.0.1:8080/v1/audio/speech",
    );
    assert.equal(
      normalizeLocalSpeechEndpoint("http://[::1]:8080/tts"),
      "http://[::1]:8080/tts",
    );
  });

  it("rejects remote hosts and unsafe URL fields", () => {
    assert.throws(
      () => normalizeLocalSpeechEndpoint("https://example.com/v1/audio/speech"),
      /must use localhost/,
    );
    assert.throws(
      () => normalizeLocalSpeechEndpoint("http://user:secret@localhost:8080/v1/audio/speech"),
      /do not include them/,
    );
    assert.throws(
      () => normalizeLocalSpeechEndpoint("http://localhost:8080/v1/audio/speech?key=secret"),
      /query string or fragment/,
    );
  });
});

describe("LocalSpeechProvider", () => {
  it("sends the local model and voice to the configured endpoint", async () => {
    let calledEndpoint = "";
    let calledInit: RequestInit | undefined;
    const fetchImplementation = (async (input: string | URL | Request, init?: RequestInit) => {
      calledEndpoint = String(input);
      calledInit = init;
      return new Response(wav, {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      });
    }) as typeof fetch;
    const provider = new LocalSpeechProvider(fetchImplementation);

    assert.deepEqual(
      await provider.synthesize(request, "", new AbortController().signal),
      wav,
    );
    assert.equal(calledEndpoint, request.localEndpoint);
    assert.equal(calledInit?.method, "POST");
    assert.equal(calledInit?.redirect, "error");
    assert.deepEqual(JSON.parse(String(calledInit?.body)), {
      model: "kokoro",
      voice: "af_heart",
      input: "Explain this branch.",
      speed: 0.9,
      response_format: "wav",
    });
  });

  it("rejects service errors and non-WAV responses", async () => {
    const serverError = new LocalSpeechProvider(
      (async () => new Response("failed", { status: 500 })) as typeof fetch,
    );
    await assert.rejects(
      serverError.synthesize(request, "", new AbortController().signal),
      /returned HTTP 500/,
    );

    const invalidAudio = new LocalSpeechProvider(
      (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as typeof fetch,
    );
    await assert.rejects(
      invalidAudio.synthesize(request, "", new AbortController().signal),
      /did not return WAV audio/,
    );
  });

  it("rejects oversized responses before reading the body", async () => {
    const oversizedAudio = new LocalSpeechProvider(
      (async () => new Response(wav, {
        status: 200,
        headers: { "Content-Length": String(64 * 1024 * 1024 + 1) },
      })) as typeof fetch,
    );
    await assert.rejects(
      oversizedAudio.synthesize(request, "", new AbortController().signal),
      /larger than 64 MB/,
    );
  });

  it("times out a local service that does not respond", async () => {
    const stalledFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }) as typeof fetch;
    const provider = new LocalSpeechProvider(stalledFetch, 1);

    await assert.rejects(
      provider.synthesize(request, "", new AbortController().signal),
      /timed out/,
    );
  });
});

describe("toLocalSpeechPayload", () => {
  it("does not send OpenAI-only instructions", () => {
    assert.deepEqual(toLocalSpeechPayload(request), {
      model: "kokoro",
      voice: "af_heart",
      input: "Explain this branch.",
      speed: 0.9,
      response_format: "wav",
    });
  });

  it("requires the local service model and voice", () => {
    assert.throws(
      () => toLocalSpeechPayload({ ...request, localModel: undefined }),
      /Local TTS model is required/,
    );
    assert.throws(
      () => toLocalSpeechPayload({ ...request, localVoice: " " }),
      /Local TTS voice is required/,
    );
  });
});
