import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { describe, it } from "node:test";

describe("local development workflow", () => {
  it("tests, packages, and installs a local VSIX without publishing", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const script = manifest.scripts?.["dev:install"] ?? "";

    assert.match(script, /npm run build:native:call/);
    assert.match(script, /npm run verify:release/);
    assert.match(script, /vsce package --out maieutic-dev\.vsix/);
    assert.match(script, /code --install-extension maieutic-dev\.vsix --force/);
    assert.doesNotMatch(script, /publish|git tag|git push/);
  });

  it("provides a Cola Extension Development Host launch", async () => {
    const launch = JSON.parse(await readFile(".vscode/launch.json", "utf8")) as {
      configurations?: Array<{ name?: string; args?: string[] }>;
    };
    const configuration = launch.configurations?.find(({ name }) => name === "Run Maieutic against Cola");

    assert.ok(configuration);
    assert.ok(configuration.args?.includes("--extensionDevelopmentPath=${workspaceFolder}"));
    assert.ok(configuration.args?.includes("${workspaceFolder}/../cola"));
  });

  it("ships reproducible universal macOS voice runtimes", async () => {
    for (const path of [
      "native/darwin-universal/maieutic-recorder",
      "native/darwin-universal/maieutic-call-audio",
      "native/darwin-universal/whisper-cli",
    ]) {
      const [binary, metadata] = await Promise.all([readFile(path), stat(path)]);
      assert.deepEqual([...binary.subarray(0, 4)], [0xca, 0xfe, 0xba, 0xbe]);
      assert.notEqual(metadata.mode & 0o111, 0, `${path} must be executable`);
    }
    const build = await readFile("scripts/build-macos-native.sh", "utf8");
    assert.match(build, /WHISPER_VERSION="v1\.9\.1"/);
    assert.match(build, /WHISPER_COMMIT="[0-9a-f]{40}"/);
    assert.match(build, /rev-parse HEAD/);
    assert.match(build, /lipo -create/);
    assert.match(build, /GGML_NATIVE=OFF/);
    assert.match(build, /build-call-audio\.sh/);

    const callAudioBuild = await readFile("scripts/build-call-audio.sh", "utf8");
    assert.match(callAudioBuild, /test-call-audio-detector\.sh/);
    assert.match(callAudioBuild, /CallAudioSpeechDetector\.swift/);
    assert.match(callAudioBuild, /arm64 x86_64/);
    assert.match(callAudioBuild, /codesign --force --sign -/);
  });
});
