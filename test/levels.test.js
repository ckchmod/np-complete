import { test } from "node:test";
import assert from "node:assert/strict";

import { makeConfig, inflow, isLegalFlip } from "../src/engine.js";
import { bfsSolve, nonTrivialityReport } from "../src/solver.js";
import { allMetrics } from "../src/difficultyMetrics.js";
import { TUTORIALS, THE_LOCK, THE_LOCK_V2, LEVELS } from "../src/levels.js";

// ---------------------------------------------------------------------------
// Exports / shape
// ---------------------------------------------------------------------------

test("TUTORIALS is an array of 6 levels", () => {
  assert.ok(Array.isArray(TUTORIALS));
  assert.equal(TUTORIALS.length, 6);
});

test("LEVELS is the tutorials followed by THE LOCK and THE LOCK V2", () => {
  assert.deepEqual(LEVELS, [...TUTORIALS, THE_LOCK, THE_LOCK_V2]);
  assert.equal(LEVELS.length, 8);
});

test("every level conforms to the engine Level shape", () => {
  for (const level of LEVELS) {
    assert.equal(typeof level.id, "string", `${level.id}: id`);
    assert.equal(typeof level.name, "string", `${level.id}: name`);
    assert.equal(typeof level.par, "number", `${level.id}: par is numeric`);
    assert.ok(Array.isArray(level.nodes) && level.nodes.length > 0, `${level.id}: nodes`);
    assert.ok(Array.isArray(level.edges) && level.edges.length > 0, `${level.id}: edges`);

    const nodeIds = new Set();
    for (const n of level.nodes) {
      assert.equal(typeof n.id, "string", `${level.id}: node id`);
      assert.equal(typeof n.x, "number", `${level.id}: node ${n.id} x`);
      assert.equal(typeof n.y, "number", `${level.id}: node ${n.id} y`);
      assert.ok(!nodeIds.has(n.id), `${level.id}: duplicate node id ${n.id}`);
      nodeIds.add(n.id);
    }

    const edgeIds = new Set();
    for (const e of level.edges) {
      assert.equal(typeof e.id, "string", `${level.id}: edge id`);
      assert.ok(!edgeIds.has(e.id), `${level.id}: duplicate edge id ${e.id}`);
      edgeIds.add(e.id);
      assert.ok(nodeIds.has(e.u), `${level.id}: edge ${e.id} u=${e.u} is a node`);
      assert.ok(nodeIds.has(e.v), `${level.id}: edge ${e.id} v=${e.v} is a node`);
      assert.ok(e.w === 1 || e.w === 2, `${level.id}: edge ${e.id} weight in {1,2}`);
      assert.ok(e.dir === "uv" || e.dir === "vu", `${level.id}: edge ${e.id} dir`);
    }

    assert.ok(edgeIds.has(level.target), `${level.id}: target ${level.target} is an edge`);
  }
});

// ---------------------------------------------------------------------------
// Legal start: makeConfig accepts every level (every node inflow >= 2)
// ---------------------------------------------------------------------------

test("every level has a legal start orientation", () => {
  for (const level of LEVELS) {
    // makeConfig throws if any node inflow < 2.
    const config = makeConfig(level);
    for (const node of level.nodes) {
      assert.ok(
        inflow(config, node.id) >= 2,
        `${level.id}: node ${node.id} starts with inflow < 2`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Layout: portrait viewBox 100 x 160, no overlapping nodes (readable on a phone)
// ---------------------------------------------------------------------------

test("nodes lie within the portrait viewBox (width 100, height 160)", () => {
  for (const level of LEVELS) {
    for (const n of level.nodes) {
      assert.ok(n.x >= 0 && n.x <= 100, `${level.id}: node ${n.id} x out of [0,100]`);
      assert.ok(n.y >= 0 && n.y <= 160, `${level.id}: node ${n.id} y out of [0,160]`);
    }
  }
});

test("no two nodes overlap within a level", () => {
  const MIN_GAP = 6; // readable separation on a phone-sized board
  for (const level of LEVELS) {
    for (let i = 0; i < level.nodes.length; i++) {
      for (let j = i + 1; j < level.nodes.length; j++) {
        const a = level.nodes[i];
        const b = level.nodes[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        assert.ok(
          d >= MIN_GAP,
          `${level.id}: nodes ${a.id} and ${b.id} too close (d=${d.toFixed(2)})`
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Exactly one target edge (the level's `target`)
// ---------------------------------------------------------------------------

test("every level designates exactly one target edge", () => {
  for (const level of LEVELS) {
    const matches = level.edges.filter((e) => e.id === level.target);
    assert.equal(matches.length, 1, `${level.id}: target must name exactly one edge`);
  }
});

test("every authored level is connected to its target component", () => {
  for (const level of LEVELS) {
    const targetEdge = level.edges.find((edge) => edge.id === level.target);
    const adjacent = new Map(level.nodes.map((node) => [node.id, []]));
    for (const edge of level.edges) {
      adjacent.get(edge.u).push(edge.v);
      adjacent.get(edge.v).push(edge.u);
    }
    const seen = new Set([targetEdge.u, targetEdge.v]);
    const queue = [targetEdge.u, targetEdge.v];
    while (queue.length) {
      const nodeId = queue.shift();
      for (const next of adjacent.get(nodeId)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }

    assert.deepEqual(
      level.nodes.map((node) => node.id).filter((nodeId) => !seen.has(nodeId)),
      [],
      `${level.id}: disconnected nodes are not honest target-puzzle topology`
    );
  }
});

// ---------------------------------------------------------------------------
// Solvability + par == solver optimal
// ---------------------------------------------------------------------------

test("every tutorial is solvable", () => {
  for (const level of TUTORIALS) {
    const { solvable } = bfsSolve(level);
    assert.ok(solvable, `${level.id}: not solvable`);
  }
});

test("THE LOCK is solvable", () => {
  const { solvable } = bfsSolve(THE_LOCK);
  assert.ok(solvable);
});

test("each level's par equals the solver's optimal length", () => {
  for (const level of LEVELS) {
    const { solvable, optimalLength } = bfsSolve(level);
    assert.ok(solvable, `${level.id}: not solvable`);
    assert.equal(
      level.par,
      optimalLength,
      `${level.id}: par ${level.par} != solver optimal ${optimalLength}`
    );
  }
});

// ---------------------------------------------------------------------------
// THE LOCK non-triviality gates (spec §7)
// ---------------------------------------------------------------------------

test("THE LOCK: target is NOT flippable on move 1 (gate 2)", () => {
  const start = makeConfig(THE_LOCK);
  assert.equal(isLegalFlip(start, THE_LOCK.target), false);
});

test("THE LOCK: optimal length is in the gamifiable band (gate 3: 12 <= L <= 30)", () => {
  const { optimalLength } = bfsSolve(THE_LOCK);
  assert.ok(optimalLength >= 12, `optimal ${optimalLength} < 12`);
  assert.ok(optimalLength <= 30, `optimal ${optimalLength} > 30`);
});

test("THE LOCK: backtracking is required (gate 4: greedy cannot reach the goal)", () => {
  const report = nonTrivialityReport(THE_LOCK);
  assert.ok(report.solvable);
  assert.ok(report.notTrivialMove1);
  assert.ok(report.backtrackingRequired, "greedy hill-climb reached the goal; no backtracking forced");
});

test("THE LOCK: reachableCount is the full reachable-component size (spec §14 bound)", () => {
  // bfsSolve runs to exhaustion, so reachableCount is the count of ALL distinct
  // legal configs reachable from the start — not just those seen before the goal.
  const { reachableCount, exhausted } = bfsSolve(THE_LOCK);
  assert.equal(exhausted, false, "BFS hit the state cap; component size is only a lower bound");
  assert.equal(reachableCount, 92, "reachable component should be 92 states (matches levels.js)");
});

test("THE LOCK V2: config validates and starts legal", () => {
  const config = makeConfig(THE_LOCK_V2);
  for (const node of THE_LOCK_V2.nodes) {
    assert.ok(inflow(config, node.id) >= 2, `node ${node.id} starts below inflow 2`);
  }
});

test("THE LOCK V2: solver gates match flagship targets", () => {
  const report = nonTrivialityReport(THE_LOCK_V2);
  assert.ok(report.solvable);
  assert.equal(report.optimalLength, THE_LOCK_V2.par);
  assert.ok(report.optimalLength >= 40, `optimal ${report.optimalLength} < 40`);
  assert.ok(report.optimalLength <= 60, `optimal ${report.optimalLength} > 60`);
  assert.ok(report.reachableCount >= 10_000, `reachable ${report.reachableCount} < 10000`);
  assert.ok(report.notTrivialMove1, "target should not be flippable on move 1");
  assert.ok(report.backtrackingRequired, "greedy hill-climb reached the goal; no backtracking forced");
});

test("THE LOCK V2: resource contention appears on shortest paths", () => {
  const metrics = allMetrics(THE_LOCK_V2);
  assert.equal(metrics.partial, false);
  assert.ok(metrics.contentionScore > 0, "expected shared critical edges on shortest paths");
  assert.ok(metrics.resourceContention > 0, "expected target-slack contention along shortest paths");
});
