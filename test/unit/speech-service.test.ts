import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SpeechService,
  type SpeechPlayer,
  type SpeechSynthesizer,
} from "../../src/speech-service.js";
import {
  SpeechCancelledError,
  type SpeechRequest,
} from "../../src/speech-model.js";

const request: SpeechRequest = {
  text: "Explain this branch.",
  voice: "marin",
  speed: 1,
};

describe("SpeechService", () => {
  it("synthesizes before playback and reports each phase", async () => {
    const events: string[] = [];
    const synthesizer: SpeechSynthesizer = {
      async synthesize(receivedRequest, apiKey) {
        events.push(`synthesize:${receivedRequest.text}:${apiKey}`);
        return new Uint8Array([1, 2, 3]);
      },
    };
    const player: SpeechPlayer = {
      async play(audio) {
        events.push(`play:${audio.join(",")}`);
      },
      stop() {
        events.push("stop");
      },
    };
    const service = new SpeechService(synthesizer, player, (phase) => events.push(`phase:${phase}`));

    await service.speak(request, "secret-key");

    assert.deepEqual(events, [
      "phase:synthesizing",
      "synthesize:Explain this branch.:secret-key",
      "phase:playing",
      "play:1,2,3",
      "phase:idle",
    ]);
  });

  it("cancels synthesis and returns to idle", async () => {
    const started = deferred<void>();
    const phases: string[] = [];
    let stopCalls = 0;
    const synthesizer: SpeechSynthesizer = {
      async synthesize(_request, _apiKey, signal) {
        started.resolve();
        return await rejectWhenAborted(signal);
      },
    };
    const player: SpeechPlayer = {
      async play() {},
      stop() {
        stopCalls += 1;
      },
    };
    const service = new SpeechService(synthesizer, player, (phase) => phases.push(phase));
    const speech = service.speak(request, "secret-key");
    const rejected = assert.rejects(speech, SpeechCancelledError);

    await started.promise;
    service.stop();
    await rejected;

    assert.equal(stopCalls, 1);
    assert.deepEqual(phases, ["synthesizing", "idle"]);
  });

  it("waits for cancelled speech cleanup before starting its replacement", async () => {
    const firstStarted = deferred<void>();
    const events: string[] = [];
    const synthesizer: SpeechSynthesizer = {
      async synthesize(receivedRequest, _apiKey, signal) {
        events.push(`synthesize:${receivedRequest.text}`);
        if (receivedRequest.text === "First") {
          firstStarted.resolve();
          return await rejectWhenAborted(signal);
        }
        return new Uint8Array([2]);
      },
    };
    const player: SpeechPlayer = {
      async play(audio) {
        events.push(`play:${audio[0]}`);
      },
      stop() {
        events.push("stop");
      },
    };
    const service = new SpeechService(synthesizer, player, (phase) => events.push(`phase:${phase}`));
    const first = service.speak({ ...request, text: "First" }, "secret-key");
    const firstRejected = assert.rejects(first, SpeechCancelledError);

    await firstStarted.promise;
    const second = service.speak({ ...request, text: "Second" }, "secret-key");
    await firstRejected;
    await second;

    assert.deepEqual(events, [
      "phase:synthesizing",
      "synthesize:First",
      "stop",
      "phase:synthesizing",
      "synthesize:Second",
      "phase:playing",
      "play:2",
      "phase:idle",
    ]);
  });

  it("honors an already-cancelled caller without contacting OpenAI", async () => {
    let synthesizeCalls = 0;
    const synthesizer: SpeechSynthesizer = {
      async synthesize() {
        synthesizeCalls += 1;
        return new Uint8Array([1]);
      },
    };
    const player: SpeechPlayer = {
      async play() {},
      stop() {},
    };
    const service = new SpeechService(synthesizer, player);
    const cancellation = new AbortController();
    cancellation.abort();

    await assert.rejects(
      service.speak(request, "secret-key", cancellation.signal),
      SpeechCancelledError,
    );
    assert.equal(synthesizeCalls, 0);
  });
});

function rejectWhenAborted(signal: AbortSignal): Promise<Uint8Array> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(new SpeechCancelledError());
      return;
    }
    signal.addEventListener("abort", () => reject(new SpeechCancelledError()), { once: true });
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
