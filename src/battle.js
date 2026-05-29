import {
  applyBattleFlip,
  hasLegalMoves,
  isLegalBattleFlip,
  isTerminal,
  makeBattleConfig,
} from "./battleEngine.js";
import { generateBattle } from "./battleGenerator.js";
import { createBoard } from "./render.js";

const PLAYER_LABELS = Object.freeze({ white: "White", black: "Black" });

function qs(root, selector) {
  return root && root.querySelector ? root.querySelector(selector) : null;
}

function playerLabel(player) {
  return PLAYER_LABELS[player] || player;
}

function winnerText(winner) {
  return playerLabel(winner) + " Wins!";
}

function legalBattleFlips(state) {
  return state.level.edges
    .filter((edge) => isLegalBattleFlip(state, edge.id))
    .map((edge) => edge.id);
}

function snapshot(state) {
  if (!state) return null;
  return {
    level: state.level,
    turn: state.turn,
    dirs: new Map(state.dirs),
    charges: new Map(state.charges),
    owner: new Map(state.owner),
    history: state.history.slice(),
    edgeById: state.edgeById,
    incident: state.incident,
    legalMoves: legalBattleFlips(state),
    terminal: isTerminal(state),
  };
}

function setText(el, value) {
  if (el) el.textContent = value;
}

export function createBattle({
  mountEl = null,
  refs = {},
  seed = 0,
  difficulty = 1,
  generatorOptions = {},
  generate = generateBattle,
  boardFactory = createBoard,
  initialCharges = 3,
  initialTurn = "white",
  autoStart = false,
  onStateChange,
  onIllegalMove,
  onTerminal,
  animationMs = 300,
} = {}) {
  const svgEl = refs.boardEl || qs(mountEl, "#battle-board") || qs(mountEl, "#board");
  const turnEl = refs.turnEl || qs(mountEl, "#battle-turn");
  const statusEl = refs.statusEl || qs(mountEl, "#battle-status");

  let level = null;
  let state = null;
  let board = null;
  let terminal = null;
  let destroyed = false;
  let animating = false;
  let feedbackTimer = null;
  let animationTimer = null;

  function emitState() {
    if (onStateChange) onStateChange(snapshot(state));
  }

  function updateTurn() {
    if (!state) return;
    setText(turnEl, playerLabel(state.turn));
  }

  function showStatus(message) {
    setText(statusEl, message);
  }

  function clearFeedbackSoon() {
    if (!statusEl) return;
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      feedbackTimer = null;
      if (!destroyed && !terminal) showStatus("");
    }, 900);
  }

  function clearAnimationTimer() {
    if (animationTimer) { clearTimeout(animationTimer); animationTimer = null; }
  }

  function refreshLegal() {
    if (board && state) board.markLegal(legalBattleFlips(state));
  }

  function finishTerminal(result) {
    terminal = result;
    animating = true;
    if (board) board.markLegal([]);
    showStatus(winnerText(result.winner));
    if (board) board.winCascade();
    if (onTerminal) onTerminal({ ...result, message: winnerText(result.winner), state: snapshot(state) });
    emitState();
  }

  function checkTerminal() {
    const result = isTerminal(state);
    if (result.terminal) finishTerminal(result);
    else {
      terminal = null;
      updateTurn();
      showStatus("");
      refreshLegal();
      emitState();
    }
  }

  function rejectMove(edgeId, reason) {
    if (board && edgeId) {
      board.shakeEdge(edgeId);
      const edge = state && state.edgeById.get(edgeId);
      if (edge) board.pulseNode(state.dirs.get(edgeId) === "uv" ? edge.v : edge.u);
    }
    showStatus("Illegal move");
    clearFeedbackSoon();
    if (onIllegalMove) onIllegalMove({ edgeId, reason, state: snapshot(state) });
  }

  function handleTap(edgeId) {
    if (destroyed || !state) return;
    if (animating || terminal) {
      rejectMove(edgeId, terminal ? "terminal" : "animating");
      return;
    }
    if (!isLegalBattleFlip(state, edgeId)) {
      rejectMove(edgeId, "illegal");
      return;
    }

    state = applyBattleFlip(state, edgeId);
    animating = true;
    if (board) board.update(state);
    const result = isTerminal(state);
    if (result.terminal) finishTerminal(result);
    else {
      checkTerminal();
      clearAnimationTimer();
      animationTimer = setTimeout(() => {
        animationTimer = null;
        if (!destroyed && !terminal) animating = false;
      }, animationMs);
    }
  }

  function start(options = {}) {
    destroyed = false;
    terminal = null;
    animating = false;
    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
    clearAnimationTimer();
    if (board) board.destroy();

    const battleOptions = {
      ...generatorOptions,
      ...options.generatorOptions,
      seed: options.seed ?? generatorOptions.seed ?? seed,
      difficulty: options.difficulty ?? generatorOptions.difficulty ?? difficulty,
    };
    level = options.level || generate(battleOptions);
    state = makeBattleConfig(
      level,
      options.initialCharges ?? initialCharges,
      options.initialTurn ?? initialTurn
    );
    if (svgEl) board = boardFactory(svgEl, state, { onEdgeTap: handleTap });
    else board = null;

    updateTurn();
    refreshLegal();
    const result = isTerminal(state);
    if (result.terminal) finishTerminal(result);
    else {
      terminal = null;
      showStatus(hasLegalMoves(state, state.turn) ? "" : winnerText(state.turn === "white" ? "black" : "white"));
      emitState();
    }
    return snapshot(state);
  }

  function destroy() {
    destroyed = true;
    animating = true;
    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
    clearAnimationTimer();
    if (board) { board.destroy(); board = null; }
  }

  if (autoStart) start();

  return {
    start,
    destroy,
    tap: handleTap,
    refreshLegal,
    get state() { return snapshot(state); },
    get level() { return level; },
    get terminal() { return terminal ? { ...terminal } : null; },
  };
}

export { legalBattleFlips };
