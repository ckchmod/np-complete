import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createBattle } from "../src/battle.js";
import { isLegalBattleFlip } from "../src/battleEngine.js";

function fakeEl() {
  const classes = new Set();
  return {
    textContent: "",
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
  };
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
      winCascade() {},
      destroy() {
        this.destroyed = true;
      },
    };
    boards.push(board);
    return board;
  };
}

function duelFixture() {
  return {
    id: "battle-ai-duel",
    name: "Battle AI duel",
    nodes: [
      { id: "c", x: 50, y: 20 },
      { id: "cBase", x: 35, y: 20 },
      { id: "r", x: 70, y: 20 },
      { id: "rBase", x: 85, y: 20 },
      { id: "wSource", x: 35, y: 75 },
      { id: "wSourceBase", x: 20, y: 75 },
      { id: "wGoal", x: 65, y: 75 },
      { id: "wGoalBase", x: 80, y: 75 },
      { id: "bSource", x: 35, y: 125 },
      { id: "bSourceBase", x: 20, y: 125 },
      { id: "bGoal", x: 65, y: 125 },
      { id: "bGoalBase", x: 80, y: 125 },
    ],
    edges: [
      { id: "cycle", u: "r", v: "c", w: 1, dir: "uv", owner: "neutral", charges: 2 },
      { id: "c-keep", u: "cBase", v: "c", w: 2, dir: "uv", owner: "neutral", charges: 0 },
      { id: "c-return", u: "cBase", v: "c", w: 2, dir: "vu", owner: "neutral", charges: 0 },
      { id: "r-keep", u: "r", v: "rBase", w: 2, dir: "uv", owner: "neutral", charges: 0 },
      { id: "r-return", u: "r", v: "rBase", w: 2, dir: "vu", owner: "neutral", charges: 0 },
      { id: "white-target", u: "wSource", v: "wGoal", w: 2, dir: "uv", owner: "white", charges: 1 },
      { id: "w-goal-keep", u: "wGoalBase", v: "wGoal", w: 2, dir: "uv", owner: "neutral", charges: 0 },
      { id: "w-goal-return", u: "wGoalBase", v: "wGoal", w: 2, dir: "vu", owner: "neutral", charges: 0 },
      { id: "w-source-keep", u: "wSource", v: "wSourceBase", w: 2, dir: "uv", owner: "neutral", charges: 0 },
      { id: "w-source-return", u: "wSource", v: "wSourceBase", w: 2, dir: "vu", owner: "neutral", charges: 0 },
      { id: "black-target", u: "bSource", v: "bGoal", w: 2, dir: "uv", owner: "black", charges: 1 },
      { id: "b-goal-keep", u: "bGoalBase", v: "bGoal", w: 2, dir: "uv", owner: "neutral", charges: 0 },
      { id: "b-goal-return", u: "bGoalBase", v: "bGoal", w: 2, dir: "vu", owner: "neutral", charges: 0 },
      { id: "b-source-keep", u: "bSource", v: "bSourceBase", w: 2, dir: "uv", owner: "neutral", charges: 0 },
      { id: "b-source-return", u: "bSource", v: "bSourceBase", w: 2, dir: "vu", owner: "neutral", charges: 0 },
    ],
    target: "white-target",
    targetB: "black-target",
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("battle AI: vs AI option appears in mode selection", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /id="battle-ai-mode-button"/);
  assert.match(html, /Vs AI/);
  assert.match(html, /Play White while Black answers automatically/);
});

test("battle AI: Black AI makes a legal automatic move", async () => {
  const boards = [];
  const statusEl = fakeEl();
  const boardEl = fakeEl();
  let aiState = null;
  const battle = createBattle({
    refs: { boardEl, statusEl, turnEl: fakeEl() },
    generate: () => duelFixture(),
    boardFactory: fakeBoardFactory(boards),
    vsAI: true,
    animationMs: 0,
    aiDelayMs: 120,
    chooseAIMove(state) {
      aiState = state;
      assert.equal(state.turn, "black");
      assert.equal(isLegalBattleFlip(state, "cycle"), true);
      return { edgeId: "cycle", thinkingTimeMs: 0 };
    },
  });

  const start = battle.start();
  battle.tap("cycle");
  assert.equal(start.turn, "white");
  assert.equal(battle.state.turn, "black");
  assert.equal(statusEl.classList.contains("thinking"), true);

  await wait(160);

  assert.ok(aiState, "AI chooser was called");
  assert.equal(battle.state.turn, "white");
  assert.equal(battle.state.history.at(-1).player, "black");
  assert.equal(boards[0].updates.length, 2);
  assert.equal(statusEl.classList.contains("thinking"), false);
  battle.destroy();
});

test("battle AI: turn order remains White, Black AI, White", async () => {
  const boards = [];
  const turnEl = fakeEl();
  const battle = createBattle({
    refs: { boardEl: fakeEl(), statusEl: fakeEl(), turnEl },
    generate: () => duelFixture(),
    boardFactory: fakeBoardFactory(boards),
    vsAI: true,
    animationMs: 0,
    aiDelayMs: 120,
    chooseAIMove: () => ({ edgeId: "cycle", thinkingTimeMs: 0 }),
  });

  battle.start();
  assert.equal(turnEl.textContent, "White");
  battle.tap("cycle");
  assert.equal(turnEl.textContent, "Black");
  await wait(160);

  assert.deepEqual(battle.state.history.map((move) => move.player), ["white", "black"]);
  assert.equal(turnEl.textContent, "White");
  assert.deepEqual(boards[0].legal.sort(), ["white-target"]);
  battle.destroy();
});

test("battle AI: automatic move waits before choosing and blocks input while thinking", async () => {
  const boards = [];
  const statusEl = fakeEl();
  let calledAt = null;
  const startedAt = Date.now();
  const battle = createBattle({
    refs: { boardEl: fakeEl(), statusEl, turnEl: fakeEl() },
    generate: () => duelFixture(),
    boardFactory: fakeBoardFactory(boards),
    vsAI: true,
    animationMs: 0,
    aiDelayMs: 120,
    chooseAIMove: () => {
      calledAt = Date.now();
      return { edgeId: "cycle", thinkingTimeMs: 0 };
    },
  });

  battle.start();
  battle.tap("cycle");
  battle.tap("black-target");
  await wait(60);

  assert.equal(calledAt, null, "AI should not move immediately");
  assert.equal(battle.state.turn, "black");
  assert.equal(boards[0].updates.length, 1);
  assert.equal(statusEl.textContent, "Black Thinking...");

  await wait(100);

  assert.ok(calledAt - startedAt >= 100, `AI moved after ${calledAt - startedAt}ms`);
  assert.equal(battle.state.turn, "white");
  assert.equal(boards[0].updates.length, 2);
  battle.destroy();
});

test("battle AI: hot-seat mode does not schedule AI", async () => {
  const boards = [];
  let aiCalled = false;
  const battle = createBattle({
    refs: { boardEl: fakeEl(), statusEl: fakeEl(), turnEl: fakeEl() },
    generate: () => duelFixture(),
    boardFactory: fakeBoardFactory(boards),
    animationMs: 0,
    aiDelayMs: 120,
    chooseAIMove: () => {
      aiCalled = true;
      return { edgeId: "cycle", thinkingTimeMs: 0 };
    },
  });

  battle.start();
  battle.tap("cycle");
  await wait(160);

  assert.equal(aiCalled, false);
  assert.equal(battle.state.turn, "black");
  assert.equal(boards[0].updates.length, 1);
  assert.deepEqual(boards[0].legal.sort(), ["black-target", "cycle"]);
  battle.destroy();
});

test("battle AI: destroy cancels pending AI turn and clears thinking state", async () => {
  const boards = [];
  const statusEl = fakeEl();
  const boardEl = fakeEl();
  let aiCalled = false;
  const battle = createBattle({
    refs: { boardEl, statusEl, turnEl: fakeEl() },
    generate: () => duelFixture(),
    boardFactory: fakeBoardFactory(boards),
    vsAI: true,
    animationMs: 0,
    aiDelayMs: 120,
    chooseAIMove: () => {
      aiCalled = true;
      return { edgeId: "cycle", thinkingTimeMs: 0 };
    },
  });

  battle.start();
  battle.tap("cycle");
  assert.equal(statusEl.textContent, "Black Thinking...");
  assert.equal(statusEl.classList.contains("thinking"), true);

  battle.destroy();
  await wait(160);

  assert.equal(aiCalled, false, "destroyed Battle vs AI does not run the queued AI chooser");
  assert.equal(statusEl.classList.contains("thinking"), false, "destroy clears thinking chrome");
  assert.equal(boards[0].destroyed, true, "destroy tears down the active board");
});
