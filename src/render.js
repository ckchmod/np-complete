// THE LOCK — SVG rendering. Builds the board, animates per-move updates.
//
// Pure presentation: it reads the engine's derived state (edgeEnds, nodeSlack)
// and draws it. No game logic lives here. All colour/theming is expressed via
// CSS classes (see styles.css); this module only sets geometry, class names,
// and a few CSS custom properties the stylesheet consumes.
//
// Edges are drawn as quadratic Béziers. The curve LOCUS depends only on the
// fixed node pair (edge.u, edge.v) and a perpendicular "bow", never on the
// current orientation — so a flip only glides the arrowhead from one end to the
// other; the line itself does not move. Parallel edges (same node pair) bow
// apart in opposite directions so they are visually distinct AND have separate
// tap targets — fixing both the overlap and the "tapping the red arrow does
// nothing" bug (previously a parallel's fat hit area covered the target).
//
// CSS contract (classes/vars styles.css must define):
//   .board / .edge-group[data-edge] / .is-thick/.is-thin / .is-target /
//   .is-legal / .is-shaking / .edge-line (fill:none) / .edge-hit (fat,
//   transparent, fill:none) / .edge-arrow / .node-group[data-node] /
//   .is-tight / .is-pulsing / --slack / .node-glow / .node-ring / .board.is-won

import { edgeEnds, nodeSlack } from "./engine.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Geometry only (viewBox units). Colour/stroke intensity belong to CSS.
const NODE_R = 3.2; // node ring radius
const ARROW_LEN = 2.8; // arrowhead length along the edge
const ARROW_HALF = 1.7; // arrowhead half-width
const ENDPOINT_GAP = NODE_R + 0.8; // stop strokes short of the node ring
const BOW_STEP = 13; // perpendicular control-point offset between parallels
const REVERSAL_MS = 300; // arrow reversal animation duration

function el(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

function reflow(node) {
  void node.getBoundingClientRect();
}

function restartClass(node, cls) {
  node.classList.remove(cls);
  reflow(node);
  requestAnimationFrame(() => node.classList.add(cls));
}

function unit(dx, dy) {
  const L = Math.hypot(dx, dy) || 1;
  return [dx / L, dy / L];
}

// Curve locus for an edge: fixed by (u,v) positions + a perpendicular bow.
// Orientation-independent, so reversals don't move the line.
function edgeCurve(nodeById, edge, bow) {
  const A = nodeById.get(edge.u);
  const B = nodeById.get(edge.v);
  const [ux, uy] = unit(B.x - A.x, B.y - A.y);
  const px = -uy;
  const py = ux;
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  return {
    ax: A.x, ay: A.y,
    bx: B.x, by: B.y,
    cx: mx + px * bow, cy: my + py * bow, // quadratic control point
  };
}

function qPoint(c, t) {
  const mt = 1 - t;
  return [
    mt * mt * c.ax + 2 * mt * t * c.cx + t * t * c.bx,
    mt * mt * c.ay + 2 * mt * t * c.cy + t * t * c.by,
  ];
}

function qTangent(c, t) {
  return unit(
    2 * (1 - t) * (c.cx - c.ax) + 2 * t * (c.bx - c.cx),
    2 * (1 - t) * (c.cy - c.ay) + 2 * t * (c.by - c.cy)
  );
}

// Endpoints pulled back to the node rings, along the curve's end tangents.
function trimmedEnds(c) {
  const [t0x, t0y] = qTangent(c, 0);
  const [t1x, t1y] = qTangent(c, 1);
  return {
    sx: c.ax + t0x * ENDPOINT_GAP, sy: c.ay + t0y * ENDPOINT_GAP,
    ex: c.bx - t1x * ENDPOINT_GAP, ey: c.by - t1y * ENDPOINT_GAP,
  };
}

function curvePath(c) {
  const e = trimmedEnds(c);
  return `M ${e.sx} ${e.sy} Q ${c.cx} ${c.cy} ${e.ex} ${e.ey}`;
}

// Visible line, pulled back at the HEAD end so the arrowhead sits in clear space
// (no line running under it / cap poking past the tip). The hit area still uses
// the full curve, so tappability is unchanged.
function linePath(c, headEnd) {
  const e = trimmedEnds(c);
  if (headEnd === "B") {
    const [dx, dy] = qTangent(c, 1);
    return `M ${e.sx} ${e.sy} Q ${c.cx} ${c.cy} ${e.ex - dx * ARROW_LEN} ${e.ey - dy * ARROW_LEN}`;
  }
  const [tx, ty] = qTangent(c, 0);
  return `M ${e.ex} ${e.ey} Q ${c.cx} ${c.cy} ${e.sx + tx * ARROW_LEN} ${e.sy + ty * ARROW_LEN}`;
}

// Arrowhead triangle whose tip sits at the head point and points along `dir`.
function arrowTriangle(tipX, tipY, dx, dy) {
  const baseX = tipX - dx * ARROW_LEN;
  const baseY = tipY - dy * ARROW_LEN;
  const px = -dy;
  const py = dx;
  return (
    `M ${tipX} ${tipY} ` +
    `L ${baseX + px * ARROW_HALF} ${baseY + py * ARROW_HALF} ` +
    `L ${baseX - px * ARROW_HALF} ${baseY - py * ARROW_HALF} Z`
  );
}

// Arrowhead at the resting head end ('A' or 'B').
function arrowPathFor(c, toEnd) {
  const e = trimmedEnds(c);
  if (toEnd === "B") {
    const [dx, dy] = qTangent(c, 1);
    return arrowTriangle(e.ex, e.ey, dx, dy);
  }
  const [tx, ty] = qTangent(c, 0);
  return arrowTriangle(e.sx, e.sy, -tx, -ty);
}

// Arrowhead mid-glide at parameter t, pointing in travel direction (dirSign).
function arrowPathAtT(c, t, dirSign) {
  const [tipX, tipY] = qPoint(c, t);
  const [tx, ty] = qTangent(c, t);
  return arrowTriangle(tipX, tipY, tx * dirSign, ty * dirSign);
}

// Signed bow for an edge within its parallel group (a lone edge bows 0 = straight).
function parallelBow(level, edge) {
  const key = (e) => (e.u < e.v ? e.u + "|" + e.v : e.v + "|" + e.u);
  const k = key(edge);
  const group = level.edges.filter((e) => key(e) === k);
  if (group.length < 2) return 0;
  const i = group.findIndex((e) => e.id === edge.id);
  const mid = (group.length - 1) / 2;
  return (i - mid) * BOW_STEP;
}

// Which physical end ('A'=u, 'B'=v) is the current arrowhead at?
function headEnd(ends, edge) {
  return ends.to === edge.v ? "B" : "A";
}

export function createBoard(svgEl, config, { onEdgeTap } = {}) {
  const nodeById = new Map(config.level.nodes.map((n) => [n.id, n]));
  let current = config;

  svgEl.classList.add("board");
  svgEl.setAttribute("viewBox", computeViewBox(config.level));
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

  const edgeLayer = el("g", { class: "edge-layer" });
  const nodeLayer = el("g", { class: "node-layer" });
  svgEl.appendChild(edgeLayer);
  svgEl.appendChild(nodeLayer);

  const edgeViews = new Map();
  const nodeViews = new Map();

  // --- Build edges -----------------------------------------------------------
  for (const edge of config.level.edges) {
    const curve = edgeCurve(nodeById, edge, parallelBow(config.level, edge));
    const toEnd = headEnd(edgeEnds(current, edge.id), edge);

    const group = el("g", {
      class:
        "edge-group " +
        (edge.w === 2 ? "is-thick" : "is-thin") +
        (config.level.target === edge.id ? " is-target" : ""),
    });
    group.dataset.edge = edge.id;

    const line = el("path", { class: "edge-line", d: linePath(curve, toEnd) });
    const arrow = el("path", { class: "edge-arrow", d: arrowPathFor(curve, toEnd) });
    const hit = el("path", { class: "edge-hit", d: curvePath(curve) });

    group.appendChild(line);
    group.appendChild(arrow);
    group.appendChild(hit);
    edgeLayer.appendChild(group);

    edgeViews.set(edge.id, { group, line, hit, arrow, curve, edge });
    bindTap(hit, () => onEdgeTap && onEdgeTap(edge.id));
  }

  // --- Build nodes -----------------------------------------------------------
  for (const node of config.level.nodes) {
    const group = el("g", { class: "node-group" });
    group.dataset.node = node.id;
    group.setAttribute("transform", `translate(${node.x} ${node.y})`);
    const glow = el("circle", { class: "node-glow", r: NODE_R });
    const ring = el("circle", { class: "node-ring", r: NODE_R });
    group.appendChild(glow);
    group.appendChild(ring);
    nodeLayer.appendChild(group);
    nodeViews.set(node.id, { group, glow, ring });
  }

  applyNodeState(current, nodeViews);

  // --- Tap binding (touch + click, de-duplicated) ----------------------------
  function bindTap(target, handler) {
    target.style.touchAction = "manipulation";
    let touched = false;
    target.addEventListener(
      "touchend",
      (e) => {
        touched = true;
        e.preventDefault();
        handler();
        setTimeout(() => (touched = false), 400);
      },
      { passive: false }
    );
    target.addEventListener("click", () => {
      if (touched) return;
      handler();
    });
  }

  // --- Public view API -------------------------------------------------------

  // Re-render to a new config: glide arrowheads whose orientation flipped,
  // pulse nodes whose slack changed. The curve locus never moves.
  function update(nextConfig) {
    for (const edge of nextConfig.level.edges) {
      const view = edgeViews.get(edge.id);
      const prevEnds = edgeEnds(current, edge.id);
      const nextEnds = edgeEnds(nextConfig, edge.id);
      if (prevEnds.to !== nextEnds.to) animateReversal(view, prevEnds, nextEnds);
    }
    for (const node of nextConfig.level.nodes) {
      if (nodeSlack(current, node.id) !== nodeSlack(nextConfig, node.id)) pulse(node.id);
    }
    current = nextConfig;
    applyNodeState(current, nodeViews);
  }

  function animateReversal(view, prevEnds, nextEnds) {
    const c = view.curve;
    const fromT = headEnd(prevEnds, view.edge) === "B" ? 1 : 0;
    const toT = headEnd(nextEnds, view.edge) === "B" ? 1 : 0;
    const dirSign = toT > fromT ? 1 : -1;
    view.line.setAttribute("d", curvePath(c)); // full curve while the head glides across
    const t0 = performance.now();
    function frame(now) {
      const k = Math.min(1, (now - t0) / REVERSAL_MS);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      view.arrow.setAttribute("d", arrowPathAtT(c, fromT + (toT - fromT) * e, dirSign));
      if (k < 1) requestAnimationFrame(frame);
      else {
        const head = toT === 1 ? "B" : "A";
        view.arrow.setAttribute("d", arrowPathFor(c, head));
        view.line.setAttribute("d", linePath(c, head)); // re-trim at the settled head
      }
    }
    requestAnimationFrame(frame);
  }

  // Subtle affordance on flippable edges; also raise them so a tap always lands
  // on a legal edge even where parallels converge near a node.
  function markLegal(edgeIds) {
    const legal = new Set(edgeIds || []);
    for (const [id, view] of edgeViews) {
      view.group.classList.toggle("is-legal", legal.has(id));
    }
    for (const [id, view] of edgeViews) {
      if (legal.has(id)) edgeLayer.appendChild(view.group); // raise to top
    }
  }

  function shakeEdge(edgeId) {
    const view = edgeViews.get(edgeId);
    if (!view) return;
    restartClass(view.group, "is-shaking");
    view.group.addEventListener(
      "animationend",
      () => view.group.classList.remove("is-shaking"),
      { once: true }
    );
  }

  function pulse(nodeId) {
    const view = nodeViews.get(nodeId);
    if (!view) return;
    restartClass(view.group, "is-pulsing");
    view.group.addEventListener(
      "animationend",
      () => view.group.classList.remove("is-pulsing"),
      { once: true }
    );
  }

  function winCascade() {
    svgEl.classList.add("is-won");
    cascadeOrder(current).forEach((nodeId, i) => {
      setTimeout(() => pulse(nodeId), i * 90);
    });
  }

  return { update, markLegal, shakeEdge, pulseNode: pulse, winCascade };
}

// --- helpers operating on a config -------------------------------------------

function applyNodeState(config, nodeViews) {
  for (const [id, view] of nodeViews) {
    const slack = nodeSlack(config, id);
    view.group.classList.toggle("is-tight", slack === 0);
    view.group.style.setProperty("--slack", String(slack));
  }
}

// Win cascade order: BFS outward from the target edge's endpoints.
function cascadeOrder(config) {
  const level = config.level;
  const targetEdge = config.edgeById.get(level.target);
  const adj = new Map(level.nodes.map((n) => [n.id, []]));
  for (const e of level.edges) {
    adj.get(e.u).push(e.v);
    adj.get(e.v).push(e.u);
  }
  const seen = new Set();
  const order = [];
  const queue = [targetEdge.u, targetEdge.v];
  for (const s of queue) seen.add(s);
  while (queue.length) {
    const v = queue.shift();
    order.push(v);
    for (const n of adj.get(v)) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  for (const n of level.nodes) if (!seen.has(n.id)) order.push(n.id);
  return order;
}

// Portrait viewBox sized to node extents, padded for glow, arrows, and bows.
function computeViewBox(level) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of level.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  const pad = NODE_R + ARROW_LEN + BOW_STEP / 2 + 4;
  return `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
}
