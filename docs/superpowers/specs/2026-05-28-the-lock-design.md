# THE LOCK — Design Spec

**Date:** 2026-05-28
**Status:** Approved (concept). Pending spec review before writing the implementation plan.
**Topic:** Mobile-first web puzzle game based on Nondeterministic Constraint Logic (NCL).

---

## 1. Vision

One puzzle. A network of arrows on a black screen. The whole rule set fits in two sentences. Underneath, it is the Hearn–Demaine **Nondeterministic Constraint Logic** model — the canonical framework whose generalized reconfiguration problem is **PSPACE-complete**. The player never hears the word "math." They just try to reverse one red arrow and discover it is a lock that has to be picked.

No daily puzzle. No theme. No accounts. One canonical hard board (**THE LOCK**) plus a short tutorial ramp.

## 2. The Rule (player-facing)

- A graph of nodes joined by **arrows**. A **thin** arrow is worth **1**, a **thick** arrow is worth **2**.
- **Every node must always receive at least 2 units of incoming arrows.**
- **Tap an arrow to reverse it** — allowed only if every node still has ≥ 2 incoming after the flip.
- **You win when you reverse the single red arrow.**

That is the entire game.

## 3. Mathematical Foundation (hidden from the player)

This is literally a Hearn–Demaine constraint graph with a minimum-inflow-2 constraint. Two invisible gadgets give it logical structure and let the board be hand-designed:

- **AND node** — degree 3 with weights {1, 1, 2}. The thick (weight-2) edge can point *outward* only when **both** thin edges point inward (1 + 1 = 2). → models dependency.
- **OR node** — degree 3, all weights 2. Any one edge can point outward as long as **at least one** of the others points inward (2 ≥ 2). → models choice.

Wired into a dependency chain, deciding whether a target edge can ever be reversed is PSPACE-complete in general. The felt skill is **managing slack**: a node with inflow > 2 has surplus that lets you release one of its incoming arrows; that release may unlock the next dependency. Greedy play dead-ends naturally.

## 4. Formal Model & Move Semantics

- Constraint graph `G = (V, E)`. Each edge `e` has weight `w(e) ∈ {1, 2}` and an orientation `(from, to)`: the arrow points from `from` to `to` and delivers `w(e)` units of inflow to `to`.
- `inflow(v) = Σ w(e)` over edges with `e.to == v`.
- **Invariant:** for all `v`, `inflow(v) ≥ 2`. A configuration (orientation of every edge) is *legal* iff it satisfies the invariant.
- **Move:** pick edge `e`, reverse it (swap `from`/`to`). Reversal changes inflow only at the two endpoints: `−w(e)` at the old `to`, `+w(e)` at the old `from`. The gaining endpoint can never violate, so the move is **legal iff `inflow(e.to) − w(e) ≥ 2`**.
- **Start:** a designated legal configuration.
- **Target:** a designated edge `t`. **Solved** when `t`'s orientation is the reverse of its start orientation.

Move legality is a single local check — no solver needed at runtime. Flips are involutive (flipping twice returns to the prior state), which is what creates the reversible, lock-picking state space.

## 5. Architecture (zero backend, zero runtime dependencies)

Vanilla JS, ES modules, SVG. Served as static files (instantly hostable like 2048/Wordle; dev via a one-line static server). No framework, no bundler, no runtime deps.

| Module | Responsibility | Key surface |
|---|---|---|
| `src/engine.js` | Pure NCL logic, **no DOM** | `makeConfig(level)`, `inflow(config, v)`, `legalFlips(config) → edgeIds[]`, `isLegalFlip(config, e)`, `applyFlip(config, e) → config'` (immutable), `isSolved(config)` |
| `src/levels.js` | Level data | `LEVELS` = tutorials + THE LOCK (nodes, edges, target) |
| `src/solver.js` | Build/test-time verification | `bfsSolve(level) → {solvable, optimalLength, goalConfig, reachableCount}`, `greedyReaches(level, goalConfig) → bool` |
| `src/render.js` | SVG build + per-move update, animations | renders a config; emits `edge-tap`; pulses affected nodes |
| `src/game.js` | Session state | move list, **undo**, **reset**, win handling, `localStorage`, share string + path hash |
| `src/main.js` | Bootstrap, tutorial flow / level selection | — |
| `index.html`, `styles.css` | Shell + noir theme | — |

Tests (Node's built-in runner, no deps): `test/engine.test.js`, `test/levels.test.js`. Run with `node --test`.

## 6. Data Model

```js
Level = {
  id: "the-lock",
  name: "THE LOCK",
  nodes: [{ id: "n0", x: 50, y: 20 }, ...],        // x,y in a fixed viewBox (portrait)
  edges: [{ id: "e0", u: "n0", v: "n1", w: 1, dir: "uv" }, ...],
  // dir "uv" => arrow points u->v (delivers w to v); "vu" => v->u. This is the START orientation.
  target: "e7",                                     // the red edge; win = target reversed from start
}
```

A level is valid iff its start orientation is legal (every node inflow ≥ 2). Verified by tests.

## 7. Solver & Non-Triviality Gates

Configuration encoded as a bitmask over edges (bit = orientation vs. a fixed canonical direction). `bfsSolve` explores legal configurations from the start; neighbors are legal single-edge flips. It runs the BFS to exhaustion (not stopping at the goal) so it returns both the shortest path to any configuration where `t` is reversed (optimal length `L`, with a witnessing goal config `g*`) and the full reachable-component size — the count of all distinct legal configurations reachable from the start — as the §14 tractability sanity bound.

**THE LOCK must pass all gates** (thresholds tuned by playtest):

1. **Solvable** — BFS finds a path.
2. **Not trivial on move 1** — `t` is not flippable from the start.
3. **Challenging but achievable** — optimal length `L` in a gamifiable band: firm lower gate **L ≥ 12** (hard enough that hitting *par* is a real chase), soft upper preference **L ≤ 30** (achievable in a session, not a brutal opaque wall). Sweet spot ~15–25.
4. **Backtracking required** — greedy hill-climb on Hamming distance to `g*` (always take the legal flip that most reduces distance) **cannot** reach `g*`; i.e. every solution must temporarily move *away* from the goal. Heuristic proxy for "you must back out of a decision," confirmed by manual playtest.
5. **Approachable entry** — several legal first moves exist and early moves produce visible progress (slack shifts near the target), so the board is an on-ramp rather than a cold brick.

Tutorials need only gate 1 (solvable) plus a tiny optimal length appropriate to the concept taught.

## 8. Levels

Five micro-tutorials, each isolating one idea, then THE LOCK:

1. **Flip** — one flippable arrow; tap to reverse the red target. Teaches tap + win.
2. **The ≥2 rule** — a node whose last incoming arrow cannot be flipped away; teaches illegal-move feedback.
3. **Slack** — a node fed by a thick arrow so a thin incoming arrow can be released; teaches surplus.
4. **AND dependency** — orient two thin arrows inward to free the thick target.
5. **OR choice** — three thick edges; free the target by committing one of two alternatives (and discover some commitments must be undone).

**THE LOCK** — one hand-designed board (~15–25 nodes, sized to a portrait phone, no panning) built from AND/OR gadgets into a dependency chain with false shortcuts and one or two "move away from the goal" moments. Tuned against the solver until it passes all gates, then playtested.

## 9. UX & Visual Design (minimal noir)

- **Board:** SVG with a fixed viewBox scaled to the screen; THE LOCK fits portrait without panning.
- **Nodes:** circular rings. Required inflow (2) vs. current inflow is shown on the ring; **slack** (`inflow − 2`) renders as a soft outer glow. A **tight** node (slack 0) reads as strained/locked. Slack is the core strategic readout.
- **Edges:** thin (w1) light stroke, thick (w2) heavy stroke, arrowhead marks direction. The **target edge is red**. Legal-to-flip edges get a subtle affordance on press; an illegal tap gives a short shake and pulses the blocking node.
- **Move:** tap/click the edge → reversal animates (arrowhead slides) → affected nodes pulse their new inflow/slack.
- **Win:** target reversal triggers a restrained cascade (nodes pulse in sequence) + a result card.
- **Controls:** Undo (revert last move), Reset (return to start), live move counter. On THE LOCK, "Optimal: N" is revealed only after solving.
- **Onboarding:** the tutorials carry all teaching; no text walls. THE LOCK opens with only "Reverse the red arrow."

Visual polish uses the frontend-design tooling to make the noir aesthetic genuinely striking (depth, glow, motion), not generic.

## 10. Persistence & Sharing

- **localStorage:** tutorial completion, THE LOCK best move count, and in-progress orientation (resume). Undo history is session-only.
- **Share result** (client-only; enables asynchronous competition):

  ```
  THE LOCK
  Solved: 41 moves (optimal 32)
  ⏱ 6:12   ↶ 9 undos
  #9F3A-C71B
  ```

  The trailing **path hash** is a short hash of the canonical move sequence — it proves a genuine solve without revealing the route.

## 11. Scoring, Par & Gamification

Per user directive (2026-05-28): the game **has to be gamifiable** — one hero board, but wrapped in a real competitive/score gradient and an addictive "one more try" loop. Build the score primitives in v1; defer the live leaderboard.

- **Par & stars.** The solver computes the optimal move count = **par**. Each solve is rated: `moves ≤ par` → ★★★ "Master pick"; `par < moves ≤ par+5` → ★★; `moves > par+5` → ★.
- **Score.** One legible number for competition, rewarding fewer moves / less time / fewer undos — e.g. `score = max(0, 1000 − 10·(moves − par) − timePenalty − 2·undos)`, tuned so a clean par-with-no-undos solve is a round number.
- **The loop (why players retry).** Frictionless Undo/Reset; the result card shows `moves · par · stars · personal best` and how close you came. Missing par by a little is the hook to replay. Personal best persists in `localStorage`.
- **Visible progress (anti-bounce).** During play, restrained feedback that the lock is yielding (e.g. a count of nodes near the target that have gained slack) — never the solution path.
- **Onboarding ramp.** The 5 tutorials ease players in so the hero board is not a cold wall.
- **Competition.** The shareable result (score, par, stars, path hash) enables Wordle-style asynchronous "beat my score."
- **Deferred (v2+):** a backend leaderboard / accounts for live global ranking. The architecture stays backend-optional — adding it means POSTing `{score, moves, time, pathHash}` to an API, with **server-side validation by replaying the move sequence through the same pure `engine.js`**. No rework of the game core.

## 12. Verification Plan (how I self-evaluate)

- **Unit:** engine preserves the ≥2 invariant; flip legality is correct; win fires only on real target reversal.
- **Property:** from random legal configs, every `applyFlip` result is legal; flips are involutive.
- **Solver gates:** all tutorials solvable; THE LOCK passes gates 1–4 of §7.
- **Manual:** run in a browser (desktop + mobile viewport); play every tutorial and solve THE LOCK end-to-end; confirm share string, persistence, undo/reset, and win cascade.
- Each milestone is committed and **pushed to GitHub**.

## 13. Out of Scope (v1)

Daily puzzles · accounts/auth · ads · procedural generation · native shell · level editor · live backend leaderboard · sound · i18n. (YAGNI — revisit after playable.)

## 14. Risks & Open Questions

- **Solver tractability:** THE LOCK's reachable state space must be BFS-tractable (target ≲ 1e6–1e7 states). Mitigation: keep ~15–25 edges; bound the search if needed. Runtime win-check needs no solver, so this only constrains design-time verification.
- **Hard-for-humans yet small-for-computer:** hand-designing this balance takes iteration with solver + playtest.
- **Small-screen readability** with ~25 nodes: tune layout/sizes; the fixed viewBox must stay legible.
- **"Compete against each other"** ultimately wants a backend; v1 ships async sharing only. Set expectations accordingly.
