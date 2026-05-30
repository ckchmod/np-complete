import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cssUrl = new URL("../styles.css", import.meta.url);
const htmlUrl = new URL("../index.html", import.meta.url);

function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s"));
  return match ? match[1] : "";
}

test("touch targets: board and controls use manipulation touch-action", async () => {
  const [css, html] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(htmlUrl, "utf8"),
  ]);

  assert.match(html, /<svg id="board" class="board"/);
  assert.match(ruleBody(css, ".board"), /touch-action:\s*manipulation;/);
  assert.match(ruleBody(css, ".edge-group"), /touch-action:\s*manipulation;/);
  assert.match(ruleBody(css, ".btn"), /touch-action:\s*manipulation;/);
  assert.match(ruleBody(css, ".btn-help"), /touch-action:\s*manipulation;/);
  assert.equal(css.includes("touch-action: none"), false);
});

test("touch targets: buttons meet the 44px minimum hit area", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(ruleBody(css, ".btn"), /min-width:\s*44px;/);
  assert.match(ruleBody(css, ".btn"), /min-height:\s*44px;/);
  assert.match(ruleBody(css, ".btn-ghost"), /min-width:\s*44px;/);
  assert.match(ruleBody(css, ".btn-ghost"), /min-height:\s*44px;/);
  assert.match(ruleBody(css, ".btn-help"), /width:\s*44px;/);
  assert.match(ruleBody(css, ".btn-help"), /height:\s*44px;/);
});

test("touch targets: edge hit corridors stay wide and clickable", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(ruleBody(css, ".edge-group"), /cursor:\s*pointer;/);
  assert.match(ruleBody(css, ".edge-hit"), /stroke-width:\s*44;/);
  assert.match(ruleBody(css, ".edge-hit"), /pointer-events:\s*stroke;/);
});
