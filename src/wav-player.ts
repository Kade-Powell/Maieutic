import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCallAudioEvent, type CallAudioEvent } from "./call-audio-model.js";
import type { SpeechPlaybackEvents, SpeechPlayer } from "./speech-service.js";
import {
  SpeechCancelledError,
  SpeechInterruptedError,
  throwIfSpeechCancelled,
} from "./speech-model.js";

export interface PlayerInvocation {
  command: string;
  args: string[];
  extraEnvironment?: Record<string, string>;
}

export interface VoiceBargeInHandler {
  onSpeechStart(): void;
  onAudioCaptured(audioPath: string, signal: AbortSignal): Promise<void>;
}

type CallAudioOutcome = "played" | "recorded" | "retry";

export class LocalWavPlayer implements SpeechPlayer {
  private child: ChildProcess | undefined;
  private stopCurrent: (() => void) | undefined;
  private conversationActive = false;
  private bargeInHandler: VoiceBargeInHandler | undefined;

  constructor(
    private readonly storagePath: string,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly callAudioPath?: string,
  ) {}

  async play(audio: Uint8Array, signal: AbortSignal, events?: SpeechPlaybackEvents): Promise<void> {
    if (audio.byteLength === 0) {
      throw new Error("Cannot play an empty WAV file.");
    }
    if (this.child !== undefined) {
      throw new Error("A local speech playback process is already active.");
    }

    throwIfSpeechCancelled(signal);
    const audioDirectory = join(this.storagePath, "speech");
    const id = randomUUID();
    const audioPath = join(audioDirectory, `${id}.wav`);
    const capturePath = join(audioDirectory, `${id}.capture.wav`);
    try {
      await mkdir(audioDirectory, { recursive: true, mode: 0o700 });
    } catch {
      throw new Error("Maieutic could not create its private speech storage directory.");
    }

    let playbackFailed = false;
    let playbackError: unknown;
    try {
      try {
        await writeFile(audioPath, audio, { mode: 0o600 });
      } catch {
        throw new Error("Maieutic could not write temporary speech audio to its private storage.");
      }
      throwIfSpeechCancelled(signal);
      if (this.conversationActive && this.platform === "darwin") {
        const handler = this.bargeInHandler;
        if (handler === undefined || this.callAudioPath === undefined) {
          throw new Error("Maieutic's call audio runtime is unavailable. Reinstall the extension and try again.");
        }
        let outcome = await this.playCallAudio(
          callAudioInvocation(this.callAudioPath, audioPath, capturePath),
          signal,
          events,
          handler,
        );
        if (outcome === "retry") {
          throwIfSpeechCancelled(signal);
          outcome = await this.playCallAudio(
            callAudioInvocation(this.callAudioPath, audioPath, capturePath, true),
            signal,
            events,
            handler,
          );
          if (outcome === "retry") {
            throw new Error("Maieutic call audio could not initialize the selected audio route.");
          }
        }
        if (outcome === "recorded") {
          throwIfSpeechCancelled(signal);
          await handler.onAudioCaptured(capturePath, signal);
          throwIfSpeechCancelled(signal);
          throw new SpeechInterruptedError();
        }
      } else {
        await this.playFile(playerInvocation(this.platform, audioPath), signal, events);
      }
    } catch (error: unknown) {
      playbackFailed = true;
      playbackError = error;
    }

    try {
      await Promise.all([
        rm(audioPath, { force: true }),
        rm(capturePath, { force: true }),
      ]);
    } catch {
      throw new Error("Maieutic could not remove temporary speech audio from its private storage.");
    }
    if (playbackFailed) {
      throw playbackError;
    }
  }

  stop(): void {
    this.stopCurrent?.();
  }

  setConversationActive(active: boolean): void {
    this.conversationActive = active;
  }

  setBargeInHandler(handler: VoiceBargeInHandler | undefined): void {
    this.bargeInHandler = handler;
  }

  private async playFile(
    invocation: PlayerInvocation,
    signal: AbortSignal,
    playbackEvents?: SpeechPlaybackEvents,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let cancelled = false;
      const child = spawn(invocation.command, invocation.args, {
        env: invocation.extraEnvironment === undefined
          ? process.env
          : { ...process.env, ...invocation.extraEnvironment },
        stdio: "ignore",
        windowsHide: true,
      });
      this.child = child;

      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", cancel);
        if (this.child === child) {
          this.child = undefined;
          this.stopCurrent = undefined;
        }
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      };
      const cancel = () => {
        cancelled = true;
        try {
          child.kill();
        } catch {
          finish(new SpeechCancelledError());
        }
      };
      this.stopCurrent = cancel;
      signal.addEventListener("abort", cancel, { once: true });

      child.once("spawn", () => safelyNotify(playbackEvents?.onStarted));
      child.once("error", (error: NodeJS.ErrnoException) => {
        if (cancelled || signal.aborted) {
          finish(new SpeechCancelledError());
          return;
        }
        if (error.code === "ENOENT") {
          finish(new Error(
            `Maieutic could not find '${invocation.command}', which is required for local WAV playback on this platform.`,
          ));
          return;
        }
        finish(new Error("Maieutic could not start the local WAV player."));
      });
      child.once("close", (code) => {
        if (cancelled || signal.aborted) {
          finish(new SpeechCancelledError());
        } else if (code === 0) {
          finish();
        } else {
          finish(new Error(`Local WAV playback exited with code ${code ?? "unknown"}.`));
        }
      });

      if (signal.aborted) {
        cancel();
      }
    });
  }

  private async playCallAudio(
    invocation: PlayerInvocation,
    signal: AbortSignal,
    playbackEvents: SpeechPlaybackEvents | undefined,
    handler: VoiceBargeInHandler,
  ): Promise<CallAudioOutcome> {
    return await new Promise<CallAudioOutcome>((resolve, reject) => {
      let settled = false;
      let cancelled = false;
      let stderr = "";
      let stdoutBuffer = "";
      let outcome: CallAudioOutcome | undefined;
      let reportedError: string | undefined;
      let interruptionReported = false;
      let playbackStartedReported = false;
      const child = spawn(invocation.command, invocation.args, {
        env: invocation.extraEnvironment === undefined
          ? process.env
          : { ...process.env, ...invocation.extraEnvironment },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      this.child = child;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      const finish = (result?: CallAudioOutcome, error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", cancel);
        if (this.child === child) {
          this.child = undefined;
          this.stopCurrent = undefined;
        }
        if (error !== undefined) {
          reject(error);
        } else if (result !== undefined) {
          resolve(result);
        } else {
          reject(new Error("Maieutic call audio ended without a result."));
        }
      };
      const cancel = () => {
        cancelled = true;
        try {
          child.kill();
        } catch {
          finish(undefined, new SpeechCancelledError());
        }
      };
      const acceptEvent = (event: CallAudioEvent) => {
        switch (event.event) {
          case "interrupted":
            if (!interruptionReported) {
              interruptionReported = true;
              safelyNotify(playbackEvents?.onInterrupted);
              safelyNotify(() => handler.onSpeechStart());
            }
            break;
          case "played":
          case "recorded":
          case "retry":
            outcome = event.event;
            break;
          case "error":
            reportedError = event.message ?? "Maieutic call audio failed.";
            break;
          case "started":
            if (!playbackStartedReported) {
              playbackStartedReported = true;
              safelyNotify(playbackEvents?.onStarted);
            }
            break;
        }
      };
      const consumeLines = (flush: boolean) => {
        const lines = stdoutBuffer.split(/\r?\n/u);
        stdoutBuffer = flush ? "" : lines.pop() ?? "";
        for (const line of lines) {
          const event = parseCallAudioEvent(line);
          if (event !== undefined) {
            acceptEvent(event);
          }
        }
      };

      this.stopCurrent = cancel;
      signal.addEventListener("abort", cancel, { once: true });
      child.stdout.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        consumeLines(false);
      });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.once("error", (error: NodeJS.ErrnoException) => {
        if (cancelled || signal.aborted) {
          finish(undefined, new SpeechCancelledError());
        } else if (error.code === "ENOENT") {
          finish(undefined, new Error("Maieutic could not find its bundled call audio runtime."));
        } else {
          finish(undefined, new Error("Maieutic could not start its call audio runtime."));
        }
      });
      child.once("close", (code) => {
        consumeLines(true);
        if (cancelled || signal.aborted) {
          finish(undefined, new SpeechCancelledError());
        } else if (reportedError !== undefined) {
          finish(undefined, new Error(reportedError));
        } else if (code !== 0) {
          finish(undefined, new Error(stderr.trim() || `Maieutic call audio exited with code ${code ?? "unknown"}.`));
        } else {
          finish(outcome);
        }
      });

      if (signal.aborted) {
        cancel();
      }
    });
  }
}

function safelyNotify(callback: (() => void) | undefined): void {
  try {
    callback?.();
  } catch {
    // Playback and capture remain authoritative when an optional UI observer fails.
  }
}

export function callAudioInvocation(
  helperPath: string,
  audioPath: string,
  capturePath: string,
  useAcousticGuard = false,
): PlayerInvocation {
  return {
    command: helperPath,
    args: [audioPath, capturePath, ...(useAcousticGuard ? ["--acoustic-guard"] : [])],
  };
}

export function playerInvocation(platform: NodeJS.Platform, audioPath: string): PlayerInvocation {
  switch (platform) {
    case "darwin":
      return {
        command: "afplay",
        args: [audioPath],
      };
    case "win32":
      return {
        command: "powershell.exe",
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$player = New-Object System.Media.SoundPlayer $env:MAIEUTIC_WAV_PATH; $player.PlaySync()",
        ],
        extraEnvironment: { MAIEUTIC_WAV_PATH: audioPath },
      };
    case "linux":
      return {
        command: "aplay",
        args: ["--quiet", audioPath],
      };
    default:
      throw new Error(`Local WAV playback is not supported on '${platform}'.`);
  }
}
