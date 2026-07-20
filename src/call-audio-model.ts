export type CallAudioEvent =
  | { event: "started" }
  | { event: "interrupted" }
  | { event: "played" }
  | { event: "recorded" }
  | { event: "retry"; message?: string }
  | { event: "error"; message?: string };

const CALL_AUDIO_EVENTS = new Set<CallAudioEvent["event"]>([
  "started",
  "interrupted",
  "played",
  "recorded",
  "retry",
  "error",
]);

export function parseCallAudioEvent(line: string): CallAudioEvent | undefined {
  try {
    const value = JSON.parse(line) as { event?: unknown; message?: unknown };
    if (typeof value.event !== "string" || !CALL_AUDIO_EVENTS.has(value.event as CallAudioEvent["event"])) {
      return undefined;
    }
    if (value.event === "error" || value.event === "retry") {
      return {
        event: value.event,
        ...(typeof value.message === "string" ? { message: value.message } : {}),
      };
    }
    return { event: value.event as Exclude<CallAudioEvent["event"], "error" | "retry"> };
  } catch {
    return undefined;
  }
}

export function parseCallAudioEvents(output: string): CallAudioEvent[] {
  return output
    .split(/\r?\n/u)
    .map(parseCallAudioEvent)
    .filter((event): event is CallAudioEvent => event !== undefined);
}
