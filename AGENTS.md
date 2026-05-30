# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-29
**Commit:** dc394c2
**Branch:** main

## OVERVIEW
THE LOCK is a static, mobile-first browser puzzle game built from Nondeterministic Constraint Logic. Stack is vanilla ESM JavaScript, SVG, HTML, CSS, Node's built-in test runner, and Python's stdlib HTTP server.

## STRUCTURE
```
np-complete/
├── index.html              # browser shell; loads src/main.js directly
├── styles.css              # noir theme, mode visibility, SVG state classes
├── src/                    # app, rules, solver, generator, rendering
├── test/                   # node:test suite; module-focused files
├── scripts/gates.mjs       # solver/non-triviality JSON gate CLI
└── docs/superpowers/specs/ # dated design and quality-pass specs
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Browser entry / flow | `index.html`, `src/main.js` | `index.html` declares hard-coded IDs; `main.js` toggles intro, tutorials, Rush. |
| NCL legality | `src/engine.js` | Pure logic. No DOM. Inflow invariant lives here. |
| Solver gates / par | `src/solver.js`, `scripts/gates.mjs` | BFS computes optimal length and non-triviality reports. |
| Authored levels | `src/levels.js` | Source of truth for tutorials, THE_LOCK, `par`, `target`, node layout. |
| Rush generation | `src/generator.js`, `src/rush.js` | Generator composes gadgets, validates by solver, then Rush budgets/strikes. |
| SVG board contract | `src/render.js`, `styles.css` | CSS classes/data attrs are coupled to renderer output. |
| Tutorial session state | `src/game.js` | Move history, undo/reset, localStorage resume, scoring/share. |
| Tests | `test/*.test.js` | 117 current node:test cases; README count may lag. |
| Product/spec intent | `docs/superpowers/specs/*.md` | Use for domain decisions before changing mechanics. |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `makeConfig` | function | `src/engine.js` | Builds immutable config and rejects illegal starts. |
| `isLegalFlip` | function | `src/engine.js` | Local move check: old receiver must remain inflow >= 2. |
| `applyFlip` | function | `src/engine.js` | Returns fresh config; flips are involutive. |
| `bfsSolve` | function | `src/solver.js` | Exhaustive BFS for par and reachable count. |
| `solveTarget` | function | `src/solver.js` | Goal-directed BFS used by live generator. |
| `generateLock` | function | `src/generator.js` | Builds solver-verified Rush levels. |
| `createBoard` | function | `src/render.js` | Builds SVG board and exposes update/animation API. |
| `createGame` | function | `src/game.js` | Tutorial-mode controller. |
| `createRush` | function | `src/rush.js` | Survival-mode controller. |
| `TUTORIALS`, `THE_LOCK`, `LEVELS` | constants | `src/levels.js` | Authored game data. |

## CONVENTIONS
- ESM only: package has `"type": "module"`; local imports include explicit `.js`.
- There is no bundler or build step. Static files are the deployable artifact.
- Serve over HTTP. `file://index.html` does not work for ES modules.
- Keep runtime dependencies at zero unless the user explicitly changes that constraint.
- Code comments are unusually load-bearing in `src/engine.js`, `src/solver.js`, `src/generator.js`, and `src/levels.js`; update them only when behavior changes.
- Domain names: thin edge = weight 1, thick edge = weight 2, red edge = target, `par` = solver optimal length.
- `levels.js` par values are contracts with `bfsSolve`, not decorative metadata.
- DOM refs use exact IDs from `index.html`; class names in `styles.css` are part of the renderer contract.
- `scripts/gates.mjs` must print one JSON object to stdout and exit nonzero on error.

## ANTI-PATTERNS (THIS PROJECT)
- Do not weaken the inflow invariant: every node must always have incoming weight >= 2.
- Do not expose or encode solution paths in UI/share text; share hashes prove route without revealing it.
- Do not describe a single fixed board as PSPACE-complete; hardness applies to the infinite NCL family.
- Do not add framework/bundler structure (`components/`, `public/`, etc.) unless requested.
- Do not move DOM IDs/classes casually; JS and CSS are tightly coupled to them.
- Do not edit `.omc/` or `.omo/` as project source; they are local agent/runtime state.

## UNIQUE STYLES
- Minimal noir UI: near-black surface, white/gray graph, red target, cyan legal/win glow, amber slack/low-budget.
- Board coordinates use portrait phone space; authored levels keep `x` in `[0,100]`, `y` in `[0,160]`.
- Rush boards are generated live, seeded with `makeRng`, capped for phone legibility, and solver-verified before display.
- Help is context-aware: tutorial intro outside Rush, Rush rules inside Rush.
- Current source has 6 tutorials and tests have 117 cases; older prose may still say 5 tutorials / 44 tests.

## WORKFLOW
- After every significant milestone, update relevant docs and push the branch once verification passes.
- Before pushing, inspect intended changes, run the project checks, and keep commits atomic.

## COMMANDS
```bash
npm start          # python3 -m http.server 8000; open http://localhost:8000
npm test           # node --test
node --test test/engine.test.js
npm run gates      # JSON solver gates for THE LOCK + tutorials
```

## NOTES
- Baseline on 2026-05-29: `npm test` passes 117/117; `npm run gates` reports THE_LOCK optimal 16, reachableCount 92, backtracking required.
- `.nojekyll` is present for GitHub Pages static hosting.
- Root `CLAUDE.md` already mandates simple, surgical, goal-verified changes; keep AGENTS guidance project-specific.
