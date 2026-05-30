import { test } from "node:test";
import assert from "node:assert/strict";

import { THE_LOCK, TUTORIALS } from "../src/levels.js";
import { makeConfig } from "../src/engine.js";
import { allMetrics, basicMetrics, cycleRank, isNonmonotonic, targetSlack } from "../src/difficultyMetrics.js";

const SIMPLE_CHAIN = TUTORIALS[2];
const SHUTTLE = TUTORIALS[5];
const TREE_TOPOLOGY = {
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
  edges: [
    { id: "ab", u: "a", v: "b" },
    { id: "bc", u: "b", v: "c" },
    { id: "bd", u: "b", v: "d" },
  ],
};

test("basicMetrics returns the expected core metrics for THE_LOCK", () => {
  const metrics = basicMetrics(THE_LOCK);

  assert.equal(metrics.reachableCount, 92);
  assert.equal(metrics.diameter, 27);
  assert.ok(metrics.diameter >= 16);
  assert.ok(metrics.branchingFactor >= 1.0);
  assert.equal(metrics.goalCount, 28);
  assert.equal(metrics.shortestPathCount, 264);
  assert.equal(metrics.deadEndCount, 0);
  assert.equal(metrics.par, 16);
  assert.equal(metrics.partial, false);
});

test("basicMetrics counts all solved states and distinct shortest paths", () => {
  const metrics = basicMetrics(TUTORIALS[4]);

  assert.equal(metrics.goalCount, 96);
  assert.equal(metrics.shortestPathCount, 2);
  assert.equal(metrics.par, 2);
  assert.equal(metrics.partial, false);
});

test("basicMetrics marks traversal as partial when capped", () => {
  const metrics = basicMetrics(THE_LOCK, { cap: 1 });

  assert.equal(metrics.partial, true);
  assert.equal(metrics.par, null);
  assert.equal(metrics.shortestPathCount, null);
  assert.equal(metrics.goalCount, null);
  assert.ok(metrics.reachableCount < 92);
});

test("allMetrics preserves core THE_LOCK metrics and reports advanced difficulty", () => {
  const metrics = allMetrics(THE_LOCK);

  assert.equal(metrics.reachableCount, 92);
  assert.equal(metrics.goalCount, 28);
  assert.equal(metrics.shortestPathCount, 264);
  assert.equal(metrics.par, 16);
  assert.equal(metrics.partial, false);
  assert.ok(metrics.bottleneckCount >= 1);
  assert.equal(metrics.mandatoryRepeatedFlips, true);
  assert.equal(metrics.resourceContention, 1);
  assert.equal(metrics.nonmonotonicity, true);
  assert.ok(metrics.cycleRank > 0);
});

test("shuttle tutorial has mandatory repeated flips and nonmonotonic target slack", () => {
  const metrics = allMetrics(SHUTTLE);

  assert.equal(metrics.par, 7);
  assert.equal(metrics.mandatoryRepeatedFlips, true);
  assert.equal(metrics.nonmonotonicity, true);
  assert.equal(metrics.resourceContention, 1);
  assert.ok(metrics.bottleneckCount >= 1);
});

test("simple slack chain has no mandatory repeat or nonmonotonic move", () => {
  const metrics = allMetrics(SIMPLE_CHAIN);

  assert.equal(metrics.par, 2);
  assert.equal(metrics.mandatoryRepeatedFlips, false);
  assert.equal(metrics.nonmonotonicity, false);
  assert.equal(metrics.resourceContention, 0);
});

test("cycleRank distinguishes tree-like and cyclic board topology", () => {
  assert.equal(cycleRank(TREE_TOPOLOGY), 0);
  assert.ok(cycleRank(THE_LOCK) > 0);
});

test("allMetrics includes cycleRank without changing basicMetrics", () => {
  const metrics = allMetrics(THE_LOCK);

  assert.equal(metrics.cycleRank, cycleRank(THE_LOCK));
  assert.equal(Object.hasOwn(basicMetrics(THE_LOCK), "cycleRank"), false);
});

test("targetSlack reads slack at the target edge receiver", () => {
  assert.equal(targetSlack(makeConfig(TUTORIALS[2])), 1);
  assert.equal(targetSlack(makeConfig(TUTORIALS[5])), 1);
});

test("isNonmonotonic reports the shortest-path slack property", () => {
  assert.equal(isNonmonotonic(TUTORIALS[5]), true);
  assert.equal(isNonmonotonic(TUTORIALS[2]), false);
});

test("allMetrics marks advanced metrics conservative when capped", () => {
  const metrics = allMetrics(THE_LOCK, { cap: 1 });

  assert.equal(metrics.partial, true);
  assert.equal(metrics.par, null);
  assert.equal(metrics.goalCount, null);
  assert.equal(metrics.shortestPathCount, null);
  assert.equal(metrics.mandatoryRepeatedFlips, false);
  assert.equal(metrics.nonmonotonicity, false);
  assert.equal(metrics.bottleneckCount, 0);
  assert.equal(metrics.resourceContention, 0);
});
