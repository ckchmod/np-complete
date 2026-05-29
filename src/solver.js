// THE LOCK — build/test-time solver & non-triviality gates. Pure logic, no DOM.
//
// Backs the gates in docs/superpowers/specs/2026-05-28-the-lock-design.md §7.
// Everything here is design-time verification; runtime win-checking needs no
// solver (move legality is a single local check in engine.js).

import {
  makeConfig,
  isLegalFlip,
  legalFlips,
  applyFlip,
  isSolved,
} from "./engine.js";

// Hard cap on BFS states (spec §14: keep the reachable space tractable).
const STATE_CAP = 5_000_000;

// ---------------------------------------------------------------------------
// Configuration encoding
//
// A config is encoded as a bitmask over the level's edge list: bit i is 1 iff
// edge i's CURRENT direction differs from its START direction (level.edges[i].dir).
// The start config encodes to 0. A plain JS number is exact for <= 30 edges
// (well within Number's 53-bit integer range, but we cap at 30 to keep bit ops
// safe); beyond that we use BigInt.
// ---------------------------------------------------------------------------

function useBigInt(level) {
  return level.edges.length > 30;
}

function encode(config) {
  const edges = config.level.edges;
  if (edges.length > 30) {
    let mask = 0n;
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      if (config.dirs.get(edge.id) !== edge.dir) mask |= 1n << BigInt(i);
    }
    return mask;
  }
  let mask = 0;
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (config.dirs.get(edge.id) !== edge.dir) mask |= 1 << i;
  }
  return mask;
}

// ---------------------------------------------------------------------------
// bfsSolve
//
// BFS over LEGAL configurations from makeConfig(level). Neighbors are the legal
// single-edge flips. The BFS runs to EXHAUSTION (it does not stop at the goal),
// so it reports both the shortest path AND the full reachable component:
//   optimalLength  = BFS depth of the first config where the TARGET edge is
//                    reversed from its start orientation (isSolved), with a
//                    witnessing goalConfig. (null/false if unsolvable.)
//   reachableCount = size of the reachable component = count of ALL distinct
//                    legal configs reachable from the start (the spec §14
//                    tractability sanity bound).
// Capped at STATE_CAP states; exhausted=true if the cap is hit (reachableCount
// and possibly solvability are then only lower bounds).
// ---------------------------------------------------------------------------

export function bfsSolve(level) {
  const start = makeConfig(level);

  const visited = new Set([encode(start)]);
  let frontier = [start];
  let depth = 0;
  let exhausted = false;

  // First solved config found (defensive: a valid start never has the target
  // reversed, but bfsSolve makes no such assumption — hence the depth-0 check).
  let optimalLength = isSolved(start) ? 0 : null;
  let goalConfig = isSolved(start) ? start : null;

  while (frontier.length > 0) {
    const next = [];
    depth++;
    for (const config of frontier) {
      for (const edgeId of legalFlips(config)) {
        const neighbor = applyFlip(config, edgeId);
        const key = encode(neighbor);
        if (visited.has(key)) continue;

        // Record the shortest solution the first time we see one, but keep
        // exploring so reachableCount counts the whole component.
        if (optimalLength === null && isSolved(neighbor)) {
          optimalLength = depth;
          goalConfig = neighbor;
        }

        visited.add(key);
        next.push(neighbor);

        if (visited.size >= STATE_CAP) {
          exhausted = true;
          break;
        }
      }
      if (exhausted) break;
    }
    if (exhausted) break;
    frontier = next;
  }

  return {
    solvable: optimalLength !== null,
    optimalLength,
    goalConfig,
    reachableCount: visited.size,
    exhausted,
  };
}

// ---------------------------------------------------------------------------
// solveTarget
//
// Goal-directed BFS: the shortest number of legal flips to reverse the TARGET
// edge. Unlike bfsSolve it STOPS at the goal (does not exhaust the reachable
// component), so it's much cheaper — used by the live generator, which only
// needs solvability + optimal length, not reachableCount. Returns
// { solvable, optimalLength }. solvable=false if unsolvable or the state cap is
// hit before the goal is found.
// ---------------------------------------------------------------------------

export function solveTarget(level) {
  const start = makeConfig(level);
  if (isSolved(start)) return { solvable: true, optimalLength: 0 };

  const visited = new Set([encode(start)]);
  let frontier = [start];
  let depth = 0;

  while (frontier.length > 0) {
    const next = [];
    depth++;
    for (const config of frontier) {
      for (const edgeId of legalFlips(config)) {
        const neighbor = applyFlip(config, edgeId);
        if (isSolved(neighbor)) return { solvable: true, optimalLength: depth };
        const key = encode(neighbor);
        if (visited.has(key)) continue;
        visited.add(key);
        next.push(neighbor);
        if (visited.size >= STATE_CAP) return { solvable: false, optimalLength: null };
      }
    }
    frontier = next;
  }
  return { solvable: false, optimalLength: null };
}

// ---------------------------------------------------------------------------
// greedyReaches
//
// From the start config, repeatedly take the legal flip that most REDUCES the
// Hamming distance to goalConfig (distance = number of edges whose current dir
// differs from goalConfig). Deterministic tie-break: smallest edge id (by the
// level's edge order, which is the encoding bit order). Stops when distance is
// 0 (reached) or no legal flip strictly reduces distance (stuck). Returns
// whether goalConfig was reached.
// ---------------------------------------------------------------------------

// Hamming distance between two encoded masks (number or BigInt): popcount of XOR.
function popcountNumber(x) {
  let count = 0;
  while (x !== 0) {
    x &= x - 1;
    count++;
  }
  return count;
}

function popcountBigInt(x) {
  let count = 0;
  while (x !== 0n) {
    x &= x - 1n;
    count++;
  }
  return count;
}

function hamming(level, aMask, bMask) {
  return useBigInt(level)
    ? popcountBigInt(aMask ^ bMask)
    : popcountNumber(aMask ^ bMask);
}

export function greedyReaches(level, goalConfig) {
  const goalMask = encode(goalConfig);
  let config = makeConfig(level);
  let dist = hamming(level, encode(config), goalMask);
  // Worst case the loop runs once per Hamming-bit reduced; bounded by edge count.
  const guard = level.edges.length + 1;

  for (let step = 0; step < guard; step++) {
    if (dist === 0) return true;

    let bestEdge = null;
    let bestDist = dist; // require a STRICT reduction

    // level.edges order is the encoding bit order, so iterating it ascending
    // gives the "smallest edge id" tie-break for free (first strict improver
    // at the best distance wins).
    for (const edgeId of legalFlips(config)) {
      const neighbor = applyFlip(config, edgeId);
      const nd = hamming(level, encode(neighbor), goalMask);
      if (nd < bestDist) {
        bestDist = nd;
        bestEdge = edgeId;
      }
    }

    if (bestEdge === null) return false; // stuck: no strict improvement
    config = applyFlip(config, bestEdge);
    dist = bestDist;
  }

  return dist === 0;
}

// ---------------------------------------------------------------------------
// nonTrivialityReport
//
// Bundles the design-time gate signals for a level (spec §7 gates 1, 2, 4).
//   notTrivialMove1      = the target is NOT flippable from the start.
//   backtrackingRequired = solvable AND greedy hill-climb cannot reach goalConfig
//                          (i.e. every solution must temporarily move away).
// ---------------------------------------------------------------------------

export function nonTrivialityReport(level) {
  const start = makeConfig(level);
  const notTrivialMove1 = !isLegalFlip(start, level.target);

  const { solvable, optimalLength, goalConfig, reachableCount } = bfsSolve(level);

  const backtrackingRequired = solvable && !greedyReaches(level, goalConfig);

  return {
    solvable,
    optimalLength,
    notTrivialMove1,
    backtrackingRequired,
    reachableCount,
  };
}
