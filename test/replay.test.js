import { test } from "node:test";
import assert from "node:assert/strict";

import { applyFlip, legalFlips } from "../src/engine.js";
import {
  REPLAY_MAX_STORED,
  REPLAY_STORAGE_KEY,
  REPLAY_VERSION,
  captureReplay,
  deleteReplay,
  loadReplays,
  playbackMoves,
  replayToState,
  saveReplay,
} from "../src/replay.js";

function orientation(config) {
  return config.level.edges.map((edge) => [edge.id, config.dirs.get(edge.id)]);
}

function replayMoves(seed, count) {
  const replay = captureReplay(seed, []);
  let config = replayToState(replay);
  const moves = [];
  for (let i = 0; i < count; i++) {
    const move = legalFlips(config)[0];
    assert.ok(move, "generated replay fixture should have a legal move");
    moves.push(move);
    config = applyFlip(config, move);
  }
  return moves;
}

async function withStorage(fn) {
  const previous = globalThis.localStorage;
  const store = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
    },
    configurable: true,
    writable: true,
  });
  try {
    return await fn(store);
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      value: previous,
      configurable: true,
      writable: true,
    });
  }
}

test("captureReplay creates a valid versioned replay object", () => {
  const originalNow = Date.now;
  Date.now = () => 123456789;
  try {
    const moves = ["e0", "e1"];
    const replay = captureReplay("seed-a", moves, { mode: "tutorial" });

    assert.deepEqual(replay, {
      version: REPLAY_VERSION,
      seed: "seed-a",
      moves,
      timestamp: 123456789,
      mode: "tutorial",
      id: replay.id,
    });
    assert.equal(typeof replay.id, "string");
    assert.notEqual(replay.id.length, 0);
    assert.equal(captureReplay("", moves), null);
    assert.equal(captureReplay("seed-a", ["e0", ""]), null);
    assert.equal(captureReplay("seed-a", moves, { mode: "story" }), null);

    moves.push("e2");
    assert.deepEqual(replay.moves, ["e0", "e1"]);
  } finally {
    Date.now = originalNow;
  }
});

test("replayToState reconstructs the same final state as manual flips", () => {
  const seed = "state-seed";
  const moves = replayMoves(seed, 4);
  const replay = captureReplay(seed, moves);

  let manual = replayToState(captureReplay(seed, []));
  for (const move of moves) manual = applyFlip(manual, move);

  assert.deepEqual(orientation(replayToState(replay)), orientation(manual));
  assert.equal(replayToState(captureReplay(seed, ["missing-edge"])), null);
});

test("playbackMoves yields move frames with speed-adjusted timing", async () => {
  const previousSetTimeout = globalThis.setTimeout;
  const delays = [];
  Object.defineProperty(globalThis, "setTimeout", {
    value: (callback, delay) => {
      delays.push(delay);
      callback();
      return delays.length;
    },
    configurable: true,
    writable: true,
  });

  try {
    const seed = "playback-seed";
    const moves = replayMoves(seed, 3);
    const replay = captureReplay(seed, moves);
    const frames = [];

    const returned = await playbackMoves(replay, (frame) => frames.push(frame), {
      delayMs: 200,
      speed: 2,
    });

    assert.equal(returned.length, 3);
    assert.deepEqual(frames.map((frame) => frame.moveId), moves);
    assert.deepEqual(frames.map((frame) => frame.moveIndex), [0, 1, 2]);
    assert.deepEqual(frames.map((frame) => frame.isLast), [false, false, true]);
    assert.deepEqual(delays, [100, 100]);
    assert.deepEqual(orientation(frames.at(-1).config), orientation(replayToState(replay)));
  } finally {
    Object.defineProperty(globalThis, "setTimeout", {
      value: previousSetTimeout,
      configurable: true,
      writable: true,
    });
  }
});

test("localStorage save, load, and delete round-trip replays", async () => {
  await withStorage(() => {
    const first = captureReplay("store-1", replayMoves("store-1", 1));
    const second = captureReplay("store-2", replayMoves("store-2", 2));

    assert.deepEqual(loadReplays(), []);
    assert.deepEqual(saveReplay(first), first);
    assert.deepEqual(saveReplay(second), second);
    assert.deepEqual(loadReplays().map((replay) => replay.id), [second.id, first.id]);

    assert.equal(deleteReplay(first.id), true);
    assert.deepEqual(loadReplays().map((replay) => replay.id), [second.id]);
    assert.equal(deleteReplay(first.id), false);
  });
});

test("unknown replay versions are ignored gracefully", async () => {
  await withStorage((store) => {
    const valid = captureReplay("version-valid", replayMoves("version-valid", 1));
    const unknown = { ...valid, version: 999 };

    store.set(REPLAY_STORAGE_KEY, JSON.stringify([unknown, valid]));

    assert.equal(replayToState(unknown), null);
    assert.equal(saveReplay(unknown), null);
    assert.deepEqual(loadReplays().map((replay) => replay.id), [valid.id]);
  });
});

test("saveReplay evicts least-recently stored entries beyond 50 replays", async () => {
  await withStorage(() => {
    const saved = [];
    for (let i = 0; i < REPLAY_MAX_STORED + 5; i++) {
      const seed = "lru-" + i;
      const replay = captureReplay(seed, replayMoves(seed, 1));
      saved.push(replay);
      assert.ok(saveReplay(replay));
    }

    const loaded = loadReplays();
    assert.equal(loaded.length, REPLAY_MAX_STORED);
    assert.equal(loaded[0].id, saved.at(-1).id);
    assert.equal(loaded.at(-1).id, saved[5].id);
    assert.equal(loaded.some((replay) => replay.id === saved[0].id), false);
  });
});
