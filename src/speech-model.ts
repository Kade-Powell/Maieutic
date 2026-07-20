export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
export const MAX_SPEECH_TEXT_LENGTH = 4_096;
export const DEFAULT_OPENAI_VOICE = "marin";
export const DEFAULT_SPEECH_INSTRUCTIONS =
  "Speak like a patient technical mentor at a measured conversational pace. Pause briefly between ideas and after naming a code symbol. Use natural emphasis without dramatic delivery.";
export const DEFAULT_SPEECH_SPEED = 0.9;
export const DEFAULT_SPEECH_PROVIDER = "system";

export const SPEECH_PROVIDERS = ["system", "local", "openai"] as const;

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
export type SpeechProviderKind = (typeof SPEECH_PROVIDERS)[number];

export interface SpeakInput {
  text: string;
}

export interface SpeechSettingsInput {
  provider?: unknown;
  voice: unknown;
  systemVoice?: unknown;
  localEndpoint?: unknown;
  localModel?: unknown;
  localVoice?: unknown;
  instructions: unknown;
  speed: unknown;
}

export interface SpeechRequest {
  text: string;
  provider: SpeechProviderKind;
  voice: OpenAIVoice;
  systemVoice?: string;
  localEndpoint?: string;
  localModel?: string;
  localVoice?: string;
  instructions?: string;
  speed: number;
}

export class SpeechCancelledError extends Error {
  constructor() {
    super("Speech was cancelled.");
    this.name = "SpeechCancelledError";
  }
}

export class SpeechInterruptedError extends Error {
  constructor() {
    super("Speech was interrupted by the learner.");
    this.name = "SpeechInterruptedError";
  }
}

export function resolveSpeechRequest(input: SpeakInput, settings: SpeechSettingsInput): SpeechRequest {
  const text = requireNarration(input.text);
  const provider = requireProvider(settings.provider ?? DEFAULT_SPEECH_PROVIDER);
  const voice = requireVoice(settings.voice);
  const systemVoice = requireSystemVoice(settings.systemVoice ?? "");
  const instructions = requireInstructions(settings.instructions);
  const speed = requireSpeed(settings.speed);
  const localSettings = provider === "local"
    ? {
        localEndpoint: requireLocalSetting(settings.localEndpoint, "endpoint"),
        localModel: requireLocalSetting(settings.localModel, "model"),
        localVoice: requireLocalSetting(settings.localVoice, "voice"),
      }
    : {};

  return {
    text,
    provider,
    voice,
    ...(systemVoice === undefined ? {} : { systemVoice }),
    ...localSettings,
    ...(instructions === undefined ? {} : { instructions }),
    speed,
  };
}

export function throwIfSpeechCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new SpeechCancelledError();
  }
}

export function isSpeechCancellation(error: unknown): boolean {
  return error instanceof SpeechCancelledError
    || error instanceof SpeechInterruptedError
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

function requireProvider(value: unknown): SpeechProviderKind {
  if (typeof value !== "string" || !SPEECH_PROVIDERS.some((provider) => provider === value)) {
    throw new Error(`Speech provider must be one of: ${SPEECH_PROVIDERS.join(", ")}.`);
  }
  return value as SpeechProviderKind;
}

function requireVoice(value: unknown): OpenAIVoice {
  if (typeof value !== "string" || !OPENAI_VOICES.some((voice) => voice === value)) {
    throw new Error(`OpenAI voice must be one of: ${OPENAI_VOICES.join(", ")}.`);
  }
  return value as OpenAIVoice;
}

function requireSystemVoice(value: unknown): string | undefined {
  if (typeof value !== "string") {
    throw new Error("System voice must be text.");
  }
  const voice = value.trim();
  return voice.length === 0 ? undefined : voice;
}

function requireLocalSetting(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Local TTS ${name} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > 512) {
    throw new Error(`Local TTS ${name} cannot exceed 512 characters.`);
  }
  return normalized;
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
    throw new Error("Speech speed must be between 0.25 and 4.");
  }
  return value;
}
