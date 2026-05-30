import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConfig, inflow, isLegalFlip } from "../src/engine.js";
import { basicMetrics, allMetrics } from "../src/difficultyMetrics.js";
import { bfsSolve, nonTrivialityReport } from "../src/solver.js";
import {
  GENERATED_GADGET_THRESHOLDS,
  difficultyPlan,
  generateLock,
  makeRng,
} from "../src/generator.js";

const newGadgetHeads = new Set(["latch", "mutex", "cyclePump", "battery", "sharedReservoir"]);

function hasNonRigidUndirectedCycle(level) {
  const parent = new Map(level.nodes.map((node) => [node.id, node.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return false;
    parent.set(ra, rb);
    return true;
  };
  const seenPairs = new Set();
  for (const edge of level.edges) {
    const key = [edge.u, edge.v].sort().join("|");
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    if (!union(edge.u, edge.v)) return true;
  }
  return false;
}

function sequenceSummary(difficulty, seed, count) {
  const rng = makeRng(seed);
  const rows = [];
  let avoidHead = "";
  for (let i = 0; i < count; i++) {
    const level = generateLock(difficulty, rng, avoidHead);
    avoidHead = level.head;
    rows.push({
      head: level.head,
      par: level.par,
      nodes: level.nodes.length,
      edges: level.edges.length,
      metadata: level.metadata,
    });
  }
  return rows;
}

test("generated boards are valid, target-locked, non-trivial, and bounded", () => {
  for (let d = 1; d <= 14; d++) {
    for (let i = 0; i < 8; i++) {
      const L = generateLock(d, makeRng(1234 + d * 10 + i));
      assert.ok(L, `tier ${d} should generate a board`);
      const c = makeConfig(L); // throws if the start orientation is illegal
      for (const n of L.nodes) {
        assert.ok(inflow(c, n.id) >= 2, `node ${n.id} must start fed (>=2)`);
      }
      assert.equal(isLegalFlip(c, L.target), false, "target not flippable on move 1");
      assert.ok(L.edges.some((e) => e.id === L.target), "target edge must exist");
      assert.ok(L.par >= 3, "non-trivial (par >= 3)");
      assert.ok(L.nodes.length <= 24 && L.edges.length <= 30, "board stays phone-legible & solver-fast");
    }
  }
});

test("the fast generator solve agrees with exhaustive bfsSolve", () => {
  for (const d of [1, 3, 5, 8, 11]) {
    const L = generateLock(d, makeRng(d * 7 + 1));
    const r = bfsSolve(L);
    assert.equal(r.solvable, true, `tier ${d} solvable`);
    assert.equal(r.optimalLength, L.par, `tier ${d}: bfsSolve optimal == generator par`);
  }
});

test("difficulty escalates: higher tiers are harder on average", () => {
  const avgPar = (d) => {
    let sum = 0, n = 0;
    for (let i = 0; i < 12; i++) {
      const L = generateLock(d, makeRng(50 + d * 100 + i));
      if (L) { sum += L.par; n++; }
    }
    return sum / n;
  };
  assert.ok(avgPar(2) > avgPar(1), "tier 2 harder than tier 1");
  assert.ok(avgPar(8) > avgPar(3), "tier 8 harder than tier 3");
});

test("a Rush run is diverse: rotating gadgets, rising par, no two alike in a row", () => {
  // Mirrors rush.generate: rising tier (1+solved) + avoidHead rotation. At a
  // fixed tier par is ~constant per head, so diversity lives ACROSS the run.
  const rng = makeRng(9001);
  let lastHead = "";
  const heads = new Set(), pars = new Set(), seq = [];
  for (let solved = 0; solved < 16; solved++) {
    const L = generateLock(1 + solved, rng, lastHead) || generateLock(1, rng);
    lastHead = L.head;
    heads.add(L.head); pars.add(L.par); seq.push(L.head);
  }
  let consecutiveSame = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) consecutiveSame++;
  assert.equal(consecutiveSame, 0, `no two consecutive boards share a gadget (${seq.join(",")})`);
  assert.ok(heads.size >= 3, `a run should use several gadget types (got ${[...heads]})`);
  assert.ok(pars.size >= 4, `par should rise/vary across a run (got ${[...pars].sort((a, b) => a - b)})`);
});


test("early Rush progression includes a non-tree topology before high-tier gadgets", () => {
  for (let seed = 0; seed < 50; seed++) {
    const rng = makeRng(20260601 + seed);
    let avoidHead = "";
    const sampled = [];
    for (let solved = 0; solved < 7; solved++) {
      const level = generateLock(1 + solved, rng, avoidHead);
      avoidHead = level.head;
      sampled.push(level);
    }

    assert.ok(sampled.some(hasNonRigidUndirectedCycle),
      `first seven Rush boards should include a genuine graph cycle for seed ${seed} (heads: ${sampled.map((level) => level.head).join(",")})`);
  }
});

test("shuttle boards force backtracking (genuine lookahead, not greedy)", () => {
  let checked = 0;
  for (let s = 0; s < 160 && checked < 5; s++) {
    const L = generateLock(9, makeRng(s * 13 + 2)); // shuttle unlocks at d>=8
    if (L && L.head === "shuttle") {
      checked++;
      assert.equal(nonTrivialityReport(L).backtrackingRequired, true,
        "a shuttle board must require backtracking");
    }
  }
  assert.ok(checked >= 3, `expected to sample several shuttle boards (got ${checked})`);
});

test("generation is deterministic for a given seed", () => {
  assert.deepEqual(generateLock(6, makeRng(99)), generateLock(6, makeRng(99)));
});

test("new gadget thresholds keep low tiers classic and unlock richer heads at tiers 6 and 8", () => {
  assert.deepEqual(GENERATED_GADGET_THRESHOLDS, { lowMax: 5, midStart: 6, highStart: 8 });
  for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
    assert.equal(newGadgetHeads.has(difficultyPlan(5, () => roll).head), false, "tier 5 is classic-only");
  }
  assert.ok(["latch", "battery"].includes(difficultyPlan(6, () => 0.99).head), "tier 6 unlocks mid gadgets");
  assert.equal(difficultyPlan(7, () => 0.99).head, "battery", "tier 7 is still mid-gadget only");
  assert.equal(difficultyPlan(8, () => 0.7).head, "mutex", "tier 8 unlocks high gadgets");
  assert.equal(difficultyPlan(8, () => 0.85).head, "cyclePump", "tier 8 includes cyclePump");
  assert.equal(difficultyPlan(8, () => 0.99).head, "sharedReservoir", "tier 8 includes sharedReservoir");
});

test("difficulty 4 and 5 OR samples stay under the reachable-state sanity cap", () => {
  for (const difficulty of [4, 5]) {
    const seed = 20260529 + difficulty * 100 + 5;
    const level = generateLock(difficulty, makeRng(seed));
    const metrics = allMetrics(level);
    assert.ok(metrics.reachableCount < 100000,
      `tier ${difficulty} seed ${seed} reachableCount ${metrics.reachableCount}`);
  }
});

test("generated high-difficulty boards include new gadget metadata while low tiers do not", () => {
  const low = sequenceSummary(3, 20260529, 10);
  assert.equal(low.some((row) => newGadgetHeads.has(row.head)), false, "tier 3 excludes new gadgets");
  assert.ok(low.every((row) => row.metadata.gadgetFamilies.length === 0), "classic heads have empty gadget metadata");

  const high = sequenceSummary(10, 20260529, 20);
  const newRows = high.filter((row) => newGadgetHeads.has(row.head));
  assert.ok(newRows.length > 0, "tier 10 samples at least one new gadget");
  for (const row of newRows) {
    assert.deepEqual(row.metadata.gadgetFamilies, [row.head]);
    assert.equal(row.metadata.sourceFixture, `gadget-${row.head}`);
  }
});

test("seeded generation sequence preserves head, count, and metadata determinism", () => {
  assert.deepEqual(sequenceSummary(10, 12345, 10), sequenceSummary(10, 12345, 10));
});

test("diagnostic metrics are opt-in and match the shared metrics helpers", () => {
  let called = false;
  const silent = generateLock(6, makeRng(31415), "", {
    onDiagnostics: () => { called = true; },
  });
  assert.ok(silent);
  assert.equal(called, false, "diagnostics stay off unless explicitly enabled");

  let payload = null;
  const loud = generateLock(6, makeRng(31415), "", {
    diagnostics: "all",
    onDiagnostics: (value) => { payload = value; },
  });
  assert.ok(loud);
  assert.deepEqual(payload, { head: loud.head, ...allMetrics(loud) });
  assert.deepEqual(basicMetrics(loud), {
    reachableCount: payload.reachableCount,
    diameter: payload.diameter,
    branchingFactor: payload.branchingFactor,
    goalCount: payload.goalCount,
    shortestPathCount: payload.shortestPathCount,
    deadEndCount: payload.deadEndCount,
    par: payload.par,
    partial: payload.partial,
  });

  const originalLog = console.log;
  const logged = [];
  try {
    console.log = (value) => { logged.push(value); };
    const debugLevel = generateLock(6, makeRng(31415), "", { debug: true });
    assert.equal(logged.length, 1, "debug mode logs exactly once");
    assert.deepEqual(JSON.parse(logged[0]), { head: debugLevel.head, ...basicMetrics(debugLevel) });
  } finally {
    console.log = originalLog;
  }
});
