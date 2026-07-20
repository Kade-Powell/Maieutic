import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveNarrationPointerCues,
  estimateNarrationDurationMs,
  scheduleNarrationPointerCues,
} from "../../src/narration-pointer-model.js";

const focusedText = [
  "  ui: {",
  "    colors: {",
  "      primary: 'sky',",
  "      secondary: 'teal',",
  "      neutral: 'zinc',",
  "    },",
].join("\n");

describe("deriveNarrationPointerCues", () => {
  it("resolves inline-code mentions against the focused source", () => {
    const markdown = [
      "The `ui.colors` object uses `primary: 'sky'`, `secondary: 'teal'`, and `neutral: 'zinc'`.",
      "Try `primary` or `neutral`.",
    ].join(" ");
    const narration = markdown.replaceAll("`", "");

    const cues = deriveNarrationPointerCues(
      markdown,
      narration,
      focusedText,
      { line: 4, character: 0 },
    );

    assert.deepEqual(cues.map(({ pointerText, range }) => ({ pointerText, range })), [
      {
        pointerText: "colors",
        range: { start: { line: 5, character: 4 }, end: { line: 5, character: 10 } },
      },
      {
        pointerText: "primary: 'sky'",
        range: { start: { line: 6, character: 6 }, end: { line: 6, character: 20 } },
      },
      {
        pointerText: "secondary: 'teal'",
        range: { start: { line: 7, character: 6 }, end: { line: 7, character: 23 } },
      },
      {
        pointerText: "neutral: 'zinc'",
        range: { start: { line: 8, character: 6 }, end: { line: 8, character: 21 } },
      },
      {
        pointerText: "primary",
        range: { start: { line: 6, character: 6 }, end: { line: 6, character: 13 } },
      },
      {
        pointerText: "neutral",
        range: { start: { line: 8, character: 6 }, end: { line: 8, character: 13 } },
      },
    ]);
  });

  it("does not guess from file paths or ambiguous source matches", () => {
    assert.deepEqual(
      deriveNarrationPointerCues(
        "Open `ui/app/app.config.ts`.",
        "Open ui/app/app.config.ts.",
        focusedText,
        { line: 4, character: 0 },
      ),
      [],
    );
    assert.deepEqual(
      deriveNarrationPointerCues(
        "Look at `overlayBackdropClass`.",
        "Look at overlayBackdropClass.",
        "const overlayBackdropClass = 'one'\nuse(overlayBackdropClass)",
        { line: 0, character: 0 },
      ),
      [],
    );
  });
});

describe("scheduleNarrationPointerCues", () => {
  it("starts after playback and spaces visual movement", () => {
    const narration = "One two three four five six seven eight nine ten.";
    const cues = [
      {
        narrationOffset: 0,
        pointerText: "one",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      },
      {
        narrationOffset: 1,
        pointerText: "two",
        range: { start: { line: 0, character: 4 }, end: { line: 0, character: 7 } },
      },
    ];

    const scheduled = scheduleNarrationPointerCues(cues, narration, 1);
    assert.equal(scheduled[0]?.delayMs, 150);
    assert.equal(scheduled[1]?.delayMs, 600);
  });

  it("accounts for configured speech speed", () => {
    const narration = "This is a short spoken explanation with several words.";
    assert.ok(estimateNarrationDurationMs(narration, 2) < estimateNarrationDurationMs(narration, 1));
  });
});
