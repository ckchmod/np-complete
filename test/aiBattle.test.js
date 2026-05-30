import { test } from "node:test";
import assert from "node:assert/strict";

import { chooseMove } from "../src/aiBattle.js";
import { applyBattleFlip, isLegalBattleFlip, makeBattleConfig } from "../src/battleEngine.js";
import { legalBattleFlips } from "../src/battle.js";

function immediateWinFixture() {
  return {
    id: "ai-immediate-win",
    name: "AI immediate win",
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
    id: "ai-no-move-loss",
    name: "AI no move loss",
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

function makeCycleRng(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

function makeQueueRng(values) {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

function assertLegalChoice(state, choice) {
  assert.ok(choice, "expected a move choice");
  assert.equal(typeof choice.edgeId, "string");
  assert.equal(typeof choice.thinkingTimeMs, "number");
  assert.equal(isLegalBattleFlip(state, choice.edgeId), true, `${choice.edgeId} should be legal`);
}

test("ai battle level 1 always picks a legal move", () => {
  const state = makeBattleConfig(immediateWinFixture(), 2, "white");
  for (let i = 0; i < 100; i++) {
    assertLegalChoice(state, chooseMove(state, 1, { rng: makeCycleRng([i / 100]) }));
  }
});

test("ai battle level 1 has a statistical target bias", () => {
  const state = makeBattleConfig(immediateWinFixture(), 2, "white");
  const legalMoves = legalBattleFlips(state);
  assert.ok(legalMoves.includes(state.level.target));

  let targetPicks = 0;
  const values = [];
  for (let i = 0; i < 160; i++) values.push(0.1);
  for (let i = 0; i < 240; i++) values.push(0.9, 0.9);
  const rng = makeQueueRng(values);
  for (let i = 0; i < 400; i++) {
    if (chooseMove(state, 1, { rng }).edgeId === state.level.target) targetPicks++;
  }

  assert.ok(targetPicks >= 120, `target picked ${targetPicks} times`);
});

test("ai battle level 2 completes within 500ms", () => {
  const state = makeBattleConfig(immediateWinFixture(), 2, "white");
  const started = performance.now();
  const choice = chooseMove(state, 2, { rng: makeCycleRng([0.7]) });
  const elapsed = performance.now() - started;

  assertLegalChoice(state, choice);
  assert.ok(choice.thinkingTimeMs < 500, `reported ${choice.thinkingTimeMs}ms`);
  assert.ok(elapsed < 500, `elapsed ${elapsed}ms`);
});

test("ai battle level 3 falls back to a legal move when the solver cap is hit", () => {
  const state = makeBattleConfig(immediateWinFixture(), 2, "white");
  const choice = chooseMove(state, 3, { fullMaxStates: 0, shallowMaxStates: 0, rng: makeCycleRng([0.4]) });

  assertLegalChoice(state, choice);
  assert.ok(choice.thinkingTimeMs < 2000, `reported ${choice.thinkingTimeMs}ms`);
});

test("ai battle level 4 makes configured mistakes from the best move", () => {
  const state = makeBattleConfig(immediateWinFixture(), 2, "white");
  const values = [];
  for (let i = 0; i < 15; i++) values.push(0.1, 0.7);
  for (let i = 0; i < 85; i++) values.push(0.9);
  const rng = makeQueueRng(values);
  let mistakes = 0;

  for (let i = 0; i < 100; i++) {
    const choice = chooseMove(state, 4, { mistakeRate: 0.15, rng });
    assertLegalChoice(state, choice);
    if (choice.edgeId !== state.level.target) mistakes++;
  }

  assert.equal(mistakes, 15);
});

test("ai battle never chooses illegal moves at any difficulty", () => {
  const state = makeBattleConfig(immediateWinFixture(), 2, "white");
  for (const difficulty of [1, 2, 3, 4]) {
    for (let i = 0; i < 20; i++) {
      assertLegalChoice(state, chooseMove(state, difficulty, { rng: makeCycleRng([0.2, 0.8]) }));
    }
  }
});

test("ai battle handles terminal states gracefully", () => {
  const won = applyBattleFlip(makeBattleConfig(immediateWinFixture(), 2, "white"), "tg");
  const noMoves = makeBattleConfig(noMoveLossFixture(), 2, "white");

  for (const difficulty of [1, 2, 3, 4]) {
    assert.equal(chooseMove(won, difficulty), null);
    assert.equal(chooseMove(noMoves, difficulty), null);
  }
});
