import { join } from "node:path";
import * as vscode from "vscode";
import {
  DEFAULT_LOCAL_TTS_ENDPOINT,
  DEFAULT_LOCAL_TTS_MODEL,
  DEFAULT_LOCAL_TTS_VOICE,
  LocalSpeechProvider,
  normalizeLocalSpeechEndpoint,
} from "./local-speech-provider.js";
import { OpenAISpeechProvider } from "./openai-speech-provider.js";
import {
  type SpeechPlaybackStarted,
  type SpeechSynthesizer,
  SpeechService,
  type SpeechPhase,
} from "./speech-service.js";
import {
  DEFAULT_OPENAI_VOICE,
  DEFAULT_SPEECH_INSTRUCTIONS,
  DEFAULT_SPEECH_PROVIDER,
  DEFAULT_SPEECH_SPEED,
  isSpeechCancellation,
  OPENAI_VOICES,
  resolveSpeechRequest,
  SpeechInterruptedError,
  type OpenAIVoice,
  type SpeakInput,
  type SpeechProviderKind,
  type SpeechRequest,
} from "./speech-model.js";
import {
  listMacSystemVoices,
  SystemSpeechProvider,
  type SystemVoice,
} from "./system-speech-provider.js";
import { LocalWavPlayer, type VoiceBargeInHandler } from "./wav-player.js";

export const SPEAK_TOOL_NAME = "maieutic_speak";
export const CONFIGURE_TTS_COMMAND = "maieutic.configureOpenAiTts";
export const CONFIGURE_LOCAL_TTS_COMMAND = "maieutic.configureLocalTts";
export const CLEAR_TTS_KEY_COMMAND = "maieutic.clearOpenAiApiKey";
export const PREVIEW_TTS_COMMAND = "maieutic.previewVoice";
export const STOP_SPEAKING_COMMAND = "maieutic.stopSpeaking";
export const SELECT_TTS_PROVIDER_COMMAND = "maieutic.selectVoiceProvider";
export const SELECT_TTS_VOICE_COMMAND = "maieutic.selectVoice";

const API_KEY_SECRET = "maieutic.openAiApiKey";
const CONFIGURATION_SECTION = "maieutic.tts";
const OPENAI_PREVIEW_TEXT = "This is Maieutic speaking with an AI-generated OpenAI voice.";
const LOCAL_PREVIEW_TEXT = "This is Maieutic speaking with a neural voice running locally on your machine.";
const SYSTEM_PREVIEW_TEXT = "This is Maieutic speaking with your free local system voice.";

export class SpeechController implements vscode.Disposable {
  private readonly status: vscode.StatusBarItem;
  private readonly player: LocalWavPlayer;
  private readonly service: SpeechService;
  private conversationActive = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.status = vscode.window.createStatusBarItem("maieutic.tts.status", vscode.StatusBarAlignment.Right, 100);
    this.status.command = STOP_SPEAKING_COMMAND;
    this.status.name = "Maieutic speech";
    this.status.tooltip = "Stop Maieutic speech";
    this.player = new LocalWavPlayer(
      context.globalStorageUri.fsPath,
      process.platform,
      join(context.extensionUri.fsPath, "native", "darwin-universal", "maieutic-call-audio"),
    );
    this.service = new SpeechService(
      new ConfigurableSpeechProvider(),
      this.player,
      (phase) => this.updateStatus(phase),
    );
  }

  async initialize(): Promise<void> {
    const provider = this.configuration().inspect<SpeechProviderKind>("provider");
    const hasExplicitProvider = provider?.globalValue !== undefined
      || provider?.workspaceValue !== undefined
      || provider?.workspaceFolderValue !== undefined;
    if (!hasExplicitProvider && await this.hasOpenAIApiKey()) {
      await this.configuration().update("provider", "openai", vscode.ConfigurationTarget.Global);
    }
  }

  async configure(): Promise<void> {
    const consent = await vscode.window.showWarningMessage(
      "Configure OpenAI text-to-speech for Maieutic?",
      {
        modal: true,
        detail: [
          "Only narration supplied to Maieutic and your configured voice settings are sent to OpenAI.",
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
      await this.configuration().update("provider", "openai", vscode.ConfigurationTarget.Global);
      await this.configuration().update("enabled", true, vscode.ConfigurationTarget.Global);
    } catch (error: unknown) {
      if (previousKey === undefined) {
        await this.context.secrets.delete(API_KEY_SECRET);
      } else {
        await this.context.secrets.store(API_KEY_SECRET, previousKey);
      }
      throw error;
    }

    await this.selectOpenAIVoice(false);
    const selection = await vscode.window.showInformationMessage(
      `OpenAI speech is configured with the '${this.configuredOpenAIVoice()}' voice.`,
      "Preview Voice",
    );
    if (selection === "Preview Voice") {
      await this.preview();
    }
  }

  async configureLocal(offerPreview = true): Promise<void> {
    const endpointInput = await vscode.window.showInputBox({
      title: "Configure Local Neural TTS",
      prompt: "OpenAI-compatible speech endpoint running on this machine.",
      value: this.configuredLocalEndpoint(),
      ignoreFocusOut: true,
      validateInput(value) {
        try {
          normalizeLocalSpeechEndpoint(value);
          return undefined;
        } catch (error: unknown) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    });
    if (endpointInput === undefined) {
      return;
    }
    const endpoint = normalizeLocalSpeechEndpoint(endpointInput);

    const model = await vscode.window.showInputBox({
      title: "Configure Local Neural TTS",
      prompt: "Model name exposed by the local service, such as kokoro.",
      value: this.configuredLocalModel(),
      ignoreFocusOut: true,
      validateInput: (value) => validateLocalSetting(value, "model"),
    });
    if (model === undefined) {
      return;
    }

    const voice = await vscode.window.showInputBox({
      title: "Configure Local Neural TTS",
      prompt: "Voice accepted by the model, such as af_heart or a numeric speaker ID.",
      value: this.configuredLocalVoice(),
      ignoreFocusOut: true,
      validateInput: (value) => validateLocalSetting(value, "voice"),
    });
    if (voice === undefined) {
      return;
    }

    await this.configuration().update("localEndpoint", endpoint, vscode.ConfigurationTarget.Global);
    await this.configuration().update("localModel", model.trim(), vscode.ConfigurationTarget.Global);
    await this.configuration().update("localVoice", voice.trim(), vscode.ConfigurationTarget.Global);
    await this.configuration().update("provider", "local", vscode.ConfigurationTarget.Global);
    await this.configuration().update("enabled", true, vscode.ConfigurationTarget.Global);

    const action = await vscode.window.showInformationMessage(
      `Local neural speech is configured with model '${model.trim()}' and voice '${voice.trim()}'.`,
      ...(offerPreview ? ["Preview Voice"] as const : []),
    );
    if (action === "Preview Voice") {
      await this.preview();
    }
  }

  async selectProvider(): Promise<void> {
    const current = this.configuredProvider();
    const selected = await vscode.window.showQuickPick<ProviderQuickPickItem>([
      {
        label: "System voice",
        description: current === "system" ? "Current provider" : "Free and processed locally",
        detail: "Uses a voice installed on this Mac. No API key or usage charge.",
        provider: "system",
      },
      {
        label: "Local neural service",
        description: current === "local" ? "Current provider" : "Private AI voice on this machine",
        detail: "Uses an OpenAI-compatible localhost service such as LocalAI with Kokoro.",
        provider: "local",
      },
      {
        label: "OpenAI",
        description: current === "openai" ? "Current provider" : "Natural AI-generated voices",
        detail: "Uses your OpenAI API key and may incur API charges.",
        provider: "openai",
      },
    ], {
      title: "Select Maieutic Voice Provider",
      placeHolder: `Current provider: ${current}`,
    });
    if (selected === undefined) {
      return;
    }

    if (selected.provider === "local") {
      await this.configureLocal();
      return;
    }

    if (selected.provider === "openai" && !(await this.hasOpenAIApiKey())) {
      const configure = await vscode.window.showInformationMessage(
        "OpenAI is selected, but no API key is configured.",
        "Configure OpenAI",
      );
      if (configure === "Configure OpenAI") {
        await this.configure();
      }
      return;
    }
    await this.configuration().update("provider", selected.provider, vscode.ConfigurationTarget.Global);
    await this.selectVoice();
  }

  async selectVoice(offerPreview = true): Promise<void> {
    switch (this.configuredProvider()) {
      case "system":
        await this.selectSystemVoice(offerPreview);
        break;
      case "local":
        await this.selectLocalVoice(offerPreview);
        break;
      case "openai":
        await this.selectOpenAIVoice(offerPreview);
        break;
    }
  }

  async clearApiKey(): Promise<void> {
    this.service.stop();
    await this.context.secrets.delete(API_KEY_SECRET);
    if (this.configuredProvider() === "openai") {
      await this.configuration().update("provider", "system", vscode.ConfigurationTarget.Global);
    }
    await vscode.window.showInformationMessage(
      "Maieutic's OpenAI API key was removed. Narration now uses the free local system provider.",
    );
  }

  async preview(): Promise<void> {
    const text = this.configuredProvider() === "openai"
      ? OPENAI_PREVIEW_TEXT
      : this.configuredProvider() === "local"
        ? LOCAL_PREVIEW_TEXT
        : SYSTEM_PREVIEW_TEXT;
    await this.speak({ text });
  }

  setConversationActive(active: boolean): void {
    this.conversationActive = active;
    this.player.setConversationActive(active);
  }

  setBargeInHandler(handler: VoiceBargeInHandler | undefined): void {
    this.player.setBargeInHandler(handler);
  }

  stop(): void {
    this.service.stop();
  }

  isEnabled(): boolean {
    return this.conversationActive || this.configuration().get<boolean>("enabled", false);
  }

  async invoke(
    input: SpeakInput,
    token: vscode.CancellationToken,
    onPlaybackStarted?: SpeechPlaybackStarted,
  ): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error("Maieutic speech is disabled. Start a voice conversation or enable automatic narration.");
    }

    const cancellation = new AbortController();
    const subscription = token.onCancellationRequested(() => cancellation.abort());
    if (token.isCancellationRequested) {
      cancellation.abort();
    }
    try {
      const request = this.resolveRequest(input);
      await this.speakRequest(request, cancellation.signal, onPlaybackStarted);
      switch (request.provider) {
        case "system":
          return "Spoke the supplied narration with the configured local system voice.";
        case "local":
          return `Spoke the supplied narration with local model '${request.localModel}' and voice '${request.localVoice}'.`;
        case "openai":
          return `Spoke the supplied narration with the configured OpenAI '${request.voice}' voice.`;
      }
    } catch (error: unknown) {
      if (isSpeechCancellation(error)) {
        if (token.isCancellationRequested) {
          throw new vscode.CancellationError();
        }
        if (error instanceof SpeechInterruptedError) {
          return "The learner interrupted the narration. Do not resume or repeat it.";
        }
        return "Speech was stopped. Continue with the text response and do not retry speech automatically.";
      }
      throw error;
    } finally {
      subscription.dispose();
    }
  }

  dispose(): void {
    this.player.setBargeInHandler(undefined);
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

  private async speakRequest(
    request: SpeechRequest,
    signal?: AbortSignal,
    onPlaybackStarted?: SpeechPlaybackStarted,
  ): Promise<void> {
    const credential = request.provider === "openai"
      ? (await this.context.secrets.get(API_KEY_SECRET))?.trim() ?? ""
      : "";
    if (request.provider === "openai" && credential.length === 0) {
      throw new Error(
        "No OpenAI API key is configured. Select a system or local neural provider, or configure OpenAI TTS.",
      );
    }
    await this.service.speak(request, credential, signal, onPlaybackStarted);
  }

  private resolveRequest(input: SpeakInput): SpeechRequest {
    const configuration = this.configuration();
    return resolveSpeechRequest(input, {
      provider: configuration.get("provider", DEFAULT_SPEECH_PROVIDER),
      voice: configuration.get("voice", DEFAULT_OPENAI_VOICE),
      systemVoice: configuration.get("systemVoice", ""),
      localEndpoint: configuration.get("localEndpoint", DEFAULT_LOCAL_TTS_ENDPOINT),
      localModel: configuration.get("localModel", DEFAULT_LOCAL_TTS_MODEL),
      localVoice: configuration.get("localVoice", DEFAULT_LOCAL_TTS_VOICE),
      instructions: configuration.get("instructions", DEFAULT_SPEECH_INSTRUCTIONS),
      speed: configuration.get("speed", DEFAULT_SPEECH_SPEED),
    });
  }

  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
  }

  private configuredProvider(): SpeechProviderKind {
    return this.configuration().get<SpeechProviderKind>("provider", DEFAULT_SPEECH_PROVIDER);
  }

  private configuredOpenAIVoice(): OpenAIVoice {
    return this.configuration().get<OpenAIVoice>("voice", DEFAULT_OPENAI_VOICE);
  }

  private configuredLocalEndpoint(): string {
    return this.configuration().get<string>("localEndpoint", DEFAULT_LOCAL_TTS_ENDPOINT);
  }

  private configuredLocalModel(): string {
    return this.configuration().get<string>("localModel", DEFAULT_LOCAL_TTS_MODEL);
  }

  private configuredLocalVoice(): string {
    return this.configuration().get<string>("localVoice", DEFAULT_LOCAL_TTS_VOICE);
  }

  private async hasOpenAIApiKey(): Promise<boolean> {
    return ((await this.context.secrets.get(API_KEY_SECRET))?.trim().length ?? 0) > 0;
  }

  private async selectOpenAIVoice(offerPreview: boolean): Promise<void> {
    const currentVoice = this.configuredOpenAIVoice();
    const selected = await vscode.window.showQuickPick<OpenAIVoiceQuickPickItem>(
      OPENAI_VOICES.map((voice) => ({
        label: voice,
        description: voice === currentVoice
          ? "Current voice"
          : voice === "marin" || voice === "cedar"
            ? "Recommended for best quality"
            : undefined,
        voice,
      })),
      {
        title: "Select OpenAI Voice",
        placeHolder: `Current voice: ${currentVoice}`,
        matchOnDescription: true,
      },
    );
    if (selected === undefined) {
      return;
    }
    await this.configuration().update("voice", selected.voice, vscode.ConfigurationTarget.Global);
    await this.offerPreview(selected.voice, offerPreview);
  }

  private async selectSystemVoice(offerPreview: boolean): Promise<void> {
    const voices = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Loading local voices" },
      async () => listMacSystemVoices(),
    );
    if (voices.length === 0) {
      throw new Error("No compatible local system voices were found.");
    }
    const currentVoice = this.configuration().get<string>("systemVoice", "");
    const selected = await vscode.window.showQuickPick<SystemVoiceQuickPickItem>(
      voices.map((voice) => ({
        label: voice.name,
        description: voice.name === currentVoice ? `Current voice · ${voice.locale}` : voice.locale,
        voice,
      })),
      {
        title: "Select Local System Voice",
        placeHolder: currentVoice.length === 0 ? "Current voice: system default" : `Current voice: ${currentVoice}`,
        matchOnDescription: true,
      },
    );
    if (selected === undefined) {
      return;
    }
    await this.configuration().update("systemVoice", selected.voice.name, vscode.ConfigurationTarget.Global);
    await this.offerPreview(selected.voice.name, offerPreview);
  }

  private async selectLocalVoice(offerPreview: boolean): Promise<void> {
    const currentVoice = this.configuredLocalVoice();
    const voice = await vscode.window.showInputBox({
      title: "Select Local Neural Voice",
      prompt: "Voice accepted by the configured local model.",
      value: currentVoice,
      ignoreFocusOut: true,
      validateInput: (value) => validateLocalSetting(value, "voice"),
    });
    if (voice === undefined) {
      return;
    }
    const normalizedVoice = voice.trim();
    await this.configuration().update("localVoice", normalizedVoice, vscode.ConfigurationTarget.Global);
    await this.offerPreview(normalizedVoice, offerPreview);
  }

  private async offerPreview(voice: string, offerPreview: boolean): Promise<void> {
    if (!offerPreview) {
      return;
    }
    const action = await vscode.window.showInformationMessage(
      `Maieutic will use the '${voice}' voice.`,
      "Preview Voice",
    );
    if (action === "Preview Voice") {
      await this.preview();
    }
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

class ConfigurableSpeechProvider implements SpeechSynthesizer {
  private readonly providers: ReadonlyMap<SpeechProviderKind, SpeechSynthesizer> = new Map([
    ["system", new SystemSpeechProvider()],
    ["local", new LocalSpeechProvider()],
    ["openai", new OpenAISpeechProvider()],
  ]);

  synthesize(request: SpeechRequest, credential: string, signal: AbortSignal): Promise<Uint8Array> {
    const provider = this.providers.get(request.provider);
    if (provider === undefined) {
      throw new Error(`No speech provider is registered for '${request.provider}'.`);
    }
    return provider.synthesize(request, credential, signal);
  }
}

function validateLocalSetting(value: string, name: string): string | undefined {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return `A local TTS ${name} is required.`;
  }
  return normalized.length > 512 ? `Local TTS ${name} cannot exceed 512 characters.` : undefined;
}

interface ProviderQuickPickItem extends vscode.QuickPickItem {
  provider: SpeechProviderKind;
}

interface OpenAIVoiceQuickPickItem extends vscode.QuickPickItem {
  voice: OpenAIVoice;
}

interface SystemVoiceQuickPickItem extends vscode.QuickPickItem {
  voice: SystemVoice;
}
