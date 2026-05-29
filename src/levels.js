// THE LOCK — level data.
//
// A Level conforms to the engine shape (see docs/.../the-lock-design.md §6):
//   { id, name, nodes:[{id,x,y}], edges:[{id,u,v,w,dir}], target, par, hint? }
//   dir "uv" => arrow points u->v (delivers w to v); "vu" => v->u. This is the START.
//   inflow(v) = sum of w over edges currently pointing INTO v; every node needs >= 2.
//
// Layout: x in [0,100], y in [0,160] (portrait phone viewBox), no overlapping nodes.
//
// `par` is the optimal move count = solver.bfsSolve(level).optimalLength. It is a
// precomputed constant here (never recomputed at page load); test/levels.test.js
// asserts every par equals the live solver result.

export const TUTORIALS = [
  // ── Tutorial 1 — Flip ────────────────────────────────────────────────────
  // 1-move solve. Teaches: tap the red arrow to win.
  // Inflows: a=2, b=4(e0+e2), c=2, d=2. Target e0 legal: 4-2=2>=2.
  {
    id: "tut-1", name: "Tutorial 1 — Flip", par: 1,
    nodes: [
      // Staple layout: the a<->b target pair sits up top, c hangs below b, and the
      // c<->d battery pair is pulled out to the right — so nothing crosses the red
      // arrow (the old diamond ran the c<->d pair straight through the middle).
      { id: "a", x: 22, y: 34 },
      { id: "b", x: 60, y: 34 },
      { id: "c", x: 60, y: 70 },
      { id: "d", x: 92, y: 70 },
    ],
    edges: [
      { id: "e0", u: "a", v: "b", w: 2, dir: "uv" }, // TARGET a->b
      { id: "e1", u: "a", v: "b", w: 2, dir: "vu" }, // b->a
      { id: "e2", u: "c", v: "b", w: 2, dir: "uv" }, // c->b (gives b slack)
      { id: "e3", u: "c", v: "d", w: 2, dir: "uv" }, // c->d
      { id: "e4", u: "c", v: "d", w: 2, dir: "vu" }, // d->c
    ],
    target: "e0",
    hint: "Tap the red arrow to reverse it.",
  },

  // ── Tutorial 2 — The >=2 Rule ────────────────────────────────────────────
  // 1-move solve. Teaches: tight nodes block flips; find the slack node.
  // Inflows: a=2, b=3(e0+e2), c=2, d=2.
  // e0 ILLEGAL: 3-2=1<2. e2 LEGAL (TARGET): 3-1=2>=2.
  {
    id: "tut-2", name: "Tutorial 2 — The >=2 Rule", par: 1,
    nodes: [
      { id: "a", x: 20, y: 50 },
      { id: "b", x: 50, y: 50 },
      { id: "c", x: 80, y: 33 },
      { id: "d", x: 80, y: 67 },
    ],
    edges: [
      { id: "e0", u: "a", v: "b", w: 2, dir: "uv" }, // a->b thick — ILLEGAL to flip
      { id: "e1", u: "a", v: "b", w: 2, dir: "vu" }, // b->a
      { id: "e2", u: "c", v: "b", w: 1, dir: "uv" }, // TARGET c->b thin
      { id: "e3", u: "c", v: "d", w: 2, dir: "uv" }, // c->d
      { id: "e4", u: "c", v: "d", w: 2, dir: "vu" }, // d->c
    ],
    target: "e2",
    hint: "Not every arrow can be reversed. Find where there is surplus.",
  },

  // ── Tutorial 3 — Slack ───────────────────────────────────────────────────
  // 2-move solve. Teaches: build surplus on a neighbor to unlock the target.
  // Inflows: a=2, b=3(et+e2) target BLOCKED(3-2=1<2), c=2, d=6(e3+e5+e6), e=2.
  // Move 1: flip e3 (b->d, recv=d inflow=6, legal). After: d->b. inflow(b)=5.
  // Move 2: flip et. Win.
  {
    id: "tut-3", name: "Tutorial 3 — Slack", par: 2,
    nodes: [
      { id: "a", x: 20, y: 50 },
      { id: "b", x: 50, y: 50 },
      { id: "c", x: 80, y: 33 },
      { id: "d", x: 80, y: 67 },
      { id: "e", x: 80, y: 88 },
    ],
    edges: [
      { id: "et", u: "a", v: "b", w: 2, dir: "uv" }, // TARGET a->b (blocked)
      { id: "e1", u: "a", v: "b", w: 2, dir: "vu" }, // b->a
      { id: "e2", u: "c", v: "b", w: 1, dir: "uv" }, // c->b thin
      { id: "e3", u: "b", v: "d", w: 2, dir: "uv" }, // b->d (flip->d->b: +2 to b)
      { id: "e4", u: "d", v: "e", w: 2, dir: "uv" }, // d->e
      { id: "e5", u: "d", v: "e", w: 2, dir: "vu" }, // e->d
      { id: "e6", u: "c", v: "d", w: 2, dir: "uv" }, // c->d
      { id: "e7", u: "c", v: "d", w: 2, dir: "vu" }, // d->c
    ],
    target: "et",
    hint: "Create surplus on the neighbor first, then flip the target.",
  },

  // ── Tutorial 4 — AND Dependency ──────────────────────────────────────────
  // 3-move solve. Teaches: two thin edges must BOTH be rerouted inward (1+1=2)
  // before the thick target opens.
  // Inflows: a=2, b=2(et) target BLOCKED(2-2=0<2), c=3(e2+e4), d=3(e3+e6), e=2, f=2.
  // Move 1: flip e2 (b->c, recv=c 3-1=2>=2). After: c->b. inflow(b)=3.
  // Move 2: flip e3 (b->d, recv=d 3-1=2>=2). After: d->b. inflow(b)=4.
  // Move 3: flip et. Win.
  {
    id: "tut-4", name: "Tutorial 4 — AND Dependency", par: 3,
    nodes: [
      { id: "a", x: 20, y: 50 },
      { id: "b", x: 50, y: 50 },
      { id: "c", x: 72, y: 28 },
      { id: "d", x: 72, y: 72 },
      { id: "e", x: 90, y: 28 },
      { id: "f", x: 90, y: 72 },
    ],
    edges: [
      { id: "et", u: "a", v: "b", w: 2, dir: "uv" }, // TARGET a->b (blocked)
      { id: "e1", u: "a", v: "b", w: 2, dir: "vu" }, // b->a
      { id: "e2", u: "b", v: "c", w: 1, dir: "uv" }, // b->c thin (flip->c->b: +1)
      { id: "e3", u: "b", v: "d", w: 1, dir: "uv" }, // b->d thin (flip->d->b: +1)
      { id: "e4", u: "e", v: "c", w: 2, dir: "uv" }, // e->c
      { id: "e5", u: "c", v: "e", w: 2, dir: "uv" }, // c->e
      { id: "e6", u: "f", v: "d", w: 2, dir: "uv" }, // f->d
      { id: "e7", u: "d", v: "f", w: 2, dir: "uv" }, // d->f
    ],
    target: "et",
    hint: "Both thin arrows must cooperate before the thick target opens.",
  },

  // ── Tutorial 5 — OR Choice ───────────────────────────────────────────────
  // 2-move solve. Teaches: a node with three thick edges (OR) needs only ONE
  // incoming. Two equivalent commitments free the target — pick either one.
  // Inflows: h=4, a=2, b=2, d=2(et) target BLOCKED, p=4(e7+e5), q=4(e8+e6).
  // Path A: flip e5 (d->p, recv=p 4-2=2>=2). After: p->d. inflow(d)=4. Flip et. Win.
  // Path B: flip e6 (d->q) instead. Same outcome.
  {
    id: "tut-5", name: "Tutorial 5 — OR Choice", par: 2,
    nodes: [
      { id: "h", x: 50, y: 28 },
      { id: "a", x: 20, y: 10 },
      { id: "b", x: 80, y: 10 },
      { id: "d", x: 50, y: 58 },
      { id: "p", x: 22, y: 78 },
      { id: "q", x: 78, y: 78 },
    ],
    edges: [
      { id: "e1", u: "a", v: "h", w: 2, dir: "uv" }, // a->h
      { id: "e2", u: "b", v: "h", w: 2, dir: "uv" }, // b->h
      { id: "e3", u: "a", v: "b", w: 2, dir: "uv" }, // a->b
      { id: "e4", u: "a", v: "b", w: 2, dir: "vu" }, // b->a
      { id: "et", u: "h", v: "d", w: 2, dir: "uv" }, // TARGET h->d (blocked)
      { id: "e5", u: "d", v: "p", w: 2, dir: "uv" }, // d->p (flip->p->d: +2)
      { id: "e6", u: "d", v: "q", w: 2, dir: "uv" }, // d->q (alt: flip->q->d: +2)
      { id: "e7", u: "p", v: "q", w: 2, dir: "uv" }, // p->q
      { id: "e8", u: "p", v: "q", w: 2, dir: "vu" }, // q->p
    ],
    target: "et",
    hint: "Two paths lead to the same lock. Either choice works — commit.",
  },

  // ── Tutorial 6 — Lend & Reclaim (the shuttle) ────────────────────────────
  // 7-move solve. Teaches the BACKTRACKING move that THE LOCK is built around:
  // to satisfy K you must first send the thin S->T arrow the "wrong" way (LEND
  // it — T drops toward the blocked state), rearrange K through its battery,
  // then RECLAIM it. Greedy play (only ever moving toward the goal) dead-ends —
  // solver-verified backtrackingRequired (see test/levels.test.js).
  // Inflows: T=3, K=2, S=2, B=2, Db=5, Ds=2.
  // Target KT BLOCKED move 1 (T 3-2=1<2). Route: ST KS KD SK ST TS KT
  //   (ST appears twice — lend on move 1, reclaim on move 5.)
  {
    id: "tut-6", name: "Tutorial 6 — Lend & Reclaim", par: 7,
    nodes: [
      { id: "T",  x: 52, y: 50 },  // target receiver
      { id: "K",  x: 30, y: 78 },  // target sender
      { id: "S",  x: 74, y: 78 },  // shuttle partner
      { id: "B",  x: 92, y: 102 }, // S's ballast sink
      { id: "Db", x: 30, y: 110 }, // K's battery (chargeable donor)
      { id: "Ds", x: 16, y: 134 }, // battery tail
    ],
    edges: [
      { id: "KT", u: "K", v: "T",  w: 2, dir: "uv" }, // TARGET K->T (blocked)
      { id: "ST", u: "S", v: "T",  w: 1, dir: "uv" }, // S->T thin — the SHUTTLE (lend/reclaim)
      { id: "TS", u: "T", v: "S",  w: 1, dir: "uv" }, // T->S thin
      { id: "KS", u: "K", v: "S",  w: 1, dir: "uv" }, // K->S thin
      { id: "SK", u: "S", v: "K",  w: 2, dir: "uv" }, // S->K thick (bulk to K)
      { id: "SB", u: "S", v: "B",  w: 2, dir: "uv" }, // S->B ballast
      { id: "KD", u: "K", v: "Db", w: 1, dir: "uv" }, // K->battery thin (flip Db->K: +1 to K)
      { id: "Dbs", u: "Db", v: "Ds", w: 2, dir: "uv" }, // battery internal
      { id: "Dsb1", u: "Ds", v: "Db", w: 2, dir: "uv" },
      { id: "Dsb2", u: "Ds", v: "Db", w: 2, dir: "uv" },
    ],
    target: "KT",
    hint: "Sometimes you must go backwards first: lend a thin arrow the wrong way, free up the lock, then reclaim it.",
  },
];

// ── THE LOCK ──────────────────────────────────────────────────────────────────
// 16 nodes, 21 edges. The hero board. It is a dependency CHAIN with a "move away
// from the goal" maneuver at its head (spec §7 gates).
//
// Shape:
//  - Target KT (K->T, thick, red). T starts tight-ish (inflow 3) so KT is BLOCKED
//    on move 1: to reverse KT, T must reach inflow 4.
//  - The head {T,K,S,B} is a shuttle gadget. The thin edge ST is a unit you must
//    LEND from T to S (flip it OUT, moving the board AWAY from the solved state) to
//    rearrange K and S, then RECLAIM it (flip ST back) once K is satisfied. Greedy
//    play (always reduce distance to the goal) dead-ends here — backtracking is
//    forced.
//  - K can only reach the inflow it needs by receiving a unit through pK, which is
//    gated behind a serial slack-pump LADDER P0 -> Q0 -> Q1 -> ... -> Q6, topped by
//    an OR-pair {Y1,Y2}. Each ladder stage must be pumped in turn (a chain of
//    dependencies); the surplus is threaded down one node at a time.
//
// Solver-verified (test/levels.test.js): par = 16, reachable component = 92 states,
// target NOT flippable on move 1, backtracking required (greedy cannot reach goal).
// Optimal route: ST KS y1 y2 q6 q5 q4 q3 q2 q1 q0 pK SK ST TS KT
//   (ST appears twice: lend, then reclaim — the move-away moment.)
//
// Start inflows (all >= 2): T=3, K=2, S=2, B=2, P0=2, Pa=2, Pb=2,
//   Q0..Q6=2 each, Y1=3, Y2=3.
export const THE_LOCK = {
  id: "the-lock",
  name: "THE LOCK",
  par: 16,
  nodes: [
    // Head: target cluster + shuttle (bottom of the board).
    { id: "T",  x: 50, y: 150 }, // target receiver
    { id: "K",  x: 32, y: 132 }, // target sender
    { id: "S",  x: 68, y: 132 }, // shuttle partner
    { id: "B",  x: 86, y: 146 }, // S's ballast sink
    // Payload junction feeding K.
    { id: "P0", x: 32, y: 112 },
    { id: "Pa", x: 52, y: 116 }, // P0 anchor
    { id: "Pb", x: 68, y: 110 }, // Pa partner
    // Serial slack-pump ladder (serpentine for phone readability).
    { id: "Q0", x: 22, y: 96 },
    { id: "Q1", x: 44, y: 90 },
    { id: "Q2", x: 24, y: 76 },
    { id: "Q3", x: 46, y: 68 },
    { id: "Q4", x: 26, y: 54 },
    { id: "Q5", x: 48, y: 44 },
    { id: "Q6", x: 30, y: 30 },
    // OR-pair: the ladder's initial slack source.
    { id: "Y1", x: 20, y: 14 },
    { id: "Y2", x: 46, y: 16 },
  ],
  edges: [
    // Head / shuttle gadget.
    { id: "SB", u: "S", v: "B", w: 2, dir: "uv" }, // S->B  (S's ballast)
    { id: "ST", u: "S", v: "T", w: 1, dir: "uv" }, // S->T  thin (the SHUTTLE: lend/reclaim)
    { id: "KT", u: "K", v: "T", w: 2, dir: "uv" }, // K->T  TARGET (red)
    { id: "KS", u: "K", v: "S", w: 1, dir: "uv" }, // K->S  thin
    { id: "TS", u: "T", v: "S", w: 1, dir: "uv" }, // T->S  thin
    { id: "SK", u: "S", v: "K", w: 2, dir: "uv" }, // S->K  thick (delivers the bulk to K)
    // Payload into K, gated by the ladder.
    { id: "pK",   u: "K",  v: "P0", w: 1, dir: "uv" }, // K->P0 thin (flip-> +1 to K)
    { id: "PaIn", u: "Pa", v: "P0", w: 1, dir: "uv" }, // Pa->P0 thin (P0 base)
    { id: "Pa_a", u: "Pa", v: "Pb", w: 2, dir: "uv" }, // Pa<->Pb thick pair (keeps Pa legal)
    { id: "Pa_b", u: "Pa", v: "Pb", w: 2, dir: "vu" },
    // Serial slack-pump ladder: q_k delivers +2 down to the previous stage when flipped.
    { id: "q0", u: "P0", v: "Q0", w: 2, dir: "uv" },
    { id: "q1", u: "Q0", v: "Q1", w: 2, dir: "uv" },
    { id: "q2", u: "Q1", v: "Q2", w: 2, dir: "uv" },
    { id: "q3", u: "Q2", v: "Q3", w: 2, dir: "uv" },
    { id: "q4", u: "Q3", v: "Q4", w: 2, dir: "uv" },
    { id: "q5", u: "Q4", v: "Q5", w: 2, dir: "uv" },
    { id: "q6", u: "Q5", v: "Q6", w: 2, dir: "uv" },
    // OR-pair top: flipping both thin edges inward injects the initial +2.
    { id: "y1", u: "Q6", v: "Y1", w: 1, dir: "uv" }, // Q6->Y1 thin
    { id: "y2", u: "Q6", v: "Y2", w: 1, dir: "uv" }, // Q6->Y2 thin
    { id: "ya", u: "Y1", v: "Y2", w: 2, dir: "uv" }, // Y1<->Y2 thick pair
    { id: "yb", u: "Y1", v: "Y2", w: 2, dir: "vu" },
  ],
  target: "KT",
  hint: "Reverse the red arrow.",
};

// All levels, in play order: the five tutorials then the hero board.
export const LEVELS = [...TUTORIALS, THE_LOCK];
