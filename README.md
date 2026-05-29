# THE LOCK

A minimalist phone-style puzzle built on **Nondeterministic Constraint Logic (NCL)** — the Hearn–Demaine model whose edge-reversal problem is **PSPACE-complete**. Five quick tutorials teach the rules, then **Puzzle Rush**: an endless stream of freshly generated locks of rising difficulty. How many can you pick before three strikes?

## The rules

- A graph of **arrows**. A **thin** arrow delivers **1**, a **thick** one delivers **2**.
- **Every node must always have ≥ 2 arriving.** This never changes — it's the law of the board, not the goal.
- **Tap an arrow to reverse it** — allowed only if *every* node still has ≥ 2 afterward.
- **Win: reverse the one red arrow.** A faint outline marks where it has to end up.

Because the ≥2 rule is satisfied at *every* moment, "win" is **not** "make the nodes legal" — it's reaching the single configuration where the red arrow points the other way, without ever breaking the rule along the way. Like a scrambled Rubik's cube: every state is a valid cube, but only one arrangement is *solved*. The red arrow usually starts **locked** (reversing it immediately would starve a node); the puzzle is the sequence of other flips that frees it.

## Why it's actually hard — and what "PSPACE-complete" means

The board is a **constraint graph** from Robert Hearn & Erik Demaine's *Nondeterministic Constraint Logic*. Each edge has weight 1 (thin) or 2 (thick); every vertex must keep an inflow of at least 2; a move reverses one edge and must leave every vertex satisfied. The decision problem —

> *Given a legal configuration and a target edge, can a sequence of legal single-edge reversals flip that target edge?*

— is **PSPACE-complete** (Hearn & Demaine, by reduction from Quantified Boolean Formulas). In that reduction the **target edge can be reversed if and only if the encoded QBF is true** — so the red arrow is literally the *output bit* of an encoded computation, and AND / OR gadgets built from the thin/thick edges are its logic. NCL is the framework used to prove a long list of puzzles and games hard (Rush Hour, sliding-block puzzles, and more) — our red arrow is their "red car."

**About the repo name.** `np-complete` is a casual nod, not a precise claim. NCL edge-reversal is **PSPACE-complete** — a class *believed to be strictly harder* than NP (we have P ⊆ NP ⊆ PSPACE, and PSPACE-complete problems are at least as hard as every NP problem). So if anything the honest label is "*harder* than NP-complete." The name just stuck.

**Honest caveat.** Any *single, fixed* board is a finite puzzle — brute-forceable, technically O(1). PSPACE-completeness is a statement about the infinite *family* of NCL instances, not about one board. What you feel while solving a lock is real search difficulty (the space of reachable configurations blows up combinatorially), not a claim that one board is PSPACE-hard. Every puzzle game is like this: a Sokoban level or a Rush Hour board is one instance of a provably hard family.

## How the puzzles are made

Each Rush lock is a **branching relay tree**, generated live in the browser and verified by the solver before you see it:

- The red target points into a root node that can only be reversed once it gains enough inflow.
- That inflow arrives through **two sub-relays joined by an AND junction** (two *thin* edges that must *both* be flipped inward) — so you have to resolve multiple branches, not just unwind a line.
- Difficulty scales the relay lengths; every board is checked to be solvable (and its **par** = the true shortest solution) before it's shown.

Because the graph is a tree, a force-directed layout spreads it out (no "everything in a ring" look), and each board is randomly rotated/mirrored so consecutive locks look distinct.

## Run it (no build, no dependencies)

ES modules must be served over HTTP — opening `index.html` as a `file://` will **not** work.

```bash
npm start          # serves at http://localhost:8000  (uses python3 -m http.server)
# or directly:
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

### Test on your phone (same Wi-Fi)

Find your computer's LAN IP and open `http://<that-ip>:8000` on the phone:

```bash
# macOS:
ipconfig getifaddr en0
# Linux:
hostname -I
```

## Tests

```bash
npm test           # node --test — engine, solver, levels, generator, rush (44 tests)
npm run gates      # prints the solver gates (THE LOCK + tutorials) as JSON
```

## Structure

| File | Role |
|---|---|
| `src/engine.js` | Pure NCL logic (no DOM): inflow, move legality, flip, solved check |
| `src/solver.js` | BFS solver (`bfsSolve` to exhaustion for gates; `solveTarget` goal-directed for the generator) + non-triviality gates |
| `src/generator.js` | Live branching relay-tree generator (AND gadgets, force-directed layout, solver-verified) |
| `src/levels.js` | 5 tutorials + the original hand-tuned **THE LOCK** board (optimal 16, a bonus — not in the Rush flow) |
| `src/render.js` | SVG board: curved edges, weight-scaled arrowheads, slack glow, red target + ghost goal marker, flip animation |
| `src/game.js` | Tutorial controller: moves, undo/reset, par/stars/score, localStorage, share + path hash |
| `src/rush.js` | Puzzle Rush: endless generated locks, move budget, 3 strikes, difficulty ramp |
| `src/main.js` | Bootstrap: intro → tutorials → Rush |
| `scripts/gates.mjs` | CLI gate check |
| `docs/superpowers/specs/` | Design spec |

## Scoring

**Tutorials** are scored against the solver-computed **par** (optimal): `moves ≤ par` → ★★★, `≤ par+5` → ★★, else ★, with a shareable result (moves, par, stars, time, and a path-hash that proves a genuine solve without revealing the route). **Puzzle Rush** is a survival streak — you score the number of locks picked before three strikes (over the per-lock move budget, or a skip, costs a strike).
