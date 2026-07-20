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
  "maieutic_speak",
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
  it("contributes a selectable typed profile and one sticky native call participant", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      contributes?: {
        chatAgents?: Array<{ path?: string }>;
        chatParticipants?: Array<{
          id?: string;
          name?: string;
          fullName?: string;
          isSticky?: boolean;
        }>;
      };
    };

    assert.deepEqual(manifest.contributes?.chatAgents, [
      { path: "./agents/socraites.agent.md" },
      { path: "./agents/socraites-discovery.agent.md" },
    ]);
    assert.deepEqual(manifest.contributes?.chatParticipants?.map((participant) => ({
      id: participant.id,
      name: participant.name,
      fullName: participant.fullName,
      isSticky: participant.isSticky,
    })), [{
      id: "maieutic.socraites",
      name: "socraites",
      fullName: "SocrAItes",
      isSticky: true,
    }]);
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
    assert.match(profile.body, /Make at most one model-requested visual state change per response/);
    assert.match(profile.body, /move its pointer without another model call/);
    assert.match(profile.body, /For every substantive repository-specific teaching response/);
    assert.match(profile.body, /you must make exactly one relevant visual state change/);
    assert.match(profile.body, /Do not substitute a file list, line-number itinerary/);
    assert.match(profile.body, /Never return a multi-stop itinerary/);
    assert.match(profile.body, /Treat every multi-part lesson, trace, tour, and walkthrough as a learner-gated sequence/);
    assert.match(profile.body, /each response teaches exactly one step/);
    assert.match(profile.body, /Do not reveal, summarize, or enumerate later steps/);
    assert.match(profile.body, /Never batch a walkthrough into one answer/);
    assert.match(profile.body, /\*\*Human decision:\*\*/);
    assert.match(profile.body, /Narration is optional and independent/);
    assert.match(profile.body, /free local macOS voice, a neural voice exposed by a localhost service, or an OpenAI voice/);
    assert.match(profile.body, /the learner can interrupt/);
    assert.match(profile.body, /under 100 words/);
    assert.match(profile.body, /Never request speech or presentation in parallel/);
    assert.match(profile.body, /Speech must never be delegated/);
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
