import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpeechSynthesizer } from "./speech-service.js";
import {
  SpeechCancelledError,
  throwIfSpeechCancelled,
  type SpeechRequest,
} from "./speech-model.js";

export interface SystemVoice {
  name: string;
  locale: string;
}

export class SystemSpeechProvider implements SpeechSynthesizer {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  async synthesize(request: SpeechRequest, _credential: string, signal: AbortSignal): Promise<Uint8Array> {
    throwIfSpeechCancelled(signal);
    if (this.platform !== "darwin") {
      throw new Error(
        `Free system speech is not yet supported on '${this.platform}'. Choose a local neural service or OpenAI.`,
      );
    }

    const directory = await mkdtemp(join(tmpdir(), "maieutic-system-speech-"));
    const audioPath = join(directory, "speech.aiff");
    try {
      await runProcess(systemSpeechInvocation(request, audioPath), signal);
      const audio = new Uint8Array(await readFile(audioPath));
      if (audio.byteLength === 0) {
        throw new Error("The system voice returned empty audio.");
      }
      return audio;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export function systemSpeechInvocation(request: SpeechRequest, audioPath: string): {
  command: string;
  args: string[];
} {
  const rate = Math.round(Math.max(80, Math.min(450, 175 * request.speed)));
  const voice = request.systemVoice === undefined ? [] : ["-v", request.systemVoice];
  return {
    command: "say",
    args: [...voice, "-r", String(rate), "-o", audioPath, request.text],
  };
}

export function parseMacSystemVoices(output: string): SystemVoice[] {
  const voices: SystemVoice[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = /^(.*?)\s+([a-z]{2,3}_(?:[A-Z]{2}|\d{3}))\s+#/u.exec(line);
    const name = match?.[1]?.trim();
    const locale = match?.[2];
    if (name !== undefined && name.length > 0 && locale !== undefined) {
      voices.push({ name, locale: locale.replace("_", "-") });
    }
  }
  return voices;
}

export async function listMacSystemVoices(signal?: AbortSignal): Promise<SystemVoice[]> {
  if (process.platform !== "darwin") {
    return [];
  }
  const output = await captureProcess({ command: "say", args: ["-v", "?"] }, signal);
  return parseMacSystemVoices(output);
}

async function runProcess(
  invocation: { command: string; args: string[] },
  signal: AbortSignal,
): Promise<void> {
  await captureProcess(invocation, signal);
}

async function captureProcess(
  invocation: { command: string; args: string[] },
  signal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(invocation.command, invocation.args, {
      signal,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (signal?.aborted === true || error.name === "AbortError") {
        reject(new SpeechCancelledError());
      } else if (error.code === "ENOENT") {
        reject(new Error(`Maieutic could not find the local speech command '${invocation.command}'.`));
      } else {
        reject(new Error("Maieutic could not start the local system voice."));
      }
    });
    child.once("close", (code) => {
      if (signal?.aborted === true) {
        reject(new SpeechCancelledError());
      } else if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `Local system speech exited with code ${code ?? "unknown"}.`));
      }
    });
  });
}
