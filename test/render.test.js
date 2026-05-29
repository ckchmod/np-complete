import { test } from "node:test";
import assert from "node:assert/strict";

import { applyBattleFlip, makeBattleConfig } from "../src/battleEngine.js";
import { makeConfig } from "../src/engine.js";
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
    style: { setProperty() {}, removeProperty() {} },
    dataset: {},
    textContent: "",
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
      if (child._parent) child._parent.removeChild(child);
      children.push(child);
      child._parent = el;
      return child;
    },
    removeChild(child) {
      const i = children.indexOf(child);
      if (i >= 0) children.splice(i, 1);
      if (child._parent === el) child._parent = null;
      return child;
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatch(type, ev) {
      (listeners[type] || []).forEach((fn) => fn(ev || {}));
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

function findEdge(svg, edgeId) {
  return findAll(svg, (el) => el.dataset && el.dataset.edge === edgeId)[0] || null;
}

function findClass(root, className) {
  return findAll(root, (el) => el.classList && el.classList.contains(className));
}

function battleFixture() {
  return {
    id: "render-battle",
    name: "render battle",
    nodes: [
      { id: "c", x: 1, y: 1 },
      { id: "L", x: 0, y: 1 },
      { id: "R", x: 2, y: 1 },
      { id: "xa", x: 0, y: 0 },
      { id: "xb", x: 2, y: 0 },
    ],
    edges: [
      { id: "t", u: "L", v: "c", w: 2, dir: "uv", owner: "white" },
      { id: "s", u: "R", v: "c", w: 1, dir: "uv", owner: "white" },
      { id: "la", u: "L", v: "xa", w: 2, dir: "uv", owner: "neutral" },
      { id: "al", u: "L", v: "xa", w: 2, dir: "vu", owner: "neutral" },
      { id: "rb", u: "R", v: "xb", w: 2, dir: "uv", owner: "black" },
      { id: "br", u: "R", v: "xb", w: 2, dir: "vu", owner: "black" },
    ],
    target: "t",
    targetB: "rb",
  };
}

async function withSvgEnv(fn) {
  const prev = {
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  globalThis.document = { createElementNS: (_ns, tagName) => fakeEl(tagName) };
  globalThis.requestAnimationFrame = () => 0;
  try {
    return await fn();
  } finally {
    globalThis.document = prev.document;
    globalThis.requestAnimationFrame = prev.requestAnimationFrame;
  }
}

test("render: classic boards keep the existing edge contract without battle overlays", async () => {
  await withSvgEnv(() => {
    const svg = fakeEl("svg");
    createBoard(svg, makeConfig(TUTORIALS[0]), {});

    assert.equal(svg.classList.contains("board"), true);
    assert.equal(svg.classList.contains("is-battle"), false);
    assert.equal(findAll(svg, (el) => el.dataset && el.dataset.edge).length, TUTORIALS[0].edges.length);
    assert.equal(findClass(svg, "edge-charge").length, 0);
    assert.equal(findEdge(svg, TUTORIALS[0].target).classList.contains("is-target"), true);
  });
});

test("render: battle boards emit owner classes, charge attributes, and badges", async () => {
  await withSvgEnv(() => {
    const svg = fakeEl("svg");
    const state = makeBattleConfig(battleFixture(), 3);
    createBoard(svg, state, {});

    const white = findEdge(svg, "s");
    const black = findEdge(svg, "rb");
    const neutral = findEdge(svg, "la");

    assert.equal(svg.classList.contains("is-battle"), true);
    assert.equal(svg.dataset.turn, "white");
    assert.equal(white.dataset.owner, "white");
    assert.equal(white.dataset.charge, "3");
    assert.equal(white.classList.contains("is-owner-white"), true);
    assert.equal(white.classList.contains("is-current-owner"), true);
    assert.equal(black.classList.contains("is-owner-black"), true);
    assert.equal(black.classList.contains("is-opponent"), true);
    assert.equal(neutral.classList.contains("is-owner-neutral"), true);
    assert.equal(findClass(svg, "edge-charge").length, state.level.edges.length);
    assert.equal(findClass(white, "edge-charge-text")[0].textContent, "3");
  });
});

test("render: update refreshes turn ownership and charge labels", async () => {
  await withSvgEnv(() => {
    const svg = fakeEl("svg");
    const start = makeBattleConfig(battleFixture(), 3);
    const board = createBoard(svg, start, {});
    const next = applyBattleFlip(start, "s");

    board.update(next);

    const flipped = findEdge(svg, "s");
    const black = findEdge(svg, "rb");
    assert.equal(svg.dataset.turn, "black");
    assert.equal(flipped.dataset.charge, "2");
    assert.equal(findClass(flipped, "edge-charge-text")[0].textContent, "2");
    assert.equal(flipped.classList.contains("is-opponent"), true);
    assert.equal(flipped.classList.contains("is-current-owner"), false);
    assert.equal(black.classList.contains("is-current-owner"), true);
  });
});

test("render: markLegal still applies legal highlights on battle boards", async () => {
  await withSvgEnv(() => {
    const svg = fakeEl("svg");
    const board = createBoard(svg, makeBattleConfig(battleFixture(), 3), {});

    board.markLegal(["s"]);

    assert.equal(findEdge(svg, "s").classList.contains("is-legal"), true);
    assert.equal(findEdge(svg, "t").classList.contains("is-legal"), false);
    assert.equal(findEdge(svg, "rb").classList.contains("is-legal"), false);
  });
});
