import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("metric-report CLI prints one JSON object with metric distributions", () => {
  const run = spawnSync(process.execPath, ["scripts/metric-report.mjs", "--seed=17", "--count=5", "--difficulty=8"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "");

  const lines = run.stdout.trim().split("\n");
  assert.equal(lines.length, 1, "script prints one JSON line");

  const report = JSON.parse(lines[0]);
  assert.equal(report.seed, 17);
  assert.equal(report.count, 5);
  assert.equal(report.difficulty, 8);
  assert.equal(report.advanced, false);
  assert.equal(report.boards.length, 5);
  assert.equal(Object.values(report.summary.headCounts).reduce((sum, value) => sum + value, 0), 5);
  assert.ok(report.summary.numeric.par.max >= report.summary.numeric.par.min);
  assert.ok(Object.prototype.hasOwnProperty.call(report.summary.boolean, "partial"));
});
