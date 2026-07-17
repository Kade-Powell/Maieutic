import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  type ClientOptions,
} from "openai";
import type { SpeechSynthesizer } from "./speech-service.js";
import {
  OPENAI_TTS_MODEL,
  SpeechCancelledError,
  type SpeechRequest,
} from "./speech-model.js";

export interface OpenAISpeechPayload {
  model: typeof OPENAI_TTS_MODEL;
  voice: string;
  input: string;
  instructions?: string;
  speed: number;
  response_format: "wav";
}

export class OpenAISpeechProvider implements SpeechSynthesizer {
  async synthesize(request: SpeechRequest, apiKey: string, signal: AbortSignal): Promise<Uint8Array> {
    const normalizedKey = apiKey.trim();
    if (normalizedKey.length === 0) {
      throw new Error("An OpenAI API key is required.");
    }

    try {
      const client = new OpenAI(openAIClientOptions(normalizedKey));
      const response = await client.audio.speech.create(toOpenAISpeechPayload(request), { signal });
      const audio = new Uint8Array(await response.arrayBuffer());
      if (audio.byteLength === 0) {
        throw new Error("OpenAI returned an empty audio response.");
      }
      return audio;
    } catch (error: unknown) {
      if (signal.aborted) {
        throw new SpeechCancelledError();
      }
      throw safeOpenAIError(error);
    }
  }
}

export function openAIClientOptions(apiKey: string): ClientOptions {
  return {
    apiKey,
    baseURL: "https://api.openai.com/v1",
    logLevel: "off",
    maxRetries: 1,
    organization: null,
    project: null,
    timeout: 60_000,
  };
}

export function toOpenAISpeechPayload(request: SpeechRequest): OpenAISpeechPayload {
  const payload: OpenAISpeechPayload = {
    model: OPENAI_TTS_MODEL,
    voice: request.voice,
    input: request.text,
    speed: request.speed,
    response_format: "wav",
  };
  if (request.instructions !== undefined) {
    payload.instructions = request.instructions;
  }
  return payload;
}

function safeOpenAIError(error: unknown): Error {
  if (error instanceof APIConnectionTimeoutError) {
    return new Error("The OpenAI speech request timed out. Try again.");
  }
  if (error instanceof APIConnectionError) {
    return new Error("Maieutic could not connect to OpenAI. Check your network and try again.");
  }
  if (error instanceof APIError) {
    const requestId = error.requestID === null || error.requestID === undefined
      ? ""
      : ` Request ID: ${error.requestID}.`;
    switch (error.status) {
      case 401:
        return new Error(`OpenAI rejected the configured API key. Reconfigure Maieutic TTS.${requestId}`);
      case 403:
        return new Error(`OpenAI denied access to text-to-speech for this API key.${requestId}`);
      case 429:
        return new Error(`OpenAI text-to-speech is rate limited or out of quota. Try again later.${requestId}`);
      default:
        return new Error(`OpenAI could not generate speech${error.status === undefined ? "" : ` (HTTP ${error.status})`}.${requestId}`);
    }
  }
  if (error instanceof Error && error.message === "OpenAI returned an empty audio response.") {
    return error;
  }
  return new Error("OpenAI could not generate speech. Try again.");
}
