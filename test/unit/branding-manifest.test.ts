import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

interface Manifest {
  icon?: string;
  galleryBanner?: {
    color?: string;
    theme?: string;
  };
}

describe("Marketplace branding", () => {
  it("ships a high-resolution PNG icon and matching gallery banner", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as Manifest;

    assert.equal(manifest.icon, "media/icon.png");
    assert.deepEqual(manifest.galleryBanner, {
      color: "#151821",
      theme: "dark",
    });

    const icon = await readFile(manifest.icon);
    assert.deepEqual(
      [...icon.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      "Marketplace icon must be a PNG",
    );
    assert.ok(icon.readUInt32BE(16) >= 128, "Marketplace icon must be at least 128 pixels wide");
    assert.ok(icon.readUInt32BE(20) >= 128, "Marketplace icon must be at least 128 pixels tall");
  });

  it("keeps the editable SVG source out of the VSIX", async () => {
    const vscodeIgnore = await readFile(".vscodeignore", "utf8");

    assert.match(vscodeIgnore, /^media\/\*\.svg$/m);
  });
});
