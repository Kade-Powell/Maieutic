# Maieutic

Maieutic is a read-only Socratic teaching extension for VS Code. It bundles **SocrAItes**, a codebase mentor agent with visual tools that guide attention through code and documentation without making changes.

## SocrAItes

Select **SocrAItes** from the Chat agent picker. The bundled profile:

- can read and search the workspace, inspect problems, ask questions, and consult primary documentation;
- cannot edit files, run commands or tests, create tasks, or delegate to subagents;
- uses Socratic questions and a progressive hint ladder without withholding basic facts;
- distills repository documentation into mental models, invariants, boundaries, tradeoffs, and verification evidence;
- points to verified code and documentation instead of generating paste-ready implementations; and
- treats workspace `AGENTS.md` and local teaching guidance as domain context without relaxing its read-only boundary.

## Visual Tools

SocrAItes and other compatible VS Code agents can use three independent tools:

- `#focusContent` opens a workspace file, reveals a complete line range, and establishes the focused block.
- `#pointAtContent` moves or clears a precise pointer inside that block without scrolling.
- `#clearFocusContent` removes the complete presentation.

SocrAItes makes at most one visual state change per response, explains one idea, and waits before moving the pointer. This keeps the presentation aligned with the conversation and future speech playback.

The presentation uses standard VS Code theme colors and never selects or edits the document. Text-to-speech and speech-to-text remain separate follow-on features.

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

1. Open Chat in the Extension Development Host and select **SocrAItes**.
2. Ask: `Teach me how resolvePointer works and how its validation protects the visual focus boundary.`
3. Answer SocrAItes' question, then ask it to move to the next relevant detail.
4. Confirm that it points and explains without editing files or running commands.

Only workspace-relative paths are accepted by the visual tools. In a multi-root workspace, prefix an ambiguous path with the workspace folder name.

## Development

- `npm run check` runs type checking, linting, and unit tests.
- `npm test` also packages the extension and runs integration tests in an Extension Development Host.
- `npm run package` produces the bundled extension entry point in `dist/`.
