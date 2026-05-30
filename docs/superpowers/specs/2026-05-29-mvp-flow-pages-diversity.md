# 2026-05-29 MVP flow, Pages, and generator diversity milestone

## Scope

This milestone addresses three MVP issues: terminal game flow, GitHub Pages deployment freshness, and Rush network diversity.

## Decisions

- Rush run-over now keeps the existing result card but adds a mode-selection escape hatch.
- Battle terminal state remains inline with the board and adds replay/mode-selection actions, avoiding a new screen system.
- GitHub Pages deploys through `.github/workflows/pages.yml`; this milestone branch and `main` both trigger the static root deploy, with no build step.
- Rush generation keeps early readability but introduces a compact cycle head before high-tier gadgets so early progression is no longer purely tree-shaped. High tiers keep richer gadget families without duplicating the low-par cycle head.

## Verification contract

- `test/main.test.js` covers post-game replay/mode-selection controls and terminal action markup.
- `test/generator.test.js` covers early non-tree topology while preserving solvability, par, difficulty escalation, and deterministic generation.
- Full verification still requires `npm test`, `npm run gates`, and browser surface QA through the real static app.

## Workflow note

After significant milestones, update relevant documentation and push the verified branch. This is also recorded in `AGENTS.md` so future sessions inherit it.
