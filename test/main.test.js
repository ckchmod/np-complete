import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function fakeEl(id = "") {
  const children = [];
  const listeners = {};
  const classes = new Set();
  const el = {
    id,
    children,
    parentNode: null,
    style: {
      touchAction: "",
      setProperty(name, value) { this[name] = String(value); },
      removeProperty(name) { delete this[name]; },
    },
    dataset: {},
    attributes: {},
    textContent: "",
    innerHTML: "",
    disabled: false,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, on) {
        const next = on === undefined ? !classes.has(name) : Boolean(on);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
      contains: (name) => classes.has(name),
    },
    get firstChild() {
      return children.length ? children[0] : null;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "class") String(value).split(/\s+/).filter(Boolean).forEach((cls) => classes.add(cls));
    },
    appendChild(child) {
      if (child.parentNode && child.parentNode !== this) child.parentNode.removeChild(child);
      child.parentNode = this;
      children.push(child);
      return child;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners[type] || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    dispatch(type, event = {}) {
      (listeners[type] || []).slice().forEach((fn) => fn(event));
    },
    click() {
      this.dispatch("click", { target: this });
    },
    querySelector(selector) {
      if (selector.startsWith("#")) return elements.get(selector.slice(1)) || null;
      return null;
    },
    getBoundingClientRect() {
      return { width: 320, height: 480, top: 0, left: 0 };
    },
  };
  return el;
}

const elements = new Map();

function fakeLocalStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    keys: () => Array.from(map.keys()),
  };
}

function installEnv() {
  elements.clear();
  const ids = [
    "app", "level-title", "level-hint", "nav-prev", "nav-next", "nav-skip", "nav-label",
    "intro", "btn-start", "btn-skip-tutorial", "btn-help", "rush-over", "rush-intro",
    "btn-rush-start", "battle-intro", "btn-battle-close", "mode-select", "rush-mode-button", "battle-mode-button", "battle-board",
    "battle-turn", "battle-status", "battle-result", "board", "rush-score", "rush-strikes",
    "rush-moves", "btn-skip", "rush-toast", "move-count", "par-display", "result-card",
    "result-moves", "result-par", "result-stars", "result-score", "result-pb", "result-hash",
    "btn-share", "btn-undo", "btn-reset", "rush-final-score", "rush-best", "rush-stats",
    "btn-rush-again", "btn-rush-share", "btn-rush-menu", "battle-result-message", "btn-battle-again", "btn-battle-menu"
  ];
  for (const id of ids) elements.set(id, fakeEl(id));
  for (const id of ["rush-over", "rush-intro", "battle-intro", "mode-select", "battle-result", "result-card"]) {
    elements.get(id).classList.add("hidden");
  }

  const previous = {
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    window: globalThis.window,
    performance: globalThis.performance,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    random: Math.random,
  };
  const storage = fakeLocalStorage();
  globalThis.document = {
    getElementById: (id) => elements.get(id) || null,
    createElementNS: () => fakeEl(),
  };
  globalThis.localStorage = storage;
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  globalThis.performance = { now: () => 0 };
  globalThis.requestAnimationFrame = () => 0;
  Math.random = () => 0.25;

  return {
    storage,
    el: (id) => elements.get(id),
    restore() {
      globalThis.document = previous.document;
      globalThis.localStorage = previous.localStorage;
      globalThis.window = previous.window;
      globalThis.performance = previous.performance;
      globalThis.requestAnimationFrame = previous.requestAnimationFrame;
      Math.random = previous.random;
      elements.clear();
    },
  };
}

test("main: mode selection appears and launches Rush and Battle paths", async () => {
  const env = installEnv();
  try {
    const { TUTORIALS } = await import("../src/levels.js");
    await import(`../src/main.js?mode-selection-${Date.now()}`);

    for (let step = 0; step < TUTORIALS.length; step++) env.el("nav-next").click();

    assert.equal(env.el("mode-select").classList.contains("hidden"), false, "mode selection is shown after the tutorial sequence");
    assert.equal(env.el("level-title").textContent, "CHOOSE MODE");

    env.el("rush-mode-button").click();
    assert.equal(env.el("app").classList.contains("mode-rush"), true, "Rush mode class is active");
    assert.equal(env.el("mode-select").classList.contains("hidden"), true, "mode selection hides after Rush choice");
    assert.equal(env.el("level-title").textContent, "RUSH");
    assert.ok(env.el("board").children.length > 0, "Rush renders into the existing #board ref");

    env.el("battle-mode-button").click();
    assert.equal(env.el("app").classList.contains("mode-rush"), false, "Battle choice stops the Rush mode surface");
    assert.equal(env.el("app").classList.contains("mode-battle"), true, "Battle mode class is active");
    assert.equal(env.el("level-title").textContent, "BATTLE");
    assert.equal(env.el("battle-turn").textContent, "White", "Battle controller writes the Task 15 turn ref");
    assert.ok(env.el("battle-board").children.length > 0, "Battle renders into the Task 15 board ref");
    assert.deepEqual(env.storage.keys().filter((key) => key.includes("mode")), [], "mode choice is not persisted");
  } finally {
    env.restore();
  }
});

test("main: help button routes to Battle rules and preserves other help flows", async () => {
  const env = installEnv();
  try {
    const { TUTORIALS } = await import("../src/levels.js");
    await import(`../src/main.js?battle-help-${Date.now()}`);

    env.el("btn-start").click();
    env.el("btn-help").click();
    assert.equal(env.el("intro").classList.contains("hidden"), false, "tutorial help still opens the original intro overlay");
    assert.equal(env.el("rush-intro").classList.contains("hidden"), true, "tutorial help does not open Rush rules");
    assert.equal(env.el("battle-intro").classList.contains("hidden"), true, "tutorial help does not open Battle rules");
    env.el("btn-start").click();

    for (let step = 0; step < TUTORIALS.length; step++) env.el("nav-next").click();
    env.el("battle-mode-button").click();
    env.el("btn-help").click();
    assert.equal(env.el("battle-intro").classList.contains("hidden"), false, "Battle help opens the Battle rules overlay");
    assert.equal(env.el("intro").classList.contains("hidden"), true, "Battle help keeps tutorial intro closed");
    assert.equal(env.el("rush-intro").classList.contains("hidden"), true, "Battle help keeps Rush rules closed");

    env.el("btn-battle-close").click();
    assert.equal(env.el("battle-intro").classList.contains("hidden"), true, "Battle rules close from the overlay button");
    assert.equal(env.el("app").classList.contains("mode-battle"), true, "closing Battle help keeps Battle active");

    env.el("rush-mode-button").click();
    env.el("btn-help").click();
    assert.equal(env.el("rush-intro").classList.contains("hidden"), false, "Rush help still opens Rush rules");
    assert.equal(env.el("battle-intro").classList.contains("hidden"), true, "Rush help does not open Battle rules");
  } finally {
    env.restore();
  }
});

test("index: Battle rules copy covers the required short rules", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /Players take turns/);
  assert.match(html, /Flip your own edges, or neutral edges when the current rules allow them/);
  assert.match(html, /limited charges/);
  assert.match(html, /Reverse your .*target.* edge to win/);
  assert.match(html, /No legal move on your turn means you lose/);
});

test("main: post-game action buttons can replay or return to mode selection", async () => {
  const env = installEnv();
  try {
    const { TUTORIALS } = await import("../src/levels.js");
    await import(`../src/main.js?post-game-actions-${Date.now()}`);

    for (let step = 0; step < TUTORIALS.length; step++) env.el("nav-next").click();

    env.el("rush-mode-button").click();
    assert.equal(env.el("app").classList.contains("mode-rush"), true, "Rush starts from mode select");
    env.el("btn-rush-menu").click();
    assert.equal(env.el("mode-select").classList.contains("hidden"), false, "Rush menu action returns to mode selection");
    assert.equal(env.el("app").classList.contains("mode-rush"), false, "Rush menu action tears down Rush mode");

    env.el("battle-mode-button").click();
    assert.equal(env.el("app").classList.contains("mode-battle"), true, "Battle starts from mode select");
    env.el("btn-battle-again").click();
    assert.equal(env.el("app").classList.contains("mode-battle"), true, "Battle replay stays in Battle mode");
    assert.equal(env.el("battle-result").classList.contains("hidden"), true, "Battle replay clears the terminal card");

    env.el("btn-battle-menu").click();
    assert.equal(env.el("mode-select").classList.contains("hidden"), false, "Battle menu action returns to mode selection");
    assert.equal(env.el("app").classList.contains("mode-battle"), false, "Battle menu action tears down Battle mode");
  } finally {
    env.restore();
  }
});

test("index: terminal Rush and Battle surfaces offer replay and mode selection", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /id="btn-rush-again"/);
  assert.match(html, /id="btn-rush-menu"/);
  assert.match(html, /id="btn-battle-again"/);
  assert.match(html, /id="btn-battle-menu"/);
});
