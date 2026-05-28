import { test } from "node:test";
import assert from "node:assert/strict";
import { moveBudget, difficultyFor } from "../src/rush.js";
import { generateLock, makeRng } from "../src/generator.js";

test("move budget always exceeds par, so a clean solve fits", () => {
  for (let par = 1; par <= 20; par++) {
    assert.ok(moveBudget(par) > par, `budget(${par}) must exceed par`);
  }
});

test("difficulty starts at 1, never drops, and ramps over a run", () => {
  let prev = 0;
  for (let s = 0; s <= 30; s++) {
    const d = difficultyFor(s);
    assert.ok(d >= 1, "difficulty >= 1");
    assert.ok(d >= prev, "difficulty is non-decreasing");
    prev = d;
  }
  assert.ok(difficultyFor(30) > difficultyFor(0), "harder by the end of a long run");
});

test("every generated lock is solvable within its move budget", () => {
  for (let s = 0; s <= 24; s += 3) {
    const L = generateLock(difficultyFor(s), makeRng(900 + s));
    assert.ok(L, `generated a lock at solve count ${s}`);
    assert.ok(L.par <= moveBudget(L.par), "par must fit inside the budget");
  }
});
