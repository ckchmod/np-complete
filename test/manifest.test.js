import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifestPath = new URL("../manifest.json", import.meta.url);
const indexPath = new URL("../index.html", import.meta.url);

async function readManifest() {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

test("manifest: JSON is valid and includes the required PWA fields", async () => {
  const manifest = await readManifest();

  assert.equal(manifest.name, "THE LOCK");
  assert.equal(manifest.short_name, "LOCK");
  assert.equal(manifest.start_url, ".");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.background_color, "#0a0a0a");
  assert.equal(manifest.theme_color, "#0a0a0a");
  assert.ok(Array.isArray(manifest.icons), "icons must be an array");
  assert.equal(manifest.icons.length, 2);
});

test("manifest: icons include the required 192 and 512 entries", async () => {
  const manifest = await readManifest();

  assert.deepEqual(manifest.icons, [
    { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
  ]);
});

test("manifest: index.html links the manifest in the head", async () => {
  const html = await readFile(indexPath, "utf8");

  assert.match(html, /<link rel="manifest" href="manifest\.json"\s*\/?>/);
});
