import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConfig, inflow, isLegalFlip } from "../src/engine.js";
import { bfsSolve } from "../src/solver.js";
import { generateLock, makeRng, difficultyShape } from "../src/generator.js";

// Move count of a constructed relay tree: a single linear leg of length L costs
// L+3 (charge the chain, flip R->C, flip target); an AND of legs costs
// sum(L)+5 (each leg charges + its thin R->C flip, plus the target).
function expectedPar(shape) {
  return shape.single
    ? shape.legs[0] + 3
    : shape.legs.reduce((s, L) => s + L, 0) + 5;
}

test("generated boards are valid, target-locked, and par matches construction", () => {
  for (let d = 1; d <= 12; d++) {
    const shape = difficultyShape(d);
    for (let i = 0; i < 8; i++) {
      const L = generateLock(d, makeRng(1234 + d * 10 + i));
      assert.ok(L, `tier ${d} should generate a board`);
      const c = makeConfig(L); // throws if the start orientation is illegal
      for (const n of L.nodes) {
        assert.ok(inflow(c, n.id) >= 2, `node ${n.id} must start fed (>=2)`);
      }
      assert.equal(isLegalFlip(c, L.target), false, "target not flippable on move 1");
      assert.ok(L.edges.some((e) => e.id === L.target), "target edge must exist");
      assert.equal(L.par, expectedPar(shape), `tier ${d}: par matches the shape`);
      assert.ok(L.par >= 3, "non-trivial");
    }
  }
});

test("the fast generator solve agrees with exhaustive bfsSolve", () => {
  for (const d of [1, 3, 5, 8]) {
    const L = generateLock(d, makeRng(d * 7 + 1));
    const r = bfsSolve(L);
    assert.equal(r.solvable, true, `tier ${d} solvable`);
    assert.equal(r.optimalLength, L.par, `tier ${d}: bfsSolve optimal == solveTarget par`);
  }
});

test("AND tiers really require both branches (target stays locked until then)", () => {
  // A d>=2 board is an AND of two legs; the target must remain locked at the
  // start (you cannot shortcut it) — a direct construction sanity check.
  const L = generateLock(4, makeRng(42));
  const c = makeConfig(L);
  assert.equal(isLegalFlip(c, L.target), false);
  assert.equal(difficultyShape(4).single, false, "tier 4 is a branching AND");
});

test("generation is deterministic for a given seed", () => {
  assert.deepEqual(generateLock(6, makeRng(99)), generateLock(6, makeRng(99)));
});
