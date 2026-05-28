import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConfig, inflow, isLegalFlip } from "../src/engine.js";
import { bfsSolve } from "../src/solver.js";
import { generateLock, makeRng, chainLength } from "../src/generator.js";

test("generated boards are valid, legal, non-trivial, with par == chain optimal", () => {
  for (let d = 1; d <= 12; d++) {
    const rng = makeRng(1234 + d);
    for (let i = 0; i < 8; i++) {
      const L = generateLock(d, rng);
      assert.ok(L, `tier ${d} should generate a board`);
      const c = makeConfig(L); // throws if start orientation is illegal
      for (const n of L.nodes) {
        assert.ok(inflow(c, n.id) >= 2, `node ${n.id} must start fed (>=2)`);
      }
      assert.equal(L.par, chainLength(d) + 1, `tier ${d}: par == k+1`);
      assert.equal(isLegalFlip(c, L.target), false, "target must not be flippable on move 1");
      assert.ok(L.edges.some((e) => e.id === L.target), "target edge must exist");
    }
  }
});

test("each generated board is solver-confirmed solvable at exactly par", () => {
  for (const d of [1, 4, 8, 12]) {
    const L = generateLock(d, makeRng(d * 7 + 1));
    const r = bfsSolve(L);
    assert.equal(r.solvable, true, `tier ${d} solvable`);
    assert.equal(r.optimalLength, L.par, `tier ${d} optimal == par`);
  }
});

test("generation is deterministic for a given seed", () => {
  assert.deepEqual(generateLock(6, makeRng(99)), generateLock(6, makeRng(99)));
});
