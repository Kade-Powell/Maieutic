import * as vscode from "vscode";
import type { ActiveFocusSnapshot, FocusController } from "./focus-controller.js";
import {
  deriveNarrationPointerCues,
  scheduleNarrationPointerCues,
} from "./narration-pointer-model.js";
import type { SpeechPlaybackStarted } from "./speech-service.js";

export class NarrationPointerCoordinator {
  constructor(private readonly focus: FocusController) {}

  async prepare(
    markdown: string,
    narration: string,
    token: vscode.CancellationToken,
  ): Promise<SpeechPlaybackStarted | undefined> {
    let snapshot: ActiveFocusSnapshot | undefined;
    try {
      snapshot = await this.focus.activeFocusSnapshot(token);
    } catch {
      if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
      }
      return undefined;
    }
    if (snapshot === undefined) {
      return undefined;
    }

    const cues = deriveNarrationPointerCues(
      markdown,
      narration,
      snapshot.focusedText,
      snapshot.focus.start,
    );
    if (cues.length === 0) {
      return undefined;
    }

    return (request, signal) => {
      if (signal.aborted) {
        return;
      }
      const timers: Array<ReturnType<typeof setTimeout>> = [];
      let stopped = false;
      const stop = () => {
        if (stopped) {
          return;
        }
        stopped = true;
        signal.removeEventListener("abort", stop);
        for (const timer of timers) {
          clearTimeout(timer);
        }
      };
      signal.addEventListener("abort", stop, { once: true });

      for (const cue of scheduleNarrationPointerCues(cues, narration, request.speed)) {
        timers.push(setTimeout(() => {
          if (stopped || signal.aborted) {
            return;
          }
          if (!this.focus.pointToResolvedRange(snapshot.revision, cue.range)) {
            stop();
          }
        }, cue.delayMs));
      }
      return stop;
    };
  }
}
