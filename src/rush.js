// THE LOCK — Rush (Survival) mode. Reuses engine + render + generator.
//
// Pick as many locks as you can. Each lock must be solved within a MOVE BUDGET
// (par + slack); blowing the budget, or tapping Skip, costs a strike. Three
// strikes ends the run. Difficulty ramps with your score. Generation is live
// and sub-millisecond, so the next lock appears instantly.

import { makeConfig, isLegalFlip, legalFlips, applyFlip, isSolved } from "./engine.js";
import { createBoard } from "./render.js";
import { generateLock, makeRng } from "./generator.js";

const STRIKES_MAX = 3;
const STORAGE_BEST = "the-lock:rush-best";
const SOLVE_DELAY = 650; // ms to savour a solve before the next lock
const STRIKE_DELAY = 850; // ms to register a strike

// Move budget for a lock of optimal `par`: always > par so a clean solve fits,
// with headroom for a little exploration. Tunable.
export function moveBudget(par) {
  return par + Math.max(3, Math.round(par * 0.5));
}

// Difficulty ramps with locks solved: every 3 solves bumps the tier.
export function difficultyFor(solved) {
  return 1 + Math.floor(solved / 3);
}

function loadBest() {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_BEST) || "0", 10);
    return Number.isFinite(v) ? v : 0;
  } catch (_) {
    return 0;
  }
}
function saveBest(n) {
  try { localStorage.setItem(STORAGE_BEST, String(n)); } catch (_) {}
}

export function createRush({ mountEl, seed, onGameOver }) {
  const svgEl = mountEl.querySelector("#board");
  const scoreEl = mountEl.querySelector("#rush-score");
  const strikesEl = mountEl.querySelector("#rush-strikes");
  const movesEl = mountEl.querySelector("#rush-moves");
  const btnSkip = mountEl.querySelector("#btn-skip");

  const rng = makeRng(seed >>> 0);
  let solved = 0;
  let strikes = 0;
  let level = null;
  let config = null;
  let board = null;
  let moves = 0;
  let budget = 0;
  let locked = false; // input frozen during solve/strike transitions
  let over = false;
  let pending = null; // the one in-flight transition timer (solve/strike -> next)

  function generate(d) {
    for (let i = 0; i < 8; i++) {
      const L = generateLock(d, rng);
      if (L) return L;
    }
    return generateLock(1, rng); // fallback (generator is ~100%, this is belt-and-braces)
  }

  function renderStrikes() {
    let s = "";
    for (let i = 0; i < STRIKES_MAX; i++) s += i < strikes ? "✕" : "·";
    if (strikesEl) strikesEl.textContent = s;
  }
  function updateHUD() {
    if (scoreEl) scoreEl.textContent = String(solved);
    if (movesEl) movesEl.textContent = moves + " / " + budget;
    renderStrikes();
  }

  function loadNext() {
    if (over) return; // a stale delayed timer must not rebuild a finished run
    level = generate(difficultyFor(solved));
    if (!level) { strike(); return; } // generation failed (shouldn't happen) — strike, don't crash
    config = makeConfig(level);
    moves = 0;
    budget = moveBudget(level.par);
    board = createBoard(svgEl, config, { onEdgeTap: handleTap });
    board.markLegal(legalFlips(config));
    locked = false;
    updateHUD();
  }

  function handleTap(edgeId) {
    if (over || locked) return;
    if (!isLegalFlip(config, edgeId)) {
      board.shakeEdge(edgeId);
      const edge = config.edgeById.get(edgeId);
      board.pulseNode(config.dirs.get(edgeId) === "uv" ? edge.v : edge.u);
      return;
    }
    config = applyFlip(config, edgeId);
    moves++;
    board.update(config);
    board.markLegal(legalFlips(config));
    updateHUD();

    if (isSolved(config)) {
      solved++;
      locked = true;
      board.winCascade();
      updateHUD();
      pending = setTimeout(loadNext, SOLVE_DELAY);
    } else if (moves >= budget) {
      strike();
    }
  }

  function strike() {
    if (over) return;
    strikes++;
    locked = true;
    renderStrikes();
    if (strikes >= STRIKES_MAX) {
      pending = setTimeout(gameOver, STRIKE_DELAY);
    } else {
      pending = setTimeout(loadNext, STRIKE_DELAY);
    }
  }

  function gameOver() {
    over = true;
    const prevBest = loadBest();
    const best = Math.max(prevBest, solved);
    saveBest(best);
    const shareText =
      "THE LOCK — Rush\nPicked " + solved + " lock" + (solved === 1 ? "" : "s") +
      " 🔒\n(best " + best + ")";
    // new best only when you STRICTLY beat your prior best (not on a tie, and
    // not on a 0-pick first run where prevBest is also 0)
    if (onGameOver) onGameOver({ solved, best, isBest: solved > prevBest, shareText });
  }

  function onSkip() {
    if (over || locked) return;
    strike();
  }

  if (btnSkip) btnSkip.addEventListener("click", onSkip);

  // Kick off the run.
  loadNext();

  return {
    destroy() {
      over = true; // stop any in-flight transition from acting on a dead run
      if (pending) { clearTimeout(pending); pending = null; }
      if (btnSkip) btnSkip.removeEventListener("click", onSkip);
    },
    get score() { return solved; },
  };
}
