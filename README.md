# Maieutic

<p align="center">
  <img src="media/icon.png" alt="Maieutic logo" width="128">
</p>

Maieutic is a read-only Socratic teaching extension for VS Code. It bundles **SocrAItes**, visual tools that guide attention without making changes, and one-button voice conversations with local speech recognition and configurable narration.

## SocrAItes

Choose **SocrAItes** from the Chat agent picker for ordinary typed conversations, or type `@socraites` to use Maieutic's native guided participant. Both are bundled with the extension. The native participant stays selected for the rest of that chat and:

- can read and search the workspace, inspect problems, ask questions, and consult primary documentation;
- cannot edit files, run commands or tests, or create tasks;
- uses Socratic questions and a progressive hint ladder without withholding basic facts;
- distills repository documentation into mental models, invariants, boundaries, tradeoffs, and verification evidence;
- points to verified code and documentation instead of generating paste-ready implementations; and
- treats workspace `AGENTS.md` and local teaching guidance as domain context without relaxing its read-only boundary.

For broad multi-file discovery, SocrAItes can delegate one bounded investigation to a read-only search worker. The worker can search and report evidence but cannot edit, execute, interact with the learner, or control Maieutic's visual tools.

SocrAItes owns the complete teaching turn. It gathers read-only evidence, requires one successful focus or pointer change when editor content applies, produces one short teaching step, optionally speaks that same step, and then stops for the learner. Prompt wording alone does not control that order.

Reasoning uses the model selected in VS Code Chat. Maieutic does not add a second coding-agent provider or use ACP.

## Visual Tools

SocrAItes and other compatible VS Code agents can use three independent tools:

- `#focusContent` opens a workspace file, reveals a complete line range, and establishes the focused block.
- `#pointAtContent` moves or clears a precise pointer inside that block without scrolling.
- `#clearFocusContent` removes the complete presentation.

SocrAItes makes at most one model-requested visual state change per response, explains one idea, and waits before advancing the lesson. During narration, Maieutic can deterministically move its pointer among uniquely matched inline-code mentions inside the focused block. This uses the completed response and focused text without another model call and never moves the user's caret.

The presentation uses standard VS Code theme colors and never selects or edits the document. Visual focus, text-to-speech, and speech-to-text remain independent capabilities.

## Voice Conversation

Open VS Code Chat and click the Maieutic call handset once. The handset is separate from VS Code's microphone, which controls dictation rather than a SocrAItes call. Maieutic then repeats this learner-gated loop:

1. Listen for one learner turn and stop after a short pause.
2. Transcribe the recording locally.
3. Submit the text to the current `@socraites` chat.
4. Let SocrAItes make one applicable visual change and explain one concept.
5. Speak that explanation while keeping echo-cancelled local listening active.
6. Resume ordinary listening automatically when playback finishes, or stop immediately and submit the learner's interruption as the next turn.

Every call uses SocrAItes regardless of the agent currently selected in Chat. The same handset toggles the conversation off while it is active. It keeps listening until you speak or stop it; click the control again to stop capture, transcription, narration, or the active SocrAItes response. Speaking while SocrAItes is talking interrupts playback, preserves the start of the learner's utterance, transcribes it locally, and continues the same call. Maieutic uses native voice-processing echo cancellation when the selected input and output route supports it, then safely retries with a conservative acoustic guard when macOS cannot combine those devices. The Chat session remains open and each SocrAItes response still ends at its teach-back or confirmation gate; voice mode does not let the agent batch later lesson steps.

Local recognition currently supports macOS. On first use, Maieutic asks before downloading the official Whisper `base.en` model, about 142 MB. The model is verified and stored in VS Code's private extension data. Each microphone recording is stored with private permissions and deleted immediately after local transcription. The recognized text is then submitted to the selected VS Code Chat model like a typed prompt.

Maieutic does not install or depend on the VS Code Speech extension.

## Voice Providers

Narration defaults to a free voice installed on macOS and is processed entirely on the machine. Run **Maieutic: Select Voice Provider** to switch between:

- **System voice**: free, local, and uses an installed macOS voice.
- **Local neural service**: private neural speech through an OpenAI-compatible endpoint on this machine, such as LocalAI running Kokoro.
- **OpenAI**: natural AI-generated speech through `gpt-4o-mini-tts`; API charges may apply.

Run **Maieutic: Select Voice** to choose a voice for the active provider and **Maieutic: Preview Voice** to hear it. The system and local-service providers work without an OpenAI key. For OpenAI, run **Maieutic: Configure OpenAI TTS**, review the disclosure, and enter a key. The key is stored in VS Code Secret Storage and is never written to settings or logs.

For local neural speech, install and start the service separately, then run **Maieutic: Configure Local Neural TTS**. Maieutic defaults to LocalAI's `http://127.0.0.1:8080/v1/audio/speech` endpoint, the `kokoro` model, and the `af_heart` voice. For example, LocalAI's model gallery can install Kokoro with:

```sh
local-ai models install kokoro
```

Maieutic accepts only loopback endpoints using `localhost`, `127.0.0.1`, or `::1`; it does not download, start, or manage the local model service. The configured model and voice are sent with each request, so another OpenAI-compatible local TTS implementation can be substituted without changing the extension.

Use `maieutic.tts.speed` to adjust narration speed for any provider. The default is a measured `0.9`, with short teaching turns and natural phrase pauses. `maieutic.tts.instructions` controls delivery style only when OpenAI is selected.

The selected neural provider receives only the final speech-ready narration and configured voice settings. Maieutic does not send files, editor content, chat history, discovery output, or visual state to a speech API. Returned audio is required to be WAV, capped at 64 MB, played locally, and deleted afterward. Run **Maieutic: Clear OpenAI API Key** to remove the cloud credential.

The visual layer, local speech recognition, and narration remain independent capabilities. A typed SocrAItes session can use visuals with narration disabled. Setting `maieutic.tts.enabled` automatically narrates typed SocrAItes turns outside voice-conversation mode; voice-conversation mode always narrates its own responses with the selected provider.

## Local Development

Use a locally installed development VSIX for agent-prompt and packaged-behavior testing. This follows the same audit, Extension Host test, and packaging path as a release, then installs the result only on the local machine:

```sh
npm install
npm run dev:install
```

After installation, run **Developer: Reload Window**, start a new Chat session, and run **Maieutic: Show Build Info**. Confirm the displayed version matches `package.json` before testing SocrAItes. No GitHub tag is created and nothing is published.

Use the Extension Development Host when debugging TypeScript. It loads the current working tree without replacing the installed package and, after activation, marks itself with `Maieutic DEV <version>` in the status bar.

1. Open this repository in VS Code.
2. Press `F5` and choose **Run Maieutic against Cola**. The pre-launch task compiles the extension and opens `../cola` in an Extension Development Host.
3. Run **Maieutic: Show Build Info** and confirm it reports **Development** mode.
4. In a new Chat session, prompt: `@socraites Trace the primary agent-response lane, then lead me through it.`
5. Confirm SocrAItes opens and focuses the first verified owner section, explains one concept, and waits for approval before advancing.
6. After an edit, reload the development window and repeat the affected scenario.

Before creating a version tag, work through `test/manual/socraites-acceptance.md` using the locally installed development VSIX. `npm run dev:install` already runs `npm run verify:release`; run the gate separately when no installation is needed. A version tag is the only trigger that publishes to the Marketplace.

## Try the Visual Layer

1. Run `npm install` and open this project in VS Code.
2. Press `F5` and choose **Run Maieutic Extension** if prompted.
3. In the Extension Development Host, open a source file and place the caret on a word.
4. Run **Maieutic: Focus Around Cursor**.
5. Move the caret within the focused block and run **Maieutic: Point at Cursor**.
6. Move the caret again and repeat **Point at Cursor** to verify that the pointer moves without scrolling.
7. Run **Maieutic: Clear Pointer**, then **Maieutic: Clear**.

**Maieutic: Demo at Cursor** remains available as a shortcut that establishes both visual layers at once.

## Try SocrAItes

1. Open Chat and select **SocrAItes**, or type `@socraites` for the native guided participant.
2. Type or dictate: `Teach me how resolvePointer works and how its validation protects the visual focus boundary.`
3. Answer SocrAItes' question, then ask it to move to the next relevant detail.
4. Confirm that it points and explains without editing files or running commands.
5. Start a SocrAItes call and confirm each visual change completes before its matching narration begins. Interrupt it while it speaks, then confirm playback stops and your interruption becomes the next SocrAItes turn.

Only workspace-relative paths are accepted by the visual tools. In a multi-root workspace, prefix an ambiguous path with the workspace folder name.

The visual tools remain usable when either speech capability is disabled or unconfigured.

## Development

- `npm run check` runs type checking, linting, and unit tests.
- `npm test` also packages the extension and runs integration tests in an Extension Development Host.
- `npm run package` produces the bundled extension entry point in `dist/`.
- `npm run package:vsix` creates an installable `.vsix` package.
- `test/manual/socraites-acceptance.md` defines the cross-model prompt and tool-boundary release checks.

## Publishing

Pull requests and pushes to `main` run the complete test suite in `.github/workflows/ci.yml`. Version tags always audit, test, package, and publish the VSIX to a GitHub Release through `.github/workflows/release.yml`, then publish that same VSIX to the Marketplace.

No publishing secret is stored in GitHub. Marketplace publishing uses Microsoft Entra workload identity federation to exchange a repository-scoped GitHub OIDC token for a short-lived access token.

### Marketplace Automation

1. The `Maieutic GitHub Marketplace Publisher` app registration trusts only GitHub's immutable owner/repository IDs and the `marketplace` environment.
2. The GitHub `marketplace` environment stores the non-secret `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` variables and allows only `v*` tags.
3. The Entra identity's Marketplace profile is a Contributor on the `TenGallonTechnology` publisher.
4. A dedicated Marketplace job downloads the tested artifact, requests `id-token: write`, signs in with a commit-pinned `azure/login`, verifies publisher access, and invokes an exact `vsce` version with `--azure-credential`.

The build and test job cannot request OIDC tokens. The publishing identity has no password, client secret, PAT, or Azure subscription role. The GitHub Release is created before Marketplace publication so the tested VSIX remains available if the Marketplace is temporarily unavailable.

### Release

For each release, update both package files together and add the release notes to `CHANGELOG.md`:

```sh
npm version 0.0.4 --no-git-tag-version
```

Then:

1. Commit the release changes on `main`.
2. Create and push the matching tag:

   ```sh
   git tag v0.0.4
   git push origin main v0.0.4
   ```

The release workflow verifies that the tag exactly matches the package version and points to a commit on `main`. It then reruns all tests, audits dependencies, packages one VSIX, attaches that exact artifact to an idempotent GitHub Release, and publishes it to the Marketplace with a short-lived Entra token.
