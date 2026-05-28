// THE LOCK — NCL engine. Pure logic, no DOM.
//
// Formal model (see docs/superpowers/specs/2026-05-28-the-lock-design.md §4):
//   Each edge e has weight w(e) ∈ {1,2} and an orientation. The arrow points
//   from `from` to `to` and delivers w(e) units of inflow to `to`.
//   inflow(v) = Σ w(e) over edges with e.to == v.
//   Invariant: for all v, inflow(v) ≥ 2.
//   Move: reverse edge e; legal iff inflow(e.to) − w(e) ≥ 2.
//   Solved: target edge's orientation is the reverse of its start orientation.

const MIN_INFLOW = 2;

// Given an edge and its current direction, return the node receiving inflow.
function receiver(edge, dir) {
  return dir === "uv" ? edge.v : edge.u;
}

// Given an edge and its current direction, return the node sending the arrow.
function sender(edge, dir) {
  return dir === "uv" ? edge.u : edge.v;
}

// A Config is an immutable value: { level, dirs, edgeById, incident }.
//   dirs:     edgeId -> current dir ("uv" | "vu")
//   edgeById: edgeId -> edge (from the level)
//   incident: nodeId -> array of edgeIds touching that node
// All of these are frozen; applyFlip returns a fresh Config.

function buildIndex(level) {
  const edgeById = new Map();
  const incident = new Map();
  for (const node of level.nodes) incident.set(node.id, []);
  for (const edge of level.edges) {
    edgeById.set(edge.id, edge);
    // u and v are assumed to be valid node ids declared in level.nodes.
    incident.get(edge.u).push(edge.id);
    incident.get(edge.v).push(edge.id);
  }
  return { edgeById, incident };
}

// Sum of w over edges currently pointing INTO nodeId.
export function inflow(config, nodeId) {
  let total = 0;
  for (const edgeId of config.incident.get(nodeId)) {
    const edge = config.edgeById.get(edgeId);
    if (receiver(edge, config.dirs.get(edgeId)) === nodeId) total += edge.w;
  }
  return total;
}

// inflow − 2: surplus incoming weight above the minimum.
export function nodeSlack(config, nodeId) {
  return inflow(config, nodeId) - MIN_INFLOW;
}

// Build an immutable Config from a level. Throws if the start orientation is
// illegal (any node inflow < 2).
export function makeConfig(level) {
  const { edgeById, incident } = buildIndex(level);
  const dirs = new Map();
  for (const edge of level.edges) dirs.set(edge.id, edge.dir);

  const config = Object.freeze({ level, dirs, edgeById, incident });

  for (const node of level.nodes) {
    if (inflow(config, node.id) < MIN_INFLOW) {
      throw new Error(
        `Illegal start: node ${node.id} has inflow ${inflow(config, node.id)} < ${MIN_INFLOW}`
      );
    }
  }
  return config;
}

// True iff flipping edgeId keeps the invariant: the current receiver, which
// loses w(e), still has inflow ≥ 2 afterward. (The gaining endpoint can never
// violate, so only the losing endpoint needs checking.)
export function isLegalFlip(config, edgeId) {
  const edge = config.edgeById.get(edgeId);
  const to = receiver(edge, config.dirs.get(edgeId));
  return inflow(config, to) - edge.w >= MIN_INFLOW;
}

// Ids of all currently-flippable edges.
export function legalFlips(config) {
  const ids = [];
  for (const edge of config.level.edges) {
    if (isLegalFlip(config, edge.id)) ids.push(edge.id);
  }
  return ids;
}

// Return a NEW Config with edgeId reversed. Throws if the flip is illegal.
// Flips are involutive: applying twice returns the original orientation.
export function applyFlip(config, edgeId) {
  if (!isLegalFlip(config, edgeId)) {
    throw new Error(`Illegal flip: edge ${edgeId}`);
  }
  const dirs = new Map(config.dirs);
  dirs.set(edgeId, dirs.get(edgeId) === "uv" ? "vu" : "uv");
  // edgeById and incident are immutable and shared; only dirs is freshly copied.
  return Object.freeze({
    level: config.level,
    dirs,
    edgeById: config.edgeById,
    incident: config.incident,
  });
}

// True iff the target edge's current orientation is the reverse of its start.
export function isSolved(config) {
  const targetId = config.level.target;
  const startDir = config.edgeById.get(targetId).dir;
  return config.dirs.get(targetId) !== startDir;
}

// Current orientation + weight of an edge (for rendering/solver).
export function edgeEnds(config, edgeId) {
  const edge = config.edgeById.get(edgeId);
  const dir = config.dirs.get(edgeId);
  return { from: sender(edge, dir), to: receiver(edge, dir), w: edge.w };
}
