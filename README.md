# THE LOCK

A minimalist puzzle built on **Nondeterministic Constraint Logic** (Hearn–Demaine) — the model whose generalized reconfiguration problem is **PSPACE-complete**. One rule set, one hard board. You pick the lock.

## The rule

- A graph of **arrows**. A **thin** arrow is worth **1**, a **thick** one **2**.
- **Every node must always receive ≥ 2 incoming.**
- **Tap an arrow to reverse it** — only allowed if every node still stays fed.
- **Win: reverse the single red arrow.**

Five quick tutorials teach the mechanics, then **THE LOCK** — one hand-tuned board (optimal 16 moves, requires backtracking).

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
```

## Tests

```bash
npm test           # node --test — engine, game, levels (37 tests)
npm run gates      # prints THE LOCK's solver gates as JSON
```

## Structure

| File | Role |
|---|---|
| `src/engine.js` | Pure NCL logic (no DOM): inflow, legality, flip, solved |
| `src/solver.js` | BFS solver + non-triviality gates |
| `src/levels.js` | 5 tutorials + THE LOCK |
| `src/render.js` | SVG board (slack glow, thin/thick edges, red target, animation) |
| `src/game.js` | Moves, undo/reset, par/stars/score, localStorage, share + path hash |
| `src/main.js` | Bootstrap + tutorial flow |
| `scripts/gates.mjs` | CLI gate check |
| `docs/superpowers/specs/` | Design spec |

## Scoring

Each solve is scored against the solver-computed **par** (optimal): `moves ≤ par` → ★★★, `≤ par+5` → ★★, else ★. The shareable result (moves, par, stars, time, and a path-hash that proves a genuine solve without revealing the route) is the substrate for competition.
