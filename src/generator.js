// THE LOCK — live procedural lock generation. Browser-safe (pure logic).
//
// Random NCL graphs almost never sample a HARD board (most edges reverse in a
// few moves), so difficulty is CONSTRUCTED, not sampled:
//
//   A "relay chain" of length k. The target points into a tight node c0, so it
//   can't be flipped until c0 gets slack. Slack only arrives by flipping the
//   chain edge from c1, which needs c1's slack, ... up to c_k, whose reservoir
//   gives it the only initial slack. So the unique route is: flip a_k, a_{k-1},
//   ..., a_1, then the target — exactly k+1 moves. Difficulty is the dial k.
//
// A rigid 2-node "ground" cluster mutually satisfies inflow and feeds the chain
// ends, so the start is legal and nothing outside the chain can be flipped to
// shortcut it. Node positions are scattered + shuffled so the chain isn't a
// visible line; optional decoys add red herrings. Every board is verified by the
// solver (solvable + true optimal == par) before being returned.

import { bfsSolve } from "./solver.js";

// Seedable PRNG (mulberry32): reproducible runs for sharing/fairness.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randint = (rng, n) => Math.floor(rng() * n);
function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randint(rng, i + 1);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
const round1 = (x) => Math.round(x * 10) / 10;

// Jittered grid over the portrait viewBox so larger boards don't crowd a ring.
function layout(n, rng) {
  const cols = Math.max(2, Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  const X0 = 14, X1 = 86, Y0 = 18, Y1 = 150, JIT = 5;
  const cw = cols > 1 ? (X1 - X0) / (cols - 1) : 0;
  const rh = rows > 1 ? (Y1 - Y0) / (rows - 1) : 0;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = cols > 1 ? X0 + col * cw : 50;
    const cy = rows > 1 ? Y0 + row * rh : 84;
    pts.push({ x: round1(cx + (rng() * 2 - 1) * JIT), y: round1(cy + (rng() * 2 - 1) * JIT) });
  }
  return pts;
}

// Difficulty d (1+) -> chain length. optimal ≈ k + 1.
export function chainLength(d) {
  return 1 + Math.max(1, Math.floor(d));
}

// Generate one lock at the given difficulty. Returns a verified Level (with
// `par`) or null if the (rare) solver check disagrees with the construction.
export function generateLock(difficulty, rng) {
  const d = Math.max(1, Math.floor(difficulty));
  const k = chainLength(d);
  const decoyCount = Math.max(0, Math.min(3, d - 3));

  const chain = [];
  for (let i = 0; i <= k; i++) chain.push("c" + i);
  const decoys = [];
  for (let i = 0; i < decoyCount; i++) decoys.push("k" + i);
  const allIds = [...chain, "x", "y", "g1", "g2", ...decoys];

  // Scatter + shuffle so the chain is not a visible straight line.
  const pts = layout(allIds.length, rng);
  const order = shuffle(rng, allIds);
  const nodes = order.map((id, i) => ({ id, x: pts[i].x, y: pts[i].y }));

  const edges = [];
  let ei = 0;
  const add = (u, v, w, dir) => {
    const id = "e" + ei++;
    edges.push({ id, u, v, w, dir });
    return id;
  };

  // Rigid ground cluster (each inflow 2, mutually satisfied, un-flippable).
  add("g1", "g2", 2, "uv");
  add("g2", "g1", 2, "uv");
  // Feeders for the chain ends.
  add("g1", "x", 2, "uv");
  add("g2", "y", 2, "uv");
  // Target: x -> c0 (into c0). c0 is tight, so the target is not flippable yet.
  const targetId = add("x", chain[0], 2, "uv");
  // Chain: c_{i-1} -> c_i (into c_i); each c_i starts tight.
  for (let i = 1; i <= k; i++) add(chain[i - 1], chain[i], 2, "uv");
  // Reservoir: y -> c_k (into c_k) gives the chain's far end its only slack.
  add("y", chain[k], 2, "uv");
  // Decoys: tight, ground-fed red herrings; never feed the chain.
  for (const dn of decoys) add("g1", dn, 2, "uv");

  const level = { id: "lock-d" + d, name: "Lock", nodes, edges, target: targetId };

  const rep = bfsSolve(level);
  if (!rep.solvable || rep.exhausted) return null;
  level.par = rep.optimalLength;
  return level;
}
