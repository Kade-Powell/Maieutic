export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
export const MAX_SPEECH_TEXT_LENGTH = 4_096;
export const DEFAULT_OPENAI_VOICE = "marin";
export const DEFAULT_SPEECH_INSTRUCTIONS =
  "Speak clearly, warmly, and conversationally. Use natural pauses and varied intonation appropriate for explaining software.";
export const DEFAULT_SPEECH_SPEED = 1;

export const OPENAI_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

export type OpenAIVoice = (typeof OPENAI_VOICES)[number];

export interface SpeakInput {
  text: string;
}

export interface SpeechSettingsInput {
  voice: unknown;
  instructions: unknown;
  speed: unknown;
}

export interface SpeechRequest {
  text: string;
  voice: OpenAIVoice;
  instructions?: string;
  speed: number;
}

export class SpeechCancelledError extends Error {
  constructor() {
    super("Speech was cancelled.");
    this.name = "SpeechCancelledError";
  }
}

export function resolveSpeechRequest(input: SpeakInput, settings: SpeechSettingsInput): SpeechRequest {
  const text = requireNarration(input.text);
  const voice = requireVoice(settings.voice);
  const instructions = requireInstructions(settings.instructions);
  const speed = requireSpeed(settings.speed);

  return instructions === undefined
    ? { text, voice, speed }
    : { text, voice, instructions, speed };
}

export function throwIfSpeechCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new SpeechCancelledError();
  }
}

export function isSpeechCancellation(error: unknown): boolean {
  return error instanceof SpeechCancelledError
    || (error instanceof Error && (error.name === "AbortError" || error.name === "APIUserAbortError"));
}

function requireNarration(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Speech text is required.");
  }
  const text = value.trim();
  if (Array.from(text).length > MAX_SPEECH_TEXT_LENGTH) {
    throw new Error(`Speech text cannot exceed ${MAX_SPEECH_TEXT_LENGTH} characters.`);
  }
  return text;
}

function requireVoice(value: unknown): OpenAIVoice {
  if (typeof value !== "string" || !OPENAI_VOICES.some((voice) => voice === value)) {
    throw new Error(`OpenAI voice must be one of: ${OPENAI_VOICES.join(", ")}.`);
  }
  return value as OpenAIVoice;
}

function requireInstructions(value: unknown): string | undefined {
  if (typeof value !== "string") {
    throw new Error("OpenAI voice instructions must be text.");
  }
  const instructions = value.trim();
  return instructions.length === 0 ? undefined : instructions;
}

function requireSpeed(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.25 || value > 4) {
    throw new Error("OpenAI speech speed must be between 0.25 and 4.");
  }
  return value;
}
