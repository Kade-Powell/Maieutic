import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCallAudioEvent,
  parseCallAudioEvents,
} from "../../src/call-audio-model.js";

describe("call audio protocol", () => {
  it("parses only the bounded native event protocol", () => {
    assert.deepEqual(parseCallAudioEvents([
      '{"event":"started"}',
      '{"event":"interrupted"}',
      "not json",
      '{"event":"recorded"}',
      '{"event":"retry","message":"acoustic-guard"}',
      '{"event":"error","message":"denied"}',
      '{"event":"unknown"}',
    ].join("\n")), [
      { event: "started" },
      { event: "interrupted" },
      { event: "recorded" },
      { event: "retry", message: "acoustic-guard" },
      { event: "error", message: "denied" },
    ]);
  });

  it("accepts a final event without a trailing newline", () => {
    assert.deepEqual(parseCallAudioEvent('{"event":"played"}'), { event: "played" });
  });
});
