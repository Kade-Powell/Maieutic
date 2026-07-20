import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpeechRequest } from "../../src/speech-model.js";
import {
  parseMacSystemVoices,
  systemSpeechInvocation,
} from "../../src/system-speech-provider.js";

const request: SpeechRequest = {
  text: "Explain this branch.",
  provider: "system",
  voice: "marin",
  systemVoice: "Samantha",
  speed: 1.25,
};

describe("system speech provider", () => {
  it("passes voice, speed, output, and text as direct process arguments", () => {
    assert.deepEqual(systemSpeechInvocation(request, "/tmp/private speech.aiff"), {
      command: "say",
      args: [
        "-v",
        "Samantha",
        "-r",
        "219",
        "-o",
        "/tmp/private speech.aiff",
        "Explain this branch.",
      ],
    });
  });

  it("parses installed voices whose names contain spaces", () => {
    assert.deepEqual(parseMacSystemVoices([
      "Samantha            en_US    # Hello.",
      "Eddy (English (US)) en_US    # Hello.",
      "Amélie              fr_CA    # Bonjour.",
      "Majed               ar_001   # Hello.",
    ].join("\n")), [
      { name: "Samantha", locale: "en-US" },
      { name: "Eddy (English (US))", locale: "en-US" },
      { name: "Amélie", locale: "fr-CA" },
      { name: "Majed", locale: "ar-001" },
    ]);
  });
});
