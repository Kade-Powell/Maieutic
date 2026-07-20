# Change Log

All notable changes to Maieutic are documented here.

## Unreleased

- Added a loopback-only OpenAI-compatible neural TTS provider with configurable endpoint, model, and voice for services such as LocalAI and Kokoro.
- Added provider validation, WAV validation, response limits, timeout handling, and manual acceptance coverage for local neural speech.
- Added deterministic narration cues that move the visual pointer across uniquely matched symbols during playback without another model call or changing the user's caret.
- Added full-duplex macOS call audio with echo cancellation, learner barge-in, local interruption transcription, and automatic SocrAItes turn resumption.
- Restored the selectable SocrAItes custom agent for typed conversations while keeping every one-button call routed to the native SocrAItes participant.
- Shortened teaching turns and adopted a measured narration cadence with natural pauses and synchronized visual cues.

## 0.0.4 - 2026-07-18

- Added the Maieutic brand mark and Marketplace gallery banner.
- Added packaging coverage for the Marketplace icon and editable SVG exclusion.
- Made applicable repository lessons use visual guidance by default instead of returning a text itinerary.
- Gated multi-step lessons to one visualized concept and one learner confirmation per response.
- Replaced the prompt-only teaching profile with a native sticky `@socraites` participant that enforces read-only discovery, one successful visual change, one short teaching step, and optional narration in order.
- Restricted SocrAItes discovery to code search, file reads, diagnostics, existing terminal output, and at most one search subagent.
- Added an OpenAI voice picker to setup and the Command Palette.
- Added one Chat control for a continuous listen, teach, speak, and listen-again conversation with SocrAItes.
- Added private local speech recognition using a pinned universal whisper.cpp runtime and a verified, first-use Whisper model download.
- Added configurable narration providers: free macOS system voices by default or optional OpenAI voices.
- Removed the VS Code Speech extension dependency; Maieutic now owns its voice-conversation loop.
- Added a dedicated Cola development launch, visible development-build status, and local release gate.
- Added a one-command audited local VSIX installation loop so prompt changes can be tested without publishing.

## 0.0.3 - 2026-07-18

- Replaced the retiring Marketplace PAT flow with secretless Microsoft Entra workload identity federation from GitHub Actions.

## 0.0.2 - 2026-07-17

- Corrected the Visual Studio Marketplace publisher ID to `TenGallonTechnology`.

## 0.0.1 - 2026-07-17

- Added the read-only SocrAItes teaching agent profile.
- Added agent-controlled block focus, precise pointer, and clear-focus tools.
- Added theme-responsive visual styling and manual demonstration commands.
- Added optional OpenAI voice narration with secure key storage, local playback, and cancellation.
- Added VS Code Speech as the independently removable local speech-to-text companion.
