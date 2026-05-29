import { inflow, isLegalFlip, makeConfig } from "./engine.js";

const PLAYERS = new Set(["white", "black"]);
const NEUTRAL = "neutral";

function otherPlayer(player) {
  return player === "white" ? "black" : "white";
}

function reverseDir(dir) {
  return dir === "uv" ? "vu" : "uv";
}

function edgeOwner(level, edge) {
  return edge.owner ?? level.owners?.[edge.id] ?? level.battle?.owners?.[edge.id] ?? NEUTRAL;
}

function edgeCharges(level, edge, initialCharges) {
  return edge.battleCharges ?? edge.charges ?? edge.initialCharges ?? level.battle?.charges?.[edge.id] ?? initialCharges;
}

function assertPlayer(player) {
  if (!PLAYERS.has(player)) throw new Error(`Invalid battle player: ${player}`);
}

function assertOwner(owner, edgeId) {
  if (owner !== NEUTRAL && !PLAYERS.has(owner)) {
    throw new Error(`Invalid owner for edge ${edgeId}: ${owner}`);
  }
}

function assertCharges(charges, edgeId) {
  if (!Number.isInteger(charges) || charges < 0) {
    throw new Error(`Invalid charges for edge ${edgeId}: ${charges}`);
  }
}

function isTargetReversed(state, targetId) {
  const edge = state.edgeById.get(targetId);
  return Boolean(edge) && state.dirs.get(targetId) !== edge.dir;
}

export function makeBattleConfig(level, initialCharges = 2, turn = "white") {
  assertPlayer(turn);
  assertCharges(initialCharges, "initialCharges");

  const base = makeConfig(level);
  const charges = new Map();
  const owner = new Map();

  for (const edge of level.edges) {
    const ownerValue = edgeOwner(level, edge);
    const chargeValue = edgeCharges(level, edge, initialCharges);

    assertOwner(ownerValue, edge.id);
    assertCharges(chargeValue, edge.id);

    owner.set(edge.id, ownerValue);
    charges.set(edge.id, chargeValue);
  }

  return {
    level,
    dirs: new Map(base.dirs),
    charges,
    owner,
    turn,
    history: [],
    edgeById: base.edgeById,
    incident: base.incident,
  };
}

export function battleInflow(state, nodeId) {
  return inflow(state, nodeId);
}

export function isLegalBattleFlip(state, edgeId) {
  const edge = state.edgeById.get(edgeId);
  if (!edge) return false;

  const owner = state.owner.get(edgeId) ?? NEUTRAL;
  if (owner !== NEUTRAL && owner !== state.turn) return false;
  if ((state.charges.get(edgeId) ?? 0) <= 0) return false;

  return isLegalFlip(state, edgeId);
}

export function applyBattleFlip(state, edgeId) {
  if (!isLegalBattleFlip(state, edgeId)) {
    throw new Error(`Illegal battle flip: edge ${edgeId}`);
  }

  const dirBefore = state.dirs.get(edgeId);
  const chargeBefore = state.charges.get(edgeId);
  const dirs = new Map(state.dirs);
  const charges = new Map(state.charges);

  dirs.set(edgeId, reverseDir(dirBefore));
  charges.set(edgeId, chargeBefore - 1);

  return {
    level: state.level,
    dirs,
    charges,
    owner: state.owner,
    turn: otherPlayer(state.turn),
    history: [
      ...state.history,
      { edgeId, dirsBefore: state.dirs, chargesBefore: state.charges, player: state.turn },
    ],
    edgeById: state.edgeById,
    incident: state.incident,
  };
}

export function hasLegalMoves(state, player) {
  assertPlayer(player);
  const turnState = state.turn === player ? state : { ...state, turn: player };

  for (const edge of state.level.edges) {
    if (isLegalBattleFlip(turnState, edge.id)) return true;
  }
  return false;
}

export function isTerminal(state) {
  if (isTargetReversed(state, state.level.target)) {
    return { terminal: true, winner: "white", reason: "target" };
  }
  if (isTargetReversed(state, state.level.targetB)) {
    return { terminal: true, winner: "black", reason: "target" };
  }
  if (!hasLegalMoves(state, state.turn)) {
    return { terminal: true, winner: otherPlayer(state.turn), reason: "no-moves" };
  }
  return { terminal: false };
}
