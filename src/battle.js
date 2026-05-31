import {
  applyBattleFlip,
  hasLegalMoves,
  isLegalBattleFlip,
  isTerminal,
  makeBattleConfig,
} from "./battleEngine.js";
import { chooseMove } from "./aiBattle.js";
import { analyzeBattleReplay, battleMovesFromState } from "./battleReplay.js";
import { generateBattle } from "./battleGenerator.js";
import { createBoard3d } from "./render3d.js";
import { createReplayUI } from "./replayUI.js";

const PLAYER_LABELS = Object.freeze({ white: "White", black: "Black" });
const AI_PLAYER = "black";
const AI_DELAY_MS = 600;

function qs(root, selector) {
  return root && root.querySelector ? root.querySelector(selector) : null;
}

function playerLabel(player) {
  return PLAYER_LABELS[player] || player;
}

function winnerText(winner) {
  return playerLabel(winner) + " Wins!";
}

function thinkingText(player) {
  return playerLabel(player) + " Thinking...";
}

function legalBattleFlips(state) {
  return state.level.edges
    .filter((edge) => isLegalBattleFlip(state, edge.id))
    .map((edge) => edge.id);
}

function withTestThree(options) {
  const testThree = globalThis.__THE_LOCK_RENDER3D_THREE__;
  return testThree && !options.THREE ? { ...options, THREE: testThree } : options;
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
  boardFactory = createBoard3d,
  boardOptions = {},
  initialCharges = 3,
  initialTurn = "white",
  vsAI = false,
  aiDifficulty,
  aiDelayMs = AI_DELAY_MS,
  aiMoveDelayMs,
  chooseAIMove = chooseMove,
  aiOptions = {},
  autoStart = false,
  onStateChange,
  onIllegalMove,
  onTerminal,
  battleReplayOptions = {},
  animationMs = 300,
} = {}) {
  const svgEl = refs.boardEl || qs(mountEl, "#battle-board") || qs(mountEl, "#board");
  const turnEl = refs.turnEl || qs(mountEl, "#battle-turn");
  const statusEl = refs.statusEl || qs(mountEl, "#battle-status");
  const replayMount = refs.replayMount || qs(mountEl, "#battle-replay-ui");

  let level = null;
  let state = null;
  let board = null;
  let terminal = null;
  let destroyed = false;
  let animating = false;
  let paused = false;
  let aiThinking = false;
  let feedbackTimer = null;
  let animationTimer = null;
  let aiTimer = null;
  let aiTurnToken = 0;
  let replayUI = null;
  let currentReplayAnalysis = null;
  let replayInitialCharges = initialCharges;
  let replayInitialTurn = initialTurn;

  const effectiveAIDifficulty = aiDifficulty ?? difficulty;
  const effectiveAIDelayMs = aiMoveDelayMs ?? aiDelayMs;

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

  function setThinking(next) {
    aiThinking = next;
    if (statusEl && statusEl.classList) statusEl.classList.toggle("thinking", next);
    if (svgEl && svgEl.classList) svgEl.classList.toggle("thinking", next);
    if (next) showStatus(thinkingText(AI_PLAYER));
  }

  function clearFeedbackSoon() {
    if (!statusEl) return;
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      feedbackTimer = null;
      if (!destroyed && !terminal && !aiThinking) showStatus("");
    }, 900);
  }

  function clearAnimationTimer() {
    if (animationTimer) { clearTimeout(animationTimer); animationTimer = null; }
  }

  function clearAiTimer() {
    aiTurnToken++;
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    setThinking(false);
  }

  function isAITurn() {
    return Boolean(vsAI && state && state.turn === AI_PLAYER && !terminal && !paused);
  }

  function refreshLegal() {
    if (board && state) board.markLegal(aiThinking ? [] : legalBattleFlips(state));
  }

  function ensureReplayUI() {
    if (!replayMount || replayUI) return replayUI;
    replayUI = createReplayUI({
      mountEl: replayMount,
      frames: [],
      analysis: { battle: true },
      onReplayStart() {
        if (board && currentReplayAnalysis?.startState) {
          if (board.clearWin) board.clearWin();
          board.update(currentReplayAnalysis.startState);
          board.markLegal([]);
          setText(turnEl, playerLabel(currentReplayAnalysis.startState.turn));
          showStatus("");
        }
      },
      onFrame(frame) {
        if (board) board.update(frame.config);
      },
    });
    replayUI.hide();
    return replayUI;
  }

  function hideReplayUI() {
    currentReplayAnalysis = null;
    if (replayUI) replayUI.hide();
  }

  function showReplayUI() {
    const ui = ensureReplayUI();
    if (!ui || !state) return;
    currentReplayAnalysis = analyzeBattleReplay({
      level,
      moves: battleMovesFromState(state),
      initialCharges: replayInitialCharges,
      initialTurn: replayInitialTurn,
      solverOptions: battleReplayOptions,
    });
    if (!currentReplayAnalysis) return;
    ui.show({
      frames: currentReplayAnalysis.frames,
      analysis: currentReplayAnalysis,
    });
  }

  function finishTerminal(result) {
    clearAiTimer();
    terminal = result;
    animating = true;
    if (board) board.markLegal([]);
    showStatus(winnerText(result.winner));
    if (board?.winCascade) board.winCascade();
    showReplayUI();
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

  function rejectMove(edgeId, reason, message = "Illegal move") {
    if (board && edgeId) {
      board.shakeEdge(edgeId);
      const edge = state && state.edgeById.get(edgeId);
      if (edge) board.pulseNode(state.dirs.get(edgeId) === "uv" ? edge.v : edge.u);
    }
    showStatus(message);
    if (message === "Illegal move") clearFeedbackSoon();
    if (onIllegalMove) onIllegalMove({ edgeId, reason, state: snapshot(state) });
  }

  function applyMove(edgeId) {
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

  function runAiTurn(token) {
    aiTimer = null;
    if (destroyed || token !== aiTurnToken || !isAITurn()) return;
    if (animating) {
      aiTimer = setTimeout(() => runAiTurn(token), 16);
      return;
    }

    const choice = chooseAIMove(state, effectiveAIDifficulty, aiOptions);
    if (!choice || !isLegalBattleFlip(state, choice.edgeId)) {
      setThinking(false);
      checkTerminal();
      return;
    }

    setThinking(false);
    applyMove(choice.edgeId);
  }

  function scheduleAiTurn() {
    if (!isAITurn() || destroyed || terminal) return;
    aiTurnToken++;
    const token = aiTurnToken;
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    setThinking(true);
    if (board) board.markLegal([]);
    aiTimer = setTimeout(() => runAiTurn(token), effectiveAIDelayMs);
  }

  function handleTap(edgeId) {
    if (destroyed || !state) return;
    if (paused) return;
    if (aiThinking || isAITurn()) {
      rejectMove(edgeId, "ai-thinking", thinkingText(AI_PLAYER));
      return;
    }
    if (animating || terminal) {
      rejectMove(edgeId, terminal ? "terminal" : "animating");
      return;
    }
    if (!isLegalBattleFlip(state, edgeId)) {
      rejectMove(edgeId, "illegal");
      return;
    }

    applyMove(edgeId);
    scheduleAiTurn();
  }

  function start(options = {}) {
    destroyed = false;
    terminal = null;
    animating = false;
    paused = false;
    hideReplayUI();
    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
    clearAnimationTimer();
    clearAiTimer();
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
    replayInitialCharges = options.initialCharges ?? initialCharges;
    replayInitialTurn = options.initialTurn ?? initialTurn;
    if (svgEl) board = boardFactory(svgEl, state, withTestThree({ ...boardOptions, ...options.boardOptions, onEdgeTap: handleTap }));
    else board = null;

    updateTurn();
    refreshLegal();
    const result = isTerminal(state);
    if (result.terminal) finishTerminal(result);
    else {
      terminal = null;
      showStatus(hasLegalMoves(state, state.turn) ? "" : winnerText(state.turn === "white" ? "black" : "white"));
      emitState();
      scheduleAiTurn();
    }
    return snapshot(state);
  }

  function destroy() {
    destroyed = true;
    paused = false;
    animating = true;
    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
    clearAnimationTimer();
    clearAiTimer();
    if (replayUI) { replayUI.destroy(); replayUI = null; }
    if (board) { board.destroy(); board = null; }
  }

  function pause() {
    if (destroyed) return;
    paused = true;
    clearAiTimer();
    if (board) board.markLegal([]);
  }

  function resume() {
    if (destroyed || !paused) return;
    paused = false;
    refreshLegal();
    scheduleAiTurn();
  }

  if (autoStart) start();

  return {
    start,
    destroy,
    pause,
    resume,
    tap: handleTap,
    refreshLegal,
    get state() { return snapshot(state); },
    get level() { return level; },
    get terminal() { return terminal ? { ...terminal } : null; },
    get isAIThinking() { return aiThinking; },
  };
}

export { legalBattleFlips };
