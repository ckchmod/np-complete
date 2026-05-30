// THE LOCK — Rush (Survival) mode. Reuses engine + render + generator.
//
// Pick as many locks as you can. Each lock must be solved within a MOVE BUDGET
// (par + slack); blowing the budget, or tapping Skip, costs a strike. Three
// strikes ends the run. Difficulty ramps with your score. Generation is live
// and runs in tens of ms (layout-dominated), well within the post-solve delay.

import { makeConfig, isLegalFlip, legalFlips, applyFlip, isSolved, inflow } from "./engine.js";
import { createBoard } from "./render.js";
import { generateLock, makeRng } from "./generator.js";

const STRIKES_MAX = 3;
const STORAGE_BEST = "the-lock:rush-best";
const SOLVE_DELAY = 900; // ms to savour a solve before the next lock (fits the win cascade)
const STRIKE_DELAY = 850; // ms to register a strike
const RESUME_DELAY = 450; // ms beat before a paused transition fires once a modal (the "?" rules) closes

// Move budget for a lock of optimal `par`: always > par so a clean solve fits,
// with headroom for a little exploration. Tunable.
export function moveBudget(par) {
  return par + Math.max(3, Math.round(par * 0.5));
}

// Difficulty ramps with EVERY solve: each win bumps the tier, so complexity
// rises lock-to-lock (the generator caps its length budget, so par plateaus
// gently rather than running away).
export function difficultyFor(solved) {
  return 1 + solved;
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

export function createRush({ mountEl, seed, onGameOver, levelFactory = generateLock } = {}) {
  const svgEl = mountEl.querySelector("#board");
  const scoreEl = mountEl.querySelector("#rush-score");
  const strikesEl = mountEl.querySelector("#rush-strikes");
  const movesEl = mountEl.querySelector("#rush-moves");
  const btnSkip = mountEl.querySelector("#btn-skip");
  const btnUndo = mountEl.querySelector("#btn-undo");
  const toastEl = mountEl.querySelector("#rush-toast");

  const rng = makeRng(seed >>> 0);
  let solved = 0;
  let totalMoves = 0; // cumulative moves across solved locks (end-screen stat)
  let strikes = 0;
  let level = null;
  let config = null;
  let board = null;
  let moves = 0;
  let budget = 0;
  let history = [];
  let locked = false; // input frozen during solve/strike transitions
  let over = false;
  let lastHead = ""; // gadget of the previous board, so the next is a different kind
  let pending = null; // the one in-flight transition timer (solve/strike -> next)
  let pendingFn = null; // the action that timer will run — retained so pause()/resume() can re-arm it
  let toastTimer = null; // transient toast auto-hide timer

  // The single in-flight transition (solve/strike -> next lock or game over).
  // Routed through schedule() so a modal — the "?" rules overlay opened mid-run —
  // can freeze it and resume it, instead of the timer firing behind the overlay
  // and silently advancing the run (swapping the board / ending the run unseen).
  function schedule(fn, delay) {
    pendingFn = fn;
    pending = setTimeout(() => { pending = null; pendingFn = null; fn(); }, delay);
  }
  function pause() { // freeze an in-flight transition; keep the action for resume()
    if (pending) { clearTimeout(pending); pending = null; }
  }
  function resume() { // re-arm a frozen transition (no-op if the run ended or none was pending)
    if (!over && pendingFn && !pending) schedule(pendingFn, RESUME_DELAY);
  }

  function generate(d) {
    // Pass the previous gadget so the next board is a DIFFERENT kind (no two
    // near-identical boards in a row). generateLock retries + verifies internally.
    const L = levelFactory(d, rng, lastHead) || levelFactory(1, rng, lastHead);
    if (L) lastHead = L.head;
    return L;
  }

  function renderStrikes() {
    let s = "";
    for (let i = 0; i < STRIKES_MAX; i++) s += i < strikes ? "✕" : "·";
    if (strikesEl) {
      strikesEl.textContent = s;
      strikesEl.setAttribute("aria-label", strikes + " of " + STRIKES_MAX + " strikes used");
    }
  }
  function updateHUD() {
    if (scoreEl) scoreEl.textContent = String(solved);
    if (movesEl) {
      movesEl.textContent = moves + " / " + budget;
      movesEl.classList.toggle("low", budget > 0 && budget - moves <= 2); // amber warning near the cap
    }
    if (btnUndo) btnUndo.disabled = over || locked || moves === 0 || history.length === 0;
    renderStrikes();
  }

  // Brief toast over the board (e.g. the skip cost). Auto-hides.
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1100);
  }

  function loadNext() {
    if (over) return; // a stale delayed timer must not rebuild a finished run
    level = generate(difficultyFor(solved));
    if (!level) { strike(); return; } // generation failed (shouldn't happen) — strike, don't crash
    config = makeConfig(level);
    moves = 0;
    budget = moveBudget(level.par);
    history = [];
    if (board) board.destroy(); // cancel the previous board's cascade timers before rebuild
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
      const receiver = config.dirs.get(edgeId) === "uv" ? edge.v : edge.u;
      board.pulseNode(receiver);
      board.explainIllegal(edgeId, receiver, inflow(config, receiver), edge.w);
      return;
    }
    history.push(config);
    config = applyFlip(config, edgeId);
    moves++;
    board.update(config);
    board.markLegal(legalFlips(config));
    updateHUD();

    if (isSolved(config)) {
      solved++;
      totalMoves += moves;
      locked = true;
      board.winCascade();
      updateHUD();
      schedule(loadNext, SOLVE_DELAY);
    } else if (moves >= budget) {
      strike();
    }
  }

  function undoMove() {
    if (over || locked || moves === 0 || history.length === 0) return;
    config = history.pop();
    moves++;
    board.update(config);
    board.markLegal(legalFlips(config));
    updateHUD();
    if (moves >= budget && !isSolved(config)) strike();
  }

  function strike() {
    if (over) return;
    strikes++;
    locked = true;
    history = [];
    renderStrikes();
    if (board) board.strikeFlash();           // red flash + shake on the board
    if (strikesEl) { strikesEl.classList.remove("struck"); void strikesEl.offsetWidth; strikesEl.classList.add("struck"); }
    try { if (navigator.vibrate) navigator.vibrate(60); } catch (_) {}
    updateHUD();
    if (strikes >= STRIKES_MAX) {
      schedule(gameOver, STRIKE_DELAY);
    } else {
      schedule(loadNext, STRIKE_DELAY);
    }
  }

  function gameOver() {
    over = true;
    const prevBest = loadBest();
    const best = Math.max(prevBest, solved);
    saveBest(best);
    const shareText =
      "THE LOCK — Rush\nPicked " + solved + " lock" + (solved === 1 ? "" : "s") +
      " 🔒\n" + totalMoves + " moves · best " + best;
    // new best only when you STRICTLY beat your prior best (not on a tie, and
    // not on a 0-pick first run where prevBest is also 0)
    if (onGameOver) onGameOver({ solved, best, prevBest, isBest: solved > prevBest, totalMoves, shareText });
  }

  function onSkip() {
    if (over || locked) return;
    showToast("SKIPPED · −1 life");
    strike();
  }

  if (btnSkip) btnSkip.addEventListener("click", onSkip);
  if (btnUndo) btnUndo.addEventListener("click", undoMove);

  // Kick off the run.
  loadNext();

  return {
    destroy() {
      over = true; // stop any in-flight transition from acting on a dead run
      if (pending) { clearTimeout(pending); pending = null; }
      pendingFn = null;
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
      if (board) board.destroy();
      if (btnSkip) btnSkip.removeEventListener("click", onSkip);
      if (btnUndo) btnUndo.removeEventListener("click", undoMove);
    },
    pause,  // freeze the in-flight transition while the "?" rules overlay is open
    resume, // resume it when the overlay closes
    get score() { return solved; },
  };
}
