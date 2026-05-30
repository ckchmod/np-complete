import {
  applyBattleFlip,
  isLegalBattleFlip,
  isTerminal,
} from "./battleEngine.js";
import { minimax } from "./battleSolver.js";

const FULL_MAX_STATES = 1_000_000;
const SHALLOW_MAX_STATES = 10_000;
const FULL_TIME_LIMIT_MS = 2_000;
const MISTAKE_RATE = 0.15;

function nowMs() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

function legalBattleFlips(state) {
  return state.level.edges
    .filter((edge) => isLegalBattleFlip(state, edge.id))
    .map((edge) => edge.id);
}

function targetFor(state, player = state.turn) {
  return player === "white" ? state.level.target : state.level.targetB;
}

function otherPlayer(player) {
  return player === "white" ? "black" : "white";
}

function choice(edgeId, started) {
  return { edgeId, thinkingTimeMs: nowMs() - started };
}

function randomMove(state, options, started = nowMs()) {
  const moves = legalBattleFlips(state);
  if (moves.length === 0) return null;

  const rng = options.rng ?? Math.random;
  const target = targetFor(state);
  const roll = rng();
  if (moves.includes(target) && roll < 0.3) return choice(target, started);

  return choice(moves[Math.min(moves.length - 1, Math.floor(roll * moves.length))], started);
}

function scoreTerminal(result, player, ply) {
  if (!result.terminal) return null;
  if (result.winner === player) return 10_000 - ply;
  return -10_000 + ply;
}

function mobility(state, player) {
  return legalBattleFlips({ ...state, turn: player }).length;
}

function chargeScore(state, player) {
  let score = 0;
  for (const edge of state.level.edges) {
    const charges = state.charges.get(edge.id) ?? 0;
    const owner = state.owner.get(edge.id) ?? "neutral";
    if (owner === player || owner === "neutral") score += charges;
    else score -= charges;
  }
  return score;
}

function staticEvaluation(state, player) {
  const terminalScore = scoreTerminal(isTerminal(state), player, 0);
  if (terminalScore !== null) return terminalScore;

  const opponent = otherPlayer(player);
  const playerTargetThreat = isLegalBattleFlip({ ...state, turn: player }, targetFor(state, player)) ? 250 : 0;
  const opponentTargetThreat = isLegalBattleFlip({ ...state, turn: opponent }, targetFor(state, opponent)) ? 250 : 0;
  return playerTargetThreat
    - opponentTargetThreat
    + 8 * (mobility(state, player) - mobility(state, opponent))
    + chargeScore(state, player);
}

function shallowSearch(state, depth, player, budget) {
  if (budget.visited >= budget.maxStates || nowMs() >= budget.deadline) return staticEvaluation(state, player);
  budget.visited++;

  const terminalScore = scoreTerminal(isTerminal(state), player, 0);
  if (terminalScore !== null) return terminalScore;
  if (depth === 0) return staticEvaluation(state, player);

  const moves = legalBattleFlips(state);
  if (moves.length === 0) return staticEvaluation(state, player);

  const maximizing = state.turn === player;
  let best = maximizing ? -Infinity : Infinity;
  for (const edgeId of moves) {
    const score = shallowSearch(applyBattleFlip(state, edgeId), depth - 1, player, budget);
    best = maximizing ? Math.max(best, score) : Math.min(best, score);
    if (budget.visited >= budget.maxStates || nowMs() >= budget.deadline) break;
  }
  return best;
}

function sortRanks(ranks) {
  return ranks.sort((a, b) => b.score - a.score || a.index - b.index);
}

function shallowRanks(state, options, started = nowMs()) {
  const moves = legalBattleFlips(state);
  const budget = {
    maxStates: options.shallowMaxStates ?? SHALLOW_MAX_STATES,
    deadline: started + (options.shallowTimeLimitMs ?? 500),
    visited: 0,
  };

  return sortRanks(moves.map((edgeId, index) => ({
    edgeId,
    index,
    score: shallowSearch(applyBattleFlip(state, edgeId), 1, state.turn, budget),
  })));
}

function shallowMove(state, options, started = nowMs()) {
  const ranks = shallowRanks(state, options, started);
  if (ranks.length === 0) return null;
  return choice(ranks[0].edgeId, started);
}

function scoreSolvedResult(result, player) {
  if (result.partial || result.outcome === null || result.distanceToWin === null) return null;
  if (result.outcome === player) return 100_000 - result.distanceToWin;
  return -100_000 + result.distanceToWin;
}

function fullRanks(state, options, started = nowMs()) {
  const moves = legalBattleFlips(state);
  const memo = options.memo ?? new Map();
  const deadline = started + (options.fullTimeLimitMs ?? FULL_TIME_LIMIT_MS);
  const maxStates = options.fullMaxStates ?? FULL_MAX_STATES;
  let remainingStates = maxStates;
  let partial = false;
  const ranks = [];

  for (let index = 0; index < moves.length; index++) {
    if (remainingStates <= 0 || nowMs() >= deadline) {
      partial = true;
      break;
    }

    const edgeId = moves[index];
    const result = minimax(applyBattleFlip(state, edgeId), { maxStates: remainingStates, memo });
    remainingStates = Math.max(0, remainingStates - result.statesEvaluated);
    const score = scoreSolvedResult(result, state.turn);
    if (score === null) {
      partial = true;
      break;
    }
    ranks.push({ edgeId, index, score, result });
  }

  if (ranks.length !== moves.length) partial = true;
  return { ranks: sortRanks(ranks), partial };
}

function fullMove(state, options, started = nowMs()) {
  const solved = fullRanks(state, options, started);
  if (!solved.partial && solved.ranks.length > 0) return choice(solved.ranks[0].edgeId, started);

  const shallow = shallowMove(state, options, started);
  if (shallow) return shallow;
  return randomMove(state, options, started);
}

function mistakeMove(state, options, started = nowMs()) {
  const solved = fullRanks(state, options, started);
  if (solved.partial || solved.ranks.length === 0) return fullMove(state, options, started);

  const rng = options.rng ?? Math.random;
  if (solved.ranks.length > 1 && rng() < (options.mistakeRate ?? MISTAKE_RATE)) {
    const mistakePool = solved.ranks.slice(1, 3);
    return choice(mistakePool[0].edgeId, started);
  }

  return choice(solved.ranks[0].edgeId, started);
}

export function chooseMove(state, difficulty, options = {}) {
  const terminal = isTerminal(state);
  if (terminal.terminal) return null;
  if (legalBattleFlips(state).length === 0) return null;

  const started = nowMs();
  if (difficulty === 1) return randomMove(state, options, started);
  if (difficulty === 2) return shallowMove(state, options, started) ?? randomMove(state, options, started);
  if (difficulty === 3) return fullMove(state, options, started);
  if (difficulty === 4) return mistakeMove(state, options, started);
  throw new Error(`Invalid AI battle difficulty: ${difficulty}`);
}
