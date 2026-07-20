import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import {
  NoSpeechDetectedError,
  normalizeWhisperTranscript,
  parseRecorderEvents,
  WHISPER_MODEL,
} from "./local-whisper-model.js";

export type LocalWhisperPhase = "preparing" | "listening" | "transcribing";

export class LocalWhisper implements vscode.Disposable {
  private preparedModelPath: string | undefined;
  private activeProcess: ReturnType<typeof spawn> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onPhase: (phase: LocalWhisperPhase) => void = () => {},
  ) {}

  async captureAndTranscribe(signal: AbortSignal): Promise<string> {
    const modelPath = await this.ensurePrepared(signal);
    throwIfAborted(signal);

    const directory = join(this.context.globalStorageUri.fsPath, "voice");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const id = randomUUID();
    const audioPath = join(directory, `${id}.wav`);
    try {
      this.onPhase("listening");
      await this.record(audioPath, signal);
      await chmod(audioPath, 0o600);
      throwIfAborted(signal);
      return await this.transcribePreparedAudio(modelPath, audioPath, signal);
    } finally {
      await rm(audioPath, { force: true });
    }
  }

  async transcribeAudioFile(audioPath: string, signal: AbortSignal): Promise<string> {
    const modelPath = await this.ensurePrepared(signal);
    throwIfAborted(signal);
    await chmod(audioPath, 0o600);
    return await this.transcribePreparedAudio(modelPath, audioPath, signal);
  }

  stop(): void {
    this.activeProcess?.kill();
    this.activeProcess = undefined;
  }

  dispose(): void {
    this.stop();
  }

  private async ensurePrepared(signal: AbortSignal): Promise<string> {
    if (process.platform !== "darwin") {
      throw new Error("Maieutic local voice conversation currently supports macOS. OpenAI TTS remains available separately.");
    }
    try {
      await Promise.all([access(this.recorderPath()), access(this.whisperPath())]);
    } catch {
      throw new Error("Maieutic's local speech runtime is missing. Reinstall the extension and try again.");
    }
    if (this.preparedModelPath !== undefined) {
      return this.preparedModelPath;
    }

    this.onPhase("preparing");
    const modelDirectory = join(this.context.globalStorageUri.fsPath, "whisper");
    const modelPath = join(modelDirectory, WHISPER_MODEL.fileName);
    await mkdir(modelDirectory, { recursive: true, mode: 0o700 });
    await chmod(modelDirectory, 0o700);
    if (await hasExpectedDigests(modelPath, WHISPER_MODEL.sha1, WHISPER_MODEL.sha256)) {
      this.preparedModelPath = modelPath;
      return modelPath;
    }
    await rm(modelPath, { force: true });

    const action = await vscode.window.showInformationMessage(
      "Download Maieutic's local speech model?",
      {
        modal: true,
        detail: [
          `Voice conversation needs the ${WHISPER_MODEL.name} Whisper model (about ${WHISPER_MODEL.approximateMegabytes} MB).`,
          "It is downloaded from the official whisper.cpp model repository, verified before use, and stored in VS Code's private extension data.",
          "Microphone audio is transcribed locally and each recording is deleted immediately. The recognized text is then submitted to your selected VS Code Chat model.",
        ].join("\n\n"),
      },
      "Download",
    );
    if (action !== "Download") {
      throw new vscode.CancellationError();
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Downloading local Whisper ${WHISPER_MODEL.name} model`,
        cancellable: true,
      },
      async (progress, token) => {
        const cancellation = new AbortController();
        const subscription = token.onCancellationRequested(() => cancellation.abort());
        const abortFromCaller = () => cancellation.abort();
        signal.addEventListener("abort", abortFromCaller, { once: true });
        try {
          await downloadModel(modelPath, cancellation.signal, (increment) => progress.report({ increment }));
        } finally {
          subscription.dispose();
          signal.removeEventListener("abort", abortFromCaller);
        }
      },
    );
    if (!(await hasExpectedDigests(modelPath, WHISPER_MODEL.sha1, WHISPER_MODEL.sha256))) {
      await rm(modelPath, { force: true });
      throw new Error("The downloaded Whisper model failed integrity verification.");
    }
    this.preparedModelPath = modelPath;
    return modelPath;
  }

  private async record(audioPath: string, signal: AbortSignal): Promise<void> {
    const child = spawn(this.recorderPath(), ["-", audioPath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.activeProcess = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    let reportedError: string | undefined;
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const parsed = parseRecorderEvents(stdout);
      for (const event of parsed) {
        if (event.event === "error") {
          reportedError = event.message ?? reportedError;
        }
      }
    });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const abort = () => child.kill();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const code = await waitForProcess(child);
      throwIfAborted(signal);
      const events = parseRecorderEvents(stdout);
      if (reportedError !== undefined) {
        throw new Error(reportedError);
      }
      if (events.some((event) => event.event === "no_speech")) {
        throw new NoSpeechDetectedError();
      }
      if (code !== 0 || !events.some((event) => event.event === "recorded")) {
        throw new Error(stderr.trim() || "Maieutic could not capture microphone audio.");
      }
    } finally {
      signal.removeEventListener("abort", abort);
      if (this.activeProcess === child) {
        this.activeProcess = undefined;
      }
    }
  }

  private async transcribe(
    modelPath: string,
    audioPath: string,
    outputPath: string,
    signal: AbortSignal,
  ): Promise<void> {
    const threadCount = Math.max(2, Math.min(8, Math.floor(cpus().length / 2)));
    const child = spawn(this.whisperPath(), [
      "--model", modelPath,
      "--file", audioPath,
      "--language", "en",
      "--threads", String(threadCount),
      "--no-timestamps",
      "--no-prints",
      "--output-txt",
      "--output-file", outputPath,
      "--prompt", "SocrAItes, codebase, TypeScript, Rust, API, workflow, agent",
    ], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    this.activeProcess = child;
    child.stderr.setEncoding("utf8");
    let stderr = "";
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const abort = () => child.kill();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const code = await waitForProcess(child);
      throwIfAborted(signal);
      if (code !== 0) {
        throw new Error(stderr.trim() || `Local Whisper exited with code ${code ?? "unknown"}.`);
      }
    } finally {
      signal.removeEventListener("abort", abort);
      if (this.activeProcess === child) {
        this.activeProcess = undefined;
      }
    }
  }

  private async transcribePreparedAudio(
    modelPath: string,
    audioPath: string,
    signal: AbortSignal,
  ): Promise<string> {
    const directory = join(this.context.globalStorageUri.fsPath, "voice");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const outputPath = join(directory, randomUUID());
    try {
      this.onPhase("transcribing");
      await this.transcribe(modelPath, audioPath, outputPath, signal);
      const text = normalizeWhisperTranscript(await readFile(`${outputPath}.txt`, "utf8"));
      if (text.length === 0) {
        throw new NoSpeechDetectedError();
      }
      return text;
    } finally {
      await rm(`${outputPath}.txt`, { force: true });
    }
  }

  private recorderPath(): string {
    return join(this.context.extensionUri.fsPath, "native", "darwin-universal", "maieutic-recorder");
  }

  private whisperPath(): string {
    return join(this.context.extensionUri.fsPath, "native", "darwin-universal", "whisper-cli");
  }
}

async function downloadModel(
  destination: string,
  signal: AbortSignal,
  reportProgress: (increment: number) => void,
): Promise<void> {
  const temporary = `${destination}.${randomUUID()}.download`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    const response = await fetch(WHISPER_MODEL.downloadUrl, { signal, redirect: "follow" });
    if (!response.ok || response.body === null) {
      throw new Error(`Whisper model download failed with HTTP ${response.status}.`);
    }
    const total = Number(response.headers.get("content-length")) || 0;
    if (total > 0 && total !== WHISPER_MODEL.byteLength) {
      throw new Error("The Whisper model download reported an unexpected size.");
    }
    const reader = response.body.getReader();
    let received = 0;
    let reported = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      await handle.write(value);
      received += value.byteLength;
      if (received > WHISPER_MODEL.byteLength) {
        throw new Error("The Whisper model download exceeded its expected size.");
      }
      if (total > 0) {
        const percent = (received / total) * 100;
        reportProgress(Math.max(0, percent - reported));
        reported = percent;
      }
    }
    if (received !== WHISPER_MODEL.byteLength) {
      throw new Error("The Whisper model download was incomplete.");
    }
    await handle.sync();
    await handle.close();
    await rename(temporary, destination);
  } catch (error: unknown) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true });
    if (signal.aborted) {
      throw new vscode.CancellationError();
    }
    throw error;
  }
}

async function hasExpectedDigests(path: string, expectedSha1: string, expectedSha256: string): Promise<boolean> {
  try {
    if ((await stat(path)).size !== WHISPER_MODEL.byteLength) {
      return false;
    }
    const sha1 = createHash("sha1");
    const sha256 = createHash("sha256");
    for await (const chunk of createReadStream(path)) {
      sha1.update(chunk);
      sha256.update(chunk);
    }
    return sha1.digest("hex") === expectedSha1 && sha256.digest("hex") === expectedSha256;
  } catch {
    return false;
  }
}

function waitForProcess(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new vscode.CancellationError();
  }
}
