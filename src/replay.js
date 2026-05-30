import { applyFlip, makeConfig } from "./engine.js";
import { generateLock, makeRng } from "./generator.js";

export const REPLAY_VERSION = 1;
export const REPLAY_STORAGE_KEY = "thelock_replays";
export const REPLAY_MAX_STORED = 50;

const MODES = new Set(["rush", "tutorial", "battle"]);
const SPEEDS = new Set([0.5, 1, 2]);

function hashString(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
    hash >>>= 0;
  }
  return hash >>> 0;
}

function replayId(seed, moves) {
  return "r_" + hashString(seed + "\u0000" + moves.join("\u0000")).toString(36).padStart(7, "0");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validMoves(moves) {
  return Array.isArray(moves) && moves.every((move) => typeof move === "string" && move.length > 0);
}

function validReplay(replay) {
  return isObject(replay) &&
    replay.version === REPLAY_VERSION &&
    typeof replay.seed === "string" &&
    validMoves(replay.moves) &&
    Number.isFinite(replay.timestamp) &&
    MODES.has(replay.mode) &&
    typeof replay.id === "string" &&
    replay.id === replayId(replay.seed, replay.moves);
}

function normalizeReplay(replay) {
  if (!validReplay(replay)) return null;
  return {
    version: REPLAY_VERSION,
    seed: replay.seed,
    moves: [...replay.moves],
    timestamp: replay.timestamp,
    mode: replay.mode,
    id: replay.id,
  };
}

function getStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch (_) {
    return null;
  }
}

function startConfig(seed) {
  const level = generateLock(1, makeRng(hashString(seed)));
  return level ? makeConfig(level) : null;
}

function parseStoredReplays() {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(REPLAY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeReplay).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function writeStoredReplays(replays) {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(replays));
    return true;
  } catch (_) {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function captureReplay(seed, moves, options = {}) {
  const mode = typeof options === "string" ? options : options.mode || "rush";
  if (typeof seed !== "string" || seed.length === 0) return null;
  if (!validMoves(moves)) return null;
  if (!MODES.has(mode)) return null;

  const copiedMoves = [...moves];
  return {
    version: REPLAY_VERSION,
    seed,
    moves: copiedMoves,
    timestamp: Date.now(),
    mode,
    id: replayId(seed, copiedMoves),
  };
}

export function replayToState(replay) {
  if (!validReplay(replay)) return null;
  try {
    let config = startConfig(replay.seed);
    if (!config) return null;
    for (const move of replay.moves) config = applyFlip(config, move);
    return config;
  } catch (_) {
    return null;
  }
}

export async function playbackMoves(replay, onMove, options = {}) {
  if (!validReplay(replay) || typeof onMove !== "function") return null;
  const delayMs = Number.isFinite(options.delayMs) && options.delayMs >= 0 ? options.delayMs : 250;
  const speed = SPEEDS.has(options.speed) ? options.speed : 1;
  const waitMs = delayMs / speed;

  try {
    let config = startConfig(replay.seed);
    if (!config) return null;
    const frames = [];
    for (let moveIndex = 0; moveIndex < replay.moves.length; moveIndex++) {
      const moveId = replay.moves[moveIndex];
      config = applyFlip(config, moveId);
      const frame = {
        config,
        moveIndex,
        moveId,
        isLast: moveIndex === replay.moves.length - 1,
      };
      frames.push(frame);
      onMove(frame);
      if (!frame.isLast && waitMs > 0) await sleep(waitMs);
    }
    return frames;
  } catch (_) {
    return null;
  }
}

export function saveReplay(replay) {
  const normalized = normalizeReplay(replay);
  if (!normalized) return null;
  const replays = parseStoredReplays().filter((entry) => entry.id !== normalized.id);
  replays.unshift(normalized);
  const stored = replays.slice(0, REPLAY_MAX_STORED);
  return writeStoredReplays(stored) ? normalized : null;
}

export function loadReplays() {
  return parseStoredReplays();
}

export function deleteReplay(id) {
  if (typeof id !== "string" || id.length === 0) return false;
  const replays = parseStoredReplays();
  const remaining = replays.filter((replay) => replay.id !== id);
  if (remaining.length === replays.length) return false;
  return writeStoredReplays(remaining);
}
