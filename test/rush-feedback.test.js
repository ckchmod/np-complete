import { test } from "node:test";
import assert from "node:assert/strict";

import { createRush } from "../src/rush.js";
import { TUTORIALS } from "../src/levels.js";

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

function queryMount(map) {
  return {
    querySelector(selector) {
      return map.get(selector) || null;
    },
  };
}

async function withDom(fn) {
  const timers = [];
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    navigator: globalThis.navigator,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    performance: globalThis.performance,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    localStorage: globalThis.localStorage,
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
  setGlobal("window", { matchMedia: () => ({ matches: false }) });
  setGlobal("navigator", { vibrate() {} });
  setGlobal("requestAnimationFrame", (cb) => {
    cb(1000);
    return 1;
  });
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
  setGlobal("localStorage", {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null;
    },
    setItem(key, value) {
      this.store.set(key, String(value));
    },
  });

  const flushTimers = () => {
    for (;;) {
      const timer = timers.find((entry) => entry.active);
      if (!timer) break;
      timer.active = false;
      timer.cb();
    }
  };

  try {
    return await fn({ timers, flushTimers });
  } finally {
    setGlobal("document", previous.document);
    setGlobal("window", previous.window);
    setGlobal("navigator", previous.navigator);
    setGlobal("requestAnimationFrame", previous.requestAnimationFrame);
    setGlobal("performance", previous.performance);
    setGlobal("setTimeout", previous.setTimeout);
    setGlobal("clearTimeout", previous.clearTimeout);
    setGlobal("localStorage", previous.localStorage);
  }
}

function buildRushFixture() {
  const svg = fakeEl("svg");
  const score = fakeEl("div");
  const strikes = fakeEl("div");
  const moves = fakeEl("div");
  const skip = fakeEl("button");
  const toast = fakeEl("div");
  const map = new Map([
    ["#board", svg],
    ["#rush-score", score],
    ["#rush-strikes", strikes],
    ["#rush-moves", moves],
    ["#btn-skip", skip],
    ["#rush-toast", toast],
  ]);
  return { svg, score, strikes, moves, skip, toast, mountEl: queryMount(map) };
}

function findEdgeHit(svg, edgeId) {
  return findOne(svg, (el) => el.classList && el.classList.contains("edge-hit") && el.parentNode && el.parentNode.dataset && el.parentNode.dataset.edge === edgeId);
}

function findNodeGroup(svg, nodeId) {
  return findOne(svg, (el) => el.dataset && el.dataset.node === nodeId && el.classList && el.classList.contains("node-group"));
}

function findEdgeGroup(svg, edgeId) {
  return findOne(svg, (el) => el.dataset && el.dataset.edge === edgeId && el.classList && el.classList.contains("edge-group"));
}

test("rush illegal tap explains the blocker, keeps HUD steady, and clears itself", async () => {
  await withDom(({ flushTimers }) => {
    const fixture = buildRushFixture();
    createRush({
      mountEl: fixture.mountEl,
      seed: 7,
      levelFactory: () => TUTORIALS[1],
      onGameOver() {
        assert.fail("illegal tap must not end the run");
      },
    });

    assert.equal(fixture.score.textContent, "0");
    assert.equal(fixture.strikes.textContent, "···");
    assert.equal(fixture.moves.textContent, "0 / 4");

    findEdgeHit(fixture.svg, "e0").dispatch("click");

    assert.equal(fixture.score.textContent, "0");
    assert.equal(fixture.strikes.textContent, "···");
    assert.equal(fixture.moves.textContent, "0 / 4");
    assert.equal(fixture.svg.classList.contains("has-illegal-explain"), true);
    assert.equal(findNodeGroup(fixture.svg, "b").classList.contains("is-illegal-receiver"), true);
    assert.equal(findEdgeGroup(fixture.svg, "e0").classList.contains("is-illegal-edge"), true);

    const nodeExplain = findOne(fixture.svg, (el) => el.classList && el.classList.contains("illegal-explain-node"));
    const edgeExplain = findOne(fixture.svg, (el) => el.classList && el.classList.contains("illegal-explain-edge"));
    assert.equal(findOne(nodeExplain, (el) => el.classList && el.classList.contains("illegal-explain-current")).textContent, "3");
    assert.equal(findOne(nodeExplain, (el) => el.classList && el.classList.contains("illegal-explain-result")).textContent, "1");
    assert.equal(findOne(nodeExplain, (el) => el.classList && el.classList.contains("illegal-explain-low")).textContent, "< 2");
    assert.equal(findOne(edgeExplain, (el) => el.classList && el.classList.contains("illegal-explain-weight")).textContent, "2");

    flushTimers();

    assert.equal(fixture.svg.classList.contains("has-illegal-explain"), false);
    assert.equal(findNodeGroup(fixture.svg, "b").classList.contains("is-illegal-receiver"), false);
    assert.equal(findEdgeGroup(fixture.svg, "e0").classList.contains("is-illegal-edge"), false);
    assert.equal(findAll(fixture.svg, (el) => el.classList && el.classList.contains("illegal-explain")).length, 0);
  });
});

test("rush legal tap does not show the illegal explanation", async () => {
  await withDom(() => {
    const fixture = buildRushFixture();
    let terminal = false;
    createRush({
      mountEl: fixture.mountEl,
      seed: 8,
      levelFactory: () => TUTORIALS[1],
      onGameOver() {
        terminal = true;
      },
    });

    findEdgeHit(fixture.svg, "e2").dispatch("click");

    assert.equal(terminal, false);
    assert.equal(findAll(fixture.svg, (el) => el.classList && el.classList.contains("illegal-explain")).length, 0);
    assert.equal(fixture.moves.textContent, "1 / 4");
    assert.equal(fixture.score.textContent, "1");
  });
});
