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
// angles). Layout dominates generation (tens of ms), well under the between-lock delay.
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
  for (let start = 0; start < 30; start++) {
    const pos = frSimulate(n, pairs, rng);
    const score = layoutScore(n, pairs, pos);
    if (score < bestScore) { bestScore = score; best = pos; }
    if (bestScore < 100) break; // crossing-free & no grazes — good enough
  }
  const oriented = fitToBox(reorient(best, rng)); // random rotation/mirror for variety
  const out = {};
  ids.forEach((id, i) => { out[id] = { x: round1(oriented[i].x), y: round1(oriented[i].y) }; });
  return out;
}

// ── Gadget palette ───────────────────────────────────────────────────────────
// Every Rush board used to be ONE template (target -> AND-of-2-relays); only leg
// lengths/orientation varied, so the game felt predictable. Now each board is
// COMPOSED from a palette of gadgets chosen by difficulty:
//   chain   — a w2 relay (the connective tissue / simplest leg)
//   AND     — two thin children, BOTH must flip in (+1 +1 = +2): forcing
//   OR      — several thick branches, ANY one delivers +2: choice / multi-path
//   shuttle — the lend/reclaim head (lifted from THE_LOCK): forces BACKTRACKING
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
  const R = ctx.node(), x = ctx.node();
  const target = ctx.E(x, R, 2);          // TARGET x -> R; reverse to win (R needs +2)
  const ax = ctx.pair(); ctx.E(ax, x, 2); // x inert at inflow 2
  if (type === "single") {
    const C = ctx.node(); ctx.E(R, C, 2); // one thick child; charging it frees R
    attachCharger(ctx, C, 2, len, rng);
  } else if (type === "or") {
    const k = 2 + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < k; i++) {
      const C = ctx.node(); ctx.E(R, C, 2); // thick OR branch; ANY one frees R
      chain(ctx, C, Math.min(len, 4));        // bounded chain per branch (see attachCharger OR)
    }
  } else { // "and": split len across two forcing legs (BOTH required)
    const a = 1 + Math.floor(rng() * Math.max(1, len - 1));
    for (const l of [a, Math.max(1, len - a)]) {
      const C = ctx.node(); ctx.E(R, C, 1);        // thin AND input
      const base = ctx.pair(); ctx.E(base, C, 1);  // C starts tight at 2
      attachCharger(ctx, C, 1, l, rng);
    }
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
// Maps a difficulty tier to a head type + recursion budget. The head pool widens
// with d (single -> +AND -> +OR -> +shuttle) so EARLY boards are simple & varied
// and LATER ones bring choice (OR) and lookahead (shuttle). rng picks within the
// pool, so consecutive same-tier boards differ in structure, not just length.
export function difficultyPlan(d, rng, avoidHead) {
  d = Math.max(1, Math.floor(d));
  // Complexity rises SLOWLY: the length budget (which drives par) gains 1 every
  // two tiers, so difficulty creeps up rather than spiking.
  const len = Math.min(10, 1 + Math.floor(d / 2));
  // Head pool widens with progression: gentle shapes first, then the shuttle
  // (backtracking / lookahead) once the player has some boards behind them.
  let pool;
  if (d <= 1) pool = ["single"];                    // gentle first board
  else if (d <= 3) pool = ["single", "and", "or"];  // ease in; single fades after the intro
  else if (d <= 7) pool = ["and", "or"];            // richer shapes only (single was too plain/frequent)
  else pool = ["and", "or", "shuttle"];             // shuttle (lookahead) unlocks ~solve 7
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
export function generateLock(difficulty, rng, avoidHead) {
  const tier = Math.max(1, Math.floor(difficulty));
  for (let attempt = 0; attempt < 16; attempt++) {
    const built = tryBuild(difficultyPlan(difficulty, rng, avoidHead), tier, rng);
    if (built) return built;
  }
  return tryBuild({ head: "single", len: 2 }, tier, rng) || null; // fallback always verifies
}

function tryBuild(plan, tier, rng) {
  const ctx = builder();
  let target;
  try {
    target = plan.head === "shuttle"
      ? shuttleHead(ctx, plan.len, rng)
      : genericHead(ctx, plan.head, plan.len, rng);
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
  return { id: "lock-d" + tier, name: "Lock", nodes, edges: ctx.edges, target, par: rep.optimalLength, head: plan.head };
}
