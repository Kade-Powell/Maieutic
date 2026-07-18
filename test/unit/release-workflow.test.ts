import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { parse } from "yaml";

interface WorkflowStep {
  name?: string;
  env?: Record<string, string>;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  environment?: string;
  needs?: string | string[];
  outputs?: Record<string, string>;
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
}

interface ReleaseWorkflow {
  permissions?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
}

describe("release workflow", () => {
  it("creates an idempotent GitHub Release without OIDC permission", async () => {
    const workflow = await readWorkflow();
    const release = job(workflow, "release");
    const steps = release.steps ?? [];
    const githubStep = steps[stepIndex(steps, "Create or update GitHub Release")];

    assert.equal(workflow.permissions?.contents, "read");
    assert.equal(workflow.permissions?.["id-token"], undefined);
    assert.equal(release.permissions?.contents, "write");
    assert.equal(release.permissions?.["id-token"], undefined);
    assert.equal(release.outputs?.package_version, "${{ steps.release_metadata.outputs.package_version }}");
    assert.equal(release.outputs?.vsix_path, "${{ steps.release_metadata.outputs.vsix_path }}");
    assert.match(githubStep?.run ?? "", /gh release view/);
    assert.match(githubStep?.run ?? "", /gh release upload/);
    assert.match(githubStep?.run ?? "", /--clobber/);
    assert.match(githubStep?.run ?? "", /gh release create/);
  });

  it("isolates environment-scoped OIDC in a minimal Marketplace job", async () => {
    const workflow = await readWorkflow();
    const marketplace = job(workflow, "marketplace");
    const steps = marketplace.steps ?? [];
    const loginStep = steps[stepIndex(steps, "Log in to Microsoft Entra")];
    const identityStep = steps[stepIndex(steps, "Identify Marketplace publisher identity")];
    const verifyStep = steps[stepIndex(steps, "Verify Marketplace publisher access")];
    const publishStep = steps[stepIndex(steps, "Publish extension")];
    const scripts = steps.map(({ run }) => run ?? "").join("\n");

    assert.equal(marketplace.needs, "release");
    assert.equal(marketplace.environment, "marketplace");
    assert.equal(marketplace.permissions?.actions, "read");
    assert.equal(marketplace.permissions?.contents, "read");
    assert.equal(marketplace.permissions?.["id-token"], "write");
    assert.equal(loginStep?.with?.["client-id"], "${{ vars.AZURE_CLIENT_ID }}");
    assert.equal(loginStep?.with?.["tenant-id"], "${{ vars.AZURE_TENANT_ID }}");
    assert.equal(loginStep?.with?.["allow-no-subscriptions"], true);
    assert.match(identityStep?.run ?? "", /profile\/profiles\/me/);
    assert.match(identityStep?.run ?? "", /499b84ac-1321-427f-aa17-267ca6975798/);
    assert.match(verifyStep?.run ?? "", /@vscode\/vsce@3\.9\.2 verify-pat --azure-credential/);
    assert.equal(verifyStep?.env?.AZURE_TENANT_ID, "${{ vars.AZURE_TENANT_ID }}");
    assert.match(publishStep?.run ?? "", /@vscode\/vsce@3\.9\.2 publish --azure-credential/);
    assert.doesNotMatch(scripts, /npm (ci|test|audit)|vsce package/);
    assert.doesNotMatch(JSON.stringify(workflow), /VSCE_PAT/);
  });

  it("passes the one packaged VSIX through the artifact boundary", async () => {
    const workflow = await readWorkflow();
    const release = job(workflow, "release");
    const marketplace = job(workflow, "marketplace");
    const releaseSteps = release.steps ?? [];
    const marketplaceSteps = marketplace.steps ?? [];
    const releaseScripts = releaseSteps.map(({ run }) => run ?? "").join("\n");
    const uploadStep = releaseSteps[stepIndex(releaseSteps, "Preserve release artifact")];
    const downloadStep = marketplaceSteps[stepIndex(marketplaceSteps, "Download release artifact")];
    const publishStep = marketplaceSteps[stepIndex(marketplaceSteps, "Publish extension")];

    assert.match(releaseScripts, /vsce package --out "\$\{VSIX_PATH\}"/);
    assert.match(releaseScripts, /gh release create "\$\{GITHUB_REF_NAME\}" "\$\{VSIX_PATH\}"/);
    assert.equal(uploadStep?.with?.name, "maieutic-${{ env.PACKAGE_VERSION }}");
    assert.equal(downloadStep?.with?.name, "maieutic-${{ needs.release.outputs.package_version }}");
    assert.match(
      publishStep?.run ?? "",
      /--packagePath "\$\{\{ needs\.release\.outputs\.vsix_path \}\}"/,
    );
  });

  it("pins every release action to a full commit SHA", async () => {
    const workflow = await readWorkflow();
    const actions = Object.values(workflow.jobs ?? {})
      .flatMap(({ steps }) => steps ?? [])
      .flatMap(({ uses }) => (uses ? [uses] : []));

    assert.ok(actions.length >= 5);
    for (const action of actions) {
      assert.match(action, /^[^@]+@[0-9a-f]{40}$/);
    }
  });
});

async function readWorkflow(): Promise<ReleaseWorkflow> {
  return parse(await readFile(".github/workflows/release.yml", "utf8")) as ReleaseWorkflow;
}

function job(workflow: ReleaseWorkflow, name: string): WorkflowJob {
  const result = workflow.jobs?.[name];
  assert.ok(result, `Missing workflow job: ${name}`);
  return result;
}

function stepIndex(steps: WorkflowStep[], name: string): number {
  const index = steps.findIndex((step) => step.name === name);
  assert.notEqual(index, -1, `Missing workflow step: ${name}`);
  return index;
}
