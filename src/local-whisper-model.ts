export const WHISPER_CPP_VERSION = "1.9.1";
export const WHISPER_MODEL = {
  name: "base.en",
  fileName: "ggml-base.en.bin",
  downloadUrl: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
  sha1: "137c40403d78fd54d454da0f9bd998f78703390c",
  sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
  byteLength: 147_964_211,
  approximateMegabytes: 142,
} as const;

export interface RecorderEvent {
  event: "started" | "recorded" | "no_speech" | "error";
  message?: string;
}

export class NoSpeechDetectedError extends Error {
  constructor() {
    super("Maieutic did not recognize any speech.");
    this.name = "NoSpeechDetectedError";
  }
}

export function parseRecorderEvents(output: string): RecorderEvent[] {
  const events: RecorderEvent[] = [];
  for (const line of output.split(/\r?\n/u)) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const candidate = JSON.parse(line) as Partial<RecorderEvent>;
      if (
        candidate.event === "started"
        || candidate.event === "recorded"
        || candidate.event === "no_speech"
        || candidate.event === "error"
      ) {
        events.push({
          event: candidate.event,
          ...(typeof candidate.message === "string" ? { message: candidate.message } : {}),
        });
      }
    } catch {
      // Ignore incomplete or non-protocol output from a terminating helper.
    }
  }
  return events;
}

export function normalizeWhisperTranscript(value: string): string {
  const text = value.replace(/\s+/gu, " ").trim();
  if (
    /^\[(?:blank[ _]audio|silence|music(?: playing)?|background music)\]$/iu.test(text)
    || /^\((?:silence|music(?: playing)?|background music)\)$/iu.test(text)
  ) {
    return "";
  }
  return text;
}
