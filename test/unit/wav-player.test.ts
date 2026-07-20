import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  callAudioInvocation,
  LocalWavPlayer,
  playerInvocation,
} from "../../src/wav-player.js";

const audioPath = "/tmp/a path/voice'quote.wav";

describe("playerInvocation", () => {
  it("passes a macOS path as a direct process argument", () => {
    assert.deepEqual(playerInvocation("darwin", audioPath), {
      command: "afplay",
      args: [audioPath],
    });
  });

  it("passes duplex call paths as direct process arguments", () => {
    assert.deepEqual(
      callAudioInvocation("/private/helper", audioPath, "/tmp/private capture.wav"),
      {
        command: "/private/helper",
        args: [audioPath, "/tmp/private capture.wav"],
      },
    );
    assert.deepEqual(
      callAudioInvocation("/private/helper", audioPath, "/tmp/private capture.wav", true),
      {
        command: "/private/helper",
        args: [audioPath, "/tmp/private capture.wav", "--acoustic-guard"],
      },
    );
  });

  it("passes a Linux path as a direct process argument", () => {
    assert.deepEqual(playerInvocation("linux", audioPath), {
      command: "aplay",
      args: ["--quiet", audioPath],
    });
  });

  it("passes a Windows path through the environment instead of PowerShell source", () => {
    const invocation = playerInvocation("win32", audioPath);

    assert.equal(invocation.command, "powershell.exe");
    assert.equal(invocation.extraEnvironment?.MAIEUTIC_WAV_PATH, audioPath);
    assert.ok(!invocation.args.join(" ").includes(audioPath));
    assert.match(invocation.args.at(-1) ?? "", /MAIEUTIC_WAV_PATH/);
  });

  it("rejects unsupported platforms", () => {
    assert.throws(
      () => playerInvocation("aix", audioPath),
      /Local WAV playback is not supported/,
    );
  });

  it("does not expose its private storage path when directory creation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "maieutic-wav-test-"));
    const fileInsteadOfDirectory = join(root, "not-a-directory");
    await writeFile(fileInsteadOfDirectory, "blocking file");
    const player = new LocalWavPlayer(fileInsteadOfDirectory, "darwin");

    try {
      await assert.rejects(
        player.play(new Uint8Array([1]), new AbortController().signal),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /private speech storage directory/);
          assert.ok(!error.message.includes(fileInsteadOfDirectory));
          return true;
        },
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

});
