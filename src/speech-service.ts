import {
  type SpeechRequest,
  throwIfSpeechCancelled,
} from "./speech-model.js";

export type SpeechPhase = "idle" | "synthesizing" | "playing";

export interface SpeechSynthesizer {
  synthesize(request: SpeechRequest, apiKey: string, signal: AbortSignal): Promise<Uint8Array>;
}

export interface SpeechPlayer {
  play(audio: Uint8Array, signal: AbortSignal, events?: SpeechPlaybackEvents): Promise<void>;
  stop(): void;
}

export interface SpeechPlaybackEvents {
  onStarted?(): void;
  onInterrupted?(): void;
}

export type SpeechPlaybackStarted = (
  request: SpeechRequest,
  signal: AbortSignal,
) => void | (() => void);

interface ActiveSpeech {
  id: number;
  controller: AbortController;
  completion: Promise<void>;
}

export class SpeechService {
  private active: ActiveSpeech | undefined;
  private nextId = 0;

  constructor(
    private readonly synthesizer: SpeechSynthesizer,
    private readonly player: SpeechPlayer,
    private readonly onPhaseChanged: (phase: SpeechPhase) => void = () => {},
  ) {}

  speak(
    request: SpeechRequest,
    apiKey: string,
    externalSignal?: AbortSignal,
    onPlaybackStarted?: SpeechPlaybackStarted,
  ): Promise<void> {
    const previous = this.active;
    if (previous !== undefined) {
      previous.controller.abort();
      this.player.stop();
    }

    const id = this.nextId + 1;
    this.nextId = id;
    const controller = new AbortController();
    const cancelFromExternalSignal = () => controller.abort();
    if (externalSignal?.aborted === true) {
      controller.abort();
    } else {
      externalSignal?.addEventListener("abort", cancelFromExternalSignal, { once: true });
    }

    const execution = Promise.resolve().then(async () => {
      if (previous !== undefined) {
        try {
          await previous.completion;
        } catch {
          // Replacement speech starts after the previous request has finished cleaning up.
        }
      }
      throwIfSpeechCancelled(controller.signal);
      this.changePhase(id, "synthesizing");
      const audio = await this.synthesizer.synthesize(request, apiKey, controller.signal);
      throwIfSpeechCancelled(controller.signal);
      this.changePhase(id, "playing");
      let stopPlaybackObserver: void | (() => void);
      let playbackObserverClosed = false;
      const startPlaybackObserverOnce = once(() => {
        if (!playbackObserverClosed) {
          stopPlaybackObserver = startPlaybackObserver(onPlaybackStarted, request, controller.signal);
        }
      });
      const stopPlaybackObserverOnce = once(() => {
        playbackObserverClosed = true;
        stopObserver(stopPlaybackObserver);
      });
      try {
        await this.player.play(audio, controller.signal, {
          onStarted: startPlaybackObserverOnce,
          onInterrupted: stopPlaybackObserverOnce,
        });
      } finally {
        stopPlaybackObserverOnce();
      }
      throwIfSpeechCancelled(controller.signal);
    });

    const completion = execution.finally(() => {
      externalSignal?.removeEventListener("abort", cancelFromExternalSignal);
      if (this.active?.id === id) {
        this.active = undefined;
        this.onPhaseChanged("idle");
      }
    });
    this.active = { id, controller, completion };
    return completion;
  }

  stop(): void {
    this.active?.controller.abort();
    this.player.stop();
  }

  dispose(): void {
    this.stop();
  }

  private changePhase(id: number, phase: SpeechPhase): void {
    if (this.active?.id === id) {
      this.onPhaseChanged(phase);
    }
  }
}

function startPlaybackObserver(
  observer: SpeechPlaybackStarted | undefined,
  request: SpeechRequest,
  signal: AbortSignal,
): void | (() => void) {
  try {
    return observer?.(request, signal);
  } catch {
    return undefined;
  }
}

function stopObserver(stop: void | (() => void)): void {
  try {
    stop?.();
  } catch {
    // Visual playback observers are optional and cannot fail completed narration.
  }
}

function once(callback: () => void): () => void {
  let called = false;
  return () => {
    if (called) {
      return;
    }
    called = true;
    callback();
  };
}
