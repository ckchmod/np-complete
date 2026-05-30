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
    disabled: false,
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
    return await fn({ flushTimers });
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
  const undo = fakeEl("button");
  const skip = fakeEl("button");
  const toast = fakeEl("div");
  const map = new Map([
    ["#board", svg],
    ["#rush-score", score],
    ["#rush-strikes", strikes],
    ["#rush-moves", moves],
    ["#btn-rush-undo", undo],
    ["#btn-skip", skip],
    ["#rush-toast", toast],
  ]);
  return { svg, score, strikes, moves, undo, skip, toast, mountEl: queryMount(map) };
}

function findEdgeHit(svg, edgeId) {
  return findOne(svg, (el) => el.classList && el.classList.contains("edge-hit") && el.parentNode && el.parentNode.dataset && el.parentNode.dataset.edge === edgeId);
}

function findEdgeArrow(svg, edgeId) {
  return findOne(svg, (el) => el.classList && el.classList.contains("edge-arrow") && el.parentNode && el.parentNode.dataset && el.parentNode.dataset.edge === edgeId);
}

function legalEdgeIds(svg) {
  return findAll(svg, (el) => el.dataset && el.dataset.edge && el.classList && el.classList.contains("edge-group") && el.classList.contains("is-legal"))
    .map((el) => el.dataset.edge)
    .sort();
}

test("rush undo restores the previous board state and adds a move penalty", async () => {
  await withDom(() => {
    const fixture = buildRushFixture();
    createRush({
      mountEl: fixture.mountEl,
      seed: 7,
      levelFactory: () => TUTORIALS[2],
      onGameOver() {
        assert.fail("undo test must not end the run");
      },
    });

    const startPaths = new Map([
      ["e2", findEdgeArrow(fixture.svg, "e2").attrs.d],
    ]);
    const startLegal = legalEdgeIds(fixture.svg);

    const startMoves = fixture.moves.textContent;
    const budget = startMoves.split(" / ")[1];
    assert.equal(startMoves, "0 / " + budget);

    fixture.undo.dispatch("click");
    assert.equal(fixture.moves.textContent, startMoves);
    assert.deepEqual(legalEdgeIds(fixture.svg), startLegal);

    findEdgeHit(fixture.svg, "e2").dispatch("click");

    assert.equal(fixture.moves.textContent, "1 / " + budget);
    assert.notEqual(findEdgeArrow(fixture.svg, "e2").attrs.d, startPaths.get("e2"));

    fixture.undo.dispatch("click");

    assert.equal(fixture.moves.textContent, "2 / " + budget);
    assert.equal(findEdgeArrow(fixture.svg, "e2").attrs.d, startPaths.get("e2"));
    assert.deepEqual(legalEdgeIds(fixture.svg), startLegal);

    fixture.undo.dispatch("click");
    assert.equal(fixture.moves.textContent, "2 / " + budget);
  });
});

test("rush undo is disabled before any move and after a strike", async () => {
  await withDom(({ flushTimers }) => {
    const fixture = buildRushFixture();
    createRush({
      mountEl: fixture.mountEl,
      seed: 8,
      levelFactory: () => TUTORIALS[1],
      onGameOver() {
        assert.fail("strike test must not end the run");
      },
    });

    fixture.skip.dispatch("click");

    fixture.undo.dispatch("click");
    assert.equal(fixture.moves.textContent, "0 / 4");
    assert.equal(fixture.strikes.textContent, "✕··");

    flushTimers();

    assert.equal(fixture.moves.textContent, "0 / 4");
    fixture.undo.dispatch("click");
    assert.equal(fixture.moves.textContent, "0 / 4");
  });
});
