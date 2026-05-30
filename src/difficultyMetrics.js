import { makeConfig, legalFlips, applyFlip, isSolved, nodeSlack } from "./engine.js";

const STATE_CAP = 5_000_000;

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

function receiver(edge, dir) {
  return dir === "uv" ? edge.v : edge.u;
}

function buildTraversal(level, cap) {
  const start = makeConfig(level);
  const startKey = encode(start);

  const keyToIndex = new Map([[startKey, 0]]);
  const states = [{ key: startKey, config: start, dist: 0, outgoing: [] }];
  let frontier = [0];
  let partial = false;
  let diameter = 0;
  let totalBranching = 0;
  let deadEndCount = 0;
  let shortestGoalDepth = isSolved(start) ? 0 : null;

  while (frontier.length > 0) {
    const next = [];

    for (const stateIndex of frontier) {
      const state = states[stateIndex];
      const legal = legalFlips(state.config);
      totalBranching += legal.length;
      if (legal.length <= 1) deadEndCount++;

      for (const edgeId of legal) {
        const neighbor = applyFlip(state.config, edgeId);
        const neighborKey = encode(neighbor);
        let neighborIndex = keyToIndex.get(neighborKey);

        if (neighborIndex === undefined) {
          const nextDepth = state.dist + 1;
          neighborIndex = states.length;
          keyToIndex.set(neighborKey, neighborIndex);
          states.push({
            key: neighborKey,
            config: neighbor,
            dist: nextDepth,
            outgoing: [],
          });
          next.push(neighborIndex);
          diameter = Math.max(diameter, nextDepth);

          if (isSolved(neighbor) && shortestGoalDepth === null) {
            shortestGoalDepth = nextDepth;
          }

          if (states.length >= cap) {
            partial = true;
          }
        }

        state.outgoing.push({ to: neighborIndex, edgeId });
        if (partial) break;
      }

      if (partial) break;
    }

    if (partial) break;
    frontier = next;
  }

  return {
    states,
    partial,
    diameter,
    totalBranching,
    deadEndCount,
    shortestGoalDepth,
  };
}

function shortestPathAnalysis(traversal) {
  const { states, shortestGoalDepth: par, partial } = traversal;
  if (partial || par === null) {
    return {
      par,
      goals: [],
      totalPaths: 0n,
      waysFromStart: new Array(states.length).fill(0n),
      waysToGoal: new Array(states.length).fill(0n),
      shortestOutgoing: new Map(),
      edgeIdsInShortestDag: new Set(),
    };
  }

  const goals = [];
  for (let i = 0; i < states.length; i++) {
    if (states[i].dist === par && isSolved(states[i].config)) goals.push(i);
  }

  const byDistance = [...states.keys()].sort((a, b) => states[a].dist - states[b].dist);
  const waysFromStart = new Array(states.length).fill(0n);
  waysFromStart[0] = 1n;

  for (const index of byDistance) {
    const state = states[index];
    if (state.dist >= par) continue;
    for (const move of state.outgoing) {
      if (states[move.to].dist === state.dist + 1) {
        waysFromStart[move.to] += waysFromStart[index];
      }
    }
  }

  const waysToGoal = new Array(states.length).fill(0n);
  for (const goal of goals) waysToGoal[goal] = 1n;

  for (const index of [...byDistance].reverse()) {
    const state = states[index];
    if (state.dist >= par) continue;
    for (const move of state.outgoing) {
      if (states[move.to].dist === state.dist + 1) {
        waysToGoal[index] += waysToGoal[move.to];
      }
    }
  }

  const totalPaths = waysToGoal[0];
  const shortestOutgoing = new Map();
  const edgeIdsInShortestDag = new Set();

  for (let index = 0; index < states.length; index++) {
    const state = states[index];
    if (waysFromStart[index] === 0n || waysToGoal[index] === 0n || state.dist >= par) continue;

    const moves = [];
    for (const move of state.outgoing) {
      if (states[move.to].dist !== state.dist + 1) continue;
      if (waysToGoal[move.to] === 0n) continue;
      moves.push(move);
      edgeIdsInShortestDag.add(move.edgeId);
    }
    shortestOutgoing.set(index, moves);
  }

  return {
    par,
    goals,
    totalPaths,
    waysFromStart,
    waysToGoal,
    shortestOutgoing,
    edgeIdsInShortestDag,
  };
}

export function cycleRank(level) {
  const neighborsByNode = new Map(level.nodes.map((node) => [node.id, []]));
  for (const edge of level.edges) {
    neighborsByNode.get(edge.u).push(edge.v);
    neighborsByNode.get(edge.v).push(edge.u);
  }

  const visited = new Set();
  let connectedComponents = 0;

  for (const node of level.nodes) {
    if (visited.has(node.id)) continue;
    connectedComponents++;
    const stack = [node.id];
    visited.add(node.id);

    while (stack.length > 0) {
      const current = stack.pop();
      for (const neighbor of neighborsByNode.get(current)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
  }

  return level.edges.length - level.nodes.length + connectedComponents;
}

export function targetSlack(config, targetEdge = config.level.target) {
  const edge = typeof targetEdge === "string"
    ? config.edgeById.get(targetEdge)
    : targetEdge;
  return nodeSlack(config, receiver(edge, config.dirs.get(edge.id)));
}

export function isNonmonotonic(level, bfsResult = null) {
  const traversal = bfsResult ?? buildTraversal(level, STATE_CAP);
  const analysis = shortestPathAnalysis(traversal);
  return computeAdvancedMetrics(traversal, analysis).nonmonotonicity;
}

function computeAdvancedMetrics(traversal, analysis) {
  const { states } = traversal;
  const {
    par,
    goals,
    totalPaths,
    waysFromStart,
    waysToGoal,
    shortestOutgoing,
    edgeIdsInShortestDag,
  } = analysis;

  if (traversal.partial || par === null || totalPaths === 0n) {
    return {
      bottleneckCount: 0,
      mandatoryRepeatedFlips: false,
      resourceContention: 0,
      nonmonotonicity: false,
    };
  }

  const goalSet = new Set(goals);
  let bottleneckCount = 0;
  for (let i = 1; i < states.length; i++) {
    if (goalSet.has(i)) continue;
    if (waysFromStart[i] > 0n && waysToGoal[i] > 0n && waysFromStart[i] * waysToGoal[i] === totalPaths) {
      bottleneckCount++;
    }
  }

  let resourceContention = 0;
  const cleanReachable = new Set([0]);
  const byDistance = [...states.keys()].sort((a, b) => states[a].dist - states[b].dist);

  for (const index of byDistance) {
    const moves = shortestOutgoing.get(index);
    if (!moves || moves.length === 0) continue;

    const slack = targetSlack(states[index].config);
    let hasNonDecreasingMove = false;
    for (const move of moves) {
      const nextSlack = targetSlack(states[move.to].config);
      if (goalSet.has(move.to) || nextSlack >= slack) {
        hasNonDecreasingMove = true;
        if (cleanReachable.has(index)) cleanReachable.add(move.to);
      }
    }

    if (!hasNonDecreasingMove) resourceContention++;
  }

  const hasMonotoneShortestPath = goals.some((goal) => cleanReachable.has(goal));

  return {
    bottleneckCount,
    mandatoryRepeatedFlips: par > edgeIdsInShortestDag.size,
    resourceContention,
    nonmonotonicity: !hasMonotoneShortestPath,
  };
}

function countSolvedStates(traversal) {
  if (traversal.partial) return null;
  let goalCount = 0;
  for (const state of traversal.states) {
    if (isSolved(state.config)) goalCount++;
  }
  return goalCount;
}

function exactCountMetric(count) {
  if (count <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(count);
  return count.toString();
}

function coreMetrics(traversal, analysis) {
  const goalCount = countSolvedStates(traversal);
  const shortestPathCount = traversal.partial || analysis.par === null || analysis.totalPaths === 0n
    ? null
    : exactCountMetric(analysis.totalPaths);

  return {
    reachableCount: traversal.states.length,
    diameter: traversal.diameter,
    branchingFactor: traversal.states.length === 0 ? 0 : traversal.totalBranching / traversal.states.length,
    goalCount,
    shortestPathCount,
    deadEndCount: traversal.deadEndCount,
    par: traversal.shortestGoalDepth,
    partial: traversal.partial,
  };
}

export function basicMetrics(level, { cap = STATE_CAP } = {}) {
  const traversal = buildTraversal(level, cap);
  return coreMetrics(traversal, shortestPathAnalysis(traversal));
}

export function allMetrics(level, { cap = STATE_CAP } = {}) {
  const traversal = buildTraversal(level, cap);
  const analysis = shortestPathAnalysis(traversal);
  return {
    ...coreMetrics(traversal, analysis),
    ...computeAdvancedMetrics(traversal, analysis),
    cycleRank: cycleRank(level),
  };
}
