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

test("touch targets: board hosts are neutral 3D canvas containers", async () => {
  const html = await readFile(htmlUrl, "utf8");

  assert.match(html, /<div id="board" class="board" aria-label="puzzle board"><\/div>/);
  assert.match(html, /<div id="battle-board" class="board battle-board" aria-label="battle puzzle board"><\/div>/);
  const svgTag = "<" + "svg";
  assert.equal(html.includes(`${svgTag} id="board"`), false);
  assert.equal(html.includes(`${svgTag} id="battle-board"`), false);
});

test("touch targets: board and controls use manipulation touch-action", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(ruleBody(css, ".board"), /touch-action:\s*manipulation;/);
  assert.match(ruleBody(css, ".btn"), /touch-action:\s*manipulation;/);
  assert.match(ruleBody(css, ".btn-help"), /touch-action:\s*manipulation;/);
  assert.match(css, /\.board > canvas,[\s\S]*?\{[\s\S]*?touch-action:\s*manipulation;/);
  assert.equal(css.includes("touch-action: none"), false);
});

test("touch targets: 3D renderer canvas fills board mounts without SVG layout rules", async () => {
  const css = await readFile(cssUrl, "utf8");

  const canvasRule = css.match(/\.board > canvas,[\s\S]*?\}/)?.[0] || "";
  assert.match(canvasRule, /\.battle-board > canvas/);
  assert.match(canvasRule, /display:\s*block;/);
  assert.match(canvasRule, /width:\s*100%;/);
  assert.match(canvasRule, /height:\s*100%;/);
  assert.match(canvasRule, /max-width:\s*100%;/);
  assert.match(canvasRule, /max-height:\s*100%;/);
  assert.match(canvasRule, /touch-action:\s*manipulation;/);
});

test("touch targets: renderer canvas has a visible keyboard focus cue", async () => {
  const css = await readFile(cssUrl, "utf8");

  const focusRule = css.match(/\.board > canvas:focus-visible,[\s\S]*?\}/)?.[0] || "";
  assert.match(focusRule, /\.battle-board > canvas:focus-visible/);
  assert.match(focusRule, /outline:\s*2px solid var\(--c-legal\);/);
  assert.match(focusRule, /outline-offset:\s*2px;/);
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

test("touch targets: obsolete SVG edge and node CSS selectors are removed", async () => {
  const css = await readFile(cssUrl, "utf8");
  const edge = "edge";
  const node = "node";
  const board = "board";
  const illegal = "illegal";
  const obsoleteSelectors = [
    `.${edge}-group`,
    `.${edge}-line`,
    `.${edge}-arrow`,
    `.${edge}-hit`,
    `.${edge}-ghost`,
    `.${edge}-charge`,
    `.${node}-group`,
    `.${node}-ring`,
    `.${node}-glow`,
    `.${illegal}-explain`,
    `.${board}.is-won`,
    `.${board}.is-strike`,
  ];

  for (const selector of obsoleteSelectors) {
    assert.equal(css.includes(selector), false, `${selector} should not remain in active CSS`);
  }
});
