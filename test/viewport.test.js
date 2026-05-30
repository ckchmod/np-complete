import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const indexPath = new URL("../index.html", import.meta.url);
const stylesPath = new URL("../styles.css", import.meta.url);

test("viewport: meta tag enables safe-area aware full-bleed layout", async () => {
  const html = await readFile(indexPath, "utf8");

  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"\s*\/?>/);
});

test("viewport: styles include safe-area padding on body", async () => {
  const css = await readFile(stylesPath, "utf8");

  assert.match(css, /body\s*\{[\s\S]*padding-top:\s*env\(safe-area-inset-top\);[\s\S]*padding-right:\s*env\(safe-area-inset-right\);[\s\S]*padding-bottom:\s*env\(safe-area-inset-bottom\);[\s\S]*padding-left:\s*env\(safe-area-inset-left\);[\s\S]*\}/);
});

test("viewport: styles provide a max() safe-area fallback and narrow-screen containment", async () => {
  const css = await readFile(stylesPath, "utf8");

  assert.match(css, /@supports \(padding: max\(0px\)\) \{[\s\S]*padding-top:\s*max\(env\(safe-area-inset-top\), 0px\);[\s\S]*padding-right:\s*max\(env\(safe-area-inset-right\), 0px\);[\s\S]*padding-bottom:\s*max\(env\(safe-area-inset-bottom\), 0px\);[\s\S]*padding-left:\s*max\(env\(safe-area-inset-left\), 0px\);[\s\S]*\}/);
  assert.match(css, /#app\s*\{[\s\S]*width:\s*min\(100%, 480px\);[\s\S]*\}/);
  assert.match(css, /@media \(max-width: 420px\) \{[\s\S]*#top-bar\s*\{[\s\S]*flex-wrap:\s*wrap;[\s\S]*\}/);
});
