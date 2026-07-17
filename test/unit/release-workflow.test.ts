import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { parse } from "yaml";

interface WorkflowStep {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
}

interface ReleaseWorkflow {
  permissions?: { contents?: string };
  jobs?: {
    release?: {
      steps?: WorkflowStep[];
    };
  };
}

describe("release workflow", () => {
  it("publishes an idempotent GitHub Release before optional Marketplace publication", async () => {
    const workflow = await readWorkflow();
    const steps = workflow.jobs?.release?.steps ?? [];
    const githubIndex = stepIndex(steps, "Create or update GitHub Release");
    const detectIndex = stepIndex(steps, "Detect Marketplace credentials");
    const marketplaceIndex = stepIndex(steps, "Publish to VS Code Marketplace");
    const githubStep = steps[githubIndex];

    assert.equal(workflow.permissions?.contents, "write");
    assert.ok(githubIndex < detectIndex);
    assert.ok(detectIndex < marketplaceIndex);
    assert.match(githubStep?.run ?? "", /gh release view/);
    assert.match(githubStep?.run ?? "", /gh release upload/);
    assert.match(githubStep?.run ?? "", /--clobber/);
    assert.match(githubStep?.run ?? "", /gh release create/);
  });

  it("does not require Marketplace credentials for a GitHub release", async () => {
    const workflow = await readWorkflow();
    const steps = workflow.jobs?.release?.steps ?? [];
    const detectStep = steps[stepIndex(steps, "Detect Marketplace credentials")];
    const marketplaceStep = steps[stepIndex(steps, "Publish to VS Code Marketplace")];
    const allScripts = steps.map(({ run }) => run ?? "").join("\n");

    assert.equal(detectStep?.id, "marketplace");
    assert.match(detectStep?.run ?? "", /enabled=false/);
    assert.match(detectStep?.run ?? "", /Marketplace publication was skipped/);
    assert.equal(marketplaceStep?.if, "steps.marketplace.outputs.enabled == 'true'");
    assert.doesNotMatch(allScripts, /Add the VSCE_PAT repository secret before releasing/);
  });

  it("uses one packaged VSIX for the artifact and release", async () => {
    const workflow = await readWorkflow();
    const steps = workflow.jobs?.release?.steps ?? [];
    const scripts = steps.map(({ run }) => run ?? "").join("\n");

    assert.match(scripts, /vsce package --out "\$\{VSIX_PATH\}"/);
    assert.match(scripts, /gh release create "\$\{GITHUB_REF_NAME\}" "\$\{VSIX_PATH\}"/);
    assert.match(scripts, /vsce publish --skip-duplicate --packagePath "\$\{VSIX_PATH\}"/);
  });
});

async function readWorkflow(): Promise<ReleaseWorkflow> {
  return parse(await readFile(".github/workflows/release.yml", "utf8")) as ReleaseWorkflow;
}

function stepIndex(steps: WorkflowStep[], name: string): number {
  const index = steps.findIndex((step) => step.name === name);
  assert.notEqual(index, -1, `Missing workflow step: ${name}`);
  return index;
}
