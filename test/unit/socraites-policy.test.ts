import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasRequiredVisualIntent,
  isAcceptableTeachingStep,
  isClearRequest,
  selectReadOnlyDiscoveryTools,
  shouldPresentContent,
  stripAgentFrontmatter,
  toSpeechText,
  MAX_TEACHING_STEP_WORDS,
} from "../../src/socraites-policy.js";

describe("SocrAItes runtime policy", () => {
  it("allows read and search discovery while excluding mutation and execution", () => {
    const tools = [
      { name: "copilot_searchCodebase", tags: ["vscode_codesearch"] },
      { name: "copilot_readFile", tags: ["vscode_codesearch"] },
      { name: "copilot_getErrors", tags: [] },
      { name: "vscode_listCodeUsages", tags: [] },
      { name: "terminal_selection", tags: ["terminal"] },
      { name: "untrusted_readFile", tags: ["vscode_codesearch"] },
      { name: "run_in_terminal", tags: ["terminal", "execute"] },
      { name: "apply_patch", tags: ["edit"] },
      { name: "manage_todo_list", tags: [] },
      { name: "tool_search", tags: [] },
      { name: "maieutic_focus_content", tags: [] },
    ];

    assert.deepEqual(
      selectReadOnlyDiscoveryTools(tools).map((tool) => tool.name),
      [
        "copilot_searchCodebase",
        "copilot_readFile",
        "copilot_getErrors",
        "vscode_listCodeUsages",
        "terminal_selection",
      ],
    );
  });

  it("requires presentation by default and honors explicit visual holds", () => {
    assert.equal(shouldPresentContent("walk me through this workflow", true), true);
    assert.equal(shouldPresentContent("next", true), true);
    assert.equal(shouldPresentContent("hold while I ask a question", true), false);
    assert.equal(shouldPresentContent("text only please", true), false);
    assert.equal(shouldPresentContent("explain this without changing the current visual state", true), false);
    assert.equal(shouldPresentContent("walk me through this workflow", false), false);
  });

  it("makes visual navigation mandatory for explicit teaching controls", () => {
    assert.equal(hasRequiredVisualIntent("walk me through a workflow agent"), true);
    assert.equal(hasRequiredVisualIntent("next"), true);
    assert.equal(hasRequiredVisualIntent("what does this function do?"), true);
    assert.equal(hasRequiredVisualIntent("what does CRUD stand for?"), false);
  });

  it("recognizes only direct clear controls", () => {
    assert.equal(isClearRequest("clear"), true);
    assert.equal(isClearRequest("clear focus."), true);
    assert.equal(isClearRequest("explain how clear works"), false);
  });

  it("loads the prompt body without profile frontmatter", () => {
    assert.equal(stripAgentFrontmatter("---\nname: SocrAItes\n---\nTeach carefully.\n"), "Teach carefully.");
  });

  it("prepares concise narration without Markdown syntax", () => {
    assert.equal(
      toSpeechText("Look at [`execute`](file.ts). **Why** does it wait?"),
      "Look at execute. Why does it wait?",
    );
  });

  it("rejects batched teaching drafts", () => {
    assert.equal(
      isAcceptableTeachingStep("This block owns the handoff. What value crosses this boundary?"),
      true,
    );
    assert.equal(
      isAcceptableTeachingStep("1. Open a.ts\n2. Open b.ts\nWhat happens next?"),
      false,
    );
    assert.equal(
      isAcceptableTeachingStep("Here is the end-to-end flow. What do you notice?"),
      false,
    );
    assert.equal(
      isAcceptableTeachingStep(`${"word ".repeat(MAX_TEACHING_STEP_WORDS)}extra?`),
      false,
    );
  });
});
