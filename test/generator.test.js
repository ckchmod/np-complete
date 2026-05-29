import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConfig, inflow, isLegalFlip } from "../src/engine.js";
import { bfsSolve, nonTrivialityReport } from "../src/solver.js";
import { generateLock, makeRng } from "../src/generator.js";

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
      assert.ok(L.nodes.length <= 24 && L.edges.length <= 32, "board stays phone-legible & solver-fast");
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
