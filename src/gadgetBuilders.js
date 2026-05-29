const layout = {
  latch: [
    ["source", 18, 44], ["gate", 46, 44], ["key", 72, 28], ["reservoir", 72, 72], ["tail", 92, 72],
  ],
  mutex: [
    ["hub", 50, 44], ["left", 24, 72], ["right", 76, 72], ["leftAnchor", 12, 102], ["rightAnchor", 88, 102],
  ],
  cyclePump: [
    ["a", 50, 24], ["b", 24, 72], ["c", 76, 72],
  ],
  battery: [
    ["source", 50, 46], ["sink", 50, 78], ["outA", 20, 106], ["outB", 80, 106], ["anchorA", 8, 132], ["anchorB", 92, 132],
  ],
  sharedReservoir: [
    ["reservoir", 50, 58], ["tail", 50, 92], ["left", 24, 112], ["right", 76, 112], ["leftAnchor", 12, 140], ["rightAnchor", 88, 140],
  ],
};

function nodeId(prefix, name) {
  return `${prefix}_${name}`;
}

function edgeId(prefix, name) {
  return `${prefix}_${name}`;
}

function nodes(prefix, kind) {
  return layout[kind].map(([name, x, y]) => ({ id: nodeId(prefix, name), x, y }));
}

function makeLevel({ kind, prefix, name, nodeNames, edgeDefs, target, portEdgeIds, notes }) {
  const edges = edgeDefs.map(([id, u, v, w, dir]) => ({
    id: edgeId(prefix, id),
    u: nodeId(prefix, u),
    v: nodeId(prefix, v),
    w,
    dir,
  }));
  const nodeIds = nodeNames.map((id) => nodeId(prefix, id));
  const edgeIds = edgeDefs.map(([id]) => edgeId(prefix, id));
  const targetEdgeId = edgeId(prefix, target);
  return {
    id: `gadget-${prefix}`,
    name,
    nodes: nodes(prefix, kind),
    edges,
    target: targetEdgeId,
    metadata: {
      kind,
      nodeIds,
      edgeIds,
      targetEdgeId,
      portEdgeIds,
      notes,
    },
  };
}

export function buildLatch(prefix = "latch") {
  return makeLevel({
    kind: "latch",
    prefix,
    name: "Latch Gadget",
    nodeNames: ["source", "gate", "key", "reservoir", "tail"],
    edgeDefs: [
      ["target", "source", "gate", 2, "uv"],
      ["sourceBack", "source", "gate", 2, "vu"],
      ["trickle", "key", "gate", 1, "uv"],
      ["unlock", "gate", "reservoir", 2, "uv"],
      ["tailFeed", "reservoir", "tail", 2, "uv"],
      ["tailReturn", "reservoir", "tail", 2, "vu"],
      ["keyFeed", "key", "reservoir", 2, "uv"],
      ["keyReturn", "key", "reservoir", 2, "vu"],
    ],
    target: "target",
    portEdgeIds: { unlock: edgeId(prefix, "unlock"), output: edgeId(prefix, "target") },
    notes: [
      "Target starts locked at the gate node until the unlock port is routed inward.",
      "Unlock then target is the standalone two-move witness.",
    ],
  });
}

export function buildMutex(prefix = "mutex") {
  return makeLevel({
    kind: "mutex",
    prefix,
    name: "Mutex Gadget",
    nodeNames: ["hub", "left", "right", "leftAnchor", "rightAnchor"],
    edgeDefs: [
      ["leftPort", "left", "hub", 2, "uv"],
      ["rightPort", "right", "hub", 2, "uv"],
      ["leftAnchorOut", "left", "leftAnchor", 2, "uv"],
      ["leftAnchorIn", "left", "leftAnchor", 2, "vu"],
      ["rightAnchorOut", "right", "rightAnchor", 2, "uv"],
      ["rightAnchorIn", "right", "rightAnchor", 2, "vu"],
    ],
    target: "leftPort",
    portEdgeIds: { left: edgeId(prefix, "leftPort"), right: edgeId(prefix, "rightPort") },
    notes: [
      "Opening either thick port spends the hub's only two units of slack.",
      "The other port cannot open in any reachable state until the first port is closed.",
    ],
  });
}

export function buildCyclePump(prefix = "cyclePump") {
  return makeLevel({
    kind: "cyclePump",
    prefix,
    name: "Cycle Pump Gadget",
    nodeNames: ["a", "b", "c"],
    edgeDefs: [
      ["abBase", "a", "b", 2, "uv"],
      ["bc", "b", "c", 2, "uv"],
      ["ca", "c", "a", 2, "uv"],
      ["abPump", "a", "b", 2, "uv"],
    ],
    target: "abPump",
    portEdgeIds: { pump: edgeId(prefix, "abPump"), cycle: [edgeId(prefix, "abBase"), edgeId(prefix, "bc"), edgeId(prefix, "ca")] },
    notes: [
      "The base triangle is an explicit undirected graph cycle.",
      "The parallel pump edge gives node b slack so the pump edge can route back to a.",
    ],
  });
}

export function buildBattery(prefix = "battery") {
  return makeLevel({
    kind: "battery",
    prefix,
    name: "Battery Gadget",
    nodeNames: ["source", "sink", "outA", "outB", "anchorA", "anchorB"],
    edgeDefs: [
      ["return", "sink", "source", 2, "uv"],
      ["feedA", "source", "sink", 2, "uv"],
      ["feedB", "source", "sink", 2, "uv"],
      ["outputA", "outA", "sink", 2, "uv"],
      ["outputB", "outB", "sink", 2, "uv"],
      ["anchorAOut", "outA", "anchorA", 2, "uv"],
      ["anchorAIn", "outA", "anchorA", 2, "vu"],
      ["anchorBOut", "outB", "anchorB", 2, "uv"],
      ["anchorBIn", "outB", "anchorB", 2, "vu"],
    ],
    target: "outputA",
    portEdgeIds: { outputs: [edgeId(prefix, "outputA"), edgeId(prefix, "outputB")] },
    notes: [
      "The sink has enough slack to route two thick outputs independently.",
      "Output edges start pointing into the sink and open when reversed out of it.",
    ],
  });
}

export function buildSharedReservoir(prefix = "sharedReservoir") {
  return makeLevel({
    kind: "sharedReservoir",
    prefix,
    name: "Shared Reservoir Gadget",
    nodeNames: ["reservoir", "tail", "left", "right", "leftAnchor", "rightAnchor"],
    edgeDefs: [
      ["return", "tail", "reservoir", 2, "vu"],
      ["feedA", "tail", "reservoir", 2, "uv"],
      ["feedB", "tail", "reservoir", 2, "uv"],
      ["leftPort", "left", "reservoir", 1, "uv"],
      ["rightPort", "right", "reservoir", 1, "uv"],
      ["leftAnchorOut", "left", "leftAnchor", 2, "uv"],
      ["leftAnchorIn", "left", "leftAnchor", 2, "vu"],
      ["rightAnchorOut", "right", "rightAnchor", 2, "uv"],
      ["rightAnchorIn", "right", "rightAnchor", 2, "vu"],
    ],
    target: "leftPort",
    portEdgeIds: { outputs: [edgeId(prefix, "leftPort"), edgeId(prefix, "rightPort")] },
    notes: [
      "Two thin outputs draw from the same slack reservoir.",
      "The shared reservoir remains legal after routing both standalone outputs.",
    ],
  });
}

export const latch = buildLatch;
export const mutex = buildMutex;
export const cyclePump = buildCyclePump;
export const battery = buildBattery;
export const sharedReservoir = buildSharedReservoir;
