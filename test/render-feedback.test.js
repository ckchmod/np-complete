import { test } from "node:test";
import assert from "node:assert/strict";

import { applyFlip, inflow, makeConfig } from "../src/engine.js";
import { TUTORIALS } from "../src/levels.js";
import { createBoard } from "../src/render.js";

function fakeEl(tagName = "g") {
  const children = [];
  const listeners = {};
  const attrs = {};
  const classes = new Set();
  const el = {
    tagName,
    children,
    attrs,
    style: { setProperty() {}, removeProperty() {}, touchAction: "" },
    dataset: {},
    textContent: "",
    parentNode: null,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, on) {
        if (on === undefined) on = !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
      contains: (name) => classes.has(name),
    },
    get firstChild() {
      return children.length ? children[0] : null;
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
      if (name === "class") {
        classes.clear();
        String(value).split(/\s+/).filter(Boolean).forEach((part) => classes.add(part));
      }
    },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      children.push(child);
      child.parentNode = el;
      return child;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      if (child.parentNode === el) child.parentNode = null;
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
    dispatch(type, ev = {}) {
      (listeners[type] || []).slice().forEach((fn) => fn(ev));
    },
    getBoundingClientRect() {
      return { width: 0, height: 0, top: 0, left: 0 };
    },
  };
  return el;
}

function findAll(root, predicate, found = []) {
  if (predicate(root)) found.push(root);
  for (const child of root.children || []) findAll(child, predicate, found);
  return found;
}

function findOne(root, predicate) {
  return findAll(root, predicate)[0] || null;
}

function findClass(root, className) {
  return findAll(root, (el) => el.classList && el.classList.contains(className));
}

function findEdge(svg, edgeId) {
  return findOne(svg, (el) => el.dataset && el.dataset.edge === edgeId);
}

function findNode(svg, nodeId) {
  return findOne(svg, (el) => el.dataset && el.dataset.node === nodeId);
}

async function withSvgEnv({ reducedMotion = false } = {}, fn) {
  const timers = [];
  const frames = [];
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    navigator: globalThis.navigator,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    performance: globalThis.performance,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  function setGlobal(name, value) {
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  }

  setGlobal("document", { createElementNS: (_ns, tagName) => fakeEl(tagName) });
  setGlobal("window", { matchMedia: () => ({ matches: reducedMotion }) });
  setGlobal("navigator", { vibrate() {} });
  setGlobal("performance", { now: () => 0 });
  setGlobal("setTimeout", (cb, delay) => {
    const id = timers.length + 1;
    timers.push({ id, cb, delay, active: true });
    return id;
  });
  setGlobal("clearTimeout", (id) => {
    const timer = timers.find((entry) => entry.id === id);
    if (timer) timer.active = false;
  });
  setGlobal("requestAnimationFrame", (cb) => {
    const id = frames.length + 1;
    frames.push({ id, cb, active: true });
    return id;
  });
  setGlobal("cancelAnimationFrame", (id) => {
    const frame = frames.find((entry) => entry.id === id);
    if (frame) frame.active = false;
  });

  const flushTimers = () => {
    for (;;) {
      const timer = timers.find((entry) => entry.active);
      if (!timer) break;
      timer.active = false;
      timer.cb();
    }
  };

  const flushFrames = () => {
    for (;;) {
      const frame = frames.find((entry) => entry.active);
      if (!frame) break;
      frame.active = false;
      frame.cb(1000);
    }
  };

  const counts = () => ({
    timers: timers.filter((entry) => entry.active).length,
    frames: frames.filter((entry) => entry.active).length,
  });

  try {
    return await fn({ timers, frames, flushTimers, flushFrames, counts });
  } finally {
    setGlobal("document", previous.document);
    setGlobal("window", previous.window);
    setGlobal("navigator", previous.navigator);
    setGlobal("requestAnimationFrame", previous.requestAnimationFrame);
    setGlobal("cancelAnimationFrame", previous.cancelAnimationFrame);
    setGlobal("performance", previous.performance);
    setGlobal("setTimeout", previous.setTimeout);
    setGlobal("clearTimeout", previous.clearTimeout);
  }
}

function buildLevel() {
  return makeConfig(TUTORIALS[1]);
}

test("render feedback: explainIllegal renders the blocker details on the board", async () => {
  await withSvgEnv({}, () => {
    const config = buildLevel();
    const svg = fakeEl("svg");
    const board = createBoard(svg, config, {});

    board.explainIllegal("e0", "b", inflow(config, "b"), 2);

    const nodeExplain = findOne(svg, (el) => el.classList && el.classList.contains("illegal-explain-node"));
    const edgeExplain = findOne(svg, (el) => el.classList && el.classList.contains("illegal-explain-edge"));

    assert.equal(svg.classList.contains("has-illegal-explain"), true);
    assert.equal(findEdge(svg, "e0").classList.contains("is-illegal-edge"), true);
    assert.equal(findNode(svg, "b").classList.contains("is-illegal-receiver"), true);
    assert.equal(findOne(nodeExplain, (el) => el.classList && el.classList.contains("illegal-explain-current")).textContent, "3");
    assert.equal(findOne(nodeExplain, (el) => el.classList && el.classList.contains("illegal-explain-result")).textContent, "1");
    assert.equal(findOne(nodeExplain, (el) => el.classList && el.classList.contains("illegal-explain-low")).textContent, "< 2");
    assert.equal(findOne(edgeExplain, (el) => el.classList && el.classList.contains("illegal-explain-weight")).textContent, "2");
  });
});

test("render feedback: explainIllegal clears itself, update(), and destroy() remove the overlay", async () => {
  await withSvgEnv({}, ({ flushTimers }) => {
    const config = buildLevel();
    const svg = fakeEl("svg");
    const board = createBoard(svg, config, {});

    board.explainIllegal("e0", "b", inflow(config, "b"), 2);
    flushTimers();
    assert.equal(findClass(svg, "illegal-explain").length, 0);
    assert.equal(svg.classList.contains("has-illegal-explain"), false);
    assert.equal(findEdge(svg, "e0").classList.contains("is-illegal-edge"), false);
    assert.equal(findNode(svg, "b").classList.contains("is-illegal-receiver"), false);

    board.explainIllegal("e0", "b", inflow(config, "b"), 2);
    board.update(config);
    assert.equal(findClass(svg, "illegal-explain").length, 0);
    assert.equal(svg.classList.contains("has-illegal-explain"), false);

    board.explainIllegal("e0", "b", inflow(config, "b"), 2);
    board.destroy();
    assert.equal(findClass(svg, "illegal-explain").length, 0);
    assert.equal(svg.classList.contains("has-illegal-explain"), false);
    assert.equal(findEdge(svg, "e0").classList.contains("is-illegal-edge"), false);
    assert.equal(findNode(svg, "b").classList.contains("is-illegal-receiver"), false);
  });
});

test("render feedback: destroy cancels pending explanation, win cascade, and animation work", async () => {
  await withSvgEnv({}, ({ counts, flushTimers, flushFrames }) => {
    const start = buildLevel();
    const next = applyFlip(start, "e2");
    const svg = fakeEl("svg");
    const board = createBoard(svg, start, {});

    board.explainIllegal("e0", "b", inflow(start, "b"), 2);
    board.winCascade();
    board.shakeEdge("e0");
    board.pulseNode("b");
    board.update(next);

    const pendingBefore = counts();
    assert.ok(pendingBefore.timers > 0 || pendingBefore.frames > 0);

    board.destroy();

    assert.deepEqual(counts(), { timers: 0, frames: 0 });
    flushTimers();
    flushFrames();
    assert.equal(findClass(svg, "illegal-explain").length, 0);
    assert.equal(svg.classList.contains("has-illegal-explain"), false);
  });
});

test("render feedback: reduced motion still renders the illegal explanation", async () => {
  await withSvgEnv({ reducedMotion: true }, () => {
    const config = buildLevel();
    const svg = fakeEl("svg");
    const board = createBoard(svg, config, {});

    board.explainIllegal("e0", "b", inflow(config, "b"), 2);

    assert.equal(svg.classList.contains("has-illegal-explain"), true);
    assert.equal(findClass(svg, "illegal-explain").length, 2);
    assert.equal(findOne(svg, (el) => el.classList && el.classList.contains("illegal-explain-current")).textContent, "3");
    assert.equal(findOne(svg, (el) => el.classList && el.classList.contains("illegal-explain-result")).textContent, "1");
  });
});
