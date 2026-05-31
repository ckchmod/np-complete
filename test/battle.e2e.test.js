import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { createBattle } from "../src/battle.js";
import { createBoard3d } from "../src/render3d.js";
import * as THREE_MOCK from "./helpers/three-mock.js";

const EVIDENCE_PATH = new URL("../.omo/evidence/task-17-e2e-battle.json", import.meta.url);
const CHROMIUM_LIMITATION = "Chrome/Chromium runtime was unavailable in this environment; used the zero-dependency injected DOM/Three mock harness.";

function fakeEl(tagName = "g") {
  const children = [];
  const listeners = {};
  const attrs = {};
  const classes = new Set();
  const el = {
    tagName,
    children,
    attrs,
    style: { setProperty() {}, removeProperty() {}, touchAction: "" },
    dataset: {},
    textContent: "",
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, on) {
        const enabled = on === undefined ? !classes.has(name) : Boolean(on);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
      contains: (name) => classes.has(name),
    },
    get firstChild() {
      return children.length ? children[0] : null;
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
      if (name === "class") {
        classes.clear();
        String(value).split(/\s+/).filter(Boolean).forEach((part) => classes.add(part));
      }
    },
    appendChild(child) {
      if (child._parent) child._parent.removeChild(child);
      children.push(child);
      child._parent = el;
      return child;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      if (child._parent === el) child._parent = null;
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
    dispatch(type, event = {}) {
      (listeners[type] || []).forEach((fn) => fn(event));
    },
    getBoundingClientRect() {
      return { width: 0, height: 0, top: 0, left: 0 };
    },
  };
  return el;
}

async function withSvgEnv(fn) {
  const previous = {
    document: globalThis.document,
    performance: globalThis.performance,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    window: globalThis.window,
  };
  globalThis.document = {
    createElement: (tagName) => fakeEl(tagName),
    createElementNS: (_ns, tagName) => fakeEl(tagName),
    body: fakeEl("body"),
  };
  globalThis.performance = { now: () => performance.now() };
  globalThis.requestAnimationFrame = (callback) => {
    callback(performance.now() + 1_000);
    return 0;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.window = {
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  try {
    return await fn();
  } finally {
    globalThis.document = previous.document;
    globalThis.performance = previous.performance;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    globalThis.cancelAnimationFrame = previous.cancelAnimationFrame;
    globalThis.window = previous.window;
  }
}

function mapObject(map) {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function captureState(state) {
  return {
    turn: state.turn,
    dirs: mapObject(state.dirs),
    charges: mapObject(state.charges),
    legalMoves: state.legalMoves.slice().sort(),
    terminal: state.terminal,
  };
}

function assertSameBattleState(actual, expected) {
  assert.equal(actual.turn, expected.turn);
  assert.deepEqual(mapObject(actual.dirs), mapObject(expected.dirs));
  assert.deepEqual(mapObject(actual.charges), mapObject(expected.charges));
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deterministicBattleFixture() {
  return {
    id: "task-17-battle-e2e",
    name: "Task 17 deterministic battle e2e",
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

async function writeEvidence(evidence) {
  await mkdir(new URL("../.omo/evidence/", import.meta.url), { recursive: true });
  await writeFile(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n");
}

test("battle e2e: deterministic full game covers illegal moves, charges, turns, and winner", async () => {
  const startTime = performance.now();
  const illegalMoves = [];
  const stateChanges = [];
  const moveSequence = [];
  const edgeCaseChecks = {
    deterministicFixture: false,
    generatedBoardNotUsed: false,
    rendererHarnessUsed: false,
    wrongOwnerRejectedWithoutMutation: false,
    illegalCallbackRecordedRejection: false,
    statusRecordedRejection: false,
    noPassingWhileLegalMovesExist: false,
    turnSwitchesAfterLegalMoves: false,
    chargeDepletionLocksEdge: false,
    completeGameToWinner: false,
    deterministicTerminationBounded: false,
  };
  const evidence = {
    task: 17,
    scenario: "automated full battle game",
    fixture: "task-17-battle-e2e",
    browser: {
      playwrightUsed: false,
      limitation: CHROMIUM_LIMITATION,
      harness: "injected DOM/Three mock with real createBoard3d",
    },
    moveCap: 8,
    moveSequence,
    edgeCaseChecks,
    winner: null,
    runtimeMs: null,
    pass: false,
  };

  try {
    await withSvgEnv(async () => {
      const svg = fakeEl("svg");
      const turnEl = fakeEl("span");
      const statusEl = fakeEl("p");
      let board = null;
      const battle = createBattle({
        refs: { boardEl: svg, turnEl, statusEl },
        generate: () => {
          throw new Error("Task 17 e2e must not use generated boards");
        },
        boardFactory: (mount, config, options) => {
          board = createBoard3d(mount, config, { ...options, THREE: THREE_MOCK });
          return board;
        },
        animationMs: 0,
        onIllegalMove: (event) => illegalMoves.push({
          edgeId: event.edgeId,
          reason: event.reason,
          state: captureState(event.state),
        }),
        onStateChange: (state) => stateChanges.push(captureState(state)),
        onTerminal: (result) => {
          evidence.winner = result.winner;
          evidence.terminal = { winner: result.winner, reason: result.reason, message: result.message };
        },
      });

      const level = deterministicBattleFixture();
      const started = battle.start({ level, initialTurn: "white" });
      edgeCaseChecks.deterministicFixture = started.level.id === "task-17-battle-e2e";
      edgeCaseChecks.generatedBoardNotUsed = battle.level === level;
      edgeCaseChecks.rendererHarnessUsed = board?.renderer?.type === "WebGLRenderer" && board.edgeMeshes.has("cycle");
      assert.equal(edgeCaseChecks.deterministicFixture, true);
      assert.equal(edgeCaseChecks.generatedBoardNotUsed, true);
      assert.equal(edgeCaseChecks.rendererHarnessUsed, true);
      assert.equal(turnEl.textContent, "White");
      assert.deepEqual(started.legalMoves.slice().sort(), ["cycle", "white-target"]);

      const beforeWrongOwner = battle.state;
      battle.tap("black-target");
      const afterWrongOwner = battle.state;
      assertSameBattleState(afterWrongOwner, beforeWrongOwner);
      assert.equal(statusEl.textContent, "Illegal move");
      assert.equal(illegalMoves.at(-1).edgeId, "black-target");
      assert.equal(illegalMoves.at(-1).reason, "illegal");
      assert.equal(afterWrongOwner.turn, "white");
      assert.ok(afterWrongOwner.legalMoves.includes("cycle"));
      edgeCaseChecks.wrongOwnerRejectedWithoutMutation = true;
      edgeCaseChecks.illegalCallbackRecordedRejection = true;
      edgeCaseChecks.statusRecordedRejection = true;
      edgeCaseChecks.noPassingWhileLegalMovesExist = true;
      moveSequence.push({ action: "tap", edgeId: "black-target", accepted: false, reason: "wrong-owner", state: captureState(afterWrongOwner) });

      battle.tap("cycle");
      await tick();
      assert.equal(battle.state.turn, "black");
      assert.equal(turnEl.textContent, "Black");
      assert.equal(battle.state.charges.get("cycle"), 1);
      assert.equal(board.config.charges.get("cycle"), 1);
      moveSequence.push({ action: "tap", edgeId: "cycle", accepted: true, player: "white", state: captureState(battle.state) });

      battle.tap("cycle");
      await tick();
      assert.equal(battle.state.turn, "white");
      assert.equal(turnEl.textContent, "White");
      assert.equal(battle.state.charges.get("cycle"), 0);
      assert.equal(board.config.charges.get("cycle"), 0);
      assert.equal(battle.state.legalMoves.includes("cycle"), false);
      assert.ok(battle.state.legalMoves.includes("white-target"));
      edgeCaseChecks.turnSwitchesAfterLegalMoves = true;
      moveSequence.push({ action: "tap", edgeId: "cycle", accepted: true, player: "black", state: captureState(battle.state) });

      const beforeNoCharge = battle.state;
      battle.tap("cycle");
      const afterNoCharge = battle.state;
      assertSameBattleState(afterNoCharge, beforeNoCharge);
      assert.equal(illegalMoves.at(-1).edgeId, "cycle");
      assert.equal(afterNoCharge.charges.get("cycle"), 0);
      edgeCaseChecks.chargeDepletionLocksEdge = true;
      moveSequence.push({ action: "tap", edgeId: "cycle", accepted: false, reason: "no-charge", state: captureState(afterNoCharge) });

      battle.tap("white-target");
      assert.deepEqual(battle.terminal, { terminal: true, winner: "white", reason: "target" });
      assert.equal(statusEl.textContent, "White Wins!");
      assert.equal(board.legalEdges.size, 0);
      edgeCaseChecks.completeGameToWinner = true;
      moveSequence.push({ action: "tap", edgeId: "white-target", accepted: true, player: "white", terminal: battle.terminal, state: captureState(battle.state) });

      const legalAcceptedMoves = moveSequence.filter((move) => move.accepted).length;
      assert.ok(legalAcceptedMoves <= evidence.moveCap);
      assert.ok(moveSequence.length <= evidence.moveCap);
      assert.equal(battle.state.history.length, legalAcceptedMoves);
      assert.ok(stateChanges.length >= legalAcceptedMoves + 1);
      edgeCaseChecks.deterministicTerminationBounded = true;

      battle.destroy();
    });

    evidence.runtimeMs = Number((performance.now() - startTime).toFixed(3));
    evidence.pass = Object.values(edgeCaseChecks).every(Boolean) && evidence.winner === "white" && evidence.runtimeMs < 10_000;
    assert.equal(evidence.pass, true);
    await writeEvidence(evidence);
  } catch (error) {
    evidence.runtimeMs = Number((performance.now() - startTime).toFixed(3));
    evidence.pass = false;
    evidence.error = error && error.stack ? error.stack : String(error);
    await writeEvidence(evidence);
    throw error;
  }
});
