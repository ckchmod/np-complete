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

// Force-directed (Fruchterman–Reingold) layout over the graph, fit to the
// portrait viewBox. Spreads connected nodes and reduces edge crossings so
// unrelated arrows don't land on top of one another.
function forceLayout(ids, edges, rng) {
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const W = 72, H = 132; // interior box (before offset)
  const k = 0.9 * Math.sqrt((W * H) / n); // ideal edge length
  const pos = ids.map(() => ({ x: rng() * W, y: rng() * H }));
  const pairs = edges.map((e) => [index.get(e.u), index.get(e.v)]);
  let temp = W / 6;

  for (let it = 0; it < 160; it++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) { dx = (rng() - 0.5) * 0.1; dy = (rng() - 0.5) * 0.1; dist = Math.hypot(dx, dy) || 0.01; }
        const f = (k * k) / dist; // repulsion
        disp[i].x += (dx / dist) * f; disp[i].y += (dy / dist) * f;
        disp[j].x -= (dx / dist) * f; disp[j].y -= (dy / dist) * f;
      }
    }
    for (const [a, b] of pairs) {
      let dx = pos[a].x - pos[b].x;
      let dy = pos[a].y - pos[b].y;
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
    temp *= 0.97; // cool
  }

  // Fit + center into the portrait box.
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of pos) {
    minx = Math.min(minx, p.x); miny = Math.min(miny, p.y);
    maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y);
  }
  const X0 = 14, X1 = 86, Y0 = 18, Y1 = 150;
  const spanx = maxx - minx || 1, spany = maxy - miny || 1;
  const s = Math.min((X1 - X0) / spanx, (Y1 - Y0) / spany);
  const offx = X0 + ((X1 - X0) - spanx * s) / 2;
  const offy = Y0 + ((Y1 - Y0) - spany * s) / 2;
  const out = {};
  ids.forEach((id, i) => {
    out[id] = { x: round1(offx + (pos[i].x - minx) * s), y: round1(offy + (pos[i].y - miny) * s) };
  });
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
  const decoyCount = Math.max(0, Math.min(3, d - 3));

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

  const pos = forceLayout(allIds, edges, rng);
  const nodes = allIds.map((id) => ({ id, x: pos[id].x, y: pos[id].y }));

  const level = { id: "lock-d" + d, name: "Lock", nodes, edges, target: targetId };

  const rep = bfsSolve(level);
  if (!rep.solvable || rep.exhausted) return null;
  level.par = rep.optimalLength;
  return level;
}
