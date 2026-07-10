import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const allowedMentorTools = [
  "read/readFile",
  "read/problems",
  "search",
  "web",
  "vscode/askQuestions",
  "maieutic_focus_content",
  "maieutic_point_at_content",
  "maieutic_clear_focus_content",
];

const forbiddenMentorTools = [
  "edit",
  "execute/runInTerminal",
  "vscode/runCommand",
  "todo",
  "agent",
];

describe("SocrAItes agent profile", () => {
  it("is contributed by the extension", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      contributes?: { chatAgents?: Array<{ path?: string }> };
    };

    assert.deepEqual(manifest.contributes?.chatAgents, [
      { path: "./agents/socraites.agent.md" },
    ]);
  });

  it("allows only the intended read and presentation tools", async () => {
    const profile = await readFile("agents/socraites.agent.md", "utf8");

    for (const tool of allowedMentorTools) {
      assert.match(profile, new RegExp(`^  - ${escapeRegExp(tool)}$`, "m"), `${tool} is not allowed`);
    }
    for (const tool of forbiddenMentorTools) {
      assert.doesNotMatch(profile, new RegExp(`^  - ${escapeRegExp(tool)}$`, "m"), `${tool} must not be allowed`);
    }
  });

  it("states the no-change and Socratic teaching contract", async () => {
    const profile = await readFile("agents/socraites.agent.md", "utf8");

    assert.match(profile, /Remain read-only for the entire session/);
    assert.match(profile, /Never provide paste-ready implementation code/);
    assert.match(profile, /Socratic teaching should produce thought/);
    assert.match(profile, /Documentation Distillation/);
    assert.match(profile, /Make at most one visual state change per response/);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
