import * as vscode from "vscode";
import { LocalWhisper, type LocalWhisperPhase } from "./local-whisper.js";
import { NoSpeechDetectedError } from "./local-whisper-model.js";
import type { SpeechController } from "./speech-controller.js";

export const START_VOICE_CONVERSATION_COMMAND = "maieutic.startVoiceConversation";
export const STOP_VOICE_CONVERSATION_COMMAND = "maieutic.stopVoiceConversation";
export const VOICE_CONVERSATION_ACTIVE_CONTEXT = "maieutic.voiceConversationActive";

type ConversationPhase = "idle" | LocalWhisperPhase | "waiting";

export class VoiceConversationController implements vscode.Disposable {
  private readonly whisper: LocalWhisper;
  private active = false;
  private phase: ConversationPhase = "idle";
  private turnCancellation: AbortController | undefined;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingTranscript: string | undefined;
  private status: vscode.Disposable | undefined;

  constructor(
    context: vscode.ExtensionContext,
    private readonly speech: SpeechController,
  ) {
    this.whisper = new LocalWhisper(context, (phase) => this.setPhase(phase));
    this.speech.setBargeInHandler({
      onSpeechStart: () => this.onBargeInStarted(),
      onAudioCaptured: (audioPath, signal) => this.onBargeInCaptured(audioPath, signal),
    });
    void vscode.commands.executeCommand("setContext", VOICE_CONVERSATION_ACTIVE_CONTEXT, false);
  }

  async start(): Promise<void> {
    if (this.active) {
      return;
    }
    this.speech.stop();
    await vscode.commands.executeCommand("workbench.action.chat.cancel");
    this.active = true;
    this.speech.setConversationActive(true);
    await vscode.commands.executeCommand("setContext", VOICE_CONVERSATION_ACTIVE_CONTEXT, true);
    await this.listenForTurn();
  }

  stop(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.pendingTranscript = undefined;
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
    this.status?.dispose();
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
        retryAfterNoSpeech = true;
        return;
      }
      this.stop();
      if (!(error instanceof vscode.CancellationError)) {
        await vscode.window.showErrorMessage(toErrorMessage(error));
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
      await vscode.window.showErrorMessage(toErrorMessage(error));
    }
  }

  private async submitTranscript(transcript: string): Promise<void> {
    if (!this.active) {
      return;
    }
    this.setPhase("waiting");
    await vscode.commands.executeCommand("workbench.action.chat.open", {
      query: `@socraites ${transcript}`,
      isPartialQuery: false,
    });
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
    this.status?.dispose();
    this.status = undefined;
    switch (phase) {
      case "preparing":
        this.status = vscode.window.setStatusBarMessage("$(loading~spin) Maieutic: Preparing local speech");
        break;
      case "listening":
        this.status = vscode.window.setStatusBarMessage("$(mic) Maieutic: Listening");
        break;
      case "transcribing":
        this.status = vscode.window.setStatusBarMessage("$(loading~spin) Maieutic: Transcribing locally");
        break;
      case "waiting":
        this.status = vscode.window.setStatusBarMessage("$(comment-discussion) Maieutic: Waiting for SocrAItes");
        break;
      case "idle":
        break;
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
