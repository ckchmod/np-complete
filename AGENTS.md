# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-30
**Commit:** post-popular-phone-game milestone
**Branch:** main

## OVERVIEW
THE LOCK is a static, mobile-first browser puzzle game built from Nondeterministic Constraint Logic. Stack is vanilla ESM JavaScript, Three.js, HTML, CSS, Node's built-in test runner, Python's stdlib HTTP server, and a static PWA shell with manifest plus service worker.

## STRUCTURE
```
np-complete/
├── index.html              # browser shell; loads src/main.js directly
├── styles.css              # noir theme, mode visibility, replay/PWA/update UI, renderer state classes
├── manifest.json           # PWA app metadata
├── sw.js                   # offline cache service worker
├── src/                    # app, rules, solver, generator, rendering, Battle AI, replay
├── test/                   # node:test suite; module-focused files
├── scripts/gates.mjs       # solver/non-triviality JSON gate CLI
└── docs/superpowers/specs/ # dated design and quality-pass specs
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Browser entry / flow | `index.html`, `src/main.js` | `index.html` declares hard-coded IDs; `main.js` toggles intro, mode hub, tutorials, Rush, Battle, and service worker registration. |
| NCL legality | `src/engine.js` | Pure logic. No DOM. Inflow invariant lives here. |
| Solver gates / par | `src/solver.js`, `scripts/gates.mjs` | BFS computes optimal length and non-triviality reports. |
| Authored levels | `src/levels.js` | Source of truth for tutorials, THE_LOCK, THE_LOCK_V2, `par`, `target`, node layout. |
| Rush generation | `src/generator.js`, `src/rush.js` | Generator composes gadgets, validates by solver, then Rush budgets/strikes. |
| Battle rules / AI | `src/battleEngine.js`, `src/battleSolver.js`, `src/battleGenerator.js`, `src/battle.js`, `src/aiBattle.js` | Battle is a finite charged NCL game. Battle vs AI is local deterministic rule/search code, not an LLM or service. |
| Replay surfaces | `src/replay.js`, `src/replayUI.js`, `src/battleReplay.js` | Replay and post-game Battle analysis. Hide analysis during active play. |
| PWA / offline | `manifest.json`, `sw.js`, `src/main.js` | Static installable shell, offline cache, and service worker update notice. |
| 3D spherical renderer contract | `src/render3d.js`, `styles.css` | CSS classes/data attrs are coupled to the Three.js spherical renderer output and board-state styling. |
| Tutorial session state | `src/game.js` | Move history, undo/reset, localStorage resume, scoring/share. |
| Tests | `test/*.test.js` | 203 current node:test cases at this milestone; avoid hard-coding counts in README. |
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
| `createBoard3d` | function | `src/render3d.js` | Builds the Three.js spherical board and exposes update/animation API. |
| `createGame` | function | `src/game.js` | Tutorial-mode controller. |
| `createRush` | function | `src/rush.js` | Survival-mode controller. |
| `createBattle` | function | `src/battle.js` | Battle Hot-seat and Battle vs AI controller. |
| `TUTORIALS`, `THE_LOCK`, `THE_LOCK_V2`, `LEVELS` | constants | `src/levels.js` | Authored game data. |

## CONVENTIONS
- ESM only: package has `"type": "module"`; local imports include explicit `.js`.
- There is no bundler or build step. Static files are the deployable artifact.
- Serve over HTTP. `file://index.html` does not work for ES modules.
- Keep runtime dependencies at zero unless the user explicitly changes that constraint.
- Current flow starts at intro, then a mode hub with Tutorial, Puzzle Rush, Battle Hot-seat, and Battle vs AI. Active Tutorial/Rush/Battle surfaces have Main Menu or abandon controls.
- Battle vs AI must stay client-side and deterministic/legal under Battle rules. Do not describe it as an LLM, chatbot, API, or external AI service.
- Replay analysis belongs after terminal Battle states or explicit replay use. Do not expose strategic analysis during active play.
- Code comments are unusually load-bearing in `src/engine.js`, `src/solver.js`, `src/generator.js`, and `src/levels.js`; update them only when behavior changes.
- Domain names: thin edge = weight 1, thick edge = weight 2, red edge = target, `par` = solver optimal length.
- `levels.js` par values are contracts with `bfsSolve`, not decorative metadata.
- DOM refs use exact IDs from `index.html`; class names in `styles.css` are part of the board renderer contract and its mount/state styling.
- `scripts/gates.mjs` must print one JSON object to stdout and exit nonzero on error.
- `manifest.json` and `sw.js` are part of the shipped static artifact. Keep PWA/offline behavior zero-dependency and compatible with GitHub Pages.

## ANTI-PATTERNS (THIS PROJECT)
- Do not weaken the inflow invariant: every node must always have incoming weight >= 2.
- Do not expose or encode solution paths in UI/share text; share hashes prove route without revealing it.
- Do not describe a single fixed board as PSPACE-complete; hardness applies to the infinite NCL family.
- Do not add framework/bundler structure (`components/`, `public/`, etc.) unless requested.
- Do not move DOM IDs/classes casually; JS and CSS are tightly coupled to them.
- Do not add network calls or model dependencies for Battle vs AI. It is browser game AI over local game state.
- Do not edit `.omc/` or `.omo/` as project source; they are local agent/runtime state.

## UNIQUE STYLES
- Minimal noir UI: near-black surface, white/gray graph, red target, cyan legal/win glow, amber slack/low-budget, and 3D spherical presentation that still preserves the tight CSS/renderer coupling.
- Board coordinates use portrait phone space; authored levels keep `x` in `[0,100]`, `y` in `[0,160]`.
- Rush boards are generated live, seeded with `makeRng`, capped for phone legibility, and solver-verified before display.
- The mode hub exposes Tutorial, Puzzle Rush, Battle Hot-seat, and Battle vs AI after the intro.
- Help is context-aware: tutorial intro outside active modes, Rush rules inside Rush, Battle rules inside Battle.
- Current source has 6 tutorials and tests have 203 cases at this milestone; older prose may still say 5 tutorials / 44, 117, 182, 185, 186, 190, 192, 193, 196, 199, 200, or 201 tests.

## WORKFLOW
- After every significant milestone, update relevant docs and push the branch once verification passes.
- Before pushing, inspect intended changes, run the project checks, and keep commits atomic.
- GitHub Pages updates from pushes to `main` through `.github/workflows/pages.yml`, deploying the static repo root with no build step.

## COMMANDS
```bash
npm start          # python3 -m http.server 8000; open http://localhost:8000
npm test           # node --test
node --test test/engine.test.js
npm run gates      # JSON solver gates for THE LOCK, THE_LOCK_V2, tutorials
```

## NOTES
- Baseline on 2026-05-30 after the render/Rush diversity pass: `npm test` passes 203/203; `npm run gates` reports THE_LOCK optimal 16, reachableCount 92, THE_LOCK_V2 optimal 40, reachableCount 24544, and backtracking required. `sw.js` cache is `the-lock-v4`.
- `.nojekyll` is present for GitHub Pages static hosting.
- Root `CLAUDE.md` already mandates simple, surgical, goal-verified changes; keep AGENTS guidance project-specific.
