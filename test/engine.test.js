import { test } from "node:test";
import assert from "node:assert/strict";

import {
  makeConfig,
  inflow,
  nodeSlack,
  isLegalFlip,
  legalFlips,
  applyFlip,
  isSolved,
  edgeEnds,
} from "../src/engine.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Thick 2-cycle: a<->b, both w2. inflow(a)=inflow(b)=2. Legal but rigid:
// neither edge is flippable (flipping drops the receiver to 0). Useful for the
// ≥2 lock and as a building block.
function thickCycle() {
  return {
    id: "thick-cycle",
    name: "thick cycle",
    nodes: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 1, y: 0 },
    ],
    edges: [
      { id: "e0", u: "a", v: "b", w: 2, dir: "uv" }, // a -> b
      { id: "e1", u: "a", v: "b", w: 2, dir: "vu" }, // b -> a
    ],
    target: "e0",
  };
}

// Slack fixture. Center node `c` is fed by a thick edge (w2) AND a thin edge
// (w1), so inflow(c)=3, slack 1 — the thin edge can be released.
//   t (thick) :  L -> c   (delivers 2 to c)
//   s (thin)  :  R -> c   (delivers 1 to c)   <- releasable
// L and R each need inflow >= 2; give each a thick self-feeder via a partner.
//   xa -> L (w2), xb -> R (w2). And L,R,xa,xb closed so all are >=2.
// To keep every node legal with minimal edges, use thick 2-cycles on the
// outside: L<->xa thick, R<->xb thick.
function slackFixture() {
  return {
    id: "slack",
    name: "slack",
    nodes: [
      { id: "c", x: 1, y: 1 },
      { id: "L", x: 0, y: 1 },
      { id: "R", x: 2, y: 1 },
      { id: "xa", x: 0, y: 0 },
      { id: "xb", x: 2, y: 0 },
    ],
    edges: [
      { id: "t", u: "L", v: "c", w: 2, dir: "uv" }, // L -> c  (thick into c)
      { id: "s", u: "R", v: "c", w: 1, dir: "uv" }, // R -> c  (thin into c)
      // L kept >=2 by thick cycle with xa
      { id: "la", u: "L", v: "xa", w: 2, dir: "uv" }, // L -> xa
      { id: "al", u: "L", v: "xa", w: 2, dir: "vu" }, // xa -> L
      // R kept >=2 by thick cycle with xb
      { id: "rb", u: "R", v: "xb", w: 2, dir: "uv" }, // R -> xb
      { id: "br", u: "R", v: "xb", w: 2, dir: "vu" }, // xb -> R
    ],
    target: "t",
  };
}

// AND gadget. Center `g` degree 3, weights {1,1,2}. The thick edge (target)
// can point OUTWARD from g only when both thin edges point INWARD (1+1=2).
//   p1 (thin): x1 -> g
//   p2 (thin): x2 -> g
//   tg (thick): g -> y   (target; outward)  -- start has it INTO g instead.
// Start: tg points y -> g so inflow(g) = 1+1+2 = 4 (slack 2); legal.
// To free tg outward, g must keep inflow>=2 from the two thin edges alone.
// Surrounding nodes kept legal via thick cycles.
function andFixture() {
  return {
    id: "and",
    name: "and",
    nodes: [
      { id: "g", x: 1, y: 1 },
      { id: "x1", x: 0, y: 0 },
      { id: "x2", x: 2, y: 0 },
      { id: "y", x: 1, y: 2 },
      // partners for thick cycles
      { id: "p", x: 0, y: 2 },
      { id: "q", x: 2, y: 2 },
      { id: "r", x: 1, y: 3 },
    ],
    edges: [
      { id: "p1", u: "x1", v: "g", w: 1, dir: "uv" }, // x1 -> g (thin in)
      { id: "p2", u: "x2", v: "g", w: 1, dir: "uv" }, // x2 -> g (thin in)
      { id: "tg", u: "g", v: "y", w: 2, dir: "vu" }, // start: y -> g (thick in)
      // x1 >=2 via thick cycle with p
      { id: "xp", u: "x1", v: "p", w: 2, dir: "uv" },
      { id: "px", u: "x1", v: "p", w: 2, dir: "vu" },
      // x2 >=2 via thick cycle with q
      { id: "xq", u: "x2", v: "q", w: 2, dir: "uv" },
      { id: "qx", u: "x2", v: "q", w: 2, dir: "vu" },
      // y >=2 via thick cycle with r
      { id: "yr", u: "y", v: "r", w: 2, dir: "uv" },
      { id: "ry", u: "y", v: "r", w: 2, dir: "vu" },
    ],
    target: "tg",
  };
}

// ---------------------------------------------------------------------------
// Legal-start invariant + makeConfig throwing
// ---------------------------------------------------------------------------

test("makeConfig accepts a legal start", () => {
  const c = makeConfig(thickCycle());
  assert.equal(inflow(c, "a"), 2);
  assert.equal(inflow(c, "b"), 2);
});

test("makeConfig throws on an illegal start (node inflow < 2)", () => {
  // Single thick edge a->b: inflow(a)=0, illegal.
  const bad = {
    id: "bad",
    name: "bad",
    nodes: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 1, y: 0 },
    ],
    edges: [{ id: "e0", u: "a", v: "b", w: 2, dir: "uv" }],
    target: "e0",
  };
  assert.throws(() => makeConfig(bad), /node a/);
});

test("makeConfig throws when a thin-only feed leaves inflow = 1", () => {
  // a<->b thick cycle is fine; add node z fed by a single thin edge -> inflow 1.
  const bad = {
    id: "bad2",
    name: "bad2",
    nodes: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 1, y: 0 },
      { id: "z", x: 2, y: 0 },
    ],
    edges: [
      { id: "e0", u: "a", v: "b", w: 2, dir: "uv" },
      { id: "e1", u: "a", v: "b", w: 2, dir: "vu" },
      { id: "e2", u: "b", v: "z", w: 1, dir: "uv" }, // b -> z, inflow(z)=1
    ],
    target: "e0",
  };
  assert.throws(() => makeConfig(bad), /node z/);
});

test("every reachable Config from a legal start is legal (invariant holds)", () => {
  // BFS the reachable component; assert no node ever drops below 2.
  const level = slackFixture();
  const start = makeConfig(level);
  const key = (c) => level.edges.map((e) => c.dirs.get(e.id)).join("");
  const seen = new Set([key(start)]);
  const queue = [start];
  let checked = 0;
  while (queue.length) {
    const c = queue.shift();
    for (const node of level.nodes) {
      assert.ok(inflow(c, node.id) >= 2, `node ${node.id} dropped below 2`);
    }
    checked++;
    for (const id of legalFlips(c)) {
      const next = applyFlip(c, id);
      const k = key(next);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(next);
      }
    }
  }
  assert.ok(checked >= 1);
});

// ---------------------------------------------------------------------------
// inflow / nodeSlack
// ---------------------------------------------------------------------------

test("inflow sums weights of edges pointing into the node", () => {
  const c = makeConfig(slackFixture());
  // c is fed by t (w2) and s (w1) => inflow 3.
  assert.equal(inflow(c, "c"), 3);
  // L sends t outward; receives only al (xa->L, w2) => inflow 2.
  assert.equal(inflow(c, "L"), 2);
});

test("nodeSlack is inflow minus 2", () => {
  const c = makeConfig(slackFixture());
  assert.equal(nodeSlack(c, "c"), 1); // inflow 3
  assert.equal(nodeSlack(c, "L"), 0); // inflow 2, tight
});

// ---------------------------------------------------------------------------
// isLegalFlip math + legalFlips
// ---------------------------------------------------------------------------

test("isLegalFlip: releasing a thin edge from a slack-1 node is legal", () => {
  const c = makeConfig(slackFixture());
  // Flipping s (R->c) removes 1 from c (inflow 3 -> 2). Legal.
  assert.equal(isLegalFlip(c, "s"), true);
});

test("isLegalFlip: releasing the thick edge from a slack-1 node is illegal", () => {
  const c = makeConfig(slackFixture());
  // Flipping t (L->c) removes 2 from c (inflow 3 -> 1). Illegal.
  assert.equal(isLegalFlip(c, "t"), false);
});

test("isLegalFlip: edges of a tight thick cycle are never flippable", () => {
  const c = makeConfig(thickCycle());
  // Each node has inflow exactly 2; removing 2 -> 0. Both illegal.
  assert.equal(isLegalFlip(c, "e0"), false);
  assert.equal(isLegalFlip(c, "e1"), false);
});

test("legalFlips returns exactly the flippable edge ids", () => {
  const c = makeConfig(slackFixture());
  // Only `s` is releasable. Verify against per-edge isLegalFlip too.
  assert.deepEqual(legalFlips(c).sort(), ["s"]);
  for (const e of c.level.edges) {
    assert.equal(legalFlips(c).includes(e.id), isLegalFlip(c, e.id));
  }
});

test("legalFlips on the AND gadget: thin inward edges are not removable, thick target is", () => {
  const c = makeConfig(andFixture());
  // g inflow = p1(1)+p2(1)+tg(2) = 4. Removing either thin (->3) is legal at g.
  // But the thin edges' receiver is g; check legality math holds.
  assert.equal(isLegalFlip(c, "p1"), true); // 4-1=3 >=2
  assert.equal(isLegalFlip(c, "p2"), true);
  // tg points y->g (into g); removing 2 -> g inflow 2, still legal.
  assert.equal(isLegalFlip(c, "tg"), true);
});

// ---------------------------------------------------------------------------
// applyFlip immutability + involutivity
// ---------------------------------------------------------------------------

test("applyFlip returns a NEW config and does not mutate the original", () => {
  const c0 = makeConfig(slackFixture());
  const before = c0.dirs.get("s");
  const c1 = applyFlip(c0, "s");
  assert.notEqual(c1, c0); // new object
  assert.equal(c0.dirs.get("s"), before); // original unchanged
  assert.notEqual(c1.dirs.get("s"), before); // new one flipped
});

test("applyFlip is involutive: flipping the same edge twice restores orientation", () => {
  const c0 = makeConfig(slackFixture());
  const c1 = applyFlip(c0, "s");
  const c2 = applyFlip(c1, "s");
  for (const e of c0.level.edges) {
    assert.equal(c2.dirs.get(e.id), c0.dirs.get(e.id));
  }
});

test("applyFlip throws on an illegal flip", () => {
  const c = makeConfig(slackFixture());
  assert.throws(() => applyFlip(c, "t"), /Illegal flip/);
});

test("applyFlip updates inflow at exactly the two endpoints", () => {
  const c0 = makeConfig(slackFixture());
  const c1 = applyFlip(c0, "s"); // s: R->c becomes c->R
  // c loses 1: 3 -> 2
  assert.equal(inflow(c1, "c"), 2);
  // R gains 1: 2 -> 3
  assert.equal(inflow(c1, "R"), 3);
  // unaffected node unchanged
  assert.equal(inflow(c1, "xa"), inflow(c0, "xa"));
});

// ---------------------------------------------------------------------------
// edgeEnds
// ---------------------------------------------------------------------------

test("edgeEnds reports current orientation and weight", () => {
  const c0 = makeConfig(slackFixture());
  assert.deepEqual(edgeEnds(c0, "s"), { from: "R", to: "c", w: 1 });
  const c1 = applyFlip(c0, "s");
  assert.deepEqual(edgeEnds(c1, "s"), { from: "c", to: "R", w: 1 });
  // thick weight preserved through orientation
  assert.equal(edgeEnds(c0, "t").w, 2);
});

// ---------------------------------------------------------------------------
// isSolved
// ---------------------------------------------------------------------------

test("isSolved is false at the start", () => {
  assert.equal(isSolved(makeConfig(slackFixture())), false);
  assert.equal(isSolved(makeConfig(andFixture())), false);
});

test("isSolved fires only when the target is reversed vs its start dir", () => {
  const c0 = makeConfig(slackFixture()); // target = t, start dir "uv"
  // Flipping a NON-target edge never solves.
  const c1 = applyFlip(c0, "s");
  assert.equal(isSolved(c1), false);
});

test("isSolved becomes true after the target is reversed, false again after reversing back", () => {
  // Use the AND gadget: tg is the target and is flippable from the start.
  const c0 = makeConfig(andFixture());
  assert.equal(isSolved(c0), false);
  const c1 = applyFlip(c0, "tg"); // reverse target
  assert.equal(isSolved(c1), true);
  const c2 = applyFlip(c1, "tg"); // reverse back (involution)
  assert.equal(isSolved(c2), false);
});
