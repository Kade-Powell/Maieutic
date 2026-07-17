import * as vscode from "vscode";
import { OpenAISpeechProvider } from "./openai-speech-provider.js";
import { SpeechService, type SpeechPhase } from "./speech-service.js";
import {
  DEFAULT_OPENAI_VOICE,
  DEFAULT_SPEECH_INSTRUCTIONS,
  DEFAULT_SPEECH_SPEED,
  isSpeechCancellation,
  resolveSpeechRequest,
  type SpeakInput,
  type SpeechRequest,
} from "./speech-model.js";
import { LocalWavPlayer } from "./wav-player.js";

export const SPEAK_TOOL_NAME = "maieutic_speak";
export const CONFIGURE_TTS_COMMAND = "maieutic.configureOpenAiTts";
export const CLEAR_TTS_KEY_COMMAND = "maieutic.clearOpenAiApiKey";
export const PREVIEW_TTS_COMMAND = "maieutic.previewOpenAiVoice";
export const STOP_SPEAKING_COMMAND = "maieutic.stopSpeaking";

const API_KEY_SECRET = "maieutic.openAiApiKey";
const CONFIGURATION_SECTION = "maieutic.tts";
const PREVIEW_TEXT = "This is Maieutic speaking with an AI-generated OpenAI voice.";

export class SpeechController implements vscode.Disposable {
  private readonly status: vscode.StatusBarItem;
  private readonly service: SpeechService;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.status = vscode.window.createStatusBarItem("maieutic.tts.status", vscode.StatusBarAlignment.Right, 100);
    this.status.command = STOP_SPEAKING_COMMAND;
    this.status.name = "Maieutic speech";
    this.status.tooltip = "Stop the AI-generated OpenAI voice";
    this.service = new SpeechService(
      new OpenAISpeechProvider(),
      new LocalWavPlayer(context.globalStorageUri.fsPath),
      (phase) => this.updateStatus(phase),
    );
  }

  async configure(): Promise<void> {
    const consent = await vscode.window.showWarningMessage(
      "Configure OpenAI text-to-speech for Maieutic?",
      {
        modal: true,
        detail: [
          "Only narration supplied to Maieutic's speak tool and your configured voice settings are sent to OpenAI.",
          "OpenAI API usage may incur charges, and playback uses an AI-generated voice.",
          "The API key is stored in VS Code Secret Storage and is never written to settings or logs.",
        ].join("\n\n"),
      },
      "Continue",
    );
    if (consent !== "Continue") {
      return;
    }

    const apiKey = await vscode.window.showInputBox({
      title: "Configure OpenAI TTS",
      prompt: "Enter an OpenAI API key. It will be stored in VS Code Secret Storage.",
      password: true,
      ignoreFocusOut: true,
      validateInput(value) {
        return value.trim().length === 0 ? "An OpenAI API key is required." : undefined;
      },
    });
    if (apiKey === undefined) {
      return;
    }

    const normalizedKey = apiKey.trim();
    const previousKey = await this.context.secrets.get(API_KEY_SECRET);
    await this.context.secrets.store(API_KEY_SECRET, normalizedKey);
    try {
      await this.configuration().update("enabled", true, vscode.ConfigurationTarget.Global);
    } catch (error: unknown) {
      if (previousKey === undefined) {
        await this.context.secrets.delete(API_KEY_SECRET);
      } else {
        await this.context.secrets.store(API_KEY_SECRET, previousKey);
      }
      throw error;
    }

    const selection = await vscode.window.showInformationMessage(
      "OpenAI text-to-speech is configured. Maieutic will clearly identify its preview as AI-generated.",
      "Preview Voice",
    );
    if (selection === "Preview Voice") {
      await this.preview();
    }
  }

  async clearApiKey(): Promise<void> {
    this.service.stop();
    await this.context.secrets.delete(API_KEY_SECRET);
    await this.configuration().update("enabled", false, vscode.ConfigurationTarget.Global);
    await vscode.window.showInformationMessage("Maieutic's OpenAI API key was removed and text-to-speech was disabled.");
  }

  async preview(): Promise<void> {
    await this.speak({ text: PREVIEW_TEXT });
  }

  stop(): void {
    this.service.stop();
  }

  async invoke(input: SpeakInput, token: vscode.CancellationToken): Promise<string> {
    if (!this.configuration().get<boolean>("enabled", false)) {
      throw new Error("OpenAI text-to-speech is disabled. Run 'Maieutic: Configure OpenAI TTS' first.");
    }

    const cancellation = new AbortController();
    const subscription = token.onCancellationRequested(() => cancellation.abort());
    if (token.isCancellationRequested) {
      cancellation.abort();
    }
    try {
      const request = this.resolveRequest(input);
      await this.speakRequest(request, cancellation.signal);
      return `Spoke the supplied narration with the configured OpenAI '${request.voice}' voice.`;
    } catch (error: unknown) {
      if (isSpeechCancellation(error)) {
        if (token.isCancellationRequested) {
          throw new vscode.CancellationError();
        }
        return "Speech was stopped. Continue with the text response and do not retry speech automatically.";
      }
      throw error;
    } finally {
      subscription.dispose();
    }
  }

  dispose(): void {
    this.service.dispose();
    this.status.dispose();
  }

  private async speak(input: SpeakInput): Promise<void> {
    const request = this.resolveRequest(input);
    try {
      await this.speakRequest(request);
    } catch (error: unknown) {
      if (!isSpeechCancellation(error)) {
        throw error;
      }
    }
  }

  private async speakRequest(request: SpeechRequest, signal?: AbortSignal): Promise<void> {
    const apiKey = await this.context.secrets.get(API_KEY_SECRET);
    if (apiKey === undefined || apiKey.trim().length === 0) {
      throw new Error("No OpenAI API key is configured. Run 'Maieutic: Configure OpenAI TTS' first.");
    }
    await this.service.speak(request, apiKey, signal);
  }

  private resolveRequest(input: SpeakInput): SpeechRequest {
    const configuration = this.configuration();
    return resolveSpeechRequest(input, {
      voice: configuration.get("voice", DEFAULT_OPENAI_VOICE),
      instructions: configuration.get("instructions", DEFAULT_SPEECH_INSTRUCTIONS),
      speed: configuration.get("speed", DEFAULT_SPEECH_SPEED),
    });
  }

  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
  }

  private updateStatus(phase: SpeechPhase): void {
    switch (phase) {
      case "synthesizing":
        this.status.text = "$(loading~spin) Maieutic: Generating speech";
        this.status.show();
        break;
      case "playing":
        this.status.text = "$(unmute) Maieutic: Speaking";
        this.status.show();
        break;
      case "idle":
        this.status.hide();
        break;
    }
  }
}
