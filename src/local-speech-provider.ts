import type { SpeechSynthesizer } from "./speech-service.js";
import {
  SpeechCancelledError,
  throwIfSpeechCancelled,
  type SpeechRequest,
} from "./speech-model.js";

export const DEFAULT_LOCAL_TTS_ENDPOINT = "http://127.0.0.1:8080/v1/audio/speech";
export const DEFAULT_LOCAL_TTS_MODEL = "kokoro";
export const DEFAULT_LOCAL_TTS_VOICE = "af_heart";

const LOCAL_TTS_TIMEOUT_MS = 60_000;
const MAX_LOCAL_AUDIO_BYTES = 64 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export interface LocalSpeechPayload {
  model: string;
  voice: string;
  input: string;
  speed: number;
  response_format: "wav";
}

export class LocalSpeechProvider implements SpeechSynthesizer {
  constructor(
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
    private readonly timeoutMs = LOCAL_TTS_TIMEOUT_MS,
  ) {}

  async synthesize(request: SpeechRequest, _credential: string, signal: AbortSignal): Promise<Uint8Array> {
    if (request.provider !== "local") {
      throw new Error("The local speech provider received a request for another provider.");
    }
    throwIfSpeechCancelled(signal);
    const endpoint = normalizeLocalSpeechEndpoint(request.localEndpoint ?? "");
    const timeout = new AbortController();
    const cancelForCaller = () => timeout.abort();
    signal.addEventListener("abort", cancelForCaller, { once: true });
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(endpoint, {
        method: "POST",
        headers: {
          Accept: "audio/wav",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toLocalSpeechPayload(request)),
        redirect: "error",
        signal: timeout.signal,
      });
      if (!response.ok) {
        throw new LocalSpeechError(`The local TTS service returned HTTP ${response.status}.`);
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_LOCAL_AUDIO_BYTES) {
        throw new LocalSpeechError("The local TTS service returned audio larger than 64 MB.");
      }
      const audio = await readLimitedAudio(response);
      if (!isWav(audio)) {
        throw new LocalSpeechError("The local TTS service did not return WAV audio.");
      }
      return audio;
    } catch (error: unknown) {
      if (signal.aborted) {
        throw new SpeechCancelledError();
      }
      if (timeout.signal.aborted) {
        throw new Error(
          "The local TTS service timed out. Check that it is running and try again.",
          { cause: error },
        );
      }
      if (error instanceof LocalSpeechError) {
        throw error;
      }
      throw new Error(
        "Maieutic could not connect to the local TTS service. Check its endpoint and confirm it is running.",
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancelForCaller);
    }
  }
}

export function normalizeLocalSpeechEndpoint(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("A local TTS endpoint is required.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(trimmed);
  } catch {
    throw new Error("The local TTS endpoint must be a valid URL.");
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("The local TTS endpoint must use HTTP or HTTPS.");
  }
  if (!LOOPBACK_HOSTS.has(endpoint.hostname.toLowerCase())) {
    throw new Error("The local TTS endpoint must use localhost, 127.0.0.1, or ::1.");
  }
  if (endpoint.username.length > 0 || endpoint.password.length > 0) {
    throw new Error("Store credentials separately; do not include them in the local TTS endpoint.");
  }
  if (endpoint.search.length > 0 || endpoint.hash.length > 0) {
    throw new Error("The local TTS endpoint cannot include a query string or fragment.");
  }

  const path = endpoint.pathname.replace(/\/+$/u, "");
  if (path.length === 0) {
    endpoint.pathname = "/v1/audio/speech";
  } else if (path.endsWith("/v1")) {
    endpoint.pathname = `${path}/audio/speech`;
  } else {
    endpoint.pathname = path;
  }
  return endpoint.toString();
}

export function toLocalSpeechPayload(request: SpeechRequest): LocalSpeechPayload {
  if (request.provider !== "local") {
    throw new Error("A local speech request is required.");
  }
  return {
    model: requireLocalRequestSetting(request.localModel, "model"),
    voice: requireLocalRequestSetting(request.localVoice, "voice"),
    input: request.text,
    speed: request.speed,
    response_format: "wav",
  };
}

function requireLocalRequestSetting(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Local TTS ${name} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > 512) {
    throw new Error(`Local TTS ${name} cannot exceed 512 characters.`);
  }
  return normalized;
}

function isWav(audio: Uint8Array): boolean {
  return audio.byteLength >= 12
    && String.fromCharCode(...audio.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...audio.subarray(8, 12)) === "WAVE";
}

async function readLimitedAudio(response: Response): Promise<Uint8Array> {
  if (response.body === null) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalLength += value.byteLength;
      if (totalLength > MAX_LOCAL_AUDIO_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new LocalSpeechError("The local TTS service returned audio larger than 64 MB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const audio = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return audio;
}

class LocalSpeechError extends Error {}
