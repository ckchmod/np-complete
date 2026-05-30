import { test } from "node:test";
import assert from "node:assert/strict";

import { createBattle } from "../src/battle.js";
import { analyzeBattleReplay } from "../src/battleReplay.js";

function duelFixture() {
  return {
    id: "battle-replay-duel",
    name: "Battle replay duel",
    nodes: [
      { id: "c", x: 50, y: 20 },
      { id: "cBase", x: 35, y: 20 },
      { id: "r", x: 70, y: 20 },
      { id: "rBase", x: 85, y: 20 },
      { id: "wSource", x: 35, y: 75 },
      { id: "wSourceBase", x: 20, y: 75 },
      { id: "wGoal", x: 65, y: 75 },
      { id: "wGoalBase", x: 80, y: 75 },
      { id: "bSource", x: 35, y: 125 },
      { id: "bSourceBase", x: 20, y: 125 },
      { id: "bGoal", x: 65, y: 125 },
      { id: "bGoalBase", x: 80, y: 125 },
    ],
    edges: [
      { id: "cycle", u: "r", v: "c", w: 1, dir: "uv", owner: "neutral", charges: 2 },
      { id: "c-keep", u: "cBase", v: "c", w: 2, dir: "uv", owner: "neutral", charges: 0 },
      { id: "c-return", u: "cBase", v: "c", w: 2, dir: "vu", owner: "neutral", charges: 0 },
      { id: "r-keep", u: "r", v: "rBase", w: 2, dir: "uv", owner: "neutral", charges: 0 },
      { id: "r-return", u: "r", v: "rBase", w: 2, dir: "vu", owner: "neutral", charges: 0 },
      { id: "white-target", u: "wSource", v: "wGoal", w: 2, dir: "uv", owner: "white", charges: 1 },
      { id: "w-goal-keep", u: "wGoalBase", v: "wGoal", w: 2, dir: "uv", owner: "neutral", charges: 0 },
      { id: "w-goal-return", u: "wGoalBase", v: "wGoal", w: 2, dir: "vu", owner: "neutral", charges: 0 },
      { id: "w-source-keep", u: "wSource", v: "wSourceBase", w: 2, dir: "uv", owner: "neutral", charges: 0 },
      { id: "w-source-return", u: "wSource", v: "wSourceBase", w: 2, dir: "vu", owner: "neutral", charges: 0 },
      { id: "black-target", u: "bSource", v: "bGoal", w: 2, dir: "uv", owner: "black", charges: 1 },
      { id: "b-goal-keep", u: "bGoalBase", v: "bGoal", w: 2, dir: "uv", owner: "neutral", charges: 0 },
      { id: "b-goal-return", u: "bGoalBase", v: "bGoal", w: 2, dir: "vu", owner: "neutral", charges: 0 },
      { id: "b-source-keep", u: "bSource", v: "bSourceBase", w: 2, dir: "uv", owner: "neutral", charges: 0 },
      { id: "b-source-return", u: "bSource", v: "bSourceBase", w: 2, dir: "vu", owner: "neutral", charges: 0 },
    ],
    target: "white-target",
    targetB: "black-target",
  };
}

function forcedLossFixture() {
  return {
    id: "battle-replay-forced-loss",
    name: "Battle replay forced loss",
    nodes: [
      { id: "g", x: 1, y: 1 },
      { id: "x1", x: 0, y: 0 },
      { id: "x2", x: 2, y: 0 },
      { id: "y", x: 1, y: 2 },
      { id: "p", x: 0, y: 2 },
      { id: "q", x: 2, y: 2 },
      { id: "r", x: 1, y: 3 },
    ],
    edges: [
      { id: "p1", u: "x1", v: "g", w: 1, dir: "uv", owner: "black", charges: 1 },
      { id: "p2", u: "x2", v: "g", w: 1, dir: "uv", owner: "neutral", charges: 1 },
      { id: "tg", u: "g", v: "y", w: 2, dir: "vu", owner: "white", charges: 0 },
      { id: "xp", u: "x1", v: "p", w: 2, dir: "uv", owner: "neutral", charges: 1 },
      { id: "px", u: "x1", v: "p", w: 2, dir: "vu", owner: "neutral", charges: 1 },
      { id: "xq", u: "x2", v: "q", w: 2, dir: "uv", owner: "neutral", charges: 1 },
      { id: "qx", u: "x2", v: "q", w: 2, dir: "vu", owner: "neutral", charges: 1 },
      { id: "yr", u: "y", v: "r", w: 2, dir: "uv", owner: "neutral", charges: 1 },
      { id: "ry", u: "y", v: "r", w: 2, dir: "vu", owner: "neutral", charges: 1 },
    ],
    target: "tg",
    targetB: "p1",
  };
}

function fakeEl(tagName = "div") {
  const children = [];
  const listeners = {};
  const classes = new Set();
  const el = {
    tagName,
    children,
    textContent: "",
    value: "",
    selected: false,
    disabled: false,
    open: false,
    type: "",
    parentNode: null,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, on) {
        const next = on === undefined ? !classes.has(name) : Boolean(on);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
      contains: (name) => classes.has(name),
    },
    get className() {
      return Array.from(classes).join(" ");
    },
    set className(value) {
      classes.clear();
      String(value).split(/\s+/).filter(Boolean).forEach((part) => classes.add(part));
    },
    setAttribute(name, value) {
      if (name === "class") el.className = value;
      else el[name] = String(value);
    },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = el;
      children.push(child);
      return child;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      if (child.parentNode === el) child.parentNode = null;
      return child;
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners[type] || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    dispatch(type, ev = {}) {
      return Promise.all((listeners[type] || []).slice().map((fn) => fn(ev)));
    },
    click() {
      return el.dispatch("click", { target: el });
    },
  };
  return el;
}

function fakeBoardFactory(boards) {
  return function makeBoard(svgEl, config, options) {
    const board = {
      svgEl,
      config,
      options,
      legal: [],
      updates: [],
      clearedWin: 0,
      update(next) {
        this.config = next;
        this.updates.push(next);
      },
      markLegal(ids) {
        this.legal = ids.slice();
      },
      shakeEdge() {},
      pulseNode() {},
      winCascade() {},
      clearWin() {
        this.clearedWin++;
      },
      destroy() {},
    };
    boards.push(board);
    return board;
  };
}

function findAll(root, predicate, found = []) {
  if (predicate(root)) found.push(root);
  for (const child of root.children || []) findAll(child, predicate, found);
  return found;
}

function findOne(root, predicate) {
  return findAll(root, predicate)[0] || null;
}

async function withDom(fn) {
  const previous = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    value: { createElement: (tagName) => fakeEl(tagName) },
    configurable: true,
    writable: true,
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(globalThis, "document", {
      value: previous,
      configurable: true,
      writable: true,
    });
  }
}

test("battle replay analysis identifies check moments and missed defenses", () => {
  const analysis = analyzeBattleReplay({ level: duelFixture(), moves: ["cycle"] });

  assert.equal(analysis.battle, true);
  assert.deepEqual(analysis.checkMoments, [{
    moveIndex: 0,
    moveNumber: 1,
    player: "black",
    immediateTargetThreat: true,
  }]);
  assert.equal(analysis.missedDefenses.length, 1);
  assert.equal(analysis.missedDefenses[0].player, "white");
  assert.equal(analysis.missedDefenses[0].threatenedBy, "black");
  assert.equal(analysis.missedDefenses[0].chosenMove, "cycle");
  assert.deepEqual(analysis.missedDefenses[0].defensiveMoves.edgeIds, ["white-target"]);
});

test("battle replay analysis reports solver-backed zugzwang states", () => {
  const analysis = analyzeBattleReplay({ level: forcedLossFixture(), moves: ["p2"] });

  assert.equal(analysis.zugzwangStates.length, 1);
  assert.deepEqual(analysis.zugzwangStates[0], {
    moveIndex: 0,
    moveNumber: 0,
    player: "white",
    legalMoveCount: 1,
  });
});

test("battle replay UI is absent during play, then collapsed and opt-in after terminal", async () => {
  await withDom(async () => {
    const boards = [];
    const replayMount = fakeEl("div");
    const turnEl = fakeEl("span");
    const statusEl = fakeEl("p");
    const battle = createBattle({
      refs: { boardEl: fakeEl("svg"), turnEl, statusEl, replayMount },
      generate: () => duelFixture(),
      boardFactory: fakeBoardFactory(boards),
      animationMs: 0,
    });

    battle.start();
    assert.equal(replayMount.children.length, 0, "Battle analysis is not mounted during active play");

    battle.tap("white-target");
    assert.equal(turnEl.textContent, "White", "Terminal HUD still names the player that just won");
    assert.equal(statusEl.textContent, "White Wins!", "Terminal status announces the winner");

    const root = replayMount.children[0];
    const controls = findOne(root, (node) => node.classList?.contains("replay-controls"));
    const details = findOne(root, (node) => node.tagName === "details");
    const text = findAll(details, () => true).map((node) => node.textContent).join(" ");

    assert.equal(root.classList.contains("hidden"), false, "Battle replay appears only after game end");
    assert.equal(controls.classList.contains("hidden"), true, "Replay controls remain opt-in");
    assert.equal(details.open, false, "Battle analysis stays collapsed by default");
    assert.match(text, /Check moments/);
    assert.match(text, /Missed defenses/);
    assert.match(text, /Zugzwang/);

    await findOne(root, (node) => node.classList?.contains("replay-open")).click();
    assert.equal(boards[0].clearedWin, 1, "Replay start clears terminal win styling from the board");
    assert.equal(turnEl.textContent, "White", "Replay start resets the HUD turn to the opening player");
    assert.equal(statusEl.textContent, "", "Replay start clears the terminal status while the board is rewound");
    assert.equal(controls.classList.contains("hidden"), false);
    assert.equal(boards[0].updates.length, 2, "Replay opt-in resets the board to the start state");

    await findOne(root, (node) => node.textContent === "Step").click();
    assert.equal(boards[0].updates.length, 3, "Replay step advances through Battle frames on demand");
  });
});
