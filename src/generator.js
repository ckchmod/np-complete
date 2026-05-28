// THE LOCK — live procedural lock generation. Browser-safe (pure logic).
//
// Difficulty is CONSTRUCTED, not sampled (random graphs almost never sample a
// hard board). A "relay chain" of length k: the target points into a tight node
// c0, so it can't be flipped until c0 gets slack; slack only arrives by flipping
// the chain edge from c1, which needs c1's slack, ... up to c_k whose reservoir
// holds the only initial slack. The unique route is flip a_k ... a_1, then the
// target — exactly k+1 moves. Difficulty is the dial k.
//
// A rigid 2-node "ground" cluster mutually satisfies inflow and feeds the chain
// ends, so the start is legal and nothing outside the chain can shortcut it.
// Node positions come from a force-directed layout (spreads nodes, cuts edge
// crossings/overlaps). Every board is solver-verified (solvable + true optimal
// == par) before being returned.

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

const round1 = (x) => Math.round(x * 10) / 10;

const W = 72, H = 116; // interior layout box (slightly less tall than the viewport)
const FIT = { X0: 14, X1: 86, Y0: 22, Y1: 144 };

// One Fruchterman–Reingold relaxation. Seeded from a jittered ring in CYCLE
// order (cycleIdx[r] = node index placed at ring slot r), so the main loop's
// edges connect ring-adjacent nodes and start crossing-free; then relaxed.
function frSimulate(n, pairs, rng, cycleIdx) {
  const k = 0.95 * Math.sqrt((W * H) / n); // ideal edge length
  const pos = new Array(n);
  for (let r = 0; r < n; r++) {
    const a = (r / n) * Math.PI * 2 + (rng() - 0.5) * 0.8;
    const rad = (Math.min(W, H) / 2) * (0.66 + rng() * 0.24);
    pos[cycleIdx[r]] = { x: W / 2 + Math.cos(a) * rad, y: H / 2 + Math.sin(a) * rad };
  }
  let temp = W / 6;
  for (let it = 0; it < 200; it++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) { dx = (rng() - 0.5) * 0.1; dy = (rng() - 0.5) * 0.1; dist = Math.hypot(dx, dy) || 0.01; }
        const f = (k * k) / dist; // repulsion
        disp[i].x += (dx / dist) * f; disp[i].y += (dy / dist) * f;
        disp[j].x -= (dx / dist) * f; disp[j].y -= (dy / dist) * f;
      }
    }
    for (const [a, b] of pairs) {
      let dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const f = (dist * dist) / k; // attraction
      disp[a].x -= (dx / dist) * f; disp[a].y -= (dy / dist) * f;
      disp[b].x += (dx / dist) * f; disp[b].y += (dy / dist) * f;
    }
    for (let i = 0; i < n; i++) {
      const dl = Math.hypot(disp[i].x, disp[i].y) || 1e-6;
      const step = Math.min(dl, temp);
      pos[i].x = Math.max(0, Math.min(W, pos[i].x + (disp[i].x / dl) * step));
      pos[i].y = Math.max(0, Math.min(H, pos[i].y + (disp[i].y / dl) * step));
    }
    temp *= 0.975; // cool
  }
  return fitToBox(pos);
}

// Uniformly scale + center a layout into the portrait fit box.
function fitToBox(pos) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of pos) {
    minx = Math.min(minx, p.x); miny = Math.min(miny, p.y);
    maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y);
  }
  const spanx = maxx - minx || 1, spany = maxy - miny || 1;
  const s = Math.min((FIT.X1 - FIT.X0) / spanx, (FIT.Y1 - FIT.Y0) / spany);
  const offx = FIT.X0 + ((FIT.X1 - FIT.X0) - spanx * s) / 2;
  const offy = FIT.Y0 + ((FIT.Y1 - FIT.Y0) - spany * s) / 2;
  return pos.map((p) => ({ x: offx + (p.x - minx) * s, y: offy + (p.y - miny) * s }));
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
function pointSegDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
// Lower is better: crossings dominate, then edges grazing non-incident nodes,
// then cramped node pairs. Drives the multi-start selection below.
function layoutScore(n, pairs, pos) {
  let cross = 0, graze = 0, cramped = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [a, b] = pairs[i], [c, d] = pairs[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (segmentsCross(pos[a], pos[b], pos[c], pos[d])) cross++;
    }
  }
  for (const [a, b] of pairs) {
    for (let v = 0; v < n; v++) {
      if (v === a || v === b) continue;
      if (pointSegDist(pos[v], pos[a], pos[b]) < 7) graze++;
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y) < 11) cramped++;
    }
  }
  return cross * 100 + graze * 45 + cramped * 12;
}

// Multi-start force layout: generation is sub-ms, so run several relaxations and
// keep the most readable (fewest crossings / grazes / cramped pairs). `order` is
// the node ids in cycle order, used to seed each start crossing-free.
function forceLayout(ids, edges, rng, order) {
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const pairs = edges.map((e) => [index.get(e.u), index.get(e.v)]);
  const cycleIdx = order.map((id) => index.get(id));
  let best = null, bestScore = Infinity;
  for (let start = 0; start < 16; start++) {
    const pos = frSimulate(n, pairs, rng, cycleIdx);
    const score = layoutScore(n, pairs, pos);
    if (score < bestScore) { bestScore = score; best = pos; }
    if (bestScore === 0) break; // perfect: no crossings, grazes, or cramping
  }
  const out = {};
  ids.forEach((id, i) => { out[id] = { x: round1(best[i].x), y: round1(best[i].y) }; });
  return out;
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
  const decoyCount = Math.max(1, Math.min(4, d - 1));

  const chain = [];
  for (let i = 0; i <= k; i++) chain.push("c" + i);
  const decoys = [];
  for (let i = 0; i < decoyCount; i++) decoys.push("k" + i);
  const allIds = [...chain, "x", "y", "g1", "g2", ...decoys];

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

  // Ring order following the actual cycle (g1-x-chain-y-g2), decoys appended as
  // pendants near g1 — seeds a crossing-free layout.
  const order = ["g1", "x", ...chain, "y", "g2", ...decoys];
  const pos = forceLayout(allIds, edges, rng, order);
  const nodes = allIds.map((id) => ({ id, x: pos[id].x, y: pos[id].y }));

  const level = { id: "lock-d" + d, name: "Lock", nodes, edges, target: targetId };

  const rep = bfsSolve(level);
  if (!rep.solvable || rep.exhausted) return null;
  level.par = rep.optimalLength;
  return level;
}
