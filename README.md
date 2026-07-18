# Maieutic

Maieutic is a read-only Socratic teaching extension for VS Code. It bundles **SocrAItes**, visual tools that guide attention without making changes, local speech input through VS Code Speech, and optional OpenAI voice narration.

## SocrAItes

Select **SocrAItes** from the Chat agent picker. The bundled profile:

- can read and search the workspace, inspect problems, ask questions, and consult primary documentation;
- cannot edit files, run commands or tests, or create tasks;
- uses Socratic questions and a progressive hint ladder without withholding basic facts;
- distills repository documentation into mental models, invariants, boundaries, tradeoffs, and verification evidence;
- points to verified code and documentation instead of generating paste-ready implementations; and
- treats workspace `AGENTS.md` and local teaching guidance as domain context without relaxing its read-only boundary.

For broad multi-file discovery, SocrAItes can delegate one bounded investigation to a hidden read-only worker. The worker can search and report evidence but cannot edit, execute, interact with the learner, or control Maieutic's visual tools.

## Visual Tools

SocrAItes and other compatible VS Code agents can use three independent tools:

- `#focusContent` opens a workspace file, reveals a complete line range, and establishes the focused block.
- `#pointAtContent` moves or clears a precise pointer inside that block without scrolling.
- `#clearFocusContent` removes the complete presentation.

SocrAItes makes at most one visual state change per response, explains one idea, and waits before moving the pointer. This keeps the presentation aligned with the conversation and future speech playback.

The presentation uses standard VS Code theme colors and never selects or edits the document. Visual focus, text-to-speech, and speech-to-text remain independent capabilities.

## OpenAI Voice Narration

Maieutic contributes an independent `#speak` tool. When enabled, it sends only the narration supplied to that tool and your configured voice settings to OpenAI's `gpt-4o-mini-tts` model, plays the returned WAV locally, and deletes the temporary audio file. It does not automatically send files, editor content, chat history, tool output, or visual state.

OpenAI API usage may incur charges. All playback is AI-generated. Your API key is stored in VS Code Secret Storage, not in settings or logs.

1. Run **Maieutic: Configure OpenAI TTS** and review the disclosure.
2. Enter an OpenAI API key.
3. Run **Maieutic: Preview OpenAI Voice**.
4. Select **SocrAItes** and ask for an explanation. SocrAItes establishes any visual state first, then speaks the same explanation it returns as text.
5. Click the Maieutic status-bar item or run **Maieutic: Stop Speaking** to cancel synthesis or playback.

The default voice is `marin`. Configure `maieutic.tts.voice`, `maieutic.tts.instructions`, and `maieutic.tts.speed` in Settings. Starting new narration replaces active narration. Run **Maieutic: Clear OpenAI API Key** to remove the stored key and disable speech.

Local playback uses the operating system's WAV player:

- macOS: `afplay`
- Windows: PowerShell `System.Media.SoundPlayer`
- Linux: `aplay`

### Local Speech Input

Maieutic includes Microsoft's [VS Code Speech](https://marketplace.visualstudio.com/items?itemName=ms-vscode.vscode-speech) as an extension-pack companion. A Marketplace installation installs it alongside Maieutic; a GitHub VSIX installation exposes the command below. VS Code Speech supplies the native Chat microphone and voice commands. Recordings are processed locally by VS Code Speech; Maieutic never requests microphone access or receives the audio.

- After installing a GitHub VSIX, run **Maieutic: Install Local Speech Input** if the companion was not installed automatically.
- Select the microphone in Chat or run **Chat: Start Voice Chat** to dictate a SocrAItes prompt.
- Hold `Cmd+I` on macOS or `Ctrl+I` on Windows and Linux for walky-talky mode.
- Configure recognition language with `accessibility.voice.speechLanguage`.
- Leave `accessibility.voice.autoSynthesize` disabled while Maieutic OpenAI TTS is enabled to avoid hearing both narration systems.

Speech-to-text, OpenAI narration, and visual focus remain independent. If VS Code Speech cannot be installed with an offline VSIX installation, install the companion later from the Marketplace; the rest of Maieutic continues to work.

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

1. Open Chat and select **SocrAItes**.
2. Type or dictate: `Teach me how resolvePointer works and how its validation protects the visual focus boundary.`
3. Answer SocrAItes' question, then ask it to move to the next relevant detail.
4. Confirm that it points and explains without editing files or running commands.
5. With OpenAI TTS enabled, confirm each visual change completes before its matching narration begins.

Only workspace-relative paths are accepted by the visual tools. In a multi-root workspace, prefix an ambiguous path with the workspace folder name.

The visual tools remain usable when either speech capability is disabled or unconfigured.

## Development

- `npm run check` runs type checking, linting, and unit tests.
- `npm test` also packages the extension and runs integration tests in an Extension Development Host.
- `npm run package` produces the bundled extension entry point in `dist/`.
- `npm run package:vsix` creates an installable `.vsix` package.
- `test/manual/socraites-acceptance.md` defines the cross-model prompt and tool-boundary release checks.

## Publishing

Pull requests and pushes to `main` run the complete test suite in `.github/workflows/ci.yml`. Version tags always audit, test, package, and publish the VSIX to a GitHub Release through `.github/workflows/release.yml`. If Marketplace credentials are configured, that same VSIX is also published there.

No repository secret is required for GitHub Releases.

### Optional Marketplace Setup

1. Manage the `TenGallonTechnology` publisher in the [Visual Studio Marketplace publisher portal](https://marketplace.visualstudio.com/manage). Its public display name is Ten Gallon Technology.
2. Create a Marketplace publishing token following the [VS Code publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token).
3. Add the token to this GitHub repository as an Actions secret named `VSCE_PAT`.

> Azure DevOps global PATs retire on December 1, 2026. Before then, migrate the Marketplace step to the guide's Microsoft Entra ID secure publishing flow.

### Release

For each release, update both package files together and add the release notes to `CHANGELOG.md`:

```sh
npm version 0.0.3 --no-git-tag-version
```

Then:

1. Commit the release changes on `main`.
2. Create and push the matching tag:

   ```sh
   git tag v0.0.3
   git push origin main v0.0.3
   ```

The release workflow verifies that the tag exactly matches the package version and points to a commit on `main`. It then reruns all tests, audits dependencies, packages one VSIX, and attaches that exact artifact to an idempotent GitHub Release. Marketplace publication is skipped cleanly when `VSCE_PAT` is absent.
