import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SpeechPlayer } from "./speech-service.js";
import {
  SpeechCancelledError,
  throwIfSpeechCancelled,
} from "./speech-model.js";

export interface PlayerInvocation {
  command: string;
  args: string[];
  extraEnvironment?: Record<string, string>;
}

export class LocalWavPlayer implements SpeechPlayer {
  private child: ChildProcess | undefined;
  private stopCurrent: (() => void) | undefined;

  constructor(
    private readonly storagePath: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async play(audio: Uint8Array, signal: AbortSignal): Promise<void> {
    if (audio.byteLength === 0) {
      throw new Error("Cannot play an empty WAV file.");
    }
    if (this.child !== undefined) {
      throw new Error("A local speech playback process is already active.");
    }

    throwIfSpeechCancelled(signal);
    const audioDirectory = join(this.storagePath, "speech");
    const audioPath = join(audioDirectory, `${randomUUID()}.wav`);
    const invocation = playerInvocation(this.platform, audioPath);
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
      await this.playFile(invocation, signal);
    } catch (error: unknown) {
      playbackFailed = true;
      playbackError = error;
    }

    try {
      await rm(audioPath, { force: true });
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

  private async playFile(invocation: PlayerInvocation, signal: AbortSignal): Promise<void> {
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
