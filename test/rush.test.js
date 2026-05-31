import { test } from "node:test";
import assert from "node:assert/strict";
import { createRush, moveBudget, difficultyFor } from "../src/rush.js";
import { generateLock, makeRng } from "../src/generator.js";
import { TUTORIALS } from "../src/levels.js";
import * as THREE_MOCK from "./helpers/three-mock.js";

function fakeElement() {
  const children = [];
  const listeners = {};
  const classes = new Set();
  return {
    children,
    textContent: "",
    disabled: false,
    style: { touchAction: "" },
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, on) {
        const next = on === undefined ? !classes.has(name) : Boolean(on);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
    },
    appendChild(child) {
      children.push(child);
      child._parent = this;
      return child;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      if (child._parent === this) child._parent = null;
      return child;
    },
    setAttribute(name, value) {
      this[name] = String(value);
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners[type] || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    getBoundingClientRect() {
      return { width: 320, height: 640, top: 0, left: 0 };
    },
  };
}

function installRushRenderEnv() {
  const previous = {
    window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    performance: globalThis.performance,
    localStorage: globalThis.localStorage,
  };

  Object.defineProperty(globalThis, "window", {
    value: { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} },
    configurable: true,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    value: () => 1,
    configurable: true,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    value: () => {},
    configurable: true,
  });
  Object.defineProperty(globalThis, "performance", {
    value: { now: () => 0 },
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: () => null, setItem() {} },
    configurable: true,
  });

  return () => {
    Object.defineProperty(globalThis, "window", { value: previous.window, configurable: true });
    Object.defineProperty(globalThis, "requestAnimationFrame", { value: previous.requestAnimationFrame, configurable: true });
    Object.defineProperty(globalThis, "cancelAnimationFrame", { value: previous.cancelAnimationFrame, configurable: true });
    Object.defineProperty(globalThis, "performance", { value: previous.performance, configurable: true });
    Object.defineProperty(globalThis, "localStorage", { value: previous.localStorage, configurable: true });
  };
}

function mountFor(boardEl) {
  const refs = new Map([
    ["#board", boardEl],
    ["#rush-score", fakeElement()],
    ["#rush-strikes", fakeElement()],
    ["#rush-moves", fakeElement()],
    ["#btn-skip", fakeElement()],
    ["#btn-rush-undo", fakeElement()],
    ["#rush-toast", fakeElement()],
  ]);
  return {
    querySelector(selector) {
      return refs.get(selector) || null;
    },
  };
}

test("move budget always exceeds par, so a clean solve fits", () => {
  for (let par = 1; par <= 20; par++) {
    assert.ok(moveBudget(par) > par, `budget(${par}) must exceed par`);
  }
});

test("difficulty starts at 1, never drops, and ramps over a run", () => {
  let prev = 0;
  for (let s = 0; s <= 30; s++) {
    const d = difficultyFor(s);
    assert.ok(d >= 1, "difficulty >= 1");
    assert.ok(d >= prev, "difficulty is non-decreasing");
    prev = d;
  }
  assert.ok(difficultyFor(30) > difficultyFor(0), "harder by the end of a long run");
});

test("every generated lock is solvable within its move budget", () => {
  for (let s = 0; s <= 24; s += 3) {
    const L = generateLock(difficultyFor(s), makeRng(900 + s));
    assert.ok(L, `generated a lock at solve count ${s}`);
    assert.ok(L.par <= moveBudget(L.par), "par must fit inside the budget");
  }
});

test("rush constructs the default 3D board renderer", () => {
  const restore = installRushRenderEnv();
  try {
    const boardEl = fakeElement();
    const rush = createRush({
      mountEl: mountFor(boardEl),
      seed: 11,
      levelFactory: () => TUTORIALS[1],
      boardOptions: { THREE: THREE_MOCK },
    });

    assert.equal(boardEl.children.length, 1);
    assert.equal(boardEl.children[0].nodeName, "CANVAS");
    rush.destroy();
    assert.equal(boardEl.children.length, 0);
  } finally {
    restore();
  }
});
