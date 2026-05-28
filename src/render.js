// THE LOCK — SVG rendering. Builds the board, animates per-move updates.
//
// Pure presentation: reads the engine's derived state (edgeEnds, nodeSlack) and
// draws it. No game logic. All colour/theming lives in CSS classes; this module
// sets geometry, class names, and the --slack custom property.
//
// Edges are quadratic Béziers. The curve LOCUS depends only on the fixed node
// pair (edge.u, edge.v) + a perpendicular "bow", never on orientation — so a
// flip only glides the arrowhead across; the line doesn't move. Parallel edges
// bow apart (distinct + independently tappable). The visible line is pulled back
// at the head so the arrowhead sits in clear space; the hit area is the full
// curve. Arrowheads scale with weight (thick = bigger head) so weight reads at a
// glance and the head fully covers the line cap.
//
// CSS contract: .board / .edge-group[data-edge] / .is-thick|.is-thin /
// .is-target / .is-legal / .is-shaking / .edge-line (fill:none) / .edge-hit
// (fat transparent, fill:none) / .edge-arrow / .node-group[data-node] /
// .is-tight / .is-pulsing / --slack / .node-glow / .node-ring / .board.is-won

import { edgeEnds, nodeSlack } from "./engine.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const NODE_R = 3.2; // node ring radius
const ARROW_MAX_LEN = 3.6; // longest arrowhead (thick) — for viewBox padding
const ENDPOINT_GAP = NODE_R + 0.8; // stop strokes short of the node ring
const BOW_STEP = 13; // perpendicular control-point offset between parallels
const REVERSAL_MS = 300; // arrow reversal animation duration

// Arrowhead size by edge weight: a thick (2) arrow gets a visibly bigger head.
function arrowDims(w) {
  return w === 2 ? { len: 3.6, half: 2.3 } : { len: 2.3, half: 1.3 };
}

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

// Curve locus: fixed by (u,v) positions + a perpendicular bow.
function edgeCurve(nodeById, edge, bow) {
  const A = nodeById.get(edge.u);
  const B = nodeById.get(edge.v);
  const [ux, uy] = unit(B.x - A.x, B.y - A.y);
  const px = -uy;
  const py = ux;
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  return { ax: A.x, ay: A.y, bx: B.x, by: B.y, cx: mx + px * bow, cy: my + py * bow };
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

function trimmedEnds(c) {
  const [t0x, t0y] = qTangent(c, 0);
  const [t1x, t1y] = qTangent(c, 1);
  return {
    sx: c.ax + t0x * ENDPOINT_GAP, sy: c.ay + t0y * ENDPOINT_GAP,
    ex: c.bx - t1x * ENDPOINT_GAP, ey: c.by - t1y * ENDPOINT_GAP,
  };
}

// Full curve (used for the hit area and mid-animation).
function curvePath(c) {
  const e = trimmedEnds(c);
  return `M ${e.sx} ${e.sy} Q ${c.cx} ${c.cy} ${e.ex} ${e.ey}`;
}

// Visible line, pulled back at the HEAD end by the arrowhead length `len`.
function linePath(c, headEnd, len) {
  const e = trimmedEnds(c);
  if (headEnd === "B") {
    const [dx, dy] = qTangent(c, 1);
    return `M ${e.sx} ${e.sy} Q ${c.cx} ${c.cy} ${e.ex - dx * len} ${e.ey - dy * len}`;
  }
  const [tx, ty] = qTangent(c, 0);
  return `M ${e.ex} ${e.ey} Q ${c.cx} ${c.cy} ${e.sx + tx * len} ${e.sy + ty * len}`;
}

function arrowTriangle(tipX, tipY, dx, dy, len, half) {
  const baseX = tipX - dx * len;
  const baseY = tipY - dy * len;
  const px = -dy;
  const py = dx;
  return (
    `M ${tipX} ${tipY} ` +
    `L ${baseX + px * half} ${baseY + py * half} ` +
    `L ${baseX - px * half} ${baseY - py * half} Z`
  );
}

function arrowPathFor(c, headEnd, len, half) {
  const e = trimmedEnds(c);
  if (headEnd === "B") {
    const [dx, dy] = qTangent(c, 1);
    return arrowTriangle(e.ex, e.ey, dx, dy, len, half);
  }
  const [tx, ty] = qTangent(c, 0);
  return arrowTriangle(e.sx, e.sy, -tx, -ty, len, half);
}

function arrowPathAtT(c, t, dirSign, len, half) {
  const [tipX, tipY] = qPoint(c, t);
  const [tx, ty] = qTangent(c, t);
  return arrowTriangle(tipX, tipY, tx * dirSign, ty * dirSign, len, half);
}

function parallelBow(level, edge) {
  const key = (e) => (e.u < e.v ? e.u + "|" + e.v : e.v + "|" + e.u);
  const k = key(edge);
  const group = level.edges.filter((e) => key(e) === k);
  if (group.length < 2) return 0;
  const i = group.findIndex((e) => e.id === edge.id);
  const mid = (group.length - 1) / 2;
  return (i - mid) * BOW_STEP;
}

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
    const dim = arrowDims(edge.w);
    const toEnd = headEnd(edgeEnds(current, edge.id), edge);

    const group = el("g", {
      class:
        "edge-group " +
        (edge.w === 2 ? "is-thick" : "is-thin") +
        (config.level.target === edge.id ? " is-target" : ""),
    });
    group.dataset.edge = edge.id;

    const line = el("path", { class: "edge-line", d: linePath(curve, toEnd, dim.len) });
    const arrow = el("path", { class: "edge-arrow", d: arrowPathFor(curve, toEnd, dim.len, dim.half) });
    const hit = el("path", { class: "edge-hit", d: curvePath(curve) });

    group.appendChild(line);
    group.appendChild(arrow);
    group.appendChild(hit);
    edgeLayer.appendChild(group);

    edgeViews.set(edge.id, { group, line, hit, arrow, curve, edge, dim });
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
    const { len, half } = view.dim;
    const fromT = headEnd(prevEnds, view.edge) === "B" ? 1 : 0;
    const toT = headEnd(nextEnds, view.edge) === "B" ? 1 : 0;
    const dirSign = toT > fromT ? 1 : -1;
    view.line.setAttribute("d", curvePath(c)); // full curve while the head glides
    const t0 = performance.now();
    function frame(now) {
      const k = Math.min(1, (now - t0) / REVERSAL_MS);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      view.arrow.setAttribute("d", arrowPathAtT(c, fromT + (toT - fromT) * e, dirSign, len, half));
      if (k < 1) requestAnimationFrame(frame);
      else {
        const head = toT === 1 ? "B" : "A";
        view.arrow.setAttribute("d", arrowPathFor(c, head, len, half));
        view.line.setAttribute("d", linePath(c, head, len));
      }
    }
    requestAnimationFrame(frame);
  }

  // Affordance on flippable edges; raise them so a tap lands on a legal edge.
  function markLegal(edgeIds) {
    const legal = new Set(edgeIds || []);
    for (const [id, view] of edgeViews) {
      view.group.classList.toggle("is-legal", legal.has(id));
    }
    for (const [id, view] of edgeViews) {
      if (legal.has(id)) edgeLayer.appendChild(view.group);
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

function computeViewBox(level) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of level.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  const pad = NODE_R + ARROW_MAX_LEN + BOW_STEP / 2 + 4;
  return `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
}
