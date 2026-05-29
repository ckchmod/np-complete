import { test } from "node:test";
import assert from "node:assert/strict";

import { applyBattleFlip, makeBattleConfig } from "../src/battleEngine.js";
import { createBattle, legalBattleFlips } from "../src/battle.js";

function fakeEl() {
  const children = [];
  const listeners = {};
  const el = {
    children,
    style: { setProperty() {}, removeProperty() {} },
    dataset: {},
    textContent: "",
    _classes: new Set(),
    classList: {
      add: (c) => el._classes.add(c),
      remove: (c) => el._classes.delete(c),
      toggle(c, on) {
        if (on === undefined) on = !el._classes.has(c);
        if (on) el._classes.add(c);
        else el._classes.delete(c);
        return on;
      },
      contains: (c) => el._classes.has(c),
    },
    get firstChild() {
      return children.length ? children[0] : null;
    },
    setAttribute() {},
    appendChild(child) {
      children.push(child);
      return child;
    },
    removeChild(child) {
      const i = children.indexOf(child);
      if (i >= 0) children.splice(i, 1);
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

function fakeBoardFactory(boards) {
  return function makeBoard(svgEl, config, options) {
    const board = {
      svgEl,
      config,
      options,
      legal: [],
      updates: [],
      shaken: [],
      pulsed: [],
      won: false,
      destroyed: false,
      update(next) {
        this.config = next;
        this.updates.push(next);
      },
      markLegal(ids) {
        this.legal = ids.slice();
      },
      shakeEdge(edgeId) {
        this.shaken.push(edgeId);
      },
      pulseNode(nodeId) {
        this.pulsed.push(nodeId);
      },
      winCascade() {
        this.won = true;
      },
      destroy() {
        this.destroyed = true;
      },
    };
    boards.push(board);
    return board;
  };
}

function battleSlackFixture() {
  return {
    id: "battle-slack",
    name: "battle slack",
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

function twoTargetFixture() {
  return {
    id: "two-target",
    name: "two target",
    nodes: [
      { id: "g", x: 1, y: 1 },
      { id: "x1", x: 0, y: 0 },
      { id: "x2", x: 2, y: 0 },
      { id: "y", x: 1, y: 2 },
      { id: "p", x: 0, y: 2 },
      { id: "q", x: 2, y: 2 },
      { id: "r", x: 1, y: 3 },
    ],
    edges: [
      { id: "p1", u: "x1", v: "g", w: 1, dir: "uv", owner: "black" },
      { id: "p2", u: "x2", v: "g", w: 1, dir: "uv", owner: "neutral" },
      { id: "tg", u: "g", v: "y", w: 2, dir: "vu", owner: "white" },
      { id: "xp", u: "x1", v: "p", w: 2, dir: "uv", owner: "neutral" },
      { id: "px", u: "x1", v: "p", w: 2, dir: "vu", owner: "neutral" },
      { id: "xq", u: "x2", v: "q", w: 2, dir: "uv", owner: "neutral" },
      { id: "qx", u: "x2", v: "q", w: 2, dir: "vu", owner: "neutral" },
      { id: "yr", u: "y", v: "r", w: 2, dir: "uv", owner: "neutral" },
      { id: "ry", u: "y", v: "r", w: 2, dir: "vu", owner: "neutral" },
    ],
    target: "tg",
    targetB: "p1",
  };
}

test("battle: start initializes generated state, HUD, and current-player legal highlights", () => {
  const boards = [];
  const turnEl = fakeEl();
  const statusEl = fakeEl();
  const level = battleSlackFixture();
  const battle = createBattle({
    refs: { boardEl: fakeEl(), turnEl, statusEl },
    generate: () => level,
    boardFactory: fakeBoardFactory(boards),
  });

  const state = battle.start();

  assert.equal(state.turn, "white");
  assert.equal(turnEl.textContent, "White");
  assert.equal(statusEl.textContent, "");
  assert.deepEqual(boards[0].legal, legalBattleFlips(makeBattleConfig(level, 3)));
});

test("battle: legal move applies flip, changes turn, decrements charge, and refreshes legal moves", () => {
  const boards = [];
  const turnEl = fakeEl();
  const battle = createBattle({
    refs: { boardEl: fakeEl(), turnEl },
    seed: 1,
    boardFactory: fakeBoardFactory(boards),
  });

  const start = battle.start();
  const edgeId = start.legalMoves[0];
  battle.tap(edgeId);

  assert.equal(battle.state.turn, "black");
  assert.equal(turnEl.textContent, "Black");
  assert.notEqual(battle.state.dirs.get(edgeId), start.dirs.get(edgeId));
  assert.equal(battle.state.charges.get(edgeId), start.charges.get(edgeId) - 1);
  assert.equal(boards[0].updates.length, 1);
  assert.deepEqual(boards[0].legal, legalBattleFlips(battle.state));
});

test("battle: illegal move gives feedback and leaves dirs, charges, and turn unchanged", () => {
  const boards = [];
  const statusEl = fakeEl();
  const level = battleSlackFixture();
  let illegal = null;
  const battle = createBattle({
    refs: { boardEl: fakeEl(), statusEl },
    generate: () => level,
    boardFactory: fakeBoardFactory(boards),
    onIllegalMove: (event) => (illegal = event),
  });

  const before = battle.start();
  battle.tap("t");
  const after = battle.state;

  assert.equal(after.turn, before.turn);
  assert.deepEqual(Object.fromEntries(after.dirs), Object.fromEntries(before.dirs));
  assert.deepEqual(Object.fromEntries(after.charges), Object.fromEntries(before.charges));
  assert.equal(statusEl.textContent, "Illegal move");
  assert.equal(illegal.edgeId, "t");
  assert.equal(boards[0].updates.length, 0);
  assert.deepEqual(boards[0].shaken, ["t"]);
});

test("battle: terminal winner is shown after a target flip", () => {
  const boards = [];
  const statusEl = fakeEl();
  let terminal = null;
  const battle = createBattle({
    refs: { boardEl: fakeEl(), statusEl },
    generate: () => twoTargetFixture(),
    boardFactory: fakeBoardFactory(boards),
    onTerminal: (result) => (terminal = result),
  });

  battle.start();
  battle.tap("tg");

  assert.deepEqual(battle.terminal, { terminal: true, winner: "white", reason: "target" });
  assert.equal(statusEl.textContent, "White Wins!");
  assert.equal(terminal.message, "White Wins!");
  assert.equal(boards[0].won, true);
});

test("battle: terminal input is ignored without mutating state", () => {
  const boards = [];
  const battle = createBattle({
    refs: { boardEl: fakeEl(), statusEl: fakeEl() },
    generate: () => twoTargetFixture(),
    boardFactory: fakeBoardFactory(boards),
  });

  battle.start();
  battle.tap("tg");
  const won = battle.state;
  battle.tap("p2");

  assert.deepEqual(Object.fromEntries(battle.state.dirs), Object.fromEntries(won.dirs));
  assert.deepEqual(Object.fromEntries(battle.state.charges), Object.fromEntries(won.charges));
  assert.equal(boards[0].updates.length, 1);
  assert.deepEqual(boards[0].shaken, ["p2"]);
});

test("battle: start can create a real generated battle board with the default generator", () => {
  const boards = [];
  const battle = createBattle({
    refs: { boardEl: fakeEl() },
    seed: 17,
    boardFactory: fakeBoardFactory(boards),
  });

  const state = battle.start();

  assert.equal(state.level.id.startsWith("battle-"), true);
  assert.ok(state.level.targetB);
  assert.ok(boards[0].legal.length > 0);
});

test("battle: destroy tears down the active board before restart", () => {
  const boards = [];
  const battle = createBattle({
    refs: { boardEl: fakeEl() },
    generate: () => battleSlackFixture(),
    boardFactory: fakeBoardFactory(boards),
  });

  battle.start();
  battle.start();
  battle.destroy();

  assert.equal(boards[0].destroyed, true);
  assert.equal(boards[1].destroyed, true);
});

test("battle: controller flow matches battle engine for the applied move", () => {
  const boards = [];
  const level = battleSlackFixture();
  const expected = applyBattleFlip(makeBattleConfig(level, 3), "s");
  const battle = createBattle({
    refs: { boardEl: fakeEl() },
    generate: () => level,
    boardFactory: fakeBoardFactory(boards),
  });

  battle.start();
  battle.tap("s");

  assert.equal(battle.state.turn, expected.turn);
  assert.deepEqual(Object.fromEntries(battle.state.dirs), Object.fromEntries(expected.dirs));
  assert.deepEqual(Object.fromEntries(battle.state.charges), Object.fromEntries(expected.charges));
});
