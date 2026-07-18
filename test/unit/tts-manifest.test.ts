import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

interface Manifest {
  extensionKind?: string[];
  extensionPack?: string[];
  publisher?: string;
  dependencies?: Record<string, string>;
  contributes?: {
    commands?: Array<{ command?: string }>;
    languageModelTools?: Array<{
      name?: string;
      when?: string;
      inputSchema?: {
        properties?: { text?: { maxLength?: number } };
      };
    }>;
    configuration?: {
      properties?: Record<
        string,
        { default?: unknown; ignoreSync?: boolean; minimum?: number; maximum?: number }
      >;
    };
  };
}

describe("OpenAI TTS manifest", () => {
  it("runs locally and contributes the complete opt-in surface", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as Manifest;
    const commands = manifest.contributes?.commands?.map(({ command }) => command);

    assert.deepEqual(manifest.extensionKind, ["ui"]);
    assert.equal(manifest.publisher, "TenGallonTechnology");
    assert.deepEqual(manifest.dependencies, { openai: "6.48.0" });
    for (const command of [
      "maieutic.installLocalSpeechInput",
      "maieutic.configureOpenAiTts",
      "maieutic.clearOpenAiApiKey",
      "maieutic.previewOpenAiVoice",
      "maieutic.stopSpeaking",
    ]) {
      assert.ok(commands?.includes(command), `${command} is not contributed`);
    }
  });

  it("declares local speech input as an independent companion", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as Manifest;

    assert.deepEqual(manifest.extensionPack, ["ms-vscode.vscode-speech"]);
  });

  it("keeps the speak tool disabled until setup and limits narration length", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as Manifest;
    const tool = manifest.contributes?.languageModelTools?.find(({ name }) => name === "maieutic_speak");

    assert.ok(tool);
    assert.equal(tool.when, "config.maieutic.tts.enabled");
    assert.equal(tool.inputSchema?.properties?.text?.maxLength, 4_096);
  });

  it("declares safe voice defaults and OpenAI limits", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as Manifest;
    const properties = manifest.contributes?.configuration?.properties;

    assert.equal(properties?.["maieutic.tts.enabled"]?.default, false);
    assert.equal(properties?.["maieutic.tts.enabled"]?.ignoreSync, true);
    assert.equal(properties?.["maieutic.tts.voice"]?.default, "marin");
    assert.equal(properties?.["maieutic.tts.speed"]?.default, 1);
    assert.equal(properties?.["maieutic.tts.speed"]?.minimum, 0.25);
    assert.equal(properties?.["maieutic.tts.speed"]?.maximum, 4);
  });
});
