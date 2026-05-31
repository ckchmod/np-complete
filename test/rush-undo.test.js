import { test } from "node:test";
import assert from "node:assert/strict";

import { createRush } from "../src/rush.js";
import { TUTORIALS } from "../src/levels.js";

function fakeEl() {
  const listeners = {};
  const classes = new Set();
  return {
    textContent: "",
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
    dispatch(type, event = {}) {
      (listeners[type] || []).slice().forEach((fn) => fn(event));
    },
  };
}

function queryMount(map) {
  return {
    querySelector(selector) {
      return map.get(selector) || null;
    },
  };
}

function buildRushFixture() {
  const boardEl = fakeEl();
  const score = fakeEl();
  const strikes = fakeEl();
  const moves = fakeEl();
  const undo = fakeEl();
  const skip = fakeEl();
  const toast = fakeEl();
  const map = new Map([
    ["#board", boardEl],
    ["#rush-score", score],
    ["#rush-strikes", strikes],
    ["#rush-moves", moves],
    ["#btn-rush-undo", undo],
    ["#btn-skip", skip],
    ["#rush-toast", toast],
  ]);
  return { boardEl, score, strikes, moves, undo, skip, toast, mountEl: queryMount(map) };
}

function fakeBoardFactory(boards) {
  return (mount, config, options) => {
    const board = {
      mount,
      config,
      options,
      legal: [],
      updates: [config],
      strikeFlashes: 0,
      destroyed: false,
      update(nextConfig) {
        this.config = nextConfig;
        this.updates.push(nextConfig);
      },
      markLegal(edgeIds) {
        this.legal = [...edgeIds].sort();
      },
      shakeEdge() {},
      pulseNode() {},
      winCascade() {},
      strikeFlash() {
        this.strikeFlashes++;
      },
      destroy() {
        this.destroyed = true;
      },
      tap(edgeId) {
        this.options.onEdgeTap(edgeId);
      },
    };
    boards.push(board);
    return board;
  };
}

async function withTimers(fn) {
  const timers = [];
  const previous = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    localStorage: globalThis.localStorage,
    navigator: globalThis.navigator,
  };

  Object.defineProperty(globalThis, "setTimeout", {
    value: (cb, delay) => {
      const id = timers.length + 1;
      timers.push({ id, cb, delay, active: true });
      return id;
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "clearTimeout", {
    value: (id) => {
      const timer = timers.find((entry) => entry.id === id);
      if (timer) timer.active = false;
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: () => null, setItem() {} },
    configurable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: { vibrate() {} },
    configurable: true,
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
    await fn({ flushTimers });
  } finally {
    Object.defineProperty(globalThis, "setTimeout", { value: previous.setTimeout, configurable: true });
    Object.defineProperty(globalThis, "clearTimeout", { value: previous.clearTimeout, configurable: true });
    Object.defineProperty(globalThis, "localStorage", { value: previous.localStorage, configurable: true });
    Object.defineProperty(globalThis, "navigator", { value: previous.navigator, configurable: true });
  }
}

test("rush undo restores the previous board state and adds a move penalty", async () => {
  await withTimers(() => {
    const fixture = buildRushFixture();
    const boards = [];
    createRush({
      mountEl: fixture.mountEl,
      seed: 7,
      levelFactory: () => TUTORIALS[2],
      boardFactory: fakeBoardFactory(boards),
      onGameOver() {
        assert.fail("undo test must not end the run");
      },
    });

    const startDirection = boards[0].config.dirs.get("e2");
    const startLegal = boards[0].legal;
    const budget = fixture.moves.textContent.split(" / ")[1];

    fixture.undo.dispatch("click");
    assert.equal(fixture.moves.textContent, "0 / " + budget);
    assert.deepEqual(boards[0].legal, startLegal);

    boards[0].tap("e2");
    assert.equal(fixture.moves.textContent, "1 / " + budget);
    assert.notEqual(boards[0].config.dirs.get("e2"), startDirection);

    fixture.undo.dispatch("click");
    assert.equal(fixture.moves.textContent, "2 / " + budget);
    assert.equal(boards[0].config.dirs.get("e2"), startDirection);
    assert.deepEqual(boards[0].legal, startLegal);

    fixture.undo.dispatch("click");
    assert.equal(fixture.moves.textContent, "2 / " + budget);
  });
});

test("rush undo is disabled before any move and after a strike", async () => {
  await withTimers(({ flushTimers }) => {
    const fixture = buildRushFixture();
    const boards = [];
    createRush({
      mountEl: fixture.mountEl,
      seed: 8,
      levelFactory: () => TUTORIALS[1],
      boardFactory: fakeBoardFactory(boards),
      onGameOver() {
        assert.fail("strike test must not end the run");
      },
    });

    assert.equal(fixture.undo.disabled, true);
    fixture.skip.dispatch("click");

    fixture.undo.dispatch("click");
    assert.equal(fixture.moves.textContent, "0 / 4");
    assert.equal(fixture.strikes.textContent, "✕··");
    assert.equal(boards[0].strikeFlashes, 1);

    flushTimers();

    assert.equal(boards[0].destroyed, true);
    assert.equal(boards.length, 2);
    assert.equal(fixture.moves.textContent, "0 / 4");
    assert.equal(fixture.undo.disabled, true);
    fixture.undo.dispatch("click");
    assert.equal(fixture.moves.textContent, "0 / 4");
  });
});
