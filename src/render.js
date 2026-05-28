// THE LOCK — SVG rendering. Builds the board, animates per-move updates.
//
// Pure presentation: it reads the engine's derived state (edgeEnds, nodeSlack)
// and draws it. No game logic lives here. All colour/theming is expressed via
// CSS classes (see styles.css); this module only sets geometry, class names,
// and a few CSS custom properties the stylesheet consumes.
//
// CSS contract (classes/vars styles.css must define):
//   .board                          root <svg>
//   .edge-group                     <g> wrapping one edge (line + hit area + arrow)
//     [data-edge]                   edge id (for hit-testing / queries)
//     .is-thick / .is-thin         weight 2 vs weight 1
//     .is-target                    the red target edge
//     .is-legal                     currently flippable (set by markLegal)
//     .is-shaking                   transient illegal-tap shake
//   .edge-line                      the visible stroke
//   .edge-hit                       fat transparent hit area (stroke, no fill)
//   .edge-arrow                     arrowhead <path>
//   .node-group                     <g> wrapping one node
//     [data-node]                   node id
//     .is-tight                     slack === 0 (strained/locked look)
//     .is-pulsing                   transient pulse
//     --slack                       numeric slack (0,1,2,...) for glow scaling
//   .node-glow                      outer slack glow ring
//   .node-ring                      the node ring itself
//   .board.is-won                   set during the win cascade
//
// Animation is done by toggling classes (CSS transitions/keyframes) plus SVG
// geometry interpolation for the arrow reversal. Re-adding a keyframe class
// requires a reflow between removal and re-add; helpers below handle that.

import { edgeEnds, nodeSlack } from "./engine.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Visual constants kept here are *geometry*, not colour. Colour/strokes/glow
// intensity belong to CSS. These describe layout in viewBox units.
const NODE_R = 3.2; // node ring radius (viewBox units)
const ARROW_LEN = 2.6; // arrowhead length along the edge
const ARROW_HALF = 1.6; // arrowhead half-width
const PARALLEL_GAP = 2.0; // perpendicular offset between parallel edges
const ENDPOINT_GAP = NODE_R + 0.6; // stop strokes short of the node ring
const REVERSAL_MS = 280; // arrow reversal animation duration

function el(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

// Force a style/layout flush so a just-removed keyframe class re-triggers.
function reflow(node) {
  // Reading a layout property is enough to flush pending class changes.
  void node.getBoundingClientRect();
}

// Restart a one-shot animation class: remove, reflow, re-add on next frame.
function restartClass(node, cls) {
  node.classList.remove(cls);
  reflow(node);
  // rAF guards against batching when several restarts happen in one tick.
  requestAnimationFrame(() => node.classList.add(cls));
}

// Geometry for one edge in its current orientation. Parallel edges (same node
// pair) are pushed apart along the perpendicular so both stay tappable.
function edgeGeometry(config, edge, ends, offset) {
  const nodeById = config.__nodeById;
  const a = nodeById.get(ends.from);
  const b = nodeById.get(ends.to);

  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len; // unit vector from -> to
  const uy = dy / len;
  const px = -uy; // perpendicular unit
  const py = ux;

  const ox = px * offset;
  const oy = py * offset;

  // Trim both ends so the stroke meets the ring, not the centre.
  const x1 = a.x + ux * ENDPOINT_GAP + ox;
  const y1 = a.y + uy * ENDPOINT_GAP + oy;
  const x2 = b.x - ux * ENDPOINT_GAP + ox;
  const y2 = b.y - uy * ENDPOINT_GAP + oy;

  return { x1, y1, x2, y2, ux, uy, px, py };
}

// Build the arrowhead path (a filled triangle) at the `to` end of a segment.
function arrowPath(g) {
  const tipX = g.x2;
  const tipY = g.y2;
  const baseX = tipX - g.ux * ARROW_LEN;
  const baseY = tipY - g.uy * ARROW_LEN;
  const leftX = baseX + g.px * ARROW_HALF;
  const leftY = baseY + g.py * ARROW_HALF;
  const rightX = baseX - g.px * ARROW_HALF;
  const rightY = baseY - g.py * ARROW_HALF;
  return `M ${tipX} ${tipY} L ${leftX} ${leftY} L ${rightX} ${rightY} Z`;
}

// Among all edges sharing this unordered node pair, return a signed offset for
// `edge` so parallels are symmetric about the centre line. Single edges get 0.
function parallelOffset(level, edge) {
  const key = (e) => (e.u < e.v ? e.u + "|" + e.v : e.v + "|" + e.u);
  const k = key(edge);
  const group = level.edges.filter((e) => key(e) === k);
  if (group.length < 2) return 0;
  const i = group.findIndex((e) => e.id === edge.id);
  // Center the group: offsets ..., -gap, 0, +gap, ... around the midpoint.
  const mid = (group.length - 1) / 2;
  return (i - mid) * PARALLEL_GAP;
}

export function createBoard(svgEl, config, { onEdgeTap } = {}) {
  // Index nodes once; stash on config-shaped lookup we own (not the frozen one).
  const nodeById = new Map(config.level.nodes.map((n) => [n.id, n]));
  // Local view state, never mutating the engine config.
  let current = withIndex(config, nodeById);

  svgEl.classList.add("board");
  // Portrait viewBox derived from node extents with padding.
  svgEl.setAttribute("viewBox", computeViewBox(config.level));
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
  // Clear any prior content (idempotent re-create).
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

  // Two layers: edges beneath nodes so rings sit on top of strokes.
  const edgeLayer = el("g", { class: "edge-layer" });
  const nodeLayer = el("g", { class: "node-layer" });
  svgEl.appendChild(edgeLayer);
  svgEl.appendChild(nodeLayer);

  const edgeViews = new Map(); // edgeId -> { group, line, hit, arrow, offset }
  const nodeViews = new Map(); // nodeId -> { group, glow, ring, label }

  // --- Build edges -----------------------------------------------------------
  for (const edge of config.level.edges) {
    const offset = parallelOffset(config.level, edge);
    const ends = edgeEnds(current, edge.id);
    const geo = edgeGeometry(current, edge, ends, offset);

    const group = el("g", {
      class:
        "edge-group " +
        (edge.w === 2 ? "is-thick" : "is-thin") +
        (config.level.target === edge.id ? " is-target" : ""),
    });
    group.dataset.edge = edge.id;

    const line = el("line", {
      class: "edge-line",
      x1: geo.x1,
      y1: geo.y1,
      x2: geo.x2,
      y2: geo.y2,
    });
    const arrow = el("path", { class: "edge-arrow", d: arrowPath(geo) });
    // Fat invisible hit area on top for generous tap/click targets.
    const hit = el("line", {
      class: "edge-hit",
      x1: geo.x1,
      y1: geo.y1,
      x2: geo.x2,
      y2: geo.y2,
    });

    group.appendChild(line);
    group.appendChild(arrow);
    group.appendChild(hit);
    edgeLayer.appendChild(group);

    edgeViews.set(edge.id, { group, line, hit, arrow, offset });

    bindTap(hit, () => onEdgeTap && onEdgeTap(edge.id));
  }

  // --- Build nodes -----------------------------------------------------------
  for (const node of config.level.nodes) {
    const group = el("g", { class: "node-group" });
    group.dataset.node = node.id;
    group.setAttribute("transform", `translate(${node.x} ${node.y})`);

    // Glow sits behind the ring; CSS scales it via --slack.
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
        e.preventDefault(); // avoid the synthetic click that follows
        handler();
        // reset the guard after the would-be click window
        setTimeout(() => (touched = false), 400);
      },
      { passive: false }
    );
    target.addEventListener("click", () => {
      if (touched) return; // already handled by touchend
      handler();
    });
  }

  // --- Public view API -------------------------------------------------------

  // Re-render to a new config: animate arrow reversals, pulse changed nodes.
  function update(nextConfig) {
    const next = withIndex(nextConfig, nodeById);

    for (const edge of next.level.edges) {
      const view = edgeViews.get(edge.id);
      const prevEnds = edgeEnds(current, edge.id);
      const nextEnds = edgeEnds(next, edge.id);
      const reversed =
        prevEnds.from !== nextEnds.from || prevEnds.to !== nextEnds.to;
      if (reversed) {
        animateReversal(view, next, edge);
      }
    }

    // Pulse nodes whose slack changed; always refresh slack state.
    for (const node of next.level.nodes) {
      const before = nodeSlack(current, node.id);
      const after = nodeSlack(next, node.id);
      if (before !== after) pulse(node.id);
    }

    current = next;
    applyNodeState(current, nodeViews);
  }

  function animateReversal(view, next, edge) {
    const startGeo = edgeGeometry(current, edge, edgeEnds(current, edge.id), view.offset);
    const endGeo = edgeGeometry(next, edge, edgeEnds(next, edge.id), view.offset);

    const t0 = performance.now();
    function frame(now) {
      const k = Math.min(1, (now - t0) / REVERSAL_MS);
      // Ease in/out for a deliberate, mechanical "lock turning" feel.
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const x1 = startGeo.x1 + (endGeo.x1 - startGeo.x1) * e;
      const y1 = startGeo.y1 + (endGeo.y1 - startGeo.y1) * e;
      const x2 = startGeo.x2 + (endGeo.x2 - startGeo.x2) * e;
      const y2 = startGeo.y2 + (endGeo.y2 - startGeo.y2) * e;
      const g = { x1, y1, x2, y2, ux: endGeo.ux, uy: endGeo.uy, px: endGeo.px, py: endGeo.py };
      view.line.setAttribute("x1", x1);
      view.line.setAttribute("y1", y1);
      view.line.setAttribute("x2", x2);
      view.line.setAttribute("y2", y2);
      view.hit.setAttribute("x1", x1);
      view.hit.setAttribute("y1", y1);
      view.hit.setAttribute("x2", x2);
      view.hit.setAttribute("y2", y2);
      view.arrow.setAttribute("d", arrowPath(g));
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Subtle affordance on currently-flippable edges.
  function markLegal(edgeIds) {
    const legal = new Set(edgeIds || []);
    for (const [id, view] of edgeViews) {
      view.group.classList.toggle("is-legal", legal.has(id));
    }
  }

  // Short shake + (caller typically) pulses the blocking node.
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

  // Restrained win cascade: nodes pulse outward in waves from the target edge.
  function winCascade() {
    svgEl.classList.add("is-won");
    const order = cascadeOrder(current);
    order.forEach((nodeId, i) => {
      setTimeout(() => pulse(nodeId), i * 90);
    });
  }

  return { update, markLegal, shakeEdge, pulseNode: pulse, winCascade };
}

// --- helpers operating on a config + our node index --------------------------

// Attach our own node index without mutating the frozen engine config.
function withIndex(config, nodeById) {
  if (config.__nodeById) return config;
  return Object.assign(Object.create(Object.getPrototypeOf(config)), config, {
    __nodeById: nodeById,
  });
}

// Set per-node slack class + the --slack custom property for the glow.
function applyNodeState(config, nodeViews) {
  for (const [id, view] of nodeViews) {
    const slack = nodeSlack(config, id);
    view.group.classList.toggle("is-tight", slack === 0);
    view.group.style.setProperty("--slack", String(slack));
  }
}

// Cascade order for the win: start at the target's endpoints, BFS outward over
// the incidence graph so the pulse radiates from the lock.
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
  // Any disconnected leftovers pulse last.
  for (const n of level.nodes) if (!seen.has(n.id)) order.push(n.id);
  return order;
}

// Portrait viewBox sized to node extents with uniform padding for glow/arrows.
function computeViewBox(level) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of level.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  const pad = NODE_R + ARROW_LEN + 4;
  const x = minX - pad;
  const y = minY - pad;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  return `${x} ${y} ${w} ${h}`;
}
