import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { parse } from "yaml";

const parentTools = [
  "agent/runSubagent",
  "read/readFile",
  "read/problems",
  "read/terminalSelection",
  "read/terminalLastCommand",
  "search",
  "web",
  "vscode/askQuestions",
  "maieutic_focus_content",
  "maieutic_point_at_content",
  "maieutic_clear_focus_content",
];

const discoveryTools = [
  "read/readFile",
  "read/problems",
  "read/terminalSelection",
  "read/terminalLastCommand",
  "search",
  "web",
];

interface AgentFrontmatter {
  name?: string;
  target?: string;
  tools?: string[];
  agents?: string[];
  "user-invocable"?: boolean;
  "disable-model-invocation"?: boolean;
}

describe("SocrAItes agent profile", () => {
  it("contributes the teacher and hidden discovery profiles", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      contributes?: { chatAgents?: Array<{ path?: string }> };
    };

    assert.deepEqual(manifest.contributes?.chatAgents, [
      { path: "./agents/socraites.agent.md" },
      { path: "./agents/socraites-discovery.agent.md" },
    ]);
  });

  it("allows only the intended parent tools and discovery agent", async () => {
    const profile = await readAgentProfile("agents/socraites.agent.md");

    assert.equal(profile.frontmatter.name, "SocrAItes");
    assert.equal(profile.frontmatter.target, "vscode");
    assert.equal(profile.frontmatter["user-invocable"], true);
    assert.equal(profile.frontmatter["disable-model-invocation"], true);
    assert.deepEqual(profile.frontmatter.tools, parentTools);
    assert.deepEqual(profile.frontmatter.agents, ["SocrAItes Discovery"]);
  });

  it("keeps discovery hidden and strictly read-only", async () => {
    const profile = await readAgentProfile("agents/socraites-discovery.agent.md");

    assert.equal(profile.frontmatter.name, "SocrAItes Discovery");
    assert.equal(profile.frontmatter.target, "vscode");
    assert.equal(profile.frontmatter["user-invocable"], false);
    assert.equal(profile.frontmatter["disable-model-invocation"], true);
    assert.deepEqual(profile.frontmatter.tools, discoveryTools);
    assert.equal(profile.frontmatter.agents, undefined);
    assert.doesNotMatch(profile.body, /#tool:maieutic_/);
  });

  it("states the no-change and Socratic teaching contract", async () => {
    const profile = await readAgentProfile("agents/socraites.agent.md");

    assert.match(profile.body, /Remain read-only for the entire session/);
    assert.match(profile.body, /Never provide paste-ready implementation code/);
    assert.match(profile.body, /Socratic teaching should produce thought/);
    assert.match(profile.body, /Documentation Distillation/);
    assert.match(profile.body, /Make at most one visual state change per response/);
    assert.match(profile.body, /\*\*Human decision:\*\*/);
    assert.match(profile.body, /Assume the final response may be read aloud/);
    assert.ok(profile.body.length < 30_000, "agent prompt exceeds VS Code's limit");
  });
});

async function readAgentProfile(path: string): Promise<{
  frontmatter: AgentFrontmatter;
  body: string;
}> {
  const source = await readFile(path, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);

  assert.ok(match, `${path} must contain YAML frontmatter and a prompt body`);
  const frontmatterSource = match[1];
  const body = match[2];
  if (frontmatterSource === undefined || body === undefined) {
    throw new Error(`${path} has an invalid agent profile structure`);
  }

  return {
    frontmatter: parse(frontmatterSource) as AgentFrontmatter,
    body,
  };
}
