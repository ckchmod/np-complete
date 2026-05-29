// THE LOCK — live procedural lock generation. Browser-safe (pure logic).
//
// Difficulty is CONSTRUCTED as a branching RELAY TREE (acyclic, so a
// force-directed layout SPREADS it — no ring). The red target points into the
// root R; R can only be reversed once it gains +2 inflow, which it gets from its
// sub-relays. An AND junction — two THIN (w=1) children that must BOTH be flipped
// inward (+1 +1 = +2) — forces resolving MULTIPLE branches rather than unwinding
// one line. Each leg is a w2 relay chain ending in a local "battery" (a rigid
// pair feeding a slack-2 donor), so legs end in a small knot, not a big loop.
//
// Small LOCAL rigid pairs anchor the target source and give each thin child its
// static base inflow — no shared hub, which would cross-link the graph and tangle
// the layout. Every board is solver-verified (solvable, optimal == par) first.

import { solveTarget } from "./solver.js";

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

// ── Layout ────────────────────────────────────────────────────────────────
// Force-directed, multi-start, readability-scored. The graph is a tree (+ tiny
// rigid 2-cycles), so a plain random-seeded relaxation spreads it; we run several
// and keep the most legible (fewest crossings / grazes / cramped pairs / sharp
// angles). Generation is a few ms, well under the between-lock delay.
const W = 72, H = 116; // interior layout box
const FIT = { X0: 14, X1: 86, Y0: 22, Y1: 144 };

// Layered seed: BFS levels from the highest-degree node (the hub/root), placed
// top-to-bottom with each level spread across x and jittered. A tree drawn in
// layers is almost planar, so FR starts near-untangled instead of from noise.
function layeredInit(n, pairs, rng) {
  const adj = Array.from({ length: n }, () => []);
  for (const [a, b] of pairs) { adj[a].push(b); adj[b].push(a); }
  let root = 0;
  for (let i = 1; i < n; i++) if (adj[i].length > adj[root].length) root = i;
  const level = new Array(n).fill(-1);
  level[root] = 0;
  const q = [root];
  for (let head = 0; head < q.length; head++) {
    const v = q[head];
    for (const u of adj[v]) if (level[u] < 0) { level[u] = level[v] + 1; q.push(u); }
  }
  const byLevel = new Map();
  let maxL = 0;
  for (let i = 0; i < n; i++) {
    const L = level[i] < 0 ? 0 : level[i];
    if (!byLevel.has(L)) byLevel.set(L, []);
    byLevel.get(L).push(i);
    if (L > maxL) maxL = L;
  }
  const pos = new Array(n);
  for (const [L, row] of byLevel) {
    const y = H * ((L + 0.5) / (maxL + 1)) + (rng() - 0.5) * 8;
    row.forEach((i, idx) => {
      const x = W * ((idx + 0.5) / row.length) + (rng() - 0.5) * 10;
      pos[i] = { x, y };
    });
  }
  return pos;
}

function frSimulate(n, pairs, rng) {
  const k = 0.95 * Math.sqrt((W * H) / n); // ideal edge length
  const pos = layeredInit(n, pairs, rng);
  const dispX = new Float64Array(n), dispY = new Float64Array(n); // reused each iter
  let temp = W / 6;
  for (let it = 0; it < 200; it++) {
    dispX.fill(0); dispY.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) { dx = (rng() - 0.5) * 0.1; dy = (rng() - 0.5) * 0.1; dist = Math.hypot(dx, dy) || 0.01; }
        const f = (k * k) / (dist * dist); // repulsion (per unit vector)
        const ux = dx * f, uy = dy * f;
        dispX[i] += ux; dispY[i] += uy; dispX[j] -= ux; dispY[j] -= uy;
      }
    }
    for (const [a, b] of pairs) {
      let dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const f = dist / k; // attraction (per unit vector)
      const ux = dx * f, uy = dy * f;
      dispX[a] -= ux; dispY[a] -= uy; dispX[b] += ux; dispY[b] += uy;
    }
    for (let i = 0; i < n; i++) {
      const dl = Math.hypot(dispX[i], dispY[i]) || 1e-6;
      const step = Math.min(dl, temp);
      pos[i].x = Math.max(0, Math.min(W, pos[i].x + (dispX[i] / dl) * step));
      pos[i].y = Math.max(0, Math.min(H, pos[i].y + (dispY[i] / dl) * step));
    }
    temp *= 0.975; // cool
  }
  return fitToBox(pos);
}

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
// then cramped node pairs, then two edges leaving a node at near-equal heading
// (which visually overlap).
function layoutScore(n, pairs, pos) {
  let cross = 0, graze = 0, cramped = 0, sharp = 0;
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
  const adj = Array.from({ length: n }, () => []);
  for (const [a, b] of pairs) { adj[a].push(b); adj[b].push(a); }
  for (let v = 0; v < n; v++) {
    const dirs = adj[v].map((u) => Math.atan2(pos[u].y - pos[v].y, pos[u].x - pos[v].x));
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        let da = Math.abs(dirs[i] - dirs[j]);
        if (da > Math.PI) da = 2 * Math.PI - da;
        if (da < 0.45) sharp++; // ~26°: arrows would visually merge
      }
    }
  }
  // Weighted so score < 100 iff zero crossings AND zero grazes (the quality
  // bars); cramped/sharp are minor tiebreakers. Lets forceLayout early-exit.
  return cross * 1000 + graze * 100 + cramped * 5 + sharp * 15;
}

function forceLayout(ids, edges, rng) {
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const pairs = edges.map((e) => [index.get(e.u), index.get(e.v)]);
  let best = null, bestScore = Infinity;
  for (let start = 0; start < 28; start++) {
    const pos = frSimulate(n, pairs, rng);
    const score = layoutScore(n, pairs, pos);
    if (score < bestScore) { bestScore = score; best = pos; }
    if (bestScore < 100) break; // crossing-free & no grazes — good enough
  }
  const out = {};
  ids.forEach((id, i) => { out[id] = { x: round1(best[i].x), y: round1(best[i].y) }; });
  return out;
}

// ── Difficulty → tree shape ─────────────────────────────────────────────────
// d=1 is a single linear relay (gentle intro, no AND). d>=2 is an AND of 2 (then
// 3) legs whose w2-chain lengths grow with d. `legs[i]` = chain length of leg i.
export function difficultyShape(d) {
  d = Math.max(1, Math.floor(d));
  if (d === 1) return { single: true, legs: [1] };
  // AND of EXACTLY two legs (both required — three thin legs into a +2 root would
  // be 2-of-3, i.e. one skippable). Chain lengths grow with d, capped so the
  // exhaustive solver stays fast and boards stay phone-readable. Difficulty
  // plateaus at the cap (fine for untimed survival).
  const total = Math.min(9, d);
  const a = Math.min(5, Math.ceil(total / 2));
  const b = Math.min(5, Math.floor(total / 2));
  return { single: false, legs: [Math.max(1, a), Math.max(1, b)] };
}

// ── Construction ────────────────────────────────────────────────────────────
// Generate one lock at the given difficulty. Returns a solver-verified Level
// (with `par`) or null if the (rare) solver check disagrees with construction.
export function generateLock(difficulty, rng) {
  const shape = difficultyShape(difficulty);
  let nid = 0, eid = 0;
  const edges = [];
  const node = () => "n" + nid++;
  const E = (u, v, w) => { const id = "e" + eid++; edges.push({ id, u, v, w, dir: "uv" }); return id; };
  const pair = () => { const a = node(), b = node(); E(a, b, 2); E(b, a, 2); return a; }; // rigid; returns usable node

  // A battery: a slack-2 donor `b` and one satellite `s`. Two parallel s->b
  // edges give b inflow 4 (slack 2, so it can donate 2); b->s keeps s fed. Just
  // two nodes (a compact lens), so it lays out cleanly instead of tangling like
  // a 3-node triangle.
  function makeBattery() {
    const s = node(), b = node();
    E(b, s, 2);             // b -> s keeps s satisfied
    E(s, b, 2); E(s, b, 2); // two s -> b: b inflow 4 (donates 2)
    return b;
  }

  const R = node(), x = node();
  const target = E(x, R, 2);      // TARGET x -> R (into R); reverse it to win
  const ax = pair(); E(ax, x, 2); // LOCAL anchor: x at inflow 2 (inert)

  // From `top` (which must gain +2 to flip its parent edge), build a w2 relay of
  // length L ending in a battery: top->m1->...->mL->battery.
  function relay(top, L) {
    let prev = top;
    for (let i = 0; i < L; i++) { const m = node(); E(prev, m, 2); prev = m; }
    const b = makeBattery();
    E(prev, b, 2); // charge edge: flip prev->b to gain +2 at prev
  }

  if (shape.single) {
    const C = node();
    E(R, C, 2);                   // single w2 child (no AND): one chain unlocks R
    relay(C, shape.legs[0]);
  } else {
    for (const L of shape.legs) {
      const C = node();
      E(R, C, 1);                 // AND input (thin): all children must flip in
      const t = pair(); E(t, C, 1); // LOCAL static base so C starts tight at 2
      relay(C, L);
    }
  }

  const ids = [...new Set(edges.flatMap((e) => [e.u, e.v]))];
  const pos = forceLayout(ids, edges, rng);
  const nodes = ids.map((id) => ({ id, x: pos[id].x, y: pos[id].y }));
  const level = { id: "lock-d" + Math.max(1, Math.floor(difficulty)), name: "Lock", nodes, edges, target };

  const rep = solveTarget(level);
  if (!rep.solvable) return null;
  level.par = rep.optimalLength;
  return level;
}
