// THE LOCK — game session logic.
// createGame({ level, mountEl, onWin, onReplayStart }) -> Game { undo(), reset(), shareResult() }

import {
  makeConfig,
  inflow,
  isLegalFlip,
  applyFlip,
  isSolved,
  legalFlips,
} from "./engine.js";
import { createBoard } from "./render.js";
import { createReplayUI } from "./replayUI.js";

// ── Persistence helpers ───────────────────────────────────────────────────────

function storageKey(levelId, suffix) {
  return "the-lock:" + levelId + ":" + suffix;
}

// Persist the in-progress orientation AND the move count together. The count is
// needed so a resumed session reports an accurate move total — par/stars/score
// on a later win are computed against it (spec §11); restoring orientation alone
// would leave the counter at 0 and silently undercount the solve.
function saveProgress(levelId, dirs, moves, history = null) {
  try {
    localStorage.setItem(
      storageKey(levelId, "progress"),
      JSON.stringify({ dirs: Object.fromEntries(dirs), moves, history })
    );
  } catch (_) {}
}

// Returns { dirs: Map, moves: number }, or null if absent/corrupt/legacy-format.
function loadProgress(levelId) {
  try {
    const raw = localStorage.getItem(storageKey(levelId, "progress"));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.dirs) return null;
    const moves = Number.isInteger(parsed.moves) && parsed.moves >= 0 ? parsed.moves : 0;
    const history = Array.isArray(parsed.history) && parsed.history.every((edgeId) => typeof edgeId === "string")
      ? parsed.history.slice()
      : null;
    return { dirs: new Map(Object.entries(parsed.dirs)), moves, history };
  } catch (_) {
    return null;
  }
}

function clearProgress(levelId) {
  try {
    localStorage.removeItem(storageKey(levelId, "progress"));
  } catch (_) {}
}

// Build a Config from a saved orientation Map and accept it only if it is a
// legal configuration (every node's inflow >= 2). Saved dirs are applied
// directly onto the start orientation; unknown edge ids and any value other
// than "uv"/"vu" are ignored (stale/corrupt storage). Returns the validated
// Config, or null when the saved state is invalid so the caller keeps start.
// The returned object has the same shape as engine applyFlip output (frozen
// { level, dirs, edgeById, incident }), reusing the orientation-independent
// edgeById/incident indexes from startConfig.
function restoreConfig(startConfig, savedDirs) {
  const dirs = new Map(startConfig.dirs);
  for (const [eid, dir] of savedDirs) {
    if (dirs.has(eid) && (dir === "uv" || dir === "vu")) dirs.set(eid, dir);
  }
  const candidate = Object.freeze({
    level: startConfig.level,
    dirs,
    edgeById: startConfig.edgeById,
    incident: startConfig.incident,
  });
  for (const node of startConfig.level.nodes) {
    if (inflow(candidate, node.id) < 2) return null;
  }
  return candidate;
}

function sameDirs(left, right) {
  if (left.size !== right.size) return false;
  for (const [edgeId, dir] of left) {
    if (right.get(edgeId) !== dir) return false;
  }
  return true;
}

function restoreHistory(startConfig, restoredConfig, history, moves) {
  if (!history || history.length !== moves) return null;
  let replayConfig = startConfig;
  for (const edgeId of history) {
    if (!replayConfig.edgeById.has(edgeId) || !isLegalFlip(replayConfig, edgeId)) return null;
    replayConfig = applyFlip(replayConfig, edgeId);
  }
  return sameDirs(replayConfig.dirs, restoredConfig.dirs) ? history.slice() : null;
}

function loadBest(levelId) {
  try {
    const raw = localStorage.getItem(storageKey(levelId, "best"));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveBest(levelId, record) {
  try {
    localStorage.setItem(storageKey(levelId, "best"), JSON.stringify(record));
  } catch (_) {}
}

// ── Score + stars ─────────────────────────────────────────────────────────────

function computeScore(moves, par, elapsedMs, undos) {
  const timePenalty = Math.floor(elapsedMs / 10000); // 1 point per 10 s
  // 1000 is the ceiling (an optimal, instant, undo-free solve); the min guards a
  // corrupt resume whose restored move count is somehow below par.
  return Math.max(0, Math.min(1000, 1000 - 10 * (moves - par) - timePenalty - 2 * undos));
}

function computeStars(moves, par) {
  if (moves <= par) return 3;
  if (moves <= par + 5) return 2;
  return 1;
}

// ── Path hash ─────────────────────────────────────────────────────────────────
// Short stable hash of the move-id sequence (proves genuine solve without revealing route).

function pathHash(moveIds) {
  // FNV-1a 32-bit over the joined string, rendered as two 4-hex groups.
  const str = moveIds.join(",");
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
    h >>>= 0;
  }
  const hi = ((h >>> 16) & 0xffff).toString(16).toUpperCase().padStart(4, "0");
  const lo = (h & 0xffff).toString(16).toUpperCase().padStart(4, "0");
  return hi + "-" + lo;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function qs(el, sel) {
  return el.querySelector(sel);
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m + ":" + String(s % 60).padStart(2, "0");
}

// ── createGame ────────────────────────────────────────────────────────────────

export function createGame({ level, mountEl, onWin, onReplayStart }) {
  // Elements expected in mountEl (provided by index.html / main.js):
  // - svg#board
  // - #move-count, #par-display
  // - #btn-undo, #btn-reset
  // - #result-card (hidden until win)
  //   - #result-moves, #result-par, #result-stars, #result-score, #result-pb, #result-hash
  //   - #btn-share (in result card)

  const svgEl = qs(mountEl, "#board");
  const moveCountEl = qs(mountEl, "#move-count");
  const parDisplayEl = qs(mountEl, "#par-display");
  const resultCard = qs(mountEl, "#result-card");
  const resultMovesEl = qs(mountEl, "#result-moves");
  const resultParEl = qs(mountEl, "#result-par");
  const resultStarsEl = qs(mountEl, "#result-stars");
  const resultScoreEl = qs(mountEl, "#result-score");
  const resultPbEl = qs(mountEl, "#result-pb");
  const resultHashEl = qs(mountEl, "#result-hash");
  const btnShare = qs(mountEl, "#btn-share");
  const btnUndo = qs(mountEl, "#btn-undo");
  const btnReset = qs(mountEl, "#btn-reset");
  const replayMount = qs(mountEl, "#replay-ui");

  // State
  const startConfig = makeConfig(level);
  let config = startConfig;
  let moveHistory = [];
  let priorMoves = 0; // moves made before a resume; undo history is session-only (spec §10)
  let routeHistory = [];
  let replayBaseConfig = startConfig;
  let activeReplayBaseConfig = startConfig;
  let replayMoveOffset = 0;
  let undoCount = 0;
  let startTime = Date.now();
  let won = false;
  let destroyed = false; // set by destroy(); deferred callbacks bail if true
  let winTimer = null;   // the 900ms result-card timer, cleared on destroy
  let finalShareString = "";
  let replayUI = null;

  function moveCount() {
    return priorMoves + moveHistory.length;
  }

  // Try restoring in-progress orientation (session resume).
  // Validate the saved orientation directly rather than replaying flips from
  // start: a stored mid-game state may not be reachable by the legal-flip
  // sequence a cold start would take, and replaying would silently skip those
  // edges and leave a partially-restored, invalid board. Instead build a
  // candidate config with all saved dirs applied and accept it only if it
  // satisfies the full inflow >= 2 invariant on every node — mirroring how
  // makeConfig validates start states. Otherwise fall back to start.
  //
  // A saved state that is ALREADY solved (e.g. stale/hand-edited storage, or a
  // mid-state persisted before the win path cleared it) is not resumed: there is
  // no honest move count or route for it, and resuming would show a solved board
  // with no win handling. Treat it as a fresh start and clear the stale entry.
  const saved = loadProgress(level.id);
  if (saved) {
    const restored = restoreConfig(startConfig, saved.dirs);
    if (restored && !isSolved(restored)) {
      config = restored;
      priorMoves = saved.moves;
      routeHistory = restoreHistory(startConfig, restored, saved.history, saved.moves);
      if (!routeHistory) {
        replayBaseConfig = restored;
        replayMoveOffset = saved.moves;
      }
    } else {
      clearProgress(level.id);
    }
  }

  // Build the board renderer
  const board = createBoard(svgEl, config, { onEdgeTap: handleTap });

  if (replayMount && typeof document.createElement === "function") {
    replayUI = createReplayUI({
      mountEl: replayMount,
      onReplayStart: () => {
        if (onReplayStart) onReplayStart();
        config = activeReplayBaseConfig;
        board.clearWin();
        board.update(config);
        board.markLegal(legalFlips(config));
      },
      onFrame(frame) {
        config = frame.config;
        board.update(config);
        board.markLegal(legalFlips(config));
      },
    });
  }

  // Show current legal edges
  refreshLegal();
  updateHUD();

  // Show the optimal (fewest-possible) move count
  if (parDisplayEl) parDisplayEl.textContent = "optimal " + level.par;

  // Wire controls
  if (btnUndo) btnUndo.addEventListener("click", undo);
  if (btnReset) btnReset.addEventListener("click", reset);
  if (btnShare) btnShare.addEventListener("click", share);

  // ── Tap handler ─────────────────────────────────────────────────────────────

  function handleTap(edgeId) {
    if (won) return;

    if (!isLegalFlip(config, edgeId)) {
      board.shakeEdge(edgeId);
      // Pulse the tight node(s) that block this flip
      const edge = config.edgeById.get(edgeId);
      const recv = config.dirs.get(edgeId) === "uv" ? edge.v : edge.u;
      board.pulseNode(recv);
      return;
    }

    const next = applyFlip(config, edgeId);
    moveHistory.push(edgeId);
    if (routeHistory) routeHistory.push(edgeId);
    config = next;

    board.update(config);
    refreshLegal();
    updateHUD();
    saveProgress(level.id, config.dirs, moveCount(), routeHistory);

    if (isSolved(config)) {
      handleWin();
    }
  }

  // ── Win ──────────────────────────────────────────────────────────────────────

  function handleWin() {
    won = true;
    clearProgress(level.id);

    const elapsed = Date.now() - startTime;
    const moves = moveCount();
    const score = computeScore(moves, level.par, elapsed, undoCount);
    const stars = computeStars(moves, level.par);
    const replayMoveIds = routeHistory || moveHistory;
    const replayBase = routeHistory ? startConfig : replayBaseConfig;
    const replayOffset = routeHistory ? 0 : replayMoveOffset;
    const hash = pathHash(replayMoveIds);
    activeReplayBaseConfig = replayBase;

    finalShareString =
      "THE LOCK\n" +
      "Solved: " + moves + " moves (optimal " + level.par + ")\n" +
      "⏱ " + fmt(elapsed) + "   ↶ " + undoCount + " undos\n" +
      "#" + hash;

    // Personal best
    const prev = loadBest(level.id);
    const isNewBest = !prev || score > prev.score;
    if (isNewBest) {
      saveBest(level.id, { score, moves, stars, hash });
    }

    // Animate
    board.winCascade();

    // Show result card
    winTimer = setTimeout(() => {
      if (destroyed) return; // a destroyed/rebuilt game must not fire its stale win timer
      if (resultCard) {
        if (resultMovesEl) resultMovesEl.textContent = moves;
        if (resultParEl) resultParEl.textContent = level.par;
        if (resultStarsEl) resultStarsEl.textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
        if (resultScoreEl) resultScoreEl.textContent = score;
        if (resultHashEl) resultHashEl.textContent = "#" + hash;
        if (resultPbEl) {
          const best = loadBest(level.id);
          resultPbEl.textContent = best
            ? "Best: " + best.score + (isNewBest ? " ✦ new best" : "")
            : "";
        }
        resultCard.classList.remove("hidden");
        resultCard.classList.add("visible");
      }
      if (replayUI) {
        replayUI.show({
          frames: replayFrames(replayMoveIds, replayBase, replayOffset),
          analysis: {
            moveCount: moves,
            par: level.par,
            targetLegalMoment: targetLegalMoment(replayMoveIds, replayBase, replayOffset),
          },
        });
      }
      if (onWin) onWin({ moves, score, stars, hash });
    }, 900);
  }

  // ── Undo ─────────────────────────────────────────────────────────────────────

  function undo() {
    if (won || moveHistory.length === 0) return;
    const last = moveHistory.pop();
    if (routeHistory) routeHistory.pop();
    undoCount++;
    config = applyFlip(config, last); // involutive
    board.update(config);
    refreshLegal();
    updateHUD();
    saveProgress(level.id, config.dirs, moveCount(), routeHistory);
  }

  // ── Reset ────────────────────────────────────────────────────────────────────

  function reset() {
    if (won) {
      // Hide result card first
      if (resultCard) {
        resultCard.classList.remove("visible");
        resultCard.classList.add("hidden");
      }
      if (replayUI) replayUI.hide();
      won = false;
    }
    moveHistory = [];
    routeHistory = [];
    priorMoves = 0;
    replayBaseConfig = startConfig;
    activeReplayBaseConfig = startConfig;
    replayMoveOffset = 0;
    undoCount = 0;
    startTime = Date.now();
    config = startConfig;
    clearProgress(level.id);
    board.update(config);
    board.clearWin(); // a reset after a win must drop the win colour (target back to red)
    refreshLegal();
    updateHUD();
  }

  // ── HUD ──────────────────────────────────────────────────────────────────────

  function updateHUD() {
    if (moveCountEl) moveCountEl.textContent = moveCount();
  }

  function refreshLegal() {
    board.markLegal(legalFlips(config));
  }

  // ── Share ────────────────────────────────────────────────────────────────────

  function share() {
    if (!finalShareString) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(finalShareString).catch(() => {});
    }
    if (btnShare) {
      const orig = btnShare.textContent;
      btnShare.textContent = "Copied!";
      setTimeout(() => (btnShare.textContent = orig), 1500);
    }
  }

  function shareResult() {
    return finalShareString;
  }

  function replayFrames(edgeIds, baseConfig = startConfig, moveOffset = 0) {
    let replayConfig = baseConfig;
    return edgeIds.map((edgeId, moveIndex) => {
      replayConfig = applyFlip(replayConfig, edgeId);
      return {
        config: replayConfig,
        moveIndex: moveOffset + moveIndex,
        moveId: edgeId,
        isLast: moveIndex === edgeIds.length - 1,
      };
    });
  }

  function targetLegalMoment(edgeIds, baseConfig = startConfig, moveOffset = 0) {
    let replayConfig = baseConfig;
    if (isLegalFlip(replayConfig, level.target)) return moveOffset;
    for (let i = 0; i < edgeIds.length; i++) {
      if (edgeIds[i] === level.target && isLegalFlip(replayConfig, level.target)) return moveOffset + i;
      replayConfig = applyFlip(replayConfig, edgeIds[i]);
      if (i < edgeIds.length - 1 && isLegalFlip(replayConfig, level.target)) return moveOffset + i + 1;
    }
    return null;
  }

  // Remove this session's listeners on the persistent control buttons so they
  // don't accumulate across level changes (main.js calls this before reloading).
  function destroy() {
    destroyed = true;
    if (winTimer) { clearTimeout(winTimer); winTimer = null; }
    if (replayUI) { replayUI.destroy(); replayUI = null; }
    if (board && board.destroy) board.destroy();
    if (btnUndo) btnUndo.removeEventListener("click", undo);
    if (btnReset) btnReset.removeEventListener("click", reset);
    if (btnShare) btnShare.removeEventListener("click", share);
  }

  return { undo, reset, shareResult, destroy };
}
