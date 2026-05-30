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
const ARROW_MAX_LEN = 4.8; // longest arrowhead (thick) — for viewBox padding
const ENDPOINT_GAP = NODE_R + 0.8; // stop strokes short of the node ring
const BOW_STEP = 18; // perpendicular control-point offset between parallels
const MAX_BOW_SPAN_RATIO = 0.7;
const CURVE_LENGTH_SAMPLES = 24;
const MIN_VISIBLE_SHAFT = 1.6;
const REVERSAL_MS = 300; // arrow reversal animation duration
const ILLEGAL_EXPLAIN_MS = 2000;
const CHARGE_BADGE_R = 3.1;
const CHARGE_BADGE_OFFSET = 5.2;

// Respect the OS "reduce motion" setting for the JS rAF tweens below (CSS
// animations are neutralised by the @media block in styles.css).
const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Arrowhead size by edge weight: a thick (2) arrow gets a visibly bigger head —
// clearly wider than its own shaft (stroke 3.2) so weight reads at a glance.
function arrowDims(w) {
  return w === 2 ? { len: 4.8, half: 3.3 } : { len: 2.4, half: 1.35 };
}

function el(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

function reflow(node) {
  void node.getBoundingClientRect();
}

function cancelFrame(id) {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else clearTimeout(id);
}

function unit(dx, dy) {
  const L = Math.hypot(dx, dy) || 1;
  return [dx / L, dy / L];
}

// Curve locus: fixed by (u,v) positions + a perpendicular bow.
// The bow's perpendicular is taken in a CANONICAL node order (sorted ids), not
// edge.u->edge.v. Otherwise a 2-cycle's two opposite edges (u,v swapped) compute
// negated perpendiculars, so equal-and-opposite bows land on the SAME side and
// the arrows collapse into one blob. Canonical order makes them bow apart.
function edgeCurve(nodeById, edge, bow) {
  const A = nodeById.get(edge.u);
  const B = nodeById.get(edge.v);
  const P = edge.u < edge.v ? A : B;
  const Q = edge.u < edge.v ? B : A;
  const [ux, uy] = unit(Q.x - P.x, Q.y - P.y);
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

function qDerivative(c, t) {
  return [
    2 * (1 - t) * (c.cx - c.ax) + 2 * t * (c.bx - c.cx),
    2 * (1 - t) * (c.cy - c.ay) + 2 * t * (c.by - c.cy),
  ];
}

function curveLength(c, fromT = 0, toT = 1) {
  if (fromT === toT) return 0;
  let total = 0;
  let [px, py] = qPoint(c, fromT);
  for (let i = 1; i <= CURVE_LENGTH_SAMPLES; i++) {
    const t = fromT + ((toT - fromT) * i) / CURVE_LENGTH_SAMPLES;
    const [x, y] = qPoint(c, t);
    total += Math.hypot(x - px, y - py);
    px = x; py = y;
  }
  return total;
}

function tAtDistance(c, distance) {
  const total = curveLength(c);
  if (distance <= 0) return 0;
  if (distance >= total) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (curveLength(c, 0, mid) < distance) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function curveTrim(c) {
  const total = curveLength(c);
  const gap = Math.min(ENDPOINT_GAP, Math.max(0, (total - MIN_VISIBLE_SHAFT) / 2));
  return {
    total,
    gap,
    startT: tAtDistance(c, gap),
    endT: tAtDistance(c, total - gap),
  };
}

function subCurvePath(c, fromT, toT) {
  const [sx, sy] = qPoint(c, fromT);
  const [ex, ey] = qPoint(c, toT);
  const [dx, dy] = qDerivative(c, fromT);
  const span = (toT - fromT) / 2;
  return `M ${sx} ${sy} Q ${sx + dx * span} ${sy + dy * span} ${ex} ${ey}`;
}

function chargeBadgePoint(c) {
  const [x, y] = qPoint(c, 0.5);
  const [tx, ty] = qTangent(c, 0.5);
  return { x: x - ty * CHARGE_BADGE_OFFSET, y: y + tx * CHARGE_BADGE_OFFSET };
}

// Trimmed curve locus, used for the hit area and mid-animation.
function curvePath(c) {
  const trim = curveTrim(c);
  return subCurvePath(c, trim.startT, trim.endT);
}

// Visible line, pulled back at the HEAD end by the arrowhead length `len`.
function linePath(c, headEnd, len) {
  const trim = curveTrim(c);
  const tip = headEnd === "B" ? trim.total - trim.gap : trim.gap;
  const shaftRoom = trim.total - trim.gap * 2;
  const headPullback = Math.min(len, shaftRoom);
  if (headEnd === "B") {
    return subCurvePath(c, trim.startT, tAtDistance(c, tip - headPullback));
  }
  return subCurvePath(c, trim.endT, tAtDistance(c, tip + headPullback));
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
  const trim = curveTrim(c);
  const tipT = headEnd === "B" ? trim.endT : trim.startT;
  if (headEnd === "B") {
    const [tipX, tipY] = qPoint(c, tipT);
    const [dx, dy] = qTangent(c, tipT);
    return arrowTriangle(tipX, tipY, dx, dy, len, half);
  }
  const [tipX, tipY] = qPoint(c, tipT);
  const [tx, ty] = qTangent(c, tipT);
  return arrowTriangle(tipX, tipY, -tx, -ty, len, half);
}

function arrowPathAtT(c, t, dirSign, len, half) {
  const [tipX, tipY] = qPoint(c, t);
  const [tx, ty] = qTangent(c, t);
  return arrowTriangle(tipX, tipY, tx * dirSign, ty * dirSign, len, half);
}

function parallelBow(level, nodeById, edge) {
  const key = (e) => (e.u < e.v ? e.u + "|" + e.v : e.v + "|" + e.u);
  const k = key(edge);
  const group = level.edges.filter((e) => key(e) === k);
  if (group.length < 2) return 0;
  const i = group.findIndex((e) => e.id === edge.id);
  const mid = (group.length - 1) / 2;
  const rawBow = (i - mid) * BOW_STEP;
  const maxRawBow = Math.abs(mid * BOW_STEP) || BOW_STEP;
  const A = nodeById.get(edge.u);
  const B = nodeById.get(edge.v);
  const span = Math.hypot(B.x - A.x, B.y - A.y);
  const cap = span * MAX_BOW_SPAN_RATIO;
  return rawBow * Math.min(1, cap / maxRawBow);
}

function headEnd(ends, edge) {
  return ends.to === edge.v ? "B" : "A";
}

function isBattleConfig(config) {
  return config.owner instanceof Map && config.charges instanceof Map;
}

function setBattleFrame(svgEl, config) {
  const battle = isBattleConfig(config);
  svgEl.classList.toggle("is-battle", battle);
  if (battle) svgEl.dataset.turn = config.turn;
  else delete svgEl.dataset.turn;
}

function battleOwner(config, edgeId) {
  return config.owner.get(edgeId) ?? "neutral";
}

function battleCharges(config, edgeId) {
  return config.charges.get(edgeId) ?? 0;
}

function edgeControlLabel(config, edge) {
  const parts = [`Flip ${edge.w === 2 ? "thick" : "thin"} edge ${edge.id}`];
  if (config.level.target === edge.id) parts.push("target");
  if (config.level.targetB === edge.id) parts.push("black target");
  if (isBattleConfig(config)) {
    const owner = battleOwner(config, edge.id);
    parts.push(owner === "neutral" ? "neutral" : `${owner} owned`);
    parts.push(`${battleCharges(config, edge.id)} charges`);
  }
  return parts.join(", ");
}

function applyBattleEdgeState(config, edgeViews) {
  if (!isBattleConfig(config)) return;
  for (const [edgeId, view] of edgeViews) {
    const owner = battleOwner(config, edgeId);
    const charges = battleCharges(config, edgeId);
    view.group.dataset.owner = owner;
    view.group.dataset.charge = String(charges);
    view.group.classList.toggle("is-owner-white", owner === "white");
    view.group.classList.toggle("is-owner-black", owner === "black");
    view.group.classList.toggle("is-owner-neutral", owner === "neutral");
    view.group.classList.toggle("is-current-owner", owner !== "neutral" && owner === config.turn);
    view.group.classList.toggle("is-opponent", owner !== "neutral" && owner !== config.turn);
    view.group.classList.toggle("is-spent", charges === 0);
    if (view.chargeText) view.chargeText.textContent = String(charges);
    view.hit.setAttribute("aria-label", edgeControlLabel(config, view.edge));
  }
}

export function createBoard(svgEl, config, { onEdgeTap } = {}) {
  const nodeById = new Map(config.level.nodes.map((n) => [n.id, n]));
  let current = config;
  let destroyed = false;

  svgEl.classList.add("board");
  svgEl.classList.remove("is-won"); // reset win state; this <svg> is reused per lock
  svgEl.classList.remove("is-strike"); // and clear a strike flash that never finished (e.g. tab backgrounded mid-animation)
  setBattleFrame(svgEl, config);
  svgEl.setAttribute("viewBox", computeViewBox(config.level));
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

  const edgeLayer = el("g", { class: "edge-layer" });
  const nodeLayer = el("g", { class: "node-layer" });
  const explainLayer = el("g", { class: "illegal-explain-layer" });
  svgEl.appendChild(edgeLayer);
  svgEl.appendChild(nodeLayer);
  svgEl.appendChild(explainLayer);

  const edgeViews = new Map();
  const nodeViews = new Map();
  let illegalExplainTimer = null;
  let illegalExplainCleanup = null;
  let tapTimers = [];
  const pendingTimeouts = new Set();
  const pendingFrames = new Set();

  function scheduleTimeout(fn, delay) {
    if (destroyed) return null;
    const id = setTimeout(() => {
      pendingTimeouts.delete(id);
      if (!destroyed) fn();
    }, delay);
    pendingTimeouts.add(id);
    return id;
  }

  function clearScheduledTimeout(id) {
    if (id == null) return;
    clearTimeout(id);
    pendingTimeouts.delete(id);
  }

  function scheduleFrame(fn) {
    if (destroyed) return null;
    let id = null;
    let fired = false;
    id = requestAnimationFrame((now) => {
      if (id !== null) pendingFrames.delete(id);
      else fired = true;
      if (!destroyed) fn(now);
    });
    if (!fired) pendingFrames.add(id);
    return id;
  }

  function clearScheduledFrame(id) {
    if (id == null) return;
    cancelFrame(id);
    pendingFrames.delete(id);
  }

  function restartClassTracked(node, cls) {
    node.classList.remove(cls);
    reflow(node);
    scheduleFrame(() => node.classList.add(cls));
  }

  // --- Build edges -----------------------------------------------------------
  for (const edge of config.level.edges) {
    const curve = edgeCurve(nodeById, edge, parallelBow(config.level, nodeById, edge));
    const dim = arrowDims(edge.w);
    const toEnd = headEnd(edgeEnds(current, edge.id), edge);

    const group = el("g", {
      class:
        "edge-group " +
        (edge.w === 2 ? "is-thick" : "is-thin") +
        (config.level.target === edge.id ? " is-target" : "") +
        (config.level.targetB === edge.id ? " is-target-b" : ""),
    });
    group.dataset.edge = edge.id;

    const line = el("path", { class: "edge-line", d: linePath(curve, toEnd, dim.len) });
    const arrow = el("path", { class: "edge-arrow", d: arrowPathFor(curve, toEnd, dim.len, dim.half) });
    const hit = el("path", {
      class: "edge-hit",
      d: curvePath(curve),
      role: "button",
      tabindex: "0",
      "aria-label": edgeControlLabel(config, edge),
    });

    if (config.level.target === edge.id) {
      // Ghost marker: a faint DASHED RING around the GOAL node (the end the target
      // must point INTO after reversal) so the player sees where the bolt lands. A
      // ring reads as a destination, NOT a second arrowhead — the old arrowhead
      // ghost looked like a double-headed red arrow. Fades on win (.board.is-won).
      const goalNodeId = edge.dir === "uv" ? edge.u : edge.v;
      const gn = nodeById.get(goalNodeId);
      const ghost = el("circle", { class: "edge-ghost", cx: gn.x, cy: gn.y, r: NODE_R + 2.8 });
      group.appendChild(ghost);
    }
    group.appendChild(line);
    group.appendChild(arrow);
    let chargeText = null;
    if (isBattleConfig(config)) {
      const p = chargeBadgePoint(curve);
      const charge = el("g", { class: "edge-charge", transform: `translate(${p.x} ${p.y})` });
      const chargeBg = el("circle", { class: "edge-charge-bg", r: CHARGE_BADGE_R });
      chargeText = el("text", { class: "edge-charge-text", y: "0.45" });
      chargeText.textContent = String(battleCharges(config, edge.id));
      charge.appendChild(chargeBg);
      charge.appendChild(chargeText);
      group.appendChild(charge);
    }
    group.appendChild(hit);
    edgeLayer.appendChild(group);

    edgeViews.set(edge.id, { group, line, hit, arrow, chargeText, curve, edge, dim });
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
  applyBattleEdgeState(current, edgeViews);

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
        const timer = scheduleTimeout(() => {
          touched = false;
          tapTimers = tapTimers.filter((id) => id !== timer);
        }, 400);
        tapTimers.push(timer);
      },
      { passive: false }
    );
    target.addEventListener("click", () => {
      if (touched) return;
      handler();
    });
    target.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      handler();
    });
  }

  // --- Public view API -------------------------------------------------------

  function update(nextConfig) {
    if (destroyed) return;
    clearIllegalExplanation();
    setBattleFrame(svgEl, nextConfig);
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
    applyBattleEdgeState(current, edgeViews);
  }

  function animateReversal(view, prevEnds, nextEnds) {
    const c = view.curve;
    const { len, half } = view.dim;
    const trim = curveTrim(c);
    const fromT = headEnd(prevEnds, view.edge) === "B" ? trim.endT : trim.startT;
    const nextHead = headEnd(nextEnds, view.edge);
    const toT = nextHead === "B" ? trim.endT : trim.startT;
    if (prefersReducedMotion()) { // snap to the final orientation, no glide
      view.arrow.setAttribute("d", arrowPathFor(c, nextHead, len, half));
      view.line.setAttribute("d", linePath(c, nextHead, len));
      return;
    }
    const dirSign = toT > fromT ? 1 : -1;
    view.line.setAttribute("d", curvePath(c)); // full curve while the head glides
    const t0 = performance.now();
    function frame(now) {
      if (destroyed) return;
      const k = Math.min(1, (now - t0) / REVERSAL_MS);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      view.arrow.setAttribute("d", arrowPathAtT(c, fromT + (toT - fromT) * e, dirSign, len, half));
      if (k < 1) scheduleFrame(frame);
      else {
        view.arrow.setAttribute("d", arrowPathFor(c, nextHead, len, half));
        view.line.setAttribute("d", linePath(c, nextHead, len));
      }
    }
    scheduleFrame(frame);
  }

  // Affordance on flippable edges; raise them so a tap lands on a legal edge.
  function markLegal(edgeIds) {
    if (destroyed) return;
    const legal = new Set(edgeIds || []);
    for (const [id, view] of edgeViews) {
      view.group.classList.toggle("is-legal", legal.has(id));
    }
    for (const [id, view] of edgeViews) {
      if (legal.has(id)) edgeLayer.appendChild(view.group);
    }
  }

  function shakeEdge(edgeId) {
    if (destroyed) return;
    if (prefersReducedMotion()) return; // no animation => animationend never fires => class + listener would leak
    const view = edgeViews.get(edgeId);
    if (!view) return;
    restartClassTracked(view.group, "is-shaking");
    view.group.addEventListener(
      "animationend",
      () => view.group.classList.remove("is-shaking"),
      { once: true }
    );
  }

  function clearIllegalExplanation() {
    if (illegalExplainTimer) {
      clearScheduledTimeout(illegalExplainTimer);
      illegalExplainTimer = null;
    }
    if (!illegalExplainCleanup) return;
    illegalExplainCleanup();
    illegalExplainCleanup = null;
  }

  function explainIllegal(edgeId, nodeId, currentInflow, edgeWeight) {
    if (destroyed) return;
    clearIllegalExplanation();
    const edgeView = edgeViews.get(edgeId);
    const nodeView = nodeViews.get(nodeId);
    if (!edgeView || !nodeView) return;

    const edgePoint = chargeBadgePoint(edgeView.curve);
    const edgeExplain = el("g", {
      class: "illegal-explain illegal-explain-edge",
      transform: `translate(${edgePoint.x} ${edgePoint.y})`,
    });
    const edgeWeightText = el("text", {
      class: "illegal-explain-text illegal-explain-weight",
      y: "0.45",
    });
    edgeWeightText.textContent = String(edgeWeight);
    edgeExplain.appendChild(edgeWeightText);

    const nodePoint = nodeById.get(nodeId);
    const nodeExplain = el("g", {
      class: "illegal-explain illegal-explain-node",
      transform: `translate(${nodePoint.x} ${nodePoint.y})`,
    });
    const currentText = el("text", {
      class: "illegal-explain-text illegal-explain-current",
      x: "0",
      y: "-4.5",
    });
    currentText.textContent = String(currentInflow);
    const resultText = el("text", {
      class: "illegal-explain-text illegal-explain-result",
      x: "0",
      y: "6.0",
    });
    resultText.textContent = String(currentInflow - edgeWeight);
    const lowText = el("text", {
      class: "illegal-explain-text illegal-explain-low",
      x: "0",
      y: "10.5",
    });
    lowText.textContent = "< 2";
    nodeExplain.appendChild(currentText);
    nodeExplain.appendChild(resultText);
    nodeExplain.appendChild(lowText);

    edgeView.group.classList.add("is-illegal-edge");
    nodeView.group.classList.add("is-illegal-receiver");
    explainLayer.appendChild(nodeExplain);
    explainLayer.appendChild(edgeExplain);

    illegalExplainCleanup = () => {
      edgeView.group.classList.remove("is-illegal-edge");
      nodeView.group.classList.remove("is-illegal-receiver");
      if (nodeExplain.parentNode === explainLayer) explainLayer.removeChild(nodeExplain);
      if (edgeExplain.parentNode === explainLayer) explainLayer.removeChild(edgeExplain);
      svgEl.classList.remove("has-illegal-explain");
    };
    svgEl.classList.add("has-illegal-explain");
    illegalExplainTimer = scheduleTimeout(() => {
      illegalExplainTimer = null;
      clearIllegalExplanation();
    }, ILLEGAL_EXPLAIN_MS);
  }

  function pulseClass(nodeId, cls) {
    if (destroyed) return;
    if (prefersReducedMotion()) return; // see shakeEdge: suppressed animation would strand the class + leak the listener
    const view = nodeViews.get(nodeId);
    if (!view) return;
    restartClassTracked(view.group, cls);
    view.group.addEventListener(
      "animationend",
      () => view.group.classList.remove(cls),
      { once: true }
    );
  }

  // Neutral pulse for slack changes and blocked (illegal) taps. Distinct from the
  // win cascade: a duplicate CSS selector used to make EVERY pulse flash the win
  // colour (cyan), so an illegal tap looked like a solve.
  function pulse(nodeId) { pulseClass(nodeId, "is-pulsing"); }

  let cascadeTimers = []; // tracked so destroy() can cancel a cascade mid-flight
  function winCascade() {
    if (destroyed) return;
    svgEl.classList.add("is-won"); // win colour applies via .board.is-won regardless
    if (prefersReducedMotion()) return; // skip the staggered pulse cascade
    const order = cascadeOrder(current);
    // Clamp the per-node stagger so the whole cascade finishes within the
    // post-solve delay even on big boards (a fixed 90ms overran and got cut off).
    const step = Math.min(90, Math.floor(360 / Math.max(1, order.length - 1)));
    order.forEach((nodeId, i) => cascadeTimers.push(scheduleTimeout(() => pulseClass(nodeId, "is-win-pulsing"), i * step)));
  }

  // Brief red flash + shake on the whole board when a life is lost — the most
  // consequential event should be the most felt (previously it had no board cue).
  function strikeFlash() {
    if (destroyed) return;
    if (prefersReducedMotion()) return; // suppressed animation would strand .is-strike + leak the listener
    restartClassTracked(svgEl, "is-strike");
    // animationend BUBBLES: a node/edge child's own animation must not strip
    // .is-strike early, so match e.target and unbind by hand (not {once}, which a
    // bubbled child event would consume).
    const onEnd = (e) => {
      if (e.target !== svgEl) return;
      svgEl.classList.remove("is-strike");
      svgEl.removeEventListener("animationend", onEnd);
    };
    svgEl.addEventListener("animationend", onEnd);
  }

  // Drop the win styling (target back to red, ghost back) without rebuilding —
  // for an in-place reset() after a win.
  function clearWin() {
    svgEl.classList.remove("is-won");
  }

  // Cancel any in-flight win-cascade timers — called before a rebuild / on
  // teardown so late pulses don't fire against the next board's nodes.
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    tapTimers.forEach(clearTimeout);
    tapTimers = [];
    clearIllegalExplanation();
    cascadeTimers.forEach(clearScheduledTimeout);
    cascadeTimers = [];
    for (const id of pendingTimeouts) clearScheduledTimeout(id);
    for (const id of pendingFrames) clearScheduledFrame(id);
    pendingTimeouts.clear();
    pendingFrames.clear();
    clearWin();
    svgEl.classList.remove("is-strike");
    for (const view of edgeViews.values()) view.group.classList.remove("is-shaking", "is-legal", "is-illegal-edge");
    for (const view of nodeViews.values()) view.group.classList.remove("is-pulsing", "is-win-pulsing", "is-illegal-receiver", "is-tight");
  }

  return { update, markLegal, shakeEdge, pulseNode: pulse, explainIllegal, winCascade, clearWin, strikeFlash, destroy };
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
