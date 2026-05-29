# THE LOCK — v2 "Professional Quality" Pass — Design Spec

Date: 2026-05-28 (status updated 2026-05-29)
Status: IMPLEMENTED through A, B, C1, D, E, F, G + review fixes — see Implementation Status below.
Extends `2026-05-28-the-lock-design.md`.

## Implementation status (2026-05-29)

Shipped + pushed to `main` (8 milestones, 47/47 tests, working tree clean & in sync):
- **A** gadget-palette generator — single/AND/OR/shuttle heads; one-of-a-kind rotation via `avoidHead`; slow ramp `len = 1 + floor(d/2)`; shuttle forces backtracking; build→verify→reject — `e6823d8`; OR-recursion + cap-blowup review fix (OR branches are bounded chains) — `90500fa`.
- **G** board legibility — dashed ring goal-marker, red-only target (no cyan halo), staple tut-1 — `fa03529`.
- **C1** skip-tutorial button on the intro card — `69e012d`.
- **B** feedback & juice — cyan-pulse split fix (`.is-win-pulsing`), strike flash/shake/vibrate, visible `Skip (−1 ✕)` + toast, amber low-budget, cascade clamp + `SOLVE_DELAY` 900 — `c5eb3d0`.
- **D** mobile & a11y — zoom re-enabled, safe-area insets, edge-hit 6→12, `prefers-reduced-motion` (CSS + JS), contrast, aria — `7fbf46a`.
- **F** robustness — cascade/win timer teardown via `board.destroy()` + game `destroyed` guard. F2 skipped: the review proved the proposed solver state-cap a no-op (BFS visits ~7.5k states) — `5603d6a`.
- **E** visual polish — stronger legal glow, slow red target-breathe, overlay fade + card-rise, run-over score count-up, richer end screen (total moves, vs-best delta) — `6495930`.

Onboarding tail — SHIPPED (Direction A, one reviewed commit `43ab98a`, 47/47):
- **Shuttle tutorial** `tut-6` "Lend & Reclaim" — a minimal solver-verified shuttle (6 nodes/10 edges, par 7, target blocked move 1, `backtrackingRequired`, crossing-free layout); route `ST KS KD SK ST TS KT`. `test/levels.test.js` counts bumped 5→6 / 6→7.
- **C2** Rush-rules overlay `#rush-intro` at the tutorial→Rush handoff (budget · 3 lives · skip).
- **C3** context-aware "?" — Rush rules in a run, how-to-play in tutorials. One overlay serves both.
- Pre-launch review (5-angle Workflow) fixes folded in: `?` mid-run **pauses** the run (`rush.pause/resume` — in-flight transition can't fire behind the modal); leftover result-card cleared on handoff; button role derived from `mode-rush` (dropped `pendingRushStart`); 1400ms handoff timer cancelled on nav.
- Deferred (pre-existing, not regressions; flagged for `/code-review ultra`): overlay focus-trap/Escape a11y across all 3 overlays; a `showOverlay/hideOverlay` helper; a pause/resume unit test (skipped — `createRush` is DOM-bound, project is zero-dep).

LAUNCH GATE (Direction B, NOW ACTIVE): user runs `/code-review ultra` → Claude addresses findings → make the repo **public** + enable **GitHub Pages** (https://ckchmod.github.io/np-complete/, `main` root; asset paths already relative). The public+Pages flip is the user's explicit, irreversible trigger.

## 0. Goal & sequencing

Raise THE LOCK from "competent hobby build" to a **polished, professional release**, then
**ship it live on GitHub Pages**. Pages is the *final* step and is gated:

1. v2 quality pass (this spec) — build all workstreams below.
2. Verify — `npm test` green + headless-render spot-checks + manual playtest.
3. **HARD GATE (user-triggered):** user runs `/code-review ultra`. Claude CANNOT launch it →
   PAUSE, ask, then address findings (verify each, don't blind-implement).
4. Make repo **public** + enable **GitHub Pages** → `https://ckchmod.github.io/np-complete/`.
   Irreversible, your-trigger-only; happens only after 1–3.

**Difficulty direction (user decision 2026-05-28, REVISED after playtest): "full palette +
lookahead".** The original "ramp & variety only" plan proved insufficient: every Rush board is the
SAME template (`target → AND-of-2-relays`), so within-template tuning leaves it **predictable** —
the #1 playtest complaint. Fix = a **gadget-palette generator** (Workstream A) composing AND / OR /
chain / ladder / **shuttle (backtracking)** gadgets, all already present and solver-verified in the
game's tutorials + THE LOCK. (Measured aside: pure *nesting* stays greedy — bt=0% — so genuine
depth comes from the shuttle/OR gadgets, not nesting.)

## 1. Source of the work

A 5-dimension multi-agent audit produced a 21-item ranked punch-list; every load-bearing claim was
re-verified against source. This spec includes ranks 1–19 + 21 (Full pro pass). **Deferred: rank 20**
(inline SVG rule diagram). Live playtest (2026-05-28) added the predictability complaint (→ A) and
two board-legibility bugs (→ G).

Verification notes carried into the design:
- **Cyan pulse bug (rank 1) is real and distinct** from the previously-fixed target-edge cyan
  issue. `styles.css` declares `.node-group.is-pulsing .node-ring` twice (L238 `node-pulse`, L249
  `win-pulse`); equal specificity → cyan `win-pulse` always wins, so illegal-tap/slack pulses flash
  the win colour.
- **Skip-puzzle-costs-a-life already exists** (`rush.js` `onSkip()`→`strike()`, L141–144). Work is
  to make the cost *visible*, not to build the mechanic.

### 1a. Feasibility — de-risk prototype (throwaway, not committed)

Built each palette gadget in isolation and ran the solver:
- **OR gate**: valid, solvable, **6 viable opening moves** → real choice / multiple solution paths.
- **Shuttle** (lend/reclaim head lifted from THE LOCK, K charged by a short relay): a compact
  **10–11 node / 15–16 edge** variant verifies **backtracking=true** → genuine lookahead is
  *generatable*, not just hand-craftable.
- **Composition**: an incomplete hand-compose came back unsolvable — confirming each gadget must set
  its own valid base inflow and the **build→verify→reject/retry** loop is mandatory.
- Tractability (measured): shuttle ~15 edges/reach 300, OR ~18 edges/reach 3.6k, THE LOCK 21
  edges/reach 92 — all under the 5M state cap and (individually) the 30-edge fast-path.

## 2. Workstream A — Network diversity: gadget-palette generator  (rank 3 + predictability)

Files: `src/generator.js` (major rewrite), `src/solver.js` (live-path gates), `test/`.

Root cause of "predictable": every Rush board today is one template — `target → R →
AND-of-2-thin-legs → linear relay → battery`; only leg lengths + orientation vary. Fix: generate
each board by composing a **random mix** of gadgets from a palette, difficulty scaling by gadget
count/type, every board solver-verified (build → verify → reject/retry).

Palette (all proven feasible in §1a):
- **A1. Chain/relay** — linear w2 relay, variable + asymmetric length (the connective tissue).
- **A2. AND-2 junction** — two thin children into a +2 need, both required (current). NB: forcing
  AND is always *binary* here (a node needs ≤ +2; AND-of-3 would be 2-of-3 = skippable), so branch
  variety comes from other gadgets, not AND-arity.
- **A3. OR gate** — a +2 need met by ANY of 2–3 thick branches, each its own slack donor /
  relay-charged → CHOICE / multiple solution paths. Greedy by design (diversity, not lookahead).
- **A4. Shuttle** — lend/reclaim head parameterized from THE LOCK; forces backtracking (move away
  from the goal, then reclaim). Compact, verified `backtracking=true`. The genuine lookahead.
- **A5. Composition/recursion** — a junction's branch may itself be charged by another gadget. Each
  gadget is self-contained (sets its own base inflow so the start is valid); the generator attaches
  and then VERIFIES (reject + retry on unsolvable).

Difficulty, ramp & mix:
- **A6.** Per-solve escalation (replace `1 + floor(solved/3)`); the opening boards are drawn from
  *distinct* gadget types so the first sequence is varied, not clones (kills "first 3 identical").
- **A7.** Difficulty scales by gadget count + presence of harder gadgets (shuttle, deeper OR); lift
  the old `min(9)` plateau. Watch total edge count vs the 30-edge fast-path (gadgets are
  individually compact); generation-time guard (ties to F2).
- **A8.** Mix policy: a per-tier distribution over gadget types (early = chain/AND; mid = + OR;
  later = + shuttle), with occasional pure-lookahead (shuttle) boards. Tunable by feel.

Gates & tests:
- **A9.** Live generator verifies solvable (existing) + the intended gadget property: shuttle boards
  `backtracking=true`; OR boards ≥2 viable openings. Reject + retry otherwise.
- **A10.** Tests: consecutive boards differ structurally; gadget distribution matches tier policy; a
  shuttle board requires backtracking; an OR board has multiple openings; generation stays fast.

## 3. Workstream B — Feedback correctness & juice  (ranks 1, 7, 2, 11, 13)

Files: `styles.css`, `src/render.js`, `src/rush.js`, `index.html`.

- **B1 (rank 1, correctness).** Split pulse states: win cascade → distinct class (`is-win-pulsing` →
  cyan `win-pulse`); illegal-tap/slack → `is-pulsing` → neutral/`--c-target` `node-pulse`. Remove
  the duplicate L249 selector. `winCascade()` adds the win class; `pulse()` uses the neutral class.
- **B2 (rank 7).** Strike board feedback: `render.js` `strikeFlash()` (red vignette + 1-frame shake,
  auto-removed); `rush.js` `strike()` calls it (guarded) + `navigator.vibrate?.(60)`. Reduced-motion
  aware (D4).
- **B3 (rank 2, ask d).** Make Skip's cost legible: relabel `#btn-skip` → **"Skip (−1 ✕)"**, flash a
  "SKIPPED · −1 life" toast in `onSkip`, animate `#rush-strikes` when a strike is consumed.
- **B4 (rank 11).** Low-budget warning: `.low` class on `#rush-moves` when `budget - moves <= 2`
  (amber/pulse) so the run-ending strike has buildup.
- **B5 (rank 13).** Win cascade is cut off — `SOLVE_DELAY=650ms` < cascade (`i*90ms`). Clamp the
  per-node stagger to finish within `SOLVE_DELAY` and/or raise `SOLVE_DELAY` to ~900ms.

## 4. Workstream C — Onboarding & flow  (ranks 4, 10, 21)

Files: `index.html`, `src/main.js`.

- **C1 (rank 4, ask c).** "Skip to Rush" button on the intro card → set `STORAGE_INTRO_SEEN`,
  `hideIntro()`, `enterRush()`; persist so returning players land in Rush.
- **C2 (rank 10).** Tutorial→Rush interstitial (reuse `.overlay`) stating budget / 3 strikes / skip,
  gated behind a "Begin" button; relabel the Rush HUD so the budget reads as a cap (`moves / max`).
- **C3 (rank 21).** Context-aware help: in `mode-rush`, "?" shows Rush rules, not the tutorial intro.

## 5. Workstream D — Mobile fit & accessibility  (ranks 5, 6, 8, 9, 17, 19)

Files: `index.html`, `styles.css`, `src/render.js`, `src/rush.js`.

- **D1 (rank 5).** Viewport: drop `maximum-scale=1, user-scalable=no` → `width=device-width,
  initial-scale=1, viewport-fit=cover`. (Double-tap zoom already blocked by `touch-action`.)
- **D2 (rank 6).** Safe-area insets: `viewport-fit=cover` + `padding: env(safe-area-inset-*)` on
  `#app`.
- **D3 (rank 8).** Tap targets: `.edge-hit` stroke-width 6 → ~12–14 (≈27px → ≈44px+); verify each
  arm of a 2-cycle stays independently tappable at 360px.
- **D4 (rank 9).** `@media (prefers-reduced-motion: reduce)`: neutralize CSS animations; gate JS
  tweens (`animateReversal` snaps, `winCascade` skips stagger) via `matchMedia`.
- **D5 (rank 17).** Contrast: `--c-grey` #6a6a7a → ~#8a8a9a; `.nav-skip` colour `--c-dim` → `--c-grey`.
- **D6 (rank 19).** `aria-live="polite"` on `#rush-hud`; real aria-label in `renderStrikes`.

## 6. Workstream E — Visual polish  (ranks 15, 16, 12)

Files: `styles.css`, `src/render.js`, `src/main.js`, `src/rush.js`, `index.html`.

- **E1 (rank 15).** Stronger affordances: `.is-legal` shadow 2px→4px + brighter stroke; non-legal
  dimmer (~0.22); subtle persistent emphasis on `.is-target` (slow red breathe), off under
  reduced-motion and once `.board.is-won`. (Pairs with G2 — target signals itself, no cyan.)
- **E2 (rank 16).** Overlay entrance motion (fade + card rise/scale) and a count-up on `.rush-final`.
- **E3 (rank 12).** Richer end-of-run screen: max difficulty/"depth" reached, streak vs best, total
  moves; enrich `shareText`.

## 7. Workstream F — Robustness  (ranks 14, 18)

Files: `src/render.js`, `src/rush.js`, `src/game.js`, `src/solver.js`.

- **F1 (rank 14).** `createBoard.destroy()` clears tracked cascade timers; called on rebuild + from
  rush/game teardown. Clear the 900ms win-card timer in `game.destroy()`; add a `destroyed` flag the
  deferred callbacks check. Removes the hidden 1400>900ms dependency + stale pulses on long runs.
- **F2 (rank 18).** Live generation passes a tight per-call cap (~50k states) into `solveTarget`;
  design-time gates keep the 5M cap. Optional `Date.now()` wall-clock guard. Bounds main-thread
  stall at the new higher tiers (ties to A7).

## G. Workstream G — Board legibility: target marker, glow, tutorial layouts  (playtest bugs)

Files: `src/render.js`, `styles.css`, `src/levels.js`.

- **G1. Ghost marker reads as a second arrowhead** ("arrow with two heads") — `render.js:194-200`
  draws a faint-red arrowhead at the goal end; on short/thin edges it looks double-headed. Redesign
  the goal cue to be clearly NOT an arrowhead: a faint dashed outline of the reversed edge, or a
  small ring/notch at the goal node. Verify via headless render. (Global — affects Rush too.)
- **G2. Cyan legal-glow on the red target** ("cyan under the red") — exclude `.is-target` from the
  `.is-legal` drop-shadow (styles.css:172); signal "tappable" via the E1 red breathe instead.
- **G3. Tutorial 1 layout is cluttered** (verified by render: a vertical 2-cycle lens crosses the
  middle, the diagonal + red 2-cycle converge). Re-place tut-1 nodes (`levels.js`) so the first board
  reads instantly; sanity-check tut-2..5 the same way.
- **G4.** Consider widening 2-cycle separation (`BOW_STEP`) so opposite arrows in a 2-cycle don't
  visually merge.

## 8. Implementation approach

Build with a **parallel workflow** (user opted into "workflows"), phased:
- **Phase 1 (core gameplay):** Workstream **A** (gadget-palette generator) + **G** (board
  legibility). These are the playtest-driven core; A is the largest single piece. A is sequential
  internally (generator rewrite) but G can run alongside.
- **Phase 2 (pro polish):** Workstreams **B, C, D, E, F** — largely independent files, fan out one
  executor per workstream; coordinate shared files (`styles.css`: B/D/E/G; `rush.js`: A/B/E/F;
  `render.js`: B/D/E/F/G) via serialized same-file stages or worktree isolation + merge.
- **Verify stage:** `npm test` (+ new A10 tests), headless-render contact sheets across tiers
  (diversity + legibility), reduced-motion check.
- Claude reviews the full diff before any commit. Commit per milestone, push after (standing rule).

## 9. Verification plan

- `npm test` green incl. new gadget/diversity tests (A10).
- Headless-render contact sheets: boards across tiers are visibly **diverse** (different gadgets),
  the opening sequence varies, the ghost cue no longer looks like an arrowhead, tut-1 reads clean,
  no cyan on the red target, layouts stay legible.
- Solver: a sampled shuttle board has `backtracking=true`; an OR board has ≥2 openings; generation
  <~100ms/lock at the top tier (F2 guard).
- Manual: cyan gone on illegal taps; strike has board feedback; Skip shows its cost; skip-tutorial
  persists; zoom + safe areas; reduced-motion calms animation.

## 10. Out of scope / deferred

- Rank 20 (inline SVG rule diagram) — deferred.
- Live leaderboard / backend — deferred (v1 spec §13).
- Sound (audio) — not requested; haptics only (B2).
- Inventing *new* backtracking gadgets beyond the shuttle — not needed; the shuttle is proven.

## 11. Open questions / decide-by-feel

1. A6 escalation rate (`1 + solved` may be steep) — tune the early curve by feel.
2. A8 gadget mix per tier — proportions of chain/AND/OR/shuttle; how often a pure-lookahead board.
3. A7 plateau cap — how far before boards get too dense / edgey for a phone.
4. G1 ghost redesign — dashed reversed-edge outline vs ring-at-goal-node (pick by render).
5. C1 — show Skip-to-Rush to first-timers, or only after tutorials done once?
6. C2 — full interstitial vs a lighter one-line "RUSH — budget + 3 strikes" banner.
