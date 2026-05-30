// THE LOCK — live procedural lock generation. Browser-safe (pure logic).
//
// Difficulty is CONSTRUCTED from branching relays plus selected cyclic heads, so
// early boards stay readable without keeping the whole progression tree-shaped.
// The red target points into the root R; R can only be reversed once it gains +2
// inflow, which it gets from its
// sub-relays. An AND junction — two THIN (w=1) children that must BOTH be flipped
// inward (+1 +1 = +2) — forces resolving MULTIPLE branches rather than unwinding
// one line. Each leg is a w2 relay chain ending in a local "battery" (a rigid
// pair feeding a slack-2 donor), so legs end in a small knot, not a big loop.
//
// Small LOCAL rigid pairs anchor the target source and give each thin child its
// static base inflow — no shared hub, which would cross-link the graph and tangle
// the layout. Every board is solver-verified (solvable, optimal == par) first.

import { solveTarget } from "./solver.js";
import { basicMetrics, allMetrics } from "./difficultyMetrics.js";
import {
  buildBattery,
  buildCyclePump,
  buildLatch,
  buildMutex,
  buildSharedReservoir,
} from "./gadgetBuilders.js";

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
// Force-directed, multi-start, readability-scored. Most heads are still sparse,
// with occasional true cycles, so random-seeded relaxation spreads them cleanly;
// we run several and keep the most legible (fewest crossings / grazes / cramped
// pairs / sharp angles). Layout dominates generation (tens of ms), well under
// the between-lock delay.
const W = 72, H = 116; // interior layout box
const FIT = { X0: 10, X1: 90, Y0: 16, Y1: 150 };
const MIN_EDGE_SPAN = 12;
const MIN_NODE_SPAN = 10.5;

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

// Vary the board's handedness/orientation WITHOUT squashing it. A full random
// rotation can leave a graph wide, which then fits the tall play area by width
// and wastes vertical space. So: random mirror in x and y (4 combinations), then
// keep it PORTRAIT (transpose if wider than tall) so it fills the tall board, then
// a small rotation jitter for an organic look. All rigid/reflection transforms,
// so crossings/spacing are unchanged; fitToBox re-centers afterwards.
function reorient(pos, rng) {
  const mx = rng() < 0.5 ? -1 : 1;
  const my = rng() < 0.5 ? -1 : 1;
  let p = pos.map((q) => ({ x: q.x * mx, y: q.y * my }));
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const q of p) { mnx = Math.min(mnx, q.x); mny = Math.min(mny, q.y); mxx = Math.max(mxx, q.x); mxy = Math.max(mxy, q.y); }
  if (mxx - mnx > mxy - mny) p = p.map((q) => ({ x: q.y, y: q.x })); // transpose -> portrait
  const j = (rng() - 0.5) * 0.5; // ~±14deg jitter (won't flip the aspect)
  const ca = Math.cos(j), sa = Math.sin(j);
  return p.map((q) => ({ x: q.x * ca - q.y * sa, y: q.x * sa + q.y * ca }));
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
  let cross = 0, graze = 0, cramped = 0, shortEdge = 0, sharp = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [a, b] = pairs[i], [c, d] = pairs[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (segmentsCross(pos[a], pos[b], pos[c], pos[d])) cross++;
    }
  }
  for (const [a, b] of pairs) {
    const span = Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y);
    if (span < MIN_EDGE_SPAN) shortEdge += MIN_EDGE_SPAN - span;
    for (let v = 0; v < n; v++) {
      if (v === a || v === b) continue;
      if (pointSegDist(pos[v], pos[a], pos[b]) < 7) graze++;
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y) < MIN_NODE_SPAN) cramped++;
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
  // Crossings and grazes dominate; short edges outrank minor cramped/sharp ties
  // because cramped generated arrows collapse visually on the phone board.
  return cross * 1_000_000 + graze * 10_000 + shortEdge * 1_000 + cramped * 5 + sharp * 15;
}

function separateShortEdges(pairs, pos) {
  const out = pos.map((p) => ({ x: p.x, y: p.y }));
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (const [a, b] of pairs) {
      let dx = out[b].x - out[a].x, dy = out[b].y - out[a].y;
      let dist = Math.hypot(dx, dy);
      if (dist >= MIN_EDGE_SPAN) continue;
      if (dist < 0.01) { dx = 1; dy = 0; dist = 1; }
      const push = (MIN_EDGE_SPAN - dist) / 2;
      const ux = dx / dist, uy = dy / dist;
      out[a].x = Math.max(FIT.X0, Math.min(FIT.X1, out[a].x - ux * push));
      out[a].y = Math.max(FIT.Y0, Math.min(FIT.Y1, out[a].y - uy * push));
      out[b].x = Math.max(FIT.X0, Math.min(FIT.X1, out[b].x + ux * push));
      out[b].y = Math.max(FIT.Y0, Math.min(FIT.Y1, out[b].y + uy * push));
      moved = true;
    }
    if (!moved) break;
  }
  return out;
}

function separateCloseNodes(n, pos) {
  const out = pos.map((p) => ({ x: p.x, y: p.y }));
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = out[j].x - out[i].x, dy = out[j].y - out[i].y;
        let dist = Math.hypot(dx, dy);
        if (dist >= MIN_NODE_SPAN) continue;
        if (dist < 0.01) { dx = ((i + j) % 2) ? 1 : -1; dy = ((i + j) % 3) - 1; dist = Math.hypot(dx, dy) || 1; }
        const push = (MIN_NODE_SPAN - dist) / 2;
        const ux = dx / dist, uy = dy / dist;
        out[i].x = Math.max(FIT.X0, Math.min(FIT.X1, out[i].x - ux * push));
        out[i].y = Math.max(FIT.Y0, Math.min(FIT.Y1, out[i].y - uy * push));
        out[j].x = Math.max(FIT.X0, Math.min(FIT.X1, out[j].x + ux * push));
        out[j].y = Math.max(FIT.Y0, Math.min(FIT.Y1, out[j].y + uy * push));
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

function separateLayout(n, pairs, pos) {
  let out = pos;
  for (let pass = 0; pass < 4; pass++) {
    out = separateCloseNodes(n, out);
    out = separateShortEdges(pairs, out);
  }
  return separateCloseNodes(n, out);
}

function forceLayout(ids, edges, rng) {
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const seenPairs = new Set();
  const pairs = [];
  for (const edge of edges) {
    const a = index.get(edge.u), b = index.get(edge.v);
    const key = a < b ? a + "|" + b : b + "|" + a;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    pairs.push([a, b]);
  }
  let best = null, bestScore = Infinity;
  for (let start = 0; start < 30; start++) {
    const pos = fitToBox(reorient(frSimulate(n, pairs, rng), rng));
    const score = layoutScore(n, pairs, pos);
    if (score < bestScore) { bestScore = score; best = pos; }
    if (bestScore < 1) break;
  }
  const out = {};
  const spaced = separateLayout(n, pairs, best);
  ids.forEach((id, i) => { out[id] = { x: round1(spaced[i].x), y: round1(spaced[i].y) }; });
  return out;
}

// ── Gadget palette ───────────────────────────────────────────────────────────
// Every Rush board used to be ONE template (target -> AND-of-2-relays); only leg
// lengths/orientation varied, so the game felt predictable. Now each board is
// COMPOSED from a palette of gadgets chosen by difficulty:
//   chain   — a w2 relay (the connective tissue / simplest leg)
//   AND     — two thin children, BOTH must flip in (+1 +1 = +2): forcing
//   OR      — several thick branches, ANY one delivers +2: choice / multi-path
//   cycle   — a compact triangle head: the first genuine non-tree topology
//   shuttle — the lend/reclaim head (lifted from THE_LOCK): forces BACKTRACKING
//   latch/battery/mutex/cyclePump/sharedReservoir — richer compact mappings of the
//              standalone gadget-builder families, unlocked only after tier 5
// Forcing AND is always binary here (a node needs <= +2; an AND-of-3 would be
// 2-of-3, i.e. one skippable). Each gadget keeps every node at inflow >= 2 by
// construction; the finished board is solver-verified (build -> verify ->
// reject/retry), so a malformed compose is simply discarded.

// A build context: id-stamped node/edge factories over one shared edge list.
function builder() {
  let nid = 0, eid = 0;
  const edges = [];
  const node = () => "n" + nid++;
  const E = (u, v, w) => { const id = "e" + eid++; edges.push({ id, u, v, w, dir: "uv" }); return id; };
  // Rigid 2-cycle: a,b both sit at inflow 2; returns a node you draw a static +w
  // from (it never needs to flip).
  const pair = () => { const a = node(), b = node(); E(a, b, 2); E(b, a, 2); return a; };
  // Slack-2 donor: b sits at inflow 4, so a charge edge X->b reverses to b->X
  // delivering +2 to X. A compact 2-node lens (lays out cleanly).
  const battery = () => { const s = node(), b = node(); E(b, s, 2); E(s, b, 2); E(s, b, 2); return b; };
  return { node, E, pair, battery, edges };
}

// chain: a w2 relay of length L from `top`, ending in a battery. Reversing it
// back from the battery delivers +2 to `top`. The connective gadget.
function chain(ctx, top, L) {
  let prev = top;
  for (let i = 0; i < L; i++) { const m = ctx.node(); ctx.E(prev, m, 2); prev = m; }
  ctx.E(prev, ctx.battery(), 2); // charge edge: reverse from the battery to gain +2 at top
}

function targetCluster(ctx) {
  const R = ctx.node(), x = ctx.node();
  const target = ctx.E(x, R, 2);
  const ax = ctx.pair(); ctx.E(ax, x, 2);
  return { R, target };
}

// attachCharger: make node N (tight at inflow 2) able to GAIN +2 — i.e. a thick
// edge into N becomes reversible — via a gadget chosen by rng + budget. `budget`
// bounds recursion (rises with difficulty). A node that only needs +1 (an AND
// leg) is fine: a chain over-delivers +2.
// `need` is how much N must gain (1 or 2); `len` is the length/complexity budget
// to spend (drives par). AND only where need===2 (so it stays forcing); a chain
// over-delivers +2 for a need-1 node. AND SPLITS len across legs and OR caps each
// branch, so par tracks `len` while node count stays bounded.
function attachCharger(ctx, N, need, len, rng) {
  len = Math.max(1, len);
  const roll = rng();
  if (len <= 2 || roll < 0.4) {
    chain(ctx, N, Math.min(len, 6)); // one relay; cap keeps a single chain readable
    return;
  }
  if (need === 2 && roll < 0.74) {
    // forcing AND: split `len` across two thin (need-1) legs, BOTH required
    const a = 1 + Math.floor(rng() * (len - 1));
    for (const l of [a, len - a]) {
      const C = ctx.node();
      ctx.E(N, C, 1);                              // N -> C thin
      const base = ctx.pair(); ctx.E(base, C, 1);  // base -> C starts tight at 2
      attachCharger(ctx, C, 1, l, rng);
    }
    return;
  }
  // OR: two thick branches, ANY one delivers +2 to N -> genuine choice / multi-path.
  // Each branch is a bounded CHAIN, not a nested charger: recursing here neither
  // shrank `len` (it looped forever for len in {3,4}) nor stayed under the node cap
  // (geometric blow-up). The choice between branches is what matters, not depth.
  for (let i = 0; i < 2; i++) {
    const C = ctx.node();
    ctx.E(N, C, 2);                                // N -> C thick
    chain(ctx, C, Math.min(len, 4));
  }
}

// Generic head: the target cluster x->R plus the structure gating R's +2.
// Returns the target edge id.
function genericHead(ctx, type, len, rng) {
  const { R, target } = targetCluster(ctx);
  if (type === "single") {
    const C = ctx.node(); ctx.E(R, C, 2); // one thick child; charging it frees R
    attachCharger(ctx, C, 2, len, rng);
  } else if (type === "or") {
    rng();
    const k = 2;
    for (let i = 0; i < k; i++) {
      const C = ctx.node(); ctx.E(R, C, 2); // thick OR branch; ANY one frees R
      chain(ctx, C, Math.min(len, 4));        // bounded chain per branch (see attachCharger OR)
    }
  } else { // "and": split len across two forcing legs (BOTH required)
    // At len<=2 this draw is fixed (a=1, legs [1,1]) but is kept UNCONDITIONAL on
    // purpose: it advances the shared rng stream, so it's load-bearing for seed
    // determinism — guarding it away would shift every later board for a seed and
    // break the determinism test.
    const a = 1 + Math.floor(rng() * Math.max(1, len - 1));
    for (const l of [a, Math.max(1, len - a)]) {
      const C = ctx.node(); ctx.E(R, C, 1);        // thin AND input
      const base = ctx.pair(); ctx.E(base, C, 1);  // C starts tight at 2
      attachCharger(ctx, C, 1, l, rng);
    }
  }
  return target;
}

function latchHead(ctx, len, rng) {
  const { R, target } = targetCluster(ctx);
  const gate = ctx.node(), key = ctx.node();
  ctx.E(R, gate, 2);
  ctx.E(gate, key, 2);
  attachCharger(ctx, key, 2, Math.min(len, 5), rng);
  return target;
}

function batteryHead(ctx) {
  const { R, target } = targetCluster(ctx);
  const source = ctx.battery();
  for (let i = 0; i < 2; i++) {
    const relay = ctx.node(), output = ctx.node();
    ctx.E(R, relay, 2);
    ctx.E(relay, output, 2);
    ctx.E(output, source, 2);
  }
  return target;
}

function mutexHead(ctx) {
  const { R, target } = targetCluster(ctx);
  const hub = ctx.node();
  for (let i = 0; i < 2; i++) {
    const relay = ctx.node(), port = ctx.node();
    ctx.E(R, relay, 2);
    ctx.E(relay, port, 2);
    ctx.E(port, hub, 2);
  }
  return target;
}

function cycleHead(ctx) {
  const { R, target } = targetCluster(ctx);
  const a = ctx.node(), b = ctx.node(), c = ctx.node();
  ctx.E(R, a, 2);
  ctx.E(a, b, 2);
  ctx.E(b, c, 2);
  ctx.E(a, c, 2);
  return target;
}

function cyclePumpHead(ctx) {
  const { R, target } = targetCluster(ctx);
  const gate = ctx.node(), a = ctx.node(), b = ctx.node(), c = ctx.node();
  ctx.E(R, gate, 2);
  ctx.E(gate, a, 2);
  ctx.E(a, b, 2);
  ctx.E(a, b, 2);
  ctx.E(b, c, 2);
  ctx.E(c, a, 2);
  return target;
}

function sharedReservoirHead(ctx) {
  const { R, target } = targetCluster(ctx);
  const reservoir = ctx.battery();
  for (let i = 0; i < 2; i++) {
    const child = ctx.node();
    ctx.E(R, child, 1);
    const base = ctx.pair(); ctx.E(base, child, 1);
    ctx.E(child, reservoir, 1);
  }
  return target;
}

// Shuttle head (parameterized from THE_LOCK's {T,K,S,B} lend/reclaim gadget): to
// satisfy K you must LEND a unit out via ST (moving AWAY from the goal) and
// RECLAIM it later — greedy play dead-ends, so a solution must BACKTRACK.
function shuttleHead(ctx, len, rng) {
  const T = ctx.node(), K = ctx.node(), S = ctx.node(), B = ctx.node(), P = ctx.node();
  const KT = ctx.E(K, T, 2);   // TARGET K -> T
  ctx.E(S, B, 2);              // S -> B  (S's ballast sink)
  ctx.E(S, T, 1);              // S -> T  thin (the shuttle: lend / reclaim)
  ctx.E(K, S, 1);              // K -> S  thin
  ctx.E(T, S, 1);              // T -> S  thin
  ctx.E(S, K, 2);              // S -> K  thick (delivers the bulk to K)
  ctx.E(K, P, 1);              // K -> P  thin (flip P->K => +1 to K)
  const pbase = ctx.pair(); ctx.E(pbase, P, 1); // P base -> P starts tight at 2
  attachCharger(ctx, P, 1, len, rng);           // charge P so P->K can flip
  return KT;
}

// ── Difficulty → build plan ──────────────────────────────────────────────────
const INTEGRATED_GADGET_BUILDERS = Object.freeze({
  latch: buildLatch,
  battery: buildBattery,
  mutex: buildMutex,
  cyclePump: buildCyclePump,
  sharedReservoir: buildSharedReservoir,
});
const MID_GADGETS = Object.freeze(["latch", "battery"]);
const HIGH_GADGETS = Object.freeze(["mutex", "cyclePump", "sharedReservoir"]);
const NEW_GADGET_HEADS = new Set([...MID_GADGETS, ...HIGH_GADGETS]);
export const GENERATED_GADGET_THRESHOLDS = Object.freeze({ lowMax: 5, midStart: 6, highStart: 8 });

// Maps a difficulty tier to a head type + recursion budget. The head pool widens
// with d (single -> +AND -> +OR -> +shuttle -> richer gadget families) so EARLY
// boards are simple & varied and LATER ones bring choice, lookahead, and shared
// resource patterns. New gadget families are excluded through tier 5, latch and
// battery unlock at tier 6, and mutex/cyclePump/sharedReservoir unlock at tier 8.
export function difficultyPlan(d, rng, avoidHead) {
  d = Math.max(1, Math.floor(d));
  // Complexity rises SLOWLY: the length budget (which drives par) gains 1 every
  // two tiers, so difficulty creeps up rather than spiking.
  const len = Math.min(10, 1 + Math.floor(d / 2));
  // Head pool widens with progression: gentle shapes first, then the shuttle
  // (backtracking / lookahead) once the player has some boards behind them.
  let pool;
  if (d <= 1) pool = ["single"];                    // gentle first board
  else if (d <= 3) pool = ["and", "or"];
  else if (d === 4) pool = ["cycle"];                // guarantee a true non-tree board early in every Rush run
  else if (d <= GENERATED_GADGET_THRESHOLDS.lowMax) pool = ["and", "or", "cycle"];
  else if (d < GENERATED_GADGET_THRESHOLDS.highStart) pool = ["and", "or", "cycle", ...MID_GADGETS];
  else pool = ["and", "or", "shuttle", ...MID_GADGETS, ...HIGH_GADGETS];
  // "One of a kind": never repeat the previous board's gadget, so consecutive
  // boards always look and play differently — no two near-identical in a row.
  let choices = pool.filter((h) => h !== avoidHead);
  if (choices.length === 0) choices = pool;
  // De-emphasise the plain "single" chain when richer shapes are available, so
  // the rotation leans toward the more interesting gadgets (single was a "hub"
  // that otherwise reappeared every other board).
  const weighted = [];
  for (const h of choices) { weighted.push(h); if (h !== "single") weighted.push(h); }
  const r = rng ? rng() : 0.5;
  return { head: weighted[Math.floor(r * weighted.length)], len };
}

const MAX_NODES = 24; // keep boards phone-legible
const MAX_EDGES = 30; // solver's fast (non-BigInt) path is edges <= 30 (see solver.js encode)

// ── Construction ────────────────────────────────────────────────────────────
// Generate one lock at the given difficulty: pick a plan, compose gadgets, then
// VERIFY (valid start + solvable, plus the gadget's signature property). Retries
// on a malformed/oversized compose; falls back to a guaranteed simple chain so a
// board is always returned.
export function generateLock(difficulty, rng, avoidHead, options = null) {
  const tier = Math.max(1, Math.floor(difficulty));
  for (let attempt = 0; attempt < 16; attempt++) {
    const built = tryBuild(difficultyPlan(difficulty, rng, avoidHead), tier, rng);
    if (built) {
      emitDiagnostics(built, options);
      return built;
    }
  }
  const fallback = tryBuild({ head: "single", len: 2 }, tier, rng) || null; // fallback always verifies
  if (fallback) emitDiagnostics(fallback, options);
  return fallback;
}

function emitDiagnostics(level, options) {
  if (!options || typeof options !== "object") return;
  const mode = options.diagnostics ?? (options.debug ? "basic" : null);
  if (!mode) return;
  const advanced = mode === "all" || mode === "advanced";
  const payload = diagnosticMetrics(level, { advanced });
  if (typeof options.onDiagnostics === "function") options.onDiagnostics(payload);
  if (options.debug || options.logDiagnostics) console.log(JSON.stringify(payload));
}

export function diagnosticMetrics(level, { advanced = false } = {}) {
  const metrics = advanced ? allMetrics(level) : basicMetrics(level);
  return { head: level.head, ...metrics };
}

function integratedHead(ctx, plan, rng) {
  if (plan.head === "cycle") return cycleHead(ctx);
  if (plan.head === "shuttle") return shuttleHead(ctx, plan.len, rng);
  if (plan.head === "latch") return latchHead(ctx, plan.len, rng);
  if (plan.head === "battery") return batteryHead(ctx);
  if (plan.head === "mutex") return mutexHead(ctx);
  if (plan.head === "cyclePump") return cyclePumpHead(ctx);
  if (plan.head === "sharedReservoir") return sharedReservoirHead(ctx);
  return genericHead(ctx, plan.head, plan.len, rng);
}

function rushMetadata(head) {
  if (!NEW_GADGET_HEADS.has(head)) return { head, gadgetFamilies: [], sourceFixture: null };
  const fixture = INTEGRATED_GADGET_BUILDERS[head]();
  return { head, gadgetFamilies: [fixture.metadata.kind], sourceFixture: fixture.id };
}

function tryBuild(plan, tier, rng) {
  const ctx = builder();
  let target;
  try {
    target = integratedHead(ctx, plan, rng);
  } catch (_) { return null; }

  if (ctx.edges.length > MAX_EDGES) return null;
  const ids = [...new Set(ctx.edges.flatMap((e) => [e.u, e.v]))];
  if (ids.length > MAX_NODES) return null;

  const probe = { id: "probe", name: "probe", nodes: ids.map((id) => ({ id, x: 0, y: 0 })), edges: ctx.edges, target };

  let rep;
  try { rep = solveTarget(probe); } catch (_) { return null; } // makeConfig throws on inflow < 2
  if (!rep.solvable) return null;

  // (Shuttle boards force backtracking structurally — asserted across samples in
  // the tests — so we trust construction and skip the expensive exhaustive
  // bfsSolve at runtime; solveTarget above already confirmed solvability.)
  const pos = forceLayout(ids, ctx.edges, rng);
  const nodes = ids.map((id) => ({ id, x: pos[id].x, y: pos[id].y }));
  return {
    id: "lock-d" + tier,
    name: "Lock",
    nodes,
    edges: ctx.edges,
    target,
    par: rep.optimalLength,
    head: plan.head,
    metadata: rushMetadata(plan.head),
  };
}
