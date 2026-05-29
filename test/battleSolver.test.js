import { test } from "node:test";
import assert from "node:assert/strict";

import { applyBattleFlip, makeBattleConfig } from "../src/battleEngine.js";
import { minimax } from "../src/battleSolver.js";

function immediateWinFixture() {
  return {
    id: "battle-immediate-win",
    name: "battle immediate win",
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

function noMoveLossFixture() {
  return {
    id: "battle-no-move-loss",
    name: "battle no move loss",
    nodes: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 1, y: 0 },
    ],
    edges: [
      { id: "e0", u: "a", v: "b", w: 2, dir: "uv", owner: "white" },
      { id: "e1", u: "a", v: "b", w: 2, dir: "vu", owner: "white" },
    ],
    target: "e0",
    targetB: "e1",
  };
}

function contestedFixture() {
  return {
    id: "battle-contested",
    name: "battle contested",
    nodes: [
      { id: "c", x: 1, y: 1 },
      { id: "L", x: 0, y: 1 },
      { id: "R", x: 2, y: 1 },
      { id: "xa", x: 0, y: 0 },
      { id: "xb", x: 2, y: 0 },
    ],
    edges: [
      { id: "t", u: "L", v: "c", w: 2, dir: "uv", owner: "white", charges: 1 },
      { id: "s", u: "R", v: "c", w: 1, dir: "uv", owner: "neutral", charges: 1 },
      { id: "la", u: "L", v: "xa", w: 2, dir: "uv", owner: "neutral", charges: 1 },
      { id: "al", u: "L", v: "xa", w: 2, dir: "vu", owner: "neutral", charges: 1 },
      { id: "rb", u: "R", v: "xb", w: 2, dir: "uv", owner: "black", charges: 1 },
      { id: "br", u: "R", v: "xb", w: 2, dir: "vu", owner: "black", charges: 1 },
    ],
    target: "t",
    targetB: "rb",
  };
}

function forcedLossFixture() {
  return {
    id: "battle-forced-loss",
    name: "battle forced loss",
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
      { id: "p1", u: "x1", v: "g", w: 1, dir: "uv", owner: "black", charges: 1 },
      { id: "p2", u: "x2", v: "g", w: 1, dir: "uv", owner: "neutral", charges: 1 },
      { id: "tg", u: "g", v: "y", w: 2, dir: "vu", owner: "white", charges: 0 },
      { id: "xp", u: "x1", v: "p", w: 2, dir: "uv", owner: "neutral", charges: 1 },
      { id: "px", u: "x1", v: "p", w: 2, dir: "vu", owner: "neutral", charges: 1 },
      { id: "xq", u: "x2", v: "q", w: 2, dir: "uv", owner: "neutral", charges: 1 },
      { id: "qx", u: "x2", v: "q", w: 2, dir: "vu", owner: "neutral", charges: 1 },
      { id: "yr", u: "y", v: "r", w: 2, dir: "uv", owner: "neutral", charges: 1 },
      { id: "ry", u: "y", v: "r", w: 2, dir: "vu", owner: "neutral", charges: 1 },
    ],
    target: "tg",
    targetB: "p1",
  };
}

test("minimax finds a deterministic immediate first-player win", () => {
  const state = makeBattleConfig(immediateWinFixture(), 2);
  const result = minimax(state);

  assert.equal(result.outcome, "white");
  assert.equal(result.distanceToWin, 1);
  assert.equal(result.partial, false);
  assert.ok(result.checkingMoves >= 1);
  assert.ok(result.branchingFactor > 0);
});

test("minimax treats an already reversed white target as terminal", () => {
  const state = makeBattleConfig(immediateWinFixture(), 2, "white");
  const won = applyBattleFlip(state, "tg");
  const result = minimax(won);

  assert.equal(result.outcome, "white");
  assert.equal(result.distanceToWin, 0);
  assert.equal(result.partial, false);
  assert.equal(result.statesEvaluated, 0);
  assert.equal(result.branchingFactor, 0);
});

test("minimax finds a deterministic immediate black win when black moves first", () => {
  const state = makeBattleConfig(immediateWinFixture(), 2, "black");
  const result = minimax(state);

  assert.equal(result.outcome, "black");
  assert.equal(result.distanceToWin, 1);
  assert.equal(result.partial, false);
  assert.ok(result.checkingMoves >= 1);
});

test("minimax reports a deterministic first-player no-move loss", () => {
  const state = makeBattleConfig(noMoveLossFixture(), 2);
  const result = minimax(state);

  assert.equal(result.outcome, "black");
  assert.equal(result.distanceToWin, 0);
  assert.equal(result.partial, false);
  assert.equal(result.zugzwangStates, 0);
});

test("minimax reports a deterministic first-player loss after a forced move", () => {
  const state = makeBattleConfig(forcedLossFixture(), 2, "white");
  const result = minimax(state);

  assert.equal(result.outcome, "black");
  assert.equal(result.distanceToWin, 2);
  assert.equal(result.partial, false);
  assert.equal(result.branchingFactor, 1);
});

test("minimax counts a real zugzwang state when every legal move loses", () => {
  const state = makeBattleConfig(forcedLossFixture(), 2, "white");
  const result = minimax(state);

  assert.equal(result.outcome, "black");
  assert.ok(result.zugzwangStates > 0);
  assert.equal(result.cacheMisses, 2);
});

test("minimax exposes stable balance metrics", () => {
  const state = makeBattleConfig(contestedFixture(), 2);
  const result = minimax(state);

  assert.equal(typeof result.defensiveReplies, "number");
  assert.equal(typeof result.zugzwangStates, "number");
  assert.equal(typeof result.chargeTension, "number");
  assert.equal(typeof result.slackTension, "number");
  assert.ok(result.chargeTension >= 1);
  assert.ok(result.slackTension >= 1);
  assert.ok(result.cacheMisses >= 1);
  assert.ok(result.statesEvaluated >= 1);
});

test("minimax cache keys include turn so opposite players solve independently", () => {
  const memo = new Map();
  const white = minimax(makeBattleConfig(immediateWinFixture(), 2, "white"), { memo });
  const black = minimax(makeBattleConfig(immediateWinFixture(), 2, "black"), { memo });

  assert.equal(white.outcome, "white");
  assert.equal(black.outcome, "black");
  assert.ok(memo.size >= 2);
  assert.ok(black.cacheMisses > 0);
});

test("minimax reuses an explicit memo table for repeated calls", () => {
  const state = makeBattleConfig(immediateWinFixture(), 2);
  const memo = new Map();
  const first = minimax(state, { memo });
  const second = minimax(state, { memo });

  assert.equal(first.outcome, "white");
  assert.equal(second.outcome, "white");
  assert.ok(first.cacheMisses > 0);
  assert.equal(second.cacheMisses, 0);
  assert.ok(second.cacheHits > first.cacheHits);
});

test("minimax flags partial results when the state cap is hit", () => {
  const state = makeBattleConfig(immediateWinFixture(), 2);
  const result = minimax(state, { maxStates: 1 });

  assert.equal(result.partial, true);
  assert.equal(result.outcome, null);
  assert.equal(result.distanceToWin, null);
  assert.equal(result.stateCap, 1);
});

test("minimax reports an immediate partial result when cap is zero", () => {
  const result = minimax(makeBattleConfig(forcedLossFixture(), 2), { maxStates: 0 });

  assert.equal(result.partial, true);
  assert.equal(result.outcome, null);
  assert.equal(result.statesEvaluated, 0);
  assert.equal(result.memoSize, 0);
});
