import * as vscode from "vscode";
import { LocalWhisper, type LocalWhisperPhase } from "./local-whisper.js";
import { NoSpeechDetectedError } from "./local-whisper-model.js";
import type { SpeechController } from "./speech-controller.js";
import {
  openNewSocrAItesChat,
  submitSocrAItesTranscript,
  type ChatCommandExecutor,
} from "./voice-conversation-model.js";

export const START_VOICE_CONVERSATION_COMMAND = "maieutic.startVoiceConversation";
export const STOP_VOICE_CONVERSATION_COMMAND = "maieutic.stopVoiceConversation";
export const VOICE_CONVERSATION_ACTIVE_CONTEXT = "maieutic.voiceConversationActive";

type ConversationPhase = "idle" | "starting" | LocalWhisperPhase | "waiting";

export class VoiceConversationController implements vscode.Disposable {
  private readonly whisper: LocalWhisper;
  private active = false;
  private phase: ConversationPhase = "idle";
  private turnCancellation: AbortController | undefined;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingTranscript: string | undefined;
  private consecutiveNoSpeech = 0;
  private readonly status: vscode.StatusBarItem;
  private readonly executeChatCommand: ChatCommandExecutor;

  constructor(
    context: vscode.ExtensionContext,
    private readonly speech: SpeechController,
  ) {
    this.whisper = new LocalWhisper(context, (phase) => this.setPhase(phase));
    this.status = vscode.window.createStatusBarItem(
      "maieutic.voiceConversation.status",
      vscode.StatusBarAlignment.Right,
      101,
    );
    this.status.name = "SocrAItes voice conversation";
    this.status.command = STOP_VOICE_CONVERSATION_COMMAND;
    this.executeChatCommand = async (command, ...args) => vscode.commands.executeCommand(command, ...args);
    this.speech.setBargeInHandler({
      onSpeechStart: () => this.onBargeInStarted(),
      onAudioCaptured: (audioPath, signal) => this.onBargeInCaptured(audioPath, signal),
    });
  }

  async initialize(): Promise<void> {
    await vscode.commands.executeCommand("setContext", VOICE_CONVERSATION_ACTIVE_CONTEXT, false);
  }

  async start(): Promise<void> {
    if (this.active) {
      return;
    }
    this.speech.stop();
    this.setPhase("starting");
    this.active = true;
    this.consecutiveNoSpeech = 0;
    this.speech.setConversationActive(true);
    try {
      await vscode.commands.executeCommand("setContext", VOICE_CONVERSATION_ACTIVE_CONTEXT, true);
      await openNewSocrAItesChat(this.executeChatCommand);
    } catch (error: unknown) {
      this.stop();
      throw error;
    }
    void vscode.window.showInformationMessage("SocrAItes call started. Speak naturally, then pause to send.");
    void this.listenForTurn();
  }

  stop(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.pendingTranscript = undefined;
    this.consecutiveNoSpeech = 0;
    this.turnCancellation?.abort();
    this.turnCancellation = undefined;
    if (this.resumeTimer !== undefined) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = undefined;
    }
    this.whisper.stop();
    this.speech.stop();
    this.speech.setConversationActive(false);
    this.setPhase("idle");
    void vscode.commands.executeCommand("setContext", VOICE_CONVERSATION_ACTIVE_CONTEXT, false);
    void vscode.commands.executeCommand("workbench.action.chat.cancel");
  }

  onParticipantTurnComplete(): void {
    if (!this.active || this.phase !== "waiting") {
      return;
    }
    if (this.pendingTranscript !== undefined) {
      const transcript = this.pendingTranscript;
      this.pendingTranscript = undefined;
      void this.submitTranscript(transcript).catch((error: unknown) => {
        if (!this.active) {
          return;
        }
        this.stop();
        void vscode.window.showErrorMessage(toErrorMessage(error));
      });
      return;
    }
    this.scheduleNextTurn();
  }

  dispose(): void {
    this.stop();
    this.speech.setBargeInHandler(undefined);
    this.whisper.dispose();
    this.status.dispose();
  }

  private async listenForTurn(): Promise<void> {
    if (!this.active || this.turnCancellation !== undefined) {
      return;
    }
    const cancellation = new AbortController();
    this.turnCancellation = cancellation;
    let retryAfterNoSpeech = false;
    try {
      const transcript = await this.whisper.captureAndTranscribe(cancellation.signal);
      if (!this.active || cancellation.signal.aborted) {
        return;
      }
      await this.submitTranscript(transcript);
    } catch (error: unknown) {
      if (cancellation.signal.aborted) {
        return;
      }
      if (error instanceof NoSpeechDetectedError) {
        this.consecutiveNoSpeech += 1;
        if (this.consecutiveNoSpeech === 1) {
          void vscode.window.showWarningMessage(
            "SocrAItes is listening but has not detected speech. Check the selected microphone and macOS microphone permission.",
            "End Call",
          ).then((action) => {
            if (action === "End Call") {
              this.stop();
            }
          });
        }
        retryAfterNoSpeech = true;
        return;
      }
      this.stop();
      if (!(error instanceof vscode.CancellationError)) {
        await showCallError(error);
      }
    } finally {
      if (this.turnCancellation === cancellation) {
        this.turnCancellation = undefined;
      }
      if (retryAfterNoSpeech && this.active) {
        void this.listenForTurn();
      }
    }
  }

  private onBargeInStarted(): void {
    if (!this.active) {
      return;
    }
    if (this.resumeTimer !== undefined) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = undefined;
    }
    this.setPhase("listening");
  }

  private async onBargeInCaptured(audioPath: string, signal: AbortSignal): Promise<void> {
    if (!this.active || signal.aborted) {
      return;
    }
    try {
      const transcript = await this.whisper.transcribeAudioFile(audioPath, signal);
      if (!this.active || signal.aborted) {
        return;
      }
      this.pendingTranscript = transcript;
      this.setPhase("waiting");
    } catch (error: unknown) {
      if (signal.aborted || error instanceof vscode.CancellationError) {
        return;
      }
      if (error instanceof NoSpeechDetectedError) {
        this.setPhase("waiting");
        return;
      }
      this.stop();
      await showCallError(error);
    }
  }

  private async submitTranscript(transcript: string): Promise<void> {
    if (!this.active) {
      return;
    }
    this.consecutiveNoSpeech = 0;
    this.setPhase("waiting");
    await submitSocrAItesTranscript(this.executeChatCommand, transcript);
  }

  private scheduleNextTurn(): void {
    if (this.resumeTimer !== undefined) {
      clearTimeout(this.resumeTimer);
    }
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = undefined;
      if (!this.active || this.phase !== "waiting") {
        return;
      }
      if (this.turnCancellation !== undefined) {
        this.scheduleNextTurn();
        return;
      }
      void this.listenForTurn();
    }, 100);
  }

  private setPhase(phase: ConversationPhase): void {
    this.phase = phase;
    switch (phase) {
      case "starting":
        this.status.text = "$(loading~spin) SocrAItes: Starting call";
        this.status.tooltip = "Starting a new SocrAItes voice conversation";
        this.status.show();
        break;
      case "preparing":
        this.status.text = "$(loading~spin) SocrAItes: Preparing speech";
        this.status.tooltip = "Preparing local speech recognition";
        this.status.show();
        break;
      case "listening":
        this.status.text = "$(mic-filled) SocrAItes: Listening";
        this.status.tooltip = "Listening locally; click to end the call";
        this.status.show();
        break;
      case "transcribing":
        this.status.text = "$(loading~spin) SocrAItes: Transcribing";
        this.status.tooltip = "Transcribing locally; click to end the call";
        this.status.show();
        break;
      case "waiting":
        this.status.text = "$(comment-discussion) SocrAItes: Thinking";
        this.status.tooltip = "Waiting for SocrAItes; click to end the call";
        this.status.show();
        break;
      case "idle":
        this.status.hide();
        break;
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function showCallError(error: unknown): Promise<void> {
  const message = toErrorMessage(error);
  if (!/microphone permission was denied/iu.test(message)) {
    await vscode.window.showErrorMessage(message);
    return;
  }

  const action = await vscode.window.showErrorMessage(message, "Open Microphone Settings");
  if (action === "Open Microphone Settings") {
    await vscode.env.openExternal(
      vscode.Uri.parse("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"),
    );
  }
}
