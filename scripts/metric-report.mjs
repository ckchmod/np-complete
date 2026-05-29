// THE LOCK — Rush diagnostic metric batch reporter.
//
// Generates a bounded batch of locks and prints one JSON object to stdout.
//
// Usage:
//   node scripts/metric-report.mjs --seed=20260529 --count=12 --difficulty=10 --advanced

import { basicMetrics, allMetrics } from "../src/difficultyMetrics.js";
import { generateLock, makeRng } from "../src/generator.js";

function parseArgs(argv) {
  const result = {
    seed: 20260529,
    count: 12,
    difficulty: 10,
    advanced: false,
  };

  for (const arg of argv) {
    if (arg === "--advanced") {
      result.advanced = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const value = eq === -1 ? "true" : arg.slice(eq + 1);

    if (key === "seed") result.seed = parseInteger(value, "seed");
    else if (key === "count") result.count = parseBoundedInteger(value, "count", 1, 200);
    else if (key === "difficulty") result.difficulty = parseBoundedInteger(value, "difficulty", 1, 99);
    else if (key === "advanced") result.advanced = value !== "false";
  }

  return result;
}

function parseInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error("invalid " + name + ": " + value);
  return parsed;
}

function parseBoundedInteger(value, name, min, max) {
  const parsed = parseInteger(value, name);
  if (parsed < min || parsed > max) throw new Error(name + " out of range: " + value);
  return parsed;
}

function summarizeNumeric(samples, key) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const sample of samples) {
    const value = sample[key];
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  return { min, max, mean: samples.length === 0 ? 0 : sum / samples.length };
}

function summarizeBooleans(samples, key) {
  let trueCount = 0;
  for (const sample of samples) if (sample[key]) trueCount++;
  return { trueCount, falseCount: samples.length - trueCount };
}

try {
  const { seed, count, difficulty, advanced } = parseArgs(process.argv.slice(2));
  const rng = makeRng(seed >>> 0);
  const boards = [];
  const headCounts = new Map();
  let avoidHead = "";

  for (let i = 0; i < count; i++) {
    const level = generateLock(difficulty, rng, avoidHead);
    if (!level) throw new Error("generation failed at index " + i);
    avoidHead = level.head;
    const metrics = advanced ? allMetrics(level) : basicMetrics(level);
    boards.push({ head: level.head, ...metrics });
    headCounts.set(level.head, (headCounts.get(level.head) || 0) + 1);
  }

  const numericKeys = ["par", "reachableCount", "diameter", "branchingFactor", "goalCount", "shortestPathCount", "deadEndCount"];
  const numericSummary = Object.fromEntries(numericKeys.map((key) => [key, summarizeNumeric(boards, key)]));
  const booleanSummary = advanced
    ? Object.fromEntries(["partial", "mandatoryRepeatedFlips", "nonmonotonicity"].map((key) => [key, summarizeBooleans(boards, key)]))
    : { partial: summarizeBooleans(boards, "partial") };

  const report = {
    seed,
    count,
    difficulty,
    advanced,
    boards,
    summary: {
      headCounts: Object.fromEntries([...headCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
      numeric: numericSummary,
      boolean: booleanSummary,
    },
  };

  process.stdout.write(JSON.stringify(report) + "\n");
  process.exit(0);
} catch (err) {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
}
