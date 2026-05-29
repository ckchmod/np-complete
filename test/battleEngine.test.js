import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyBattleFlip,
  hasLegalMoves,
  isLegalBattleFlip,
  isTerminal,
  makeBattleConfig,
} from "../src/battleEngine.js";

function battleSlackFixture() {
  return {
    id: "battle-slack",
    name: "battle slack",
    nodes: [
      { id: "c", x: 1, y: 1 },
      { id: "L", x: 0, y: 1 },
      { id: "R", x: 2, y: 1 },
      { id: "xa", x: 0, y: 0 },
      { id: "xb", x: 2, y: 0 },
    ],
    edges: [
      { id: "t", u: "L", v: "c", w: 2, dir: "uv", owner: "white" },
      { id: "s", u: "R", v: "c", w: 1, dir: "uv", owner: "white" },
      { id: "la", u: "L", v: "xa", w: 2, dir: "uv", owner: "neutral" },
      { id: "al", u: "L", v: "xa", w: 2, dir: "vu", owner: "neutral" },
      { id: "rb", u: "R", v: "xb", w: 2, dir: "uv", owner: "black" },
      { id: "br", u: "R", v: "xb", w: 2, dir: "vu", owner: "black" },
    ],
    target: "t",
    targetB: "rb",
  };
}

function twoTargetFixture() {
  return {
    id: "two-target",
    name: "two target",
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
      { id: "p1", u: "x1", v: "g", w: 1, dir: "uv", owner: "black" },
      { id: "p2", u: "x2", v: "g", w: 1, dir: "uv", owner: "neutral" },
      { id: "tg", u: "g", v: "y", w: 2, dir: "vu", owner: "white" },
      { id: "xp", u: "x1", v: "p", w: 2, dir: "uv", owner: "neutral" },
      { id: "px", u: "x1", v: "p", w: 2, dir: "vu", owner: "neutral" },
      { id: "xq", u: "x2", v: "q", w: 2, dir: "uv", owner: "neutral" },
      { id: "qx", u: "x2", v: "q", w: 2, dir: "vu", owner: "neutral" },
      { id: "yr", u: "y", v: "r", w: 2, dir: "uv", owner: "neutral" },
      { id: "ry", u: "y", v: "r", w: 2, dir: "vu", owner: "neutral" },
    ],
    target: "tg",
    targetB: "p1",
  };
}

function noMoveFixture() {
  return {
    id: "no-move",
    name: "no move",
    nodes: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 1, y: 0 },
    ],
    edges: [
      { id: "e0", u: "a", v: "b", w: 2, dir: "uv", owner: "white" },
      { id: "e1", u: "a", v: "b", w: 2, dir: "vu", owner: "white" },
    ],
    target: "e0",
    targetB: "e1",
  };
}

test("makeBattleConfig builds mutable-friendly maps with explicit owners and charges", () => {
  const state = makeBattleConfig(battleSlackFixture(), 3);

  assert.equal(state.turn, "white");
  assert.equal(state.dirs.get("s"), "uv");
  assert.equal(state.charges.get("s"), 3);
  assert.equal(state.owner.get("rb"), "black");
  assert.deepEqual(state.history, []);
  assert.equal(Object.isFrozen(state), false);
});

test("makeBattleConfig supports neutral default owner and explicit edge charges", () => {
  const level = battleSlackFixture();
  delete level.edges[1].owner;
  level.edges[1].charges = 1;

  const state = makeBattleConfig(level, 2);

  assert.equal(state.owner.get("s"), "neutral");
  assert.equal(state.charges.get("s"), 1);
});

test("isLegalBattleFlip requires ownership, positive charges, and NCL legality", () => {
  const state = makeBattleConfig(battleSlackFixture(), 2);

  assert.equal(isLegalBattleFlip(state, "s"), true);
  assert.equal(isLegalBattleFlip(state, "rb"), false);
  assert.equal(isLegalBattleFlip(state, "t"), false);
  assert.equal(isLegalBattleFlip({ ...state, charges: new Map(state.charges).set("s", 0) }, "s"), false);
  assert.equal(isLegalBattleFlip(state, "missing"), false);
});

test("isLegalBattleFlip allows a charged legal edge for its owner", () => {
  const state = makeBattleConfig(battleSlackFixture(), 2, "white");

  assert.equal(state.owner.get("s"), "white");
  assert.equal(state.charges.get("s"), 2);
  assert.equal(isLegalBattleFlip(state, "s"), true);
});

test("isLegalBattleFlip rejects a legal edge controlled by the other player", () => {
  const state = makeBattleConfig(battleSlackFixture(), 2, "black");

  assert.equal(isLegalBattleFlip(state, "s"), false);
  assert.throws(() => applyBattleFlip(state, "s"), /Illegal battle flip/);
  assert.equal(state.charges.get("s"), 2);
});

test("isLegalBattleFlip rejects an otherwise legal edge with no charge", () => {
  const state = makeBattleConfig(battleSlackFixture(), 2, "white");
  const spent = { ...state, charges: new Map(state.charges).set("s", 0) };

  assert.equal(isLegalBattleFlip(state, "s"), true);
  assert.equal(isLegalBattleFlip(spent, "s"), false);
  assert.throws(() => applyBattleFlip(spent, "s"), /Illegal battle flip/);
});

test("isLegalBattleFlip rejects a charged owned edge that would violate NCL inflow", () => {
  const state = makeBattleConfig(battleSlackFixture(), 2, "white");

  assert.equal(state.owner.get("t"), "white");
  assert.equal(state.charges.get("t"), 2);
  assert.equal(isLegalBattleFlip(state, "t"), false);
  assert.throws(() => applyBattleFlip(state, "t"), /Illegal battle flip/);
});

test("applyBattleFlip clones state, reverses one edge, decrements one charge, records history, and switches turn", () => {
  const state = makeBattleConfig(battleSlackFixture(), 2);
  const next = applyBattleFlip(state, "s");

  assert.notEqual(next, state);
  assert.notEqual(next.dirs, state.dirs);
  assert.notEqual(next.charges, state.charges);
  assert.notEqual(next.history, state.history);
  assert.equal(state.dirs.get("s"), "uv");
  assert.equal(state.charges.get("s"), 2);
  assert.equal(next.dirs.get("s"), "vu");
  assert.equal(next.charges.get("s"), 1);
  assert.equal(next.charges.get("t"), 2);
  assert.equal(next.turn, "black");
  assert.equal(next.history.length, 1);
  assert.equal(next.history[0].edgeId, "s");
  assert.equal(next.history[0].player, "white");
  assert.equal(next.history[0].dirsBefore.get("s"), "uv");
  assert.equal(next.history[0].chargesBefore.get("s"), 2);
});

test("applyBattleFlip throws on illegal flips and never decrements below zero", () => {
  const state = makeBattleConfig(battleSlackFixture(), 0);

  assert.throws(() => applyBattleFlip(state, "s"), /Illegal battle flip/);
  assert.equal(state.charges.get("s"), 0);
});

test("hasLegalMoves evaluates the requested player without mutating turn", () => {
  const state = makeBattleConfig(battleSlackFixture(), 2);

  assert.equal(hasLegalMoves(state, "white"), true);
  assert.equal(hasLegalMoves(state, "black"), false);
  assert.equal(state.turn, "white");
});

test("isTerminal reports target wins before no-move loss", () => {
  const whiteStart = makeBattleConfig(twoTargetFixture(), 2);
  const whiteWin = applyBattleFlip(whiteStart, "tg");

  assert.deepEqual(isTerminal(whiteWin), { terminal: true, winner: "white", reason: "target" });

  const blackStart = { ...makeBattleConfig(twoTargetFixture(), 2), turn: "black" };
  const blackWin = applyBattleFlip(blackStart, "p1");

  assert.deepEqual(isTerminal(blackWin), { terminal: true, winner: "black", reason: "target" });
});

test("isTerminal reports no-legal-moves loss for the current player", () => {
  const state = { ...makeBattleConfig(noMoveFixture(), 2), turn: "black" };

  assert.equal(hasLegalMoves(state, "black"), false);
  assert.deepEqual(isTerminal(state), { terminal: true, winner: "white", reason: "no-moves" });
});
