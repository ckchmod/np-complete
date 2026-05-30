# THE LOCK

A minimalist phone-style puzzle built on **Nondeterministic Constraint Logic (NCL)**, the Hearn-Demaine model whose edge-reversal problem is **PSPACE-complete**. The intro opens to a mode menu with **Tutorial**, **Puzzle Rush**, **Battle Hot-seat**, and **Battle vs AI**. Rush asks how many generated locks you can pick before three strikes. Battle turns the same constraint graph into a local duel, either against another person on the same device or browser-controlled Black.

## The rules

- A graph of **arrows**. A **thin** arrow delivers **1**, a **thick** one delivers **2**.
- **Every node must always have >= 2 arriving.** This never changes. It's the law of the board, not the goal.
- **Tap an arrow to reverse it**, allowed only if *every* node still has >= 2 afterward.
- **Win: reverse the one red arrow.** A faint outline marks where it has to end up.

Because the >=2 rule is satisfied at *every* moment, "win" is **not** "make the nodes legal." It's reaching the single configuration where the red arrow points the other way, without ever breaking the rule along the way. Like a scrambled Rubik's cube: every state is a valid cube, but only one arrangement is *solved*. The red arrow usually starts **locked** because reversing it immediately would starve a node. The puzzle is the sequence of other flips that frees it.

## Game flow

Play starts with the intro, then opens the mode menu. You can start with Tutorial, jump into Puzzle Rush, play Battle Hot-seat, or play Battle vs AI. Tutorial, Rush, and Battle screens include Main Menu or abandon controls so you can leave an active mode without waiting for a win or loss.

- **Tutorial:** six authored boards that teach the inflow rule, target locks, and scoring.
- **Puzzle Rush:** endless solver-verified generated locks with move budgets, skips, and three strikes. When the run ends, you can copy the result, play again, or return to mode selection.
- **Battle Hot-seat:** local play for two people on the same device.
- **Battle vs AI:** the same Battle rules with Black controlled by client-side rule/search code. It doesn't call an LLM, server, or external service.

There is no network play, account system, or persistent Battle profile.

## Battle rules

Battle keeps the NCL inflow law and adds a finite two-player layer:

- White and Black take turns. Passing isn't allowed.
- Edges can be owned by White, owned by Black, or neutral.
- On your turn, you may flip your own edges and neutral edges if the flip is legal under the >=2 inflow rule.
- Each edge has a finite number of charges. A flip spends one charge, and spent edges can't be flipped again.
- White wins by flipping the White target. Black wins by flipping the Black target.
- If it's your turn and you have no legal move, you lose.
- In Battle vs AI, Black follows the same rules but chooses its moves with deterministic browser game AI.
- After a Battle ends, replay analysis can show check moments, missed defenses, and zugzwang notes. It stays hidden during active play.

## Why it's actually hard, and what "PSPACE-complete" means

The board is a **constraint graph** from Robert Hearn & Erik Demaine's *Nondeterministic Constraint Logic*. Each edge has weight 1 (thin) or 2 (thick), every vertex must keep an inflow of at least 2, and a move reverses one edge while leaving every vertex satisfied. The decision problem is:

> *Given a legal configuration and a target edge, can a sequence of legal single-edge reversals flip that target edge?*

That problem is **PSPACE-complete** for the infinite family of NCL instances. In the Hearn-Demaine reduction from Quantified Boolean Formulas, the **target edge can be reversed if and only if the encoded QBF is true**, so the red arrow acts like the output bit of an encoded computation. AND and OR gadgets built from thin and thick edges supply the logic. NCL is also used to prove hardness for puzzles and games such as Rush Hour and sliding-block puzzles.

**About the repo name.** `np-complete` is a casual nod, not a precise claim. NCL edge-reversal is **PSPACE-complete**, a class believed to be strictly harder than NP. We have P ⊆ NP ⊆ PSPACE, and PSPACE-complete problems are at least as hard as every NP problem. The name just stuck.

**Honest caveat.** Any *single, fixed* board is a finite puzzle: brute-forceable, technically O(1). PSPACE-completeness is a statement about the infinite *family* of NCL instances, not about one board. What you feel while solving a lock is real search difficulty because the space of reachable configurations grows combinatorially, not a claim that one board is PSPACE-hard. A Sokoban level or a Rush Hour board works the same way: one instance from a provably hard family.

## How the puzzles are made

Each Rush lock is generated live in the browser and verified by the solver before you see it:

- The red target points into a root node that can only be reversed once it gains enough inflow.
- Earlier boards use relay and AND/OR patterns to teach the core logic, then introduce a compact cycle head so the progression does not stay purely tree-shaped.
- Higher tiers can draw from richer gadget families such as latch, battery, mutex, cycle-pump, shared-reservoir, and shuttle-style patterns.
- Difficulty metrics report things like reachable states, diameter, branching, par, and other search properties. The generator uses solver checks so each accepted board is solvable and has a true shortest solution length.

Battle boards are generated from the same NCL base, then checked as finite charged two-player games before play starts. The generator enforces outcome balance internally, but the UI doesn't expose solution routes or strategy tables.

## Run it (no build, no dependencies)

ES modules must be served over HTTP. Opening `index.html` as a `file://` will **not** work.

```bash
npm start          # serves at http://localhost:8000  (uses python3 -m http.server)
# or directly:
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

### GitHub Pages

The repository includes a Pages workflow at `.github/workflows/pages.yml`. Pushes to `main` upload the static repo root and deploy it with GitHub Pages, so the published view updates from `main` without a build step.

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
npm test           # node --test across engine, solver, levels, metrics, generator, Rush, Battle, replay, PWA, render, and main flow
npm run gates      # prints the solver gates (THE LOCK, THE_LOCK_V2, tutorials) as JSON
```

## Manual offline QA checklist

- Open the app in a browser.
- Open DevTools, switch Network to Offline, then refresh the page.
- Confirm the intro or tutorial screen still loads.
- Navigate through the tutorials and confirm they still advance.
- Start Puzzle Rush and confirm the board appears and plays normally.
- Start Battle vs AI and confirm the board appears and the mode starts.

## Structure

| File | Role |
|---|---|
| `src/engine.js` | Pure NCL logic with no DOM: inflow, move legality, flip, solved check |
| `src/solver.js` | BFS solver for exhaustive gates, goal-directed solving, and non-triviality reports |
| `src/difficultyMetrics.js` | Reachability, par, diameter, branching, path, slack, and contention metrics |
| `src/gadgetBuilders.js` | Standalone gadget fixtures and metadata for richer generated lock families |
| `src/generator.js` | Live Rush generator with solver verification, gadget-family sampling, and diagnostics hooks |
| `src/levels.js` | 6 tutorials plus authored **THE LOCK** and **THE_LOCK_V2** boards outside Rush |
| `src/render.js` | SVG board: curved edges, weight-scaled arrowheads, slack glow, red targets, ghost markers, flip animation, and Battle badges |
| `src/game.js` | Tutorial controller: moves, undo/reset, par/stars/score, localStorage, share + path hash |
| `src/rush.js` | Puzzle Rush: endless generated locks, move budget, 3 strikes, difficulty ramp |
| `src/battleEngine.js` | Battle rules: turns, ownership, charges, legal flips, target wins, and no-legal-move losses |
| `src/battleSolver.js` | Finite charged-game solver and balance metrics for generated Battle boards |
| `src/battleGenerator.js` | Deterministic Battle board generator with solver-complete balance checks |
| `src/battle.js` | Battle controller for local hot-seat play and injected UI refs |
| `src/aiBattle.js` | Client-side Battle vs AI move choice using rule/search heuristics, not an LLM |
| `src/replay.js` | Generic replay timeline helpers for move history and snapshots |
| `src/replayUI.js` | Shared replay controls and UI binding |
| `src/battleReplay.js` | Battle replay analysis for checks, missed defenses, and zugzwang after terminal play |
| `src/main.js` | Bootstrap: intro, mode menu, tutorials, Rush, Battle, and service worker registration |
| `manifest.json` | PWA metadata for installable app shell |
| `sw.js` | Service worker and offline cache for the static app |
| `scripts/gates.mjs` | JSON solver gate CLI |
| `scripts/metric-report.mjs` | Zero-dependency generated-board metric report CLI |
| `docs/superpowers/specs/` | Design and quality-pass specs |

## Scoring

**Tutorials** are scored against the solver-computed **par** (optimal): `moves <= par` gives three stars, `moves <= par+5` gives two, and anything else gives one. Share text includes moves, par, stars, time, and a path hash that proves a genuine solve without revealing the route.

**Puzzle Rush** is a survival streak: you score the number of locks picked before three strikes. Going over the per-lock move budget or skipping a lock costs a strike.

**Battle** is winner-take-all local play. Flip your target to win, or trap the other player with no legal move.
