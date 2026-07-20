import * as vscode from "vscode";
import { FocusController } from "./focus-controller.js";
import type { FocusContentInput, PointAtContentInput } from "./model.js";
import { registerSocrAItesParticipant } from "./socraites-participant.js";
import {
  CLEAR_TTS_KEY_COMMAND,
  CONFIGURE_LOCAL_TTS_COMMAND,
  CONFIGURE_TTS_COMMAND,
  PREVIEW_TTS_COMMAND,
  SELECT_TTS_PROVIDER_COMMAND,
  SELECT_TTS_VOICE_COMMAND,
  SPEAK_TOOL_NAME,
  SpeechController,
  STOP_SPEAKING_COMMAND,
} from "./speech-controller.js";
import type { SpeakInput } from "./speech-model.js";
import {
  START_VOICE_CONVERSATION_COMMAND,
  STOP_VOICE_CONVERSATION_COMMAND,
  VoiceConversationController,
} from "./voice-conversation-controller.js";

const SHOW_BUILD_INFO_COMMAND = "maieutic.showBuildInfo";
const FOCUS_TOOL_NAME = "maieutic_focus_content";
const POINT_TOOL_NAME = "maieutic_point_at_content";
const CLEAR_TOOL_NAME = "maieutic_clear_focus_content";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const controller = new FocusController();
  const speech = new SpeechController(context);
  await speech.initialize();
  const voiceConversation = new VoiceConversationController(context, speech);

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    const status = vscode.window.createStatusBarItem(
      "maieutic.development.status",
      vscode.StatusBarAlignment.Left,
      100,
    );
    status.text = `$(beaker) Maieutic DEV ${extensionVersion(context)}`;
    status.tooltip = "Maieutic development build is active";
    status.command = SHOW_BUILD_INFO_COMMAND;
    status.show();
    context.subscriptions.push(status);
  }

  context.subscriptions.push(
    controller,
    speech,
    voiceConversation,
    registerSocrAItesParticipant(
      context,
      controller,
      speech,
      () => voiceConversation.onParticipantTurnComplete(),
    ),
    registerCommand(START_VOICE_CONVERSATION_COMMAND, () => voiceConversation.start()),
    registerCommand(STOP_VOICE_CONVERSATION_COMMAND, () => voiceConversation.stop()),
    registerCommand(SHOW_BUILD_INFO_COMMAND, () => showBuildInfo(context)),
    registerCommand(CONFIGURE_TTS_COMMAND, () => speech.configure()),
    registerCommand(CONFIGURE_LOCAL_TTS_COMMAND, () => speech.configureLocal()),
    registerCommand(CLEAR_TTS_KEY_COMMAND, () => speech.clearApiKey()),
    registerCommand(SELECT_TTS_PROVIDER_COMMAND, () => speech.selectProvider()),
    registerCommand(SELECT_TTS_VOICE_COMMAND, () => speech.selectVoice()),
    registerCommand(PREVIEW_TTS_COMMAND, () => speech.preview()),
    registerCommand(STOP_SPEAKING_COMMAND, () => speech.stop()),
    registerCommand("maieutic.focusAroundCursor", () => controller.focusAroundCursor()),
    registerCommand("maieutic.pointAtCursor", () => controller.pointAtCursor()),
    registerCommand("maieutic.clearPointer", () => controller.clearPointer()),
    registerCommand("maieutic.demoAtCursor", () => controller.demoAtCursor()),
    registerCommand("maieutic.clear", () => controller.clear()),
    vscode.lm.registerTool<FocusContentInput>(FOCUS_TOOL_NAME, {
      async invoke(options, token) {
        return toolResult(await controller.focus(options.input, token));
      },
      prepareInvocation(options) {
        return {
          invocationMessage: `Focusing ${options.input.path}`,
          confirmationMessages: {
            title: "Focus editor content",
            message: `Allow the agent to open and visually focus \`${options.input.path}\`? This will not edit the file.`,
          },
        };
      },
    }),
    vscode.lm.registerTool<PointAtContentInput>(POINT_TOOL_NAME, {
      async invoke(options, token) {
        return toolResult(await controller.point(options.input, token));
      },
      prepareInvocation(options) {
        const clearing = options.input.action === "clear";
        return {
          invocationMessage: clearing ? "Clearing the precise pointer" : "Moving the precise pointer",
          confirmationMessages: {
            title: clearing ? "Clear content pointer" : "Point at editor content",
            message: clearing
              ? "Allow the agent to clear the precise pointer while preserving the focused section?"
              : "Allow the agent to move the precise pointer within the focused section? This will not edit or scroll the file.",
          },
        };
      },
    }),
    vscode.lm.registerTool<Record<string, never>>(CLEAR_TOOL_NAME, {
      invoke() {
        controller.clear();
        return toolResult("Cleared the focused section and precise pointer.");
      },
      prepareInvocation() {
        return {
          invocationMessage: "Clearing focused content",
          confirmationMessages: {
            title: "Clear focused content",
            message: "Allow the agent to clear the complete visual presentation?",
          },
        };
      },
    }),
    vscode.lm.registerTool<SpeakInput>(SPEAK_TOOL_NAME, {
      async invoke(options, token) {
        return toolResult(await speech.invoke(options.input, token));
      },
      prepareInvocation() {
        return {
          invocationMessage: "Generating and playing speech",
        };
      },
    }),
  );
}

export function deactivate(): void {}

async function showBuildInfo(context: vscode.ExtensionContext): Promise<void> {
  const mode = context.extensionMode === vscode.ExtensionMode.Development
    ? "Development"
    : context.extensionMode === vscode.ExtensionMode.Test
      ? "Test"
      : "Production";
  await vscode.window.showInformationMessage(
    `Maieutic ${extensionVersion(context)} is running in ${mode} mode.`,
  );
}

function extensionVersion(context: vscode.ExtensionContext): string {
  const packageJson = context.extension.packageJSON as { version?: unknown };
  return typeof packageJson.version === "string" ? packageJson.version : "unknown";
}

function registerCommand(command: string, callback: () => void | Thenable<void>): vscode.Disposable {
  return vscode.commands.registerCommand(command, async () => {
    try {
      await callback();
    } catch (error: unknown) {
      void vscode.window.showErrorMessage(toErrorMessage(error));
    }
  });
}

function toolResult(message: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(message)]);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
