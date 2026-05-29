import { test } from "node:test";
import assert from "node:assert/strict";

import { makeConfig, inflow, legalFlips, applyFlip } from "../src/engine.js";
import { bfsSolve } from "../src/solver.js";
import {
  buildBattery,
  buildCyclePump,
  buildLatch,
  buildMutex,
  buildSharedReservoir,
} from "../src/gadgetBuilders.js";

const builders = [
  ["latch", buildLatch],
  ["mutex", buildMutex],
  ["cyclePump", buildCyclePump],
  ["battery", buildBattery],
  ["sharedReservoir", buildSharedReservoir],
];

function reachableStates(level) {
  const start = makeConfig(level);
  const key = (config) => level.edges.map((edge) => config.dirs.get(edge.id)).join("|");
  const seen = new Set([key(start)]);
  const queue = [start];
  const states = [];
  while (queue.length > 0) {
    const config = queue.shift();
    states.push(config);
    for (const edgeId of legalFlips(config)) {
      const next = applyFlip(config, edgeId);
      const nextKey = key(next);
      if (!seen.has(nextKey)) {
        seen.add(nextKey);
        queue.push(next);
      }
    }
  }
  return states;
}

function hasUndirectedCycle(level) {
  const parent = new Map();
  const rank = new Map();
  for (const node of level.nodes) {
    parent.set(node.id, node.id);
    rank.set(node.id, 0);
  }
  const find = (node) => {
    if (parent.get(node) !== node) parent.set(node, find(parent.get(node)));
    return parent.get(node);
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return false;
    if (rank.get(rootA) < rank.get(rootB)) parent.set(rootA, rootB);
    else if (rank.get(rootA) > rank.get(rootB)) parent.set(rootB, rootA);
    else {
      parent.set(rootB, rootA);
      rank.set(rootA, rank.get(rootA) + 1);
    }
    return true;
  };
  return level.edges.some((edge) => !union(edge.u, edge.v));
}

test("exports deterministic gadget builder functions", () => {
  for (const [, builder] of builders) assert.equal(typeof builder, "function");
  assert.deepEqual(buildLatch(), buildLatch());
  assert.notDeepEqual(buildLatch(), buildLatch("altLatch"));
});

test("standalone gadgets are legal, small, weighted NCL fixtures with metadata", () => {
  for (const [kind, builder] of builders) {
    const level = builder();
    const config = makeConfig(level);
    assert.equal(level.metadata.kind, kind);
    assert.ok(level.nodes.length <= 12, `${kind} node count`);
    assert.ok(level.edges.length <= 15, `${kind} edge count`);
    assert.ok(level.edges.some((edge) => edge.id === level.target), `${kind} target exists`);
    assert.deepEqual(level.metadata.nodeIds, level.nodes.map((node) => node.id));
    assert.deepEqual(level.metadata.edgeIds, level.edges.map((edge) => edge.id));
    assert.equal(level.metadata.targetEdgeId, level.target);
    assert.ok(level.metadata.notes.length > 0, `${kind} notes describe integration ports`);
    for (const edge of level.edges) assert.ok(edge.w === 1 || edge.w === 2, `${edge.id} has allowed weight`);
    for (const node of level.nodes) assert.ok(inflow(config, node.id) >= 2, `${node.id} starts legal`);
    const result = bfsSolve(level);
    assert.equal(result.solvable, true, `${kind} target is solvable`);
    assert.equal(result.exhausted, false, `${kind} BFS is bounded`);
  }
});

test("latch requires opening its unlock port before the target can move", () => {
  const level = buildLatch();
  const config = makeConfig(level);
  const { unlock, output } = level.metadata.portEdgeIds;
  assert.equal(legalFlips(config).includes(output), false);
  const unlocked = applyFlip(config, unlock);
  assert.equal(legalFlips(unlocked).includes(output), true);
  assert.equal(bfsSolve(level).optimalLength, 2);
});

test("mutex never allows both named ports to be open in reachable states", () => {
  const level = buildMutex();
  const { left, right } = level.metadata.portEdgeIds;
  let leftOpen = 0;
  let rightOpen = 0;
  for (const config of reachableStates(level)) {
    const isLeftOpen = config.dirs.get(left) !== config.edgeById.get(left).dir;
    const isRightOpen = config.dirs.get(right) !== config.edgeById.get(right).dir;
    if (isLeftOpen) leftOpen++;
    if (isRightOpen) rightOpen++;
    assert.equal(isLeftOpen && isRightOpen, false, "mutex ports are mutually exclusive");
  }
  assert.ok(leftOpen > 0, "left port is reachable");
  assert.ok(rightOpen > 0, "right port is reachable");
});

test("cyclePump includes a detectable graph cycle and a routable pump edge", () => {
  const level = buildCyclePump();
  assert.equal(hasUndirectedCycle(level), true);
  assert.ok(legalFlips(makeConfig(level)).includes(level.metadata.portEdgeIds.pump));
});

test("battery exposes two independently routable outputs", () => {
  const level = buildBattery();
  const [outputA, outputB] = level.metadata.portEdgeIds.outputs;
  let config = makeConfig(level);
  assert.ok(legalFlips(config).includes(outputA));
  assert.ok(legalFlips(config).includes(outputB));
  config = applyFlip(config, outputA);
  assert.ok(legalFlips(config).includes(outputB));
});

test("sharedReservoir routes both thin outputs from the same legal reservoir", () => {
  const level = buildSharedReservoir();
  const [left, right] = level.metadata.portEdgeIds.outputs;
  let config = makeConfig(level);
  config = applyFlip(config, left);
  config = applyFlip(config, right);
  for (const node of level.nodes) assert.ok(inflow(config, node.id) >= 2, `${node.id} remains legal`);
});
