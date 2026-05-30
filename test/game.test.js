import { test } from "node:test";
import assert from "node:assert/strict";

import { makeConfig, isSolved } from "../src/engine.js";
import { TUTORIALS } from "../src/levels.js";

// ---------------------------------------------------------------------------
// Minimal environment stubs.
//
// game.js drives render.js (which builds real SVG DOM) plus localStorage and a
// couple of timing globals. None of that needs a browser to exercise the
// session logic, so we stub the narrow surface both modules actually touch:
//   document.createElementNS + element { setAttribute, appendChild, removeChild,
//     firstChild, classList, dataset, style, addEventListener,
//     getBoundingClientRect }
//   localStorage, performance.now, requestAnimationFrame.
// (navigator already exists in Node with no .clipboard, so share() is inert and
// we leave it alone — it is a read-only global here.)
//
// We deliberately do NOT assert pixels — only the game-session contract:
// resume restores the move count, an already-solved save is not resumed as a
// dead board, and corrupt/legacy storage starts fresh.
// ---------------------------------------------------------------------------

function fakeEl() {
  const children = [];
  const listeners = {};
  const el = {
    children,
    style: { setProperty() {}, removeProperty() {} },
    dataset: {},
    textContent: "",
    _classes: new Set(),
    classList: {
      add: (c) => el._classes.add(c),
      remove: (c) => el._classes.delete(c),
      toggle(c, on) {
        if (on === undefined) on = !el._classes.has(c);
        if (on) el._classes.add(c);
        else el._classes.delete(c);
        return on;
      },
      contains: (c) => el._classes.has(c),
    },
    get firstChild() {
      return children.length ? children[0] : null;
    },
    setAttribute() {},
    appendChild(child) {
      child.parentNode = el;
      children.push(child);
      return child;
    },
    removeChild(child) {
      const i = children.indexOf(child);
      if (i >= 0) children.splice(i, 1);
      if (child.parentNode === el) child.parentNode = null;
      return child;
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((listener) => listener !== fn);
    },
    dispatch(type, ev) {
      (listeners[type] || []).forEach((fn) => fn(ev || {}));
    },
    getBoundingClientRect() {
      return { width: 0, height: 0, top: 0, left: 0 };
    },
  };
  return el;
}

// A mountEl that hands out (and caches) one stub element per selector, so the
// test can read back e.g. the move counter via mount.querySelector("#move-count").
function fakeMount() {
  const bySel = new Map();
  return {
    querySelector(sel) {
      if (!bySel.has(sel)) bySel.set(sel, fakeEl());
      return bySel.get(sel);
    },
  };
}

function fakeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

// Install globals, run fn, then restore. createGame is imported once (top of
// module would eval before globals exist), so we import lazily inside withEnv.
async function withEnv(fn) {
  const prev = {
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    performance: globalThis.performance,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  globalThis.document = { createElement: () => fakeEl(), createElementNS: () => fakeEl() };
  globalThis.localStorage = fakeLocalStorage();
  globalThis.performance = { now: () => 0 };
  globalThis.requestAnimationFrame = () => 0; // never run animation frames
  try {
    const { createGame } = await import("../src/game.js");
    return await fn(createGame);
  } finally {
    globalThis.document = prev.document;
    globalThis.localStorage = prev.localStorage;
    globalThis.performance = prev.performance;
    globalThis.requestAnimationFrame = prev.requestAnimationFrame;
  }
}

const progressKey = (levelId) => "the-lock:" + levelId + ":progress";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// tut-1 is a 1-move solve whose only winning tap is the target edge; ideal for
// deterministic win assertions.
const tut1 = TUTORIALS.find((l) => l.id === "tut-1");
const tut3 = TUTORIALS.find((l) => l.id === "tut-3");

function testPathHash(moveIds) {
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

// Walk the fake SVG tree to find the hit <line> for a given edge id. render.js
// builds: svg > g.edge-layer > g.edge-group[dataset.edge] > [line, arrow, hit],
// so the hit area (the element carrying the click listener) is the last child.
function findEdgeHit(svg, edgeId) {
  for (const layer of svg.children) {
    for (const group of layer.children || []) {
      if (group.dataset && group.dataset.edge === edgeId) {
        return group.children[group.children.length - 1];
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Consequence (2): resume restores the move COUNT, so the counter is accurate
// and a later win scores against the full move total (not an undercount).
// ---------------------------------------------------------------------------

test("game: resume restores the persisted move count", async () => {
  await withEnv((createGame) => {
    // A VALID, NOT-solved mid-game: target left at its start orientation, but
    // the player had already made 7 moves before closing the tab.
    const startDirs = Object.fromEntries(makeConfig(tut1).dirs);
    localStorage.setItem(
      progressKey("tut-1"),
      JSON.stringify({ dirs: startDirs, moves: 7 })
    );

    const mount = fakeMount();
    createGame({ level: tut1, mountEl: mount, onWin: () => {} });

    assert.equal(
      mount.querySelector("#move-count").textContent,
      7,
      "resumed move counter reflects the persisted count, not 0"
    );
  });
});

test("game: a win after resume counts resumed moves + this-session moves", async () => {
  await withEnv((createGame) => {
    const startDirs = Object.fromEntries(makeConfig(tut1).dirs);
    localStorage.setItem(
      progressKey("tut-1"),
      JSON.stringify({ dirs: startDirs, moves: 5 })
    );

    let win = null;
    const mount = fakeMount();
    createGame({ level: tut1, mountEl: mount, onWin: (p) => (win = p) });

    // Fire the target edge's click to make the single winning flip. Use the
    // SAME selector game.js uses ("#board") so we inspect the populated board.
    const board = mount.querySelector("#board");
    const targetHit = findEdgeHit(board, tut1.target);
    assert.ok(targetHit, "target edge hit area exists in the rendered board");
    targetHit.dispatch("click");

    // The result card is shown via setTimeout(900); drain it.
    return new Promise((resolve) => {
      setTimeout(() => {
        assert.ok(win, "win fired");
        assert.equal(win.moves, 6, "5 resumed + 1 winning tap = 6 moves");
        // par for tut-1 is 1; 6 moves sits on the ★★ upper edge (moves <= par+5).
        // Had the resumed count been dropped, moves would be 1 -> ★★★, so this
        // proves the resumed total feeds the score/star primitive (spec §11).
        assert.equal(win.stars, 2, "6 moves vs par 1 -> 2 stars (count fed scoring)");
        resolve();
      }, 950);
    });
  });
});

test("game: a resumed solve keeps the full route hash across sessions", async () => {
  await withEnv((createGame) => {
    const firstMount = fakeMount();
    const firstGame = createGame({ level: tut3, mountEl: firstMount, onWin: () => {} });
    findEdgeHit(firstMount.querySelector("#board"), "e3").dispatch("click");
    firstGame.destroy();

    const secondMount = fakeMount();
    const game = createGame({ level: tut3, mountEl: secondMount, onWin: () => {} });
    assert.equal(secondMount.querySelector("#move-count").textContent, 1, "resume starts from the saved first move");

    findEdgeHit(secondMount.querySelector("#board"), tut3.target).dispatch("click");

    assert.match(
      game.shareResult(),
      new RegExp("#" + testPathHash(["e3", tut3.target]) + "$"),
      "share hash covers both the restored prefix and the finishing move"
    );
    game.destroy();
  });
});

test("game: a resumed solve opens replay with the restored prefix", async () => {
  await withEnv(async (createGame) => {
    const firstMount = fakeMount();
    const firstGame = createGame({ level: tut3, mountEl: firstMount, onWin: () => {} });
    findEdgeHit(firstMount.querySelector("#board"), "e3").dispatch("click");
    firstGame.destroy();

    let replayStarted = false;
    let win = null;
    const secondMount = fakeMount();
    const game = createGame({
      level: tut3,
      mountEl: secondMount,
      onWin: (payload) => (win = payload),
      onReplayStart: () => (replayStarted = true),
    });

    findEdgeHit(secondMount.querySelector("#board"), tut3.target).dispatch("click");
    await delay(950);

    assert.ok(win, "win callback fires after the delayed result card render");
    const replayRoot = secondMount.querySelector("#replay-ui").children[0];
    const replayButton = replayRoot.children[0];
    const controls = replayRoot.children[1];
    const stepButton = controls.children[2];
    const progress = controls.children[4];

    assert.equal(progress.textContent, "0 / 2", "replay has both the restored prefix and finishing move");
    replayButton.dispatch("click");
    await Promise.resolve();
    assert.equal(replayStarted, true, "opening replay resets the board before stepping frames");
    stepButton.dispatch("click");
    await Promise.resolve();
    assert.equal(progress.textContent, "1 / 2", "first replay step is the restored prefix move");
    stepButton.dispatch("click");
    await Promise.resolve();
    assert.equal(progress.textContent, "2 / 2", "second replay step is the finishing move");

    game.destroy();
  });
});

test("game: corrupt saved history falls back to restored-state replay", async () => {
  await withEnv(async (createGame) => {
    const firstMount = fakeMount();
    const firstGame = createGame({ level: tut3, mountEl: firstMount, onWin: () => {} });
    findEdgeHit(firstMount.querySelector("#board"), "e3").dispatch("click");
    firstGame.destroy();

    const saved = JSON.parse(localStorage.getItem(progressKey("tut-3")));
    saved.history = ["e1"];
    localStorage.setItem(progressKey("tut-3"), JSON.stringify(saved));

    let win = null;
    const secondMount = fakeMount();
    const game = createGame({ level: tut3, mountEl: secondMount, onWin: (payload) => (win = payload) });
    assert.equal(secondMount.querySelector("#move-count").textContent, 1, "corrupt-history resume keeps the saved move count");

    findEdgeHit(secondMount.querySelector("#board"), tut3.target).dispatch("click");
    await delay(950);

    assert.ok(win, "win still completes when saved history is corrupt");
    assert.match(
      game.shareResult(),
      new RegExp("#" + testPathHash([tut3.target]) + "$"),
      "untrusted saved history is not used for the route hash"
    );
    const replayRoot = secondMount.querySelector("#replay-ui").children[0];
    const controls = replayRoot.children[1];
    const progress = controls.children[4];
    assert.equal(progress.textContent, "0 / 1", "replay starts from restored state when saved route cannot be trusted");

    game.destroy();
  });
});

// ---------------------------------------------------------------------------
// Consequence (1): an already-solved saved state is NOT resumed as a dead
// solved board. It falls back to start (unsolved) and the stale entry is
// cleared, so the player gets a live, playable board.
// ---------------------------------------------------------------------------

test("game: an already-solved saved state is not resumed; falls back to start", async () => {
  await withEnv((createGame) => {
    // Encode a SOLVED tut-1: target reversed from its start (uv -> vu). Stays
    // legal (b drops 4->2, a rises 2->4) but isSolved() is true. Per the engine,
    // "solved" == target's current dir differs from the level's declared start.
    const targetStartDir = tut1.edges.find((e) => e.id === tut1.target).dir;
    const solvedDirs = Object.fromEntries(makeConfig(tut1).dirs);
    solvedDirs[tut1.target] = targetStartDir === "uv" ? "vu" : "uv";

    // Sanity: confirm the fixture really encodes a solved configuration by the
    // engine's own definition. isSolved reads target, edgeById[target].dir, and
    // dirs[target], so a minimal config carrying those is enough.
    const sanity = makeConfig(tut1);
    assert.equal(
      isSolved({ level: tut1, edgeById: sanity.edgeById, dirs: new Map(Object.entries(solvedDirs)) }),
      true,
      "fixture is a solved configuration"
    );

    localStorage.setItem(
      progressKey("tut-1"),
      JSON.stringify({ dirs: solvedDirs, moves: 99 })
    );

    let win = null;
    const mount = fakeMount();
    createGame({ level: tut1, mountEl: mount, onWin: (p) => (win = p) });

    assert.equal(win, null, "solved save does not trigger a win on resume");
    assert.equal(
      mount.querySelector("#move-count").textContent,
      0,
      "solved save is discarded; counter starts fresh at 0 (not the bogus 99)"
    );
    assert.equal(
      localStorage.getItem(progressKey("tut-1")),
      null,
      "stale solved progress is cleared on resume"
    );
  });
});

// ---------------------------------------------------------------------------
// A corrupt / legacy progress value is ignored (board starts fresh, no crash).
// ---------------------------------------------------------------------------

test("game: corrupt or legacy progress is ignored and the board starts fresh", async () => {
  await withEnv((createGame) => {
    // Legacy format was a bare dirs object (no { dirs, moves } wrapper).
    localStorage.setItem(progressKey("tut-1"), JSON.stringify({ e0: "vu" }));
    const mount = fakeMount();
    let win = null;
    createGame({ level: tut1, mountEl: mount, onWin: (p) => (win = p) });
    assert.equal(win, null, "legacy value does not crash or auto-win");
    assert.equal(
      mount.querySelector("#move-count").textContent,
      0,
      "legacy/corrupt progress -> fresh start, counter 0"
    );
  });
});

// ---------------------------------------------------------------------------
// Regression: the board <svg> is reused across locks. winCascade() adds .is-won
// (which paints the target in the WIN colour); a fresh board must CLEAR it, or
// the next lock's red target would render win-coloured (cyan) instead of red.
// ---------------------------------------------------------------------------

test("render: a fresh board clears a stale is-won (next target stays red)", async () => {
  const prevDoc = globalThis.document;
  const prevRaf = globalThis.requestAnimationFrame;
  globalThis.document = { createElementNS: () => fakeEl() };
  globalThis.requestAnimationFrame = () => 0;
  try {
    const { createBoard } = await import("../src/render.js");
    const svg = fakeEl();
    svg.classList.add("is-won"); // simulate the previous lock having been solved
    const board = createBoard(svg, makeConfig(tut1), {}); // build the next lock on the same <svg>
    assert.equal(svg.classList.contains("is-won"), false, "stale win state must be cleared on (re)build");
    // clearWin() — used by game.js reset() after a win — drops the class in place:
    svg.classList.add("is-won");
    board.clearWin();
    assert.equal(svg.classList.contains("is-won"), false, "clearWin() drops the win colour");
  } finally {
    globalThis.document = prevDoc;
    globalThis.requestAnimationFrame = prevRaf;
  }
});
