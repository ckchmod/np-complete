import { isLegalFlip, makeConfig } from "./engine.js";
import { generateLock, makeRng } from "./generator.js";
import { makeBattleConfig } from "./battleEngine.js";
import { minimax } from "./battleSolver.js";

export const BATTLE_MAX_NODES = 24;
export const BATTLE_MAX_EDGES = 30;
export const BATTLE_GENERATOR_MAX_ATTEMPTS = 50;
export const BATTLE_SOLVER_MAX_STATES = 250_000;

export const BATTLE_BALANCE_THRESHOLDS = Object.freeze({
  minDistanceToWin: 7,
  maxDistanceToWin: 25,
  minBranchingFactor: 1.3,
  minCheckingMoves: 1,
  minDefensiveReplies: 1,
  minZugzwangStates: 1,
  minChargeTension: 2,
});

const OWNER_PATTERN = Object.freeze(["neutral", "white", "neutral", "black", "neutral"]);

function edgeNumber(edgeId) {
  const n = Number(edgeId.replace(/^\D+/, ""));
  return Number.isFinite(n) ? n : 0;
}

function rotate(items, offset) {
  if (items.length === 0) return items;
  const n = offset % items.length;
  return [...items.slice(n), ...items.slice(0, n)];
}

function lockedTargetCandidates(level) {
  const config = makeConfig(level);
  return level.edges
    .filter((edge) => edge.id !== level.target && !isLegalFlip(config, edge.id))
    .sort((a, b) => edgeNumber(a.id) - edgeNumber(b.id));
}

function ownerFor(edge, index, target, targetB) {
  if (edge.id === target) return "white";
  if (edge.id === targetB) return "black";
  return OWNER_PATTERN[index % OWNER_PATTERN.length];
}

export function decorateBattleLevel(baseLevel, targetB, options = {}) {
  const chargesPerEdge = options.chargesPerEdge ?? 3;
  const owners = {};
  const charges = {};
  const edges = baseLevel.edges.map((edge, index) => {
    const owner = ownerFor(edge, index, baseLevel.target, targetB);
    const chargeCount = edge.battleCharges ?? edge.charges ?? edge.initialCharges ?? chargesPerEdge;
    owners[edge.id] = owner;
    charges[edge.id] = chargeCount;
    return { ...edge, owner, charges: chargeCount };
  });

  return {
    ...baseLevel,
    id: `battle-${baseLevel.id}`,
    name: "Battle Lock",
    edges,
    targetB,
    battle: {
      source: baseLevel.id,
      sourceHead: baseLevel.head,
      owners,
      charges,
    },
  };
}

export function hasFirstMoveWin(level, options = {}) {
  const turn = options.turn ?? "white";
  const result = minimax(makeBattleConfig(level, options.initialCharges ?? 2, turn), {
    maxStates: options.maxStates ?? BATTLE_SOLVER_MAX_STATES,
  });
  return result.partial === false && result.outcome === turn && result.distanceToWin === 1;
}

function balanceReasons(result, thresholds) {
  const reasons = [];
  if (result.partial) reasons.push("partial");
  if (result.distanceToWin === null) reasons.push("no-distance");
  if (result.distanceToWin === 1) reasons.push("first-move-win");
  if (result.distanceToWin < thresholds.minDistanceToWin) reasons.push("too-shallow");
  if (result.distanceToWin > thresholds.maxDistanceToWin) reasons.push("too-deep");
  if (result.branchingFactor < thresholds.minBranchingFactor) reasons.push("low-branching");
  if (result.checkingMoves < thresholds.minCheckingMoves) reasons.push("no-checking-threat");
  if (result.defensiveReplies < thresholds.minDefensiveReplies) reasons.push("no-defensive-reply");
  if (result.zugzwangStates < thresholds.minZugzwangStates) reasons.push("no-zugzwang");
  if (result.chargeTension < thresholds.minChargeTension) reasons.push("low-charge-tension");
  return reasons;
}

export function evaluateBattle(level, options = {}) {
  const thresholds = options.thresholds ?? BATTLE_BALANCE_THRESHOLDS;
  const result = minimax(makeBattleConfig(level, options.initialCharges ?? 2, options.turn ?? "white"), {
    maxStates: options.maxStates ?? BATTLE_SOLVER_MAX_STATES,
  });
  const reasons = balanceReasons(result, thresholds);
  return {
    ...result,
    passed: reasons.length === 0,
    reasons,
  };
}

function candidateScore(evaluation, desiredOutcome) {
  const depth = evaluation.distanceToWin ?? 0;
  const desiredBonus = evaluation.outcome === desiredOutcome ? 100 : 0;
  const depthScore = Math.max(0, 30 - Math.abs(13 - depth));
  return desiredBonus
    + depthScore
    + evaluation.branchingFactor
    + Math.min(10, evaluation.defensiveReplies)
    + Math.min(10, evaluation.zugzwangStates)
    + Math.min(10, evaluation.chargeTension);
}

function summarizeRejection(level, targetB, evaluation) {
  return {
    sourceHead: level.head,
    targetB,
    outcome: evaluation.outcome,
    distanceToWin: evaluation.distanceToWin,
    partial: evaluation.partial,
    reasons: evaluation.reasons,
  };
}

function attachDiagnostics(level, diagnostics, evaluation) {
  return {
    ...level,
    battle: {
      ...level.battle,
      thresholds: BATTLE_BALANCE_THRESHOLDS,
      diagnostics: {
        ...diagnostics,
        accepted: {
          outcome: evaluation.outcome,
          distanceToWin: evaluation.distanceToWin,
          branchingFactor: evaluation.branchingFactor,
          checkingMoves: evaluation.checkingMoves,
          defensiveReplies: evaluation.defensiveReplies,
          zugzwangStates: evaluation.zugzwangStates,
          chargeTension: evaluation.chargeTension,
          slackTension: evaluation.slackTension,
          statesEvaluated: evaluation.statesEvaluated,
          partial: evaluation.partial,
        },
      },
    },
  };
}

function fallbackBattle(options) {
  const rng = makeRng(options.seed ?? 1);
  const base = generateLock(1, rng);
  const targetB = lockedTargetCandidates(base)[0]?.id;
  if (!targetB) throw new Error("Unable to build battle fallback: no locked secondary target");
  return decorateBattleLevel(base, targetB, { chargesPerEdge: 3 });
}

export function generateBattle(options = {}) {
  const seed = options.seed ?? 0;
  const rng = options.rng ?? makeRng(seed);
  const maxAttempts = options.maxAttempts ?? BATTLE_GENERATOR_MAX_ATTEMPTS;
  const maxStates = options.maxStates ?? BATTLE_SOLVER_MAX_STATES;
  const difficulty = Math.max(1, Math.floor(options.difficulty ?? 1));
  const targetCandidatesPerBoard = options.targetCandidatesPerBoard ?? 4;
  const desiredOutcome = rng() < 0.5 ? "white" : "black";
  const rejections = [];
  let best = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const base = generateLock(difficulty, rng);
    if (!base || base.nodes.length > BATTLE_MAX_NODES || base.edges.length > BATTLE_MAX_EDGES) {
      rejections.push({ attempt, reasons: ["classic-generator-failed-or-oversized"] });
      continue;
    }

    const candidates = rotate(lockedTargetCandidates(base), Math.floor(rng() * Math.max(1, base.edges.length)))
      .slice(0, targetCandidatesPerBoard);
    if (candidates.length === 0) {
      rejections.push({ attempt, sourceHead: base.head, reasons: ["no-locked-secondary-target"] });
      continue;
    }

    for (const candidate of candidates) {
      const level = decorateBattleLevel(base, candidate.id, { chargesPerEdge: 3 });
      const evaluation = evaluateBattle(level, { maxStates });
      const scored = { level, evaluation, score: candidateScore(evaluation, desiredOutcome) };
      if (!best || scored.score > best.score) best = scored;
      if (evaluation.passed) {
        return attachDiagnostics(level, {
          attempts: attempt,
          fallback: false,
          desiredOutcome,
          rejectionReasons: rejections,
        }, evaluation);
      }
      rejections.push({ attempt, ...summarizeRejection(base, candidate.id, evaluation) });
    }
  }

  const fallbackLevel = best?.evaluation?.distanceToWin >= BATTLE_BALANCE_THRESHOLDS.minDistanceToWin
    && !best.evaluation.partial
    && best.evaluation.distanceToWin !== 1
    ? best.level
    : fallbackBattle({ seed });
  const fallbackEvaluation = best?.level === fallbackLevel
    ? best.evaluation
    : evaluateBattle(fallbackLevel, { maxStates });

  if (fallbackEvaluation.partial || fallbackEvaluation.distanceToWin === 1) {
    throw new Error("Unable to generate non-trivial battle board fallback");
  }

  return attachDiagnostics(fallbackLevel, {
    attempts: maxAttempts,
    fallback: true,
    desiredOutcome,
    rejectionReasons: rejections,
  }, fallbackEvaluation);
}
