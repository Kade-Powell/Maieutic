import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  openNewSocrAItesChat,
  SOCRAITES_CHAT_PREFIX,
  submitSocrAItesTranscript,
} from "../../src/voice-conversation-model.js";

describe("voice conversation chat flow", () => {
  it("opens a fresh chat with SocrAItes selected before listening", async () => {
    const calls: Array<{ command: string; args: unknown[] }> = [];

    await openNewSocrAItesChat(async (command, ...args) => {
      calls.push({ command, args });
    });

    assert.deepEqual(calls, [
      { command: "workbench.action.chat.cancel", args: [] },
      { command: "workbench.action.chat.open", args: [] },
      { command: "workbench.action.chat.newChat", args: [] },
      {
        command: "workbench.action.chat.open",
        args: [{ query: SOCRAITES_CHAT_PREFIX, isPartialQuery: true }],
      },
    ]);
  });

  it("submits every call turn directly to the SocrAItes participant", async () => {
    const calls: Array<{ command: string; args: unknown[] }> = [];

    await submitSocrAItesTranscript(async (command, ...args) => {
      calls.push({ command, args });
    }, "teach me this function");

    assert.deepEqual(calls, [{
      command: "workbench.action.chat.open",
      args: [{ query: "@socraites teach me this function", isPartialQuery: false }],
    }]);
  });
});
