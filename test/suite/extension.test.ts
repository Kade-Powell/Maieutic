import assert from "node:assert/strict";
import * as vscode from "vscode";

const commands = [
  "maieutic.focusAroundCursor",
  "maieutic.pointAtCursor",
  "maieutic.clearPointer",
  "maieutic.demoAtCursor",
  "maieutic.clear",
  "maieutic.installLocalSpeechInput",
  "maieutic.configureOpenAiTts",
  "maieutic.clearOpenAiApiKey",
  "maieutic.previewOpenAiVoice",
  "maieutic.stopSpeaking",
];

const tools = [
  "maieutic_focus_content",
  "maieutic_point_at_content",
  "maieutic_clear_focus_content",
  "maieutic_speak",
];

suite("Maieutic extension", () => {
  suiteSetup(async () => {
    await vscode.workspace.getConfiguration("maieutic.tts").update("enabled", true, vscode.ConfigurationTarget.Global);
    const document = await vscode.workspace.openTextDocument({
      content: ["function example() {", "  return 42;", "}"].join("\n"),
      language: "typescript",
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(1, 9, 1, 9);
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.workspace.getConfiguration("maieutic.tts").update("enabled", false, vscode.ConfigurationTarget.Global);
  });

  test("registers all manual commands and language model tools", async () => {
    await vscode.commands.executeCommand("maieutic.focusAroundCursor");

    const registeredCommands = await vscode.commands.getCommands(true);
    for (const command of commands) {
      assert.ok(registeredCommands.includes(command), `${command} is not registered`);
    }
    for (const tool of tools) {
      assert.ok(vscode.lm.tools.some((candidate) => candidate.name === tool), `${tool} is not registered`);
    }
  });

  test("runs independent focus and pointer controls without changing the document", async () => {
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor);
    const originalText = editor.document.getText();
    const originalDirtyState = editor.document.isDirty;

    await vscode.commands.executeCommand("maieutic.focusAroundCursor");
    await vscode.commands.executeCommand("maieutic.pointAtCursor");
    await vscode.commands.executeCommand("maieutic.clearPointer");
    await vscode.commands.executeCommand("maieutic.clear");

    assert.equal(editor.document.getText(), originalText);
    assert.equal(editor.document.isDirty, originalDirtyState);
  });

  test("keeps the combined demo command available", async () => {
    await vscode.commands.executeCommand("maieutic.demoAtCursor");
    await vscode.commands.executeCommand("maieutic.clear");
  });

  test("allows stop when no speech is active", async () => {
    await vscode.commands.executeCommand("maieutic.stopSpeaking");
  });
});
