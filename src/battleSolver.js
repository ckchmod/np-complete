import {
  applyBattleFlip,
  battleInflow,
  isLegalBattleFlip,
  isTerminal,
} from "./battleEngine.js";

const DEFAULT_MAX_STATES = 1_000_000;
const PLAYERS = ["white", "black"];

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

function encodeState(state) {
  const parts = [state.turn];
  for (const edge of state.level.edges) {
    parts.push(state.dirs.get(edge.id) === edge.dir ? "0" : "1");
    parts.push(String(state.charges.get(edge.id)));
  }
  return parts.join("|");
}

function canThreatenTarget(state, player) {
  const target = targetFor(state, player);
  if (!target) return false;
  return isLegalBattleFlip({ ...state, turn: player }, target);
}

function isCheckingMove(state, edgeId) {
  const mover = state.turn;
  const next = applyBattleFlip(state, edgeId);
  const terminal = isTerminal(next);
  return terminal.terminal && terminal.winner === mover
    ? true
    : canThreatenTarget(next, mover);
}

function defensiveReplyCount(state, moves) {
  const opponent = otherPlayer(state.turn);
  if (!canThreatenTarget(state, opponent)) return 0;

  let replies = 0;
  for (const edgeId of moves) {
    const next = applyBattleFlip(state, edgeId);
    const terminal = isTerminal(next);
    if ((terminal.terminal && terminal.winner === state.turn) || !canThreatenTarget(next, opponent)) {
      replies++;
    }
  }
  return replies;
}

function edgeIsRelevantToBothTargets(state, edge) {
  const whiteTarget = state.edgeById.get(state.level.target);
  const blackTarget = state.edgeById.get(state.level.targetB);
  if (!whiteTarget || !blackTarget) return false;

  const endpoints = new Set([edge.u, edge.v]);
  return [whiteTarget.u, whiteTarget.v].some((nodeId) => endpoints.has(nodeId))
    && [blackTarget.u, blackTarget.v].some((nodeId) => endpoints.has(nodeId));
}

function chargeTension(state) {
  let tension = 0;
  for (const edge of state.level.edges) {
    if ((state.charges.get(edge.id) ?? 0) !== 1) continue;
    const owner = state.owner.get(edge.id) ?? "neutral";
    const sharedByLegality = PLAYERS.every((player) => isLegalBattleFlip({ ...state, turn: player }, edge.id));
    if (owner === "neutral" && (sharedByLegality || edgeIsRelevantToBothTargets(state, edge))) tension++;
  }
  return tension;
}

function slackTension(state) {
  let tension = 0;

  for (const node of state.level.nodes) {
    if (battleInflow(state, node.id) - 2 > 1) continue;
    let whiteCanUseRegion = false;
    let blackCanUseRegion = false;

    for (const edgeId of state.incident.get(node.id)) {
      const edge = state.edgeById.get(edgeId);
      const owner = state.owner.get(edgeId) ?? "neutral";
      if ((state.charges.get(edgeId) ?? 0) <= 0) continue;
      if (owner === "white" || owner === "neutral") whiteCanUseRegion = true;
      if (owner === "black" || owner === "neutral") blackCanUseRegion = true;
      if (edge.id === targetFor(state, "white")) whiteCanUseRegion = true;
      if (edge.id === targetFor(state, "black")) blackCanUseRegion = true;
    }

    if (whiteCanUseRegion && blackCanUseRegion) tension++;
  }
  return tension;
}

function emptyMetrics() {
  return {
    checkingMoves: 0,
    defensiveReplies: 0,
    zugzwangStates: 0,
    chargeTension: 0,
    slackTension: 0,
    legalMoveTotal: 0,
    nonterminalStates: 0,
    statesEvaluated: 0,
  };
}

function addMetrics(total, next) {
  total.checkingMoves += next.checkingMoves;
  total.defensiveReplies += next.defensiveReplies;
  total.zugzwangStates += next.zugzwangStates;
  total.chargeTension += next.chargeTension;
  total.slackTension += next.slackTension;
  total.legalMoveTotal += next.legalMoveTotal;
  total.nonterminalStates += next.nonterminalStates;
  total.statesEvaluated += next.statesEvaluated;
}

function terminalResult(winner) {
  return {
    outcome: winner,
    distanceToWin: 0,
    partial: false,
    metrics: emptyMetrics(),
  };
}

function partialResult() {
  return {
    outcome: null,
    distanceToWin: null,
    partial: true,
    metrics: emptyMetrics(),
  };
}

function pickBestResult(player, childResults) {
  const winning = childResults.filter((child) => child.outcome === player);
  if (winning.length > 0) {
    return winning.reduce((best, child) =>
      child.distanceToWin < best.distanceToWin ? child : best
    );
  }
  return childResults.reduce((best, child) =>
    child.distanceToWin > best.distanceToWin ? child : best
  );
}

export function minimax(state, options = {}) {
  const maxStates = options.maxStates ?? DEFAULT_MAX_STATES;
  const memo = options.memo ?? new Map();
  const stats = { cacheHits: 0, cacheMisses: 0, statesEvaluated: 0 };

  function solve(current) {
    const terminal = isTerminal(current);
    if (terminal.terminal) return terminalResult(terminal.winner);

    const key = encodeState(current);
    const cached = memo.get(key);
    if (cached) {
      stats.cacheHits++;
      return cached;
    }

    if (stats.statesEvaluated >= maxStates) return partialResult();
    stats.statesEvaluated++;
    stats.cacheMisses++;

    const moves = legalBattleFlips(current);
    const metrics = emptyMetrics();
    metrics.statesEvaluated = 1;
    metrics.nonterminalStates = 1;
    metrics.legalMoveTotal = moves.length;
    metrics.defensiveReplies = defensiveReplyCount(current, moves);
    metrics.chargeTension = chargeTension(current);
    metrics.slackTension = slackTension(current);

    const childResults = [];
    for (const edgeId of moves) {
      if (isCheckingMove(current, edgeId)) metrics.checkingMoves++;
      const child = solve(applyBattleFlip(current, edgeId));
      addMetrics(metrics, child.metrics);
      if (child.partial) return partialResult();
      childResults.push({
        outcome: child.outcome,
        distanceToWin: child.distanceToWin + 1,
      });
    }

    const best = pickBestResult(current.turn, childResults);
    if (best.outcome !== current.turn && moves.length > 0) metrics.zugzwangStates++;

    const result = {
      outcome: best.outcome,
      distanceToWin: best.distanceToWin,
      partial: false,
      metrics,
    };
    memo.set(key, result);
    return result;
  }

  const result = solve(state);
  const metrics = result.metrics;
  const branchingFactor = metrics.nonterminalStates === 0
    ? 0
    : metrics.legalMoveTotal / metrics.nonterminalStates;

  return {
    outcome: result.outcome,
    distanceToWin: result.distanceToWin,
    checkingMoves: metrics.checkingMoves,
    defensiveReplies: metrics.defensiveReplies,
    zugzwangStates: metrics.zugzwangStates,
    chargeTension: metrics.chargeTension,
    slackTension: metrics.slackTension,
    branchingFactor,
    partial: result.partial,
    stateCap: maxStates,
    cacheHits: stats.cacheHits,
    cacheMisses: stats.cacheMisses,
    statesEvaluated: stats.statesEvaluated,
    memoSize: memo.size,
  };
}
