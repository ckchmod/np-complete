import { test } from "node:test";
import assert from "node:assert/strict";

import { makeBattleConfig } from "../src/battleEngine.js";
import {
  BATTLE_BALANCE_THRESHOLDS,
  BATTLE_FIRST_PLAYER_BIAS_THRESHOLD,
  BATTLE_MAX_EDGES,
  BATTLE_MAX_NODES,
  decorateBattleLevel,
  desiredBattleOutcome,
  evaluateBattle,
  generateBattle,
  hasFirstMoveWin,
} from "../src/battleGenerator.js";
import { generateLock, makeRng } from "../src/generator.js";

test("generateBattle is deterministic for a given seed", () => {
  assert.deepEqual(generateBattle({ seed: 12 }), generateBattle({ seed: 12 }));
});

test("generated battle boards stay under phone caps and carry battle metadata", () => {
  const level = generateBattle({ seed: 21 });

  assert.ok(level.nodes.length <= BATTLE_MAX_NODES);
  assert.ok(level.edges.length <= BATTLE_MAX_EDGES);
  assert.ok(level.target);
  assert.ok(level.targetB);
  assert.notEqual(level.target, level.targetB);
  assert.equal(level.battle.owners[level.target], "white");
  assert.equal(level.battle.owners[level.targetB], "black");
  assert.ok(Object.values(level.battle.owners).includes("neutral"));
  assert.ok(Object.values(level.battle.owners).includes("white"));
  assert.ok(Object.values(level.battle.owners).includes("black"));
  assert.ok(Object.values(level.battle.charges).every((charges) => charges === 3));
});

test("generated boards are compatible with makeBattleConfig and minimax", () => {
  const level = generateBattle({ seed: 32 });
  const state = makeBattleConfig(level);
  const evaluation = evaluateBattle(level);

  assert.equal(state.level.targetB, level.targetB);
  assert.equal(evaluation.partial, false);
  assert.equal(evaluation.passed, true);
  assert.ok(evaluation.distanceToWin >= BATTLE_BALANCE_THRESHOLDS.minDistanceToWin);
  assert.ok(evaluation.distanceToWin <= BATTLE_BALANCE_THRESHOLDS.maxDistanceToWin);
  assert.ok(evaluation.branchingFactor >= BATTLE_BALANCE_THRESHOLDS.minBranchingFactor);
  assert.ok(evaluation.checkingMoves >= BATTLE_BALANCE_THRESHOLDS.minCheckingMoves);
  assert.ok(evaluation.defensiveReplies >= BATTLE_BALANCE_THRESHOLDS.minDefensiveReplies);
  assert.ok(evaluation.zugzwangStates >= BATTLE_BALANCE_THRESHOLDS.minZugzwangStates);
  assert.ok(evaluation.chargeTension >= BATTLE_BALANCE_THRESHOLDS.minChargeTension);
});

test("deterministic sample has no first-move or shallow wins", () => {
  for (let seed = 100; seed < 112; seed++) {
    const level = generateBattle({ seed });
    const evaluation = evaluateBattle(level);

    assert.equal(hasFirstMoveWin(level), false, `seed ${seed} must not be a first-move win`);
    assert.equal(evaluation.partial, false, `seed ${seed} should fully solve`);
    assert.ok(evaluation.distanceToWin >= BATTLE_BALANCE_THRESHOLDS.minDistanceToWin,
      `seed ${seed} distance ${evaluation.distanceToWin}`);
  }
});

test("deterministic batch satisfies first-player bias threshold", () => {
  const counts = { white: 0, black: 0 };
  const sampleSize = 50;

  for (let offset = 0; offset < sampleSize; offset++) {
    const seed = 3000 + offset;
    const level = generateBattle({ seed });
    const evaluation = evaluateBattle(level);

    assert.equal(evaluation.passed, true, `seed ${seed} should pass balance thresholds`);
    assert.equal(evaluation.outcome, desiredBattleOutcome(seed), `seed ${seed} should match desired outcome`);
    assert.equal(evaluation.outcome, level.battle.diagnostics.desiredOutcome);
    counts[evaluation.outcome]++;
  }

  const bias = Math.abs(counts.white - counts.black) / sampleSize;
  assert.ok(bias < BATTLE_FIRST_PLAYER_BIAS_THRESHOLD,
    `first-player bias ${bias} from ${JSON.stringify(counts)}`);
});

test("fallback path remains solver-checked and non-trivial", () => {
  const level = generateBattle({ seed: 5, maxAttempts: 0 });
  const evaluation = evaluateBattle(level);

  assert.equal(level.battle.diagnostics.fallback, true);
  assert.equal(evaluation.partial, false);
  assert.equal(hasFirstMoveWin(level), false);
  assert.ok(evaluation.distanceToWin >= BATTLE_BALANCE_THRESHOLDS.minDistanceToWin);
});

test("decorateBattleLevel exposes edge fields and level battle metadata", () => {
  const base = generateLock(1, makeRng(7));
  const decorated = decorateBattleLevel(base, "e1");

  assert.equal(decorated.targetB, "e1");
  for (const edge of decorated.edges) {
    assert.equal(edge.owner, decorated.battle.owners[edge.id]);
    assert.equal(edge.charges, decorated.battle.charges[edge.id]);
  }
});
