import {
  applyBattleFlip,
  isLegalBattleFlip,
  isTerminal,
  makeBattleConfig,
} from "./battleEngine.js";
import { minimax } from "./battleSolver.js";

function otherPlayer(player) {
  return player === "white" ? "black" : "white";
}

function targetFor(state, player) {
  return player === "white" ? state.level.target : state.level.targetB;
}

function legalBattleFlips(state) {
  const moves = [];
  for (const edge of state.level.edges) {
    if (isLegalBattleFlip(state, edge.id)) moves.push(edge.id);
  }
  return moves;
}

function canThreatenTarget(state, player) {
  const target = targetFor(state, player);
  return Boolean(target) && isLegalBattleFlip({ ...state, turn: player }, target);
}

function isDefensiveMove(state, edgeId, threatenedBy) {
  const next = applyBattleFlip(state, edgeId);
  const terminal = isTerminal(next);
  return (terminal.terminal && terminal.winner === state.turn) || !canThreatenTarget(next, threatenedBy);
}

function summarizeMoveList(moves) {
  return {
    count: moves.length,
    edgeIds: moves.slice(),
  };
}

function analyzeZugzwang(state, legalMoves, moveIndex, solverOptions, memo) {
  if (legalMoves.length === 0) return null;
  const result = minimax(state, { ...solverOptions, memo });
  if (result.partial || result.outcome === state.turn) return null;
  return {
    moveIndex,
    moveNumber: moveIndex,
    player: state.turn,
    legalMoveCount: legalMoves.length,
  };
}

export function analyzeBattleReplay({
  level,
  moves,
  initialCharges = 3,
  initialTurn = "white",
  solverOptions = {},
} = {}) {
  if (!level || !Array.isArray(moves)) return null;

  const memo = solverOptions.memo ?? new Map();
  const options = { ...solverOptions };
  delete options.memo;

  let state = makeBattleConfig(level, initialCharges, initialTurn);
  const startState = state;
  const frames = [];
  const checkMoments = [];
  const missedDefenses = [];
  const zugzwangStates = [];

  for (let moveIndex = 0; moveIndex < moves.length; moveIndex++) {
    const moveId = moves[moveIndex];
    const legalMoves = legalBattleFlips(state);
    const threatenedBy = otherPlayer(state.turn);
    const defensiveMoves = canThreatenTarget(state, threatenedBy)
      ? legalMoves.filter((edgeId) => isDefensiveMove(state, edgeId, threatenedBy))
      : [];
    const zugzwang = analyzeZugzwang(state, legalMoves, moveIndex, options, memo);

    if (zugzwang) zugzwangStates.push(zugzwang);
    if (defensiveMoves.length > 0 && !defensiveMoves.includes(moveId)) {
      missedDefenses.push({
        moveIndex,
        moveNumber: moveIndex + 1,
        player: state.turn,
        threatenedBy,
        chosenMove: moveId,
        defensiveMoves: summarizeMoveList(defensiveMoves),
      });
    }

    state = applyBattleFlip(state, moveId);
    const terminal = isTerminal(state);
    if (terminal.terminal && terminal.reason === "target") {
      checkMoments.push({
        moveIndex,
        moveNumber: moveIndex + 1,
        player: terminal.winner,
        terminal: true,
      });
    } else if (!terminal.terminal && canThreatenTarget(state, state.turn)) {
      checkMoments.push({
        moveIndex,
        moveNumber: moveIndex + 1,
        player: state.turn,
        immediateTargetThreat: true,
      });
    }

    frames.push({
      config: state,
      moveIndex,
      moveId,
      isLast: moveIndex === moves.length - 1,
    });
    if (terminal.terminal) break;
  }

  const terminal = isTerminal(state);
  return {
    battle: true,
    moveCount: frames.length,
    checkMoments,
    missedDefenses,
    zugzwangStates,
    startState,
    finalState: state,
    frames,
    terminal,
  };
}

export function battleMovesFromState(state) {
  return state?.history?.map((entry) => entry.edgeId) ?? [];
}
