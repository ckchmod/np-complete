import { test } from "node:test";
import assert from "node:assert/strict";

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
    "btn-rush-start", "mode-select", "rush-mode-button", "battle-mode-button", "battle-board",
    "battle-turn", "battle-status", "battle-result", "board", "rush-score", "rush-strikes",
    "rush-moves", "btn-skip", "rush-toast", "move-count", "par-display", "result-card",
    "result-moves", "result-par", "result-stars", "result-score", "result-pb", "result-hash",
    "btn-share", "btn-undo", "btn-reset", "rush-final-score", "rush-best", "rush-stats",
    "btn-rush-again", "btn-rush-share"
  ];
  for (const id of ids) elements.set(id, fakeEl(id));
  for (const id of ["rush-over", "rush-intro", "mode-select", "battle-result", "result-card"]) {
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
