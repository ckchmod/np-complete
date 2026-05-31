import * as THREE_DEFAULT from "../lib/three.module.min.js";
import { edgeEnds, nodeSlack } from "./engine.js";

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 640;
const CAMERA_FOV = 45;
const CAMERA_FIT_PADDING = 2.5;
const MIN_CAMERA_ZOOM = 0.75;
const MAX_CAMERA_ZOOM = 2.2;
const CAMERA_ZOOM_STEP = 0.2;
const DEFAULT_CAMERA_ZOOM = 1.15;
const BOARD_WIDTH = 100;
const BOARD_HEIGHT = 160;
const MAX_LONGITUDE = Math.PI / 4;
const MAX_LATITUDE = Math.PI / 4;
const NODE_SURFACE_RADIUS = 12;
const NODE_MESH_RADIUS = 0.32;
const NODE_WIDTH_SEGMENTS = 12;
const NODE_HEIGHT_SEGMENTS = 8;
const NODE_DRAG_SCALE = 1.35;
const RELAXED_NODE_MIN_DISTANCE = NODE_MESH_RADIUS * 3;
const RELAXATION_ITERATIONS = 24;
const RELAXATION_PUSH = 0.55;
const RELAXATION_EDGE_PULL = 0.35;
const RELAXATION_ANCHOR_PULL = 0.04;
const RELAXATION_EDGE_STRETCH = 1.25;
const RELAXATION_EDGE_MARGIN = 0.65;
const NODE_FRONT_OPACITY = 1.0;
const NODE_BACK_OPACITY = 0.3;
const EDGE_FRONT_OPACITY = 1.0;
const EDGE_BACK_OPACITY = 0.6;
const SPHERE_SURFACE_RADIUS = NODE_SURFACE_RADIUS - 0.18;
const SPHERE_SURFACE_COLOR = 0x07090f;
const SPHERE_SURFACE_WIDTH_SEGMENTS = 48;
const SPHERE_SURFACE_HEIGHT_SEGMENTS = 24;
const SPHERE_WIREFRAME_COLOR = 0x77777f;
const SPHERE_WIREFRAME_OPACITY = 0.22;
const SPHERE_WIREFRAME_DETAIL = 1;
const SPHERE_WIREFRAME_RADIUS = NODE_SURFACE_RADIUS + 0.02;
const NODE_COLORS = Object.freeze({
  default: 0xe8e8ec,
  target: 0xff3333,
  slack: 0xffaa00,
});
const EDGE_COLORS = Object.freeze({
  default: 0xd8d8de,
  target: 0xff3333,
});
const EDGE_LEGAL_COLOR = 0x00d4ff;
const EDGE_RADIUS_BY_WEIGHT = Object.freeze({
  1: 0.1,
  2: 0.2,
});
const EDGE_HIT_RADIUS = 0.42;
const EDGE_ARC_SEGMENTS = 16;
const EDGE_RADIAL_SEGMENTS = 6;
const ARROWHEAD_RADIUS = 0.32;
const ARROWHEAD_HEIGHT = 0.72;
const ARROWHEAD_SEGMENTS = 8;
const ARROWHEAD_T = 0.88;
const DRAG_ROTATION_SPEED = 0.006;
const ROTATION_DAMPING = 0.82;
const ROTATION_STOP_EPSILON = 0.0001;
const TAP_MOVE_TOLERANCE = 5;
const TAP_TIME_TOLERANCE = 300;
const EDGE_SHAKE_DURATION_MS = 350;
const EDGE_SHAKE_AMPLITUDE = 0.36;
const EDGE_SHAKE_CYCLES = 3;
const NODE_PULSE_DURATION_MS = 450;
const NODE_PULSE_SCALE = 1.45;
const DEFAULT_TARGET_VIEW = normalizeToRadius({ x: 1.6, y: 1.1, z: NODE_SURFACE_RADIUS }, NODE_SURFACE_RADIUS);

export function projectToSphere(x, y, radius) {
  const longitude = ((x - BOARD_WIDTH / 2) / (BOARD_WIDTH / 2)) * MAX_LONGITUDE;
  const latitude = ((BOARD_HEIGHT / 2 - y) / (BOARD_HEIGHT / 2)) * MAX_LATITUDE;
  const horizontal = radius * Math.cos(latitude);

  return {
    x: horizontal * Math.sin(longitude),
    y: radius * Math.sin(latitude),
    z: horizontal * Math.cos(longitude),
  };
}

function readMountSize(mount) {
  const rect = typeof mount?.getBoundingClientRect === "function" ? mount.getBoundingClientRect() : null;
  const width = rect?.width || mount?.clientWidth || DEFAULT_WIDTH;
  const height = rect?.height || mount?.clientHeight || DEFAULT_HEIGHT;
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

function readPixelRatio() {
  return Math.min(2, Math.max(1, globalThis.window?.devicePixelRatio || 1));
}

function isDocumentHidden() {
  return globalThis.document?.hidden === true || globalThis.document?.visibilityState === "hidden";
}

function prefersReducedMotion() {
  if (typeof globalThis.window?.matchMedia !== "function") return false;
  try {
    return Boolean(globalThis.window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}

function scheduleAnimation(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    let synchronous = true;
    let deferred = null;
    const id = globalThis.requestAnimationFrame((time) => {
      if (synchronous && typeof globalThis.setTimeout === "function") {
        deferred = globalThis.setTimeout(() => {
          deferred = null;
          callback(time);
        }, 0);
        deferred.unref?.();
        return;
      }
      callback(time);
    });
    synchronous = false;
    return { kind: "raf", id, deferred };
  }

  const id = globalThis.setTimeout(callback, 16);
  id.unref?.();
  return { kind: "timeout", id, deferred: null };
}

function cancelAnimation(frame) {
  if (!frame) return;
  if (frame.deferred !== null) globalThis.clearTimeout(frame.deferred);
  if (frame.kind === "raf" && typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(frame.id);
    return;
  }
  if (frame.kind === "timeout") globalThis.clearTimeout(frame.id);
}

function removeCanvas(mount, canvas) {
  const attachedToMount = canvas?.parentNode === mount || canvas?._parent === mount || mount?.children?.includes?.(canvas);
  if (attachedToMount && typeof mount.removeChild === "function") mount.removeChild(canvas);
}

function removeElement(mount, element) {
  const attachedToMount = element?.parentNode === mount || element?._parent === mount || mount?.children?.includes?.(element);
  if (attachedToMount && typeof mount.removeChild === "function") mount.removeChild(element);
}

function setAttribute(element, name, value) {
  if (typeof element?.setAttribute === "function") element.setAttribute(name, value);
  else if (element) element[name] = value;
}

function setButtonDisabled(button, disabled) {
  if (!button) return;
  button.disabled = disabled;
  setAttribute(button, "aria-disabled", String(disabled));
}

function setFallbackStyle(element, styles) {
  if (!element?.style) return;
  for (const [name, value] of Object.entries(styles)) {
    if (typeof element.style.setProperty === "function") element.style.setProperty(name, value);
    else element.style[name] = value;
  }
}

function isSvgMount(mount) {
  return String(mount?.tagName || mount?.nodeName || "").toLowerCase() === "svg";
}

function createElement(tagName) {
  if (typeof globalThis.document?.createElement === "function") return globalThis.document.createElement(tagName);
  return null;
}

function createSvgElement(tagName) {
  if (typeof globalThis.document?.createElementNS === "function") {
    return globalThis.document.createElementNS("http://www.w3.org/2000/svg", tagName);
  }
  return null;
}

function hasInjectedThree(options) {
  return Boolean(options.THREE || globalThis.__THE_LOCK_RENDER3D_THREE__);
}

function cameraFitDistance(size, fov = CAMERA_FOV, radius = NODE_SURFACE_RADIUS + CAMERA_FIT_PADDING) {
  const aspect = Math.max(0.01, (size?.width || DEFAULT_WIDTH) / (size?.height || DEFAULT_HEIGHT));
  const verticalHalfAngle = (fov * Math.PI) / 360;
  const limitingScale = Math.min(1, aspect);
  return radius / (Math.tan(verticalHalfAngle) * limitingScale);
}

function canCreateWebGLContext(options = {}) {
  if (typeof options.webglAvailable === "boolean") return options.webglAvailable;
  if (typeof options.isWebGLAvailable === "function") {
    try {
      return Boolean(options.isWebGLAvailable());
    } catch {
      return false;
    }
  }
  if (hasInjectedThree(options)) return true;

  const canvas = createElement("canvas");
  if (!canvas || typeof canvas.getContext !== "function") return false;

  try {
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

function createFallbackContent() {
  const content = createElement("div");
  if (!content) return null;

  const title = createElement("h2");
  const copy = createElement("p");

  setAttribute(content, "class", "board-webgl-error");
  setAttribute(content, "role", "status");
  setAttribute(content, "aria-live", "polite");
  setAttribute(content, "aria-label", "3D graphics unavailable");
  setFallbackStyle(content, {
    "display": "flex",
    "flex-direction": "column",
    "align-items": "center",
    "justify-content": "center",
    "gap": "var(--space-3)",
    "width": "100%",
    "height": "100%",
    "min-height": "100%",
    "padding": "var(--space-6)",
    "border": "var(--panel-border)",
    "border-radius": "var(--radius-lg)",
    "background": "var(--bg-surface)",
    "color": "var(--c-white)",
    "font-family": "var(--font-mono)",
    "text-align": "center",
    "touch-action": "manipulation",
  });

  if (title) {
    title.textContent = "3D Graphics Unavailable";
    setFallbackStyle(title, {
      "color": "var(--c-target)",
      "font-family": "var(--font-label)",
      "font-size": "var(--text-xl)",
      "letter-spacing": "0.12em",
      "text-transform": "uppercase",
      "text-wrap": "balance",
    });
    content.appendChild(title);
  }

  if (copy) {
    copy.textContent = "WebGL/3D graphics are unavailable on this browser or device. Try another browser, update graphics settings, or use a different device.";
    setFallbackStyle(copy, {
      "max-width": "32ch",
      "color": "var(--c-grey)",
      "font-size": "var(--text-md)",
      "line-height": "1.5",
      "overflow-wrap": "break-word",
      "text-wrap": "pretty",
    });
    content.appendChild(copy);
  }

  return content;
}

function createWebGLErrorElement(mount) {
  const content = createFallbackContent();
  if (!content) return null;

  if (isSvgMount(mount)) {
    const wrapper = createSvgElement("foreignObject");
    if (!wrapper) return content;
    setAttribute(wrapper, "class", "board-webgl-error-wrap");
    setAttribute(wrapper, "x", "0");
    setAttribute(wrapper, "y", "0");
    setAttribute(wrapper, "width", "100%");
    setAttribute(wrapper, "height", "100%");
    wrapper.appendChild(content);
    return wrapper;
  }

  return content;
}

function createFallbackBoard(mount, config) {
  let current = config;
  let destroyed = false;
  const legalEdges = new Set();
  const errorElement = createWebGLErrorElement(mount);

  if (errorElement && typeof mount?.appendChild === "function") mount.appendChild(errorElement);

  return {
    scene: null,
    graphRoot: null,
    camera: null,
    renderer: null,
    errorElement,
    webglAvailable: false,
    update(nextConfig) {
      if (!destroyed) current = nextConfig;
    },
    markLegal(edgeIds) {
      if (destroyed) return;
      legalEdges.clear();
      for (const edgeId of edgeIds || []) legalEdges.add(edgeId);
    },
    shakeEdge() {},
    pulseNode() {},
    focusEdge() {
      return false;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (errorElement) removeCanvas(mount, errorElement);
    },
    get config() {
      return current;
    },
    get legalEdges() {
      return new Set(legalEdges);
    },
    get edgeMeshes() {
      return new Map();
    },
    get nodeMeshes() {
      return new Map();
    },
  };
}

function disposeMesh(mesh) {
  mesh.geometry?.dispose?.();
  if (Array.isArray(mesh.material)) {
    for (const material of mesh.material) material.dispose?.();
  } else {
    mesh.material?.dispose?.();
  }
}

function disposeObject(object) {
  object.traverse?.((child) => {
    if (child?.geometry || child?.material) disposeMesh(child);
  });
}

function targetReceiver(config) {
  return config?.level?.target ? edgeEnds(config, config.level.target).to : null;
}

function nodeColor(config, nodeId) {
  if (nodeId === targetReceiver(config)) return NODE_COLORS.target;
  return nodeSlack(config, nodeId) > 0 ? NODE_COLORS.slack : NODE_COLORS.default;
}

function edgeColor(config, edgeId) {
  return edgeId === config.level.target ? EDGE_COLORS.target : EDGE_COLORS.default;
}

function edgeRadius(edge) {
  return EDGE_RADIUS_BY_WEIGHT[edge.w] || EDGE_RADIUS_BY_WEIGHT[1];
}

function magnitude(point) {
  return Math.hypot(point.x, point.y, point.z) || 1;
}

function normalizeToRadius(point, radius) {
  const scale = radius / magnitude(point);
  return { x: point.x * scale, y: point.y * scale, z: point.z * scale };
}

function normalizePoint(point) {
  return normalizeToRadius(point, 1);
}

function dotPoints(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function crossPoints(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function slerpOnSphere(from, to, t, radius) {
  const fromLength = magnitude(from);
  const toLength = magnitude(to);
  const dot = (from.x * to.x + from.y * to.y + from.z * to.z) / (fromLength * toLength);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

  if (angle < 1e-9) {
    return normalizeToRadius(
      {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
      },
      radius
    );
  }

  const sinAngle = Math.sin(angle);
  const fromWeight = Math.sin((1 - t) * angle) / sinAngle;
  const toWeight = Math.sin(t * angle) / sinAngle;
  return {
    x: from.x * fromWeight + to.x * toWeight,
    y: from.y * fromWeight + to.y * toWeight,
    z: from.z * fromWeight + to.z * toWeight,
  };
}

function createArcPoints(from, to, radius) {
  const points = [];
  for (let index = 0; index <= EDGE_ARC_SEGMENTS; index += 1) {
    points.push(slerpOnSphere(from, to, index / EDGE_ARC_SEGMENTS, radius));
  }
  return points;
}

function clonePoint(point) {
  return { x: point.x, y: point.y, z: point.z };
}

function pointDistance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function shiftedOnSphere(point, direction, amount, radius) {
  return normalizeToRadius(
    {
      x: point.x + direction.x * amount,
      y: point.y + direction.y * amount,
      z: point.z + direction.z * amount,
    },
    radius
  );
}

function tangentBasis(point) {
  const normal = normalizePoint(point);
  const seed = Math.abs(normal.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const first = normalizePoint(crossPoints(seed, normal));
  const second = normalizePoint(crossPoints(normal, first));
  return { first, second };
}

function deterministicTangentDirection(point, leftIndex, rightIndex) {
  const basis = tangentBasis(point);
  const turn = ((leftIndex + 1) * 17 + (rightIndex + 1) * 31) % 8;
  const angle = (turn / 8) * Math.PI * 2;
  return normalizePoint({
    x: basis.first.x * Math.cos(angle) + basis.second.x * Math.sin(angle),
    y: basis.first.y * Math.cos(angle) + basis.second.y * Math.sin(angle),
    z: basis.first.z * Math.cos(angle) + basis.second.z * Math.sin(angle),
  });
}

function separationDirection(from, to, leftIndex, rightIndex) {
  const delta = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const length = Math.hypot(delta.x, delta.y, delta.z);
  if (length > 1e-9) return { x: delta.x / length, y: delta.y / length, z: delta.z / length };
  return deterministicTangentDirection(from, leftIndex, rightIndex);
}

function relaxClosePairs(nodes, positions, radius) {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const leftId = nodes[leftIndex].id;
      const rightId = nodes[rightIndex].id;
      const left = positions.get(leftId);
      const right = positions.get(rightId);
      const distance = pointDistance(left, right);
      if (distance >= RELAXED_NODE_MIN_DISTANCE) continue;

      const direction = separationDirection(left, right, leftIndex, rightIndex);
      const amount = (RELAXED_NODE_MIN_DISTANCE - distance) * RELAXATION_PUSH;
      positions.set(leftId, shiftedOnSphere(left, direction, -amount / 2, radius));
      positions.set(rightId, shiftedOnSphere(right, direction, amount / 2, radius));
    }
  }
}

function relaxLongEdges(level, positions, rawPositions, radius) {
  for (const edge of level.edges || []) {
    const from = positions.get(edge.u);
    const to = positions.get(edge.v);
    const rawFrom = rawPositions.get(edge.u);
    const rawTo = rawPositions.get(edge.v);
    if (!from || !to || !rawFrom || !rawTo) continue;

    const distance = pointDistance(from, to);
    const rawDistance = pointDistance(rawFrom, rawTo);
    const maxDistance = Math.max(
      rawDistance * RELAXATION_EDGE_STRETCH,
      rawDistance + RELAXATION_EDGE_MARGIN,
      RELAXED_NODE_MIN_DISTANCE * 1.2
    );
    if (distance <= maxDistance) continue;

    const direction = separationDirection(from, to, 0, 1);
    const amount = (distance - maxDistance) * RELAXATION_EDGE_PULL;
    positions.set(edge.u, shiftedOnSphere(from, direction, amount / 2, radius));
    positions.set(edge.v, shiftedOnSphere(to, direction, -amount / 2, radius));
  }
}

function pullTowardRaw(nodes, positions, rawPositions, radius) {
  for (const node of nodes) {
    const position = positions.get(node.id);
    const raw = rawPositions.get(node.id);
    if (!position || !raw) continue;
    positions.set(node.id, slerpOnSphere(position, raw, RELAXATION_ANCHOR_PULL, radius));
  }
}

export function relaxProjectedNodes(level, radius = NODE_SURFACE_RADIUS) {
  const nodes = level?.nodes || [];
  const rawPositions = new Map(nodes.map((node) => [node.id, projectToSphere(node.x, node.y, radius)]));
  const positions = new Map([...rawPositions].map(([nodeId, position]) => [nodeId, clonePoint(position)]));

  if (nodes.length < 2) return positions;

  for (let iteration = 0; iteration < RELAXATION_ITERATIONS; iteration += 1) {
    relaxClosePairs(nodes, positions, radius);
    relaxLongEdges(level, positions, rawPositions, radius);
    pullTowardRaw(nodes, positions, rawPositions, radius);
  }

  relaxClosePairs(nodes, positions, radius);
  for (const [nodeId, position] of positions) positions.set(nodeId, normalizeToRadius(position, radius));
  return positions;
}

function toVector3(THREE, point) {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function createArcPath(THREE, points) {
  const vectors = points.map((point) => toVector3(THREE, point));
  if (typeof THREE.CatmullRomCurve3 === "function") return new THREE.CatmullRomCurve3(vectors);

  return {
    type: "GreatCircleArcPath",
    points: vectors,
    getPoint(t) {
      const clamped = Math.max(0, Math.min(1, t));
      const scaled = clamped * (vectors.length - 1);
      const startIndex = Math.floor(scaled);
      const endIndex = Math.min(vectors.length - 1, startIndex + 1);
      const localT = scaled - startIndex;
      const start = vectors[startIndex];
      const end = vectors[endIndex];
      return toVector3(THREE, {
        x: start.x + (end.x - start.x) * localT,
        y: start.y + (end.y - start.y) * localT,
        z: start.z + (end.z - start.z) * localT,
      });
    },
  };
}

function createSphereSurface(THREE) {
  const geometry = new THREE.SphereGeometry(SPHERE_SURFACE_RADIUS, SPHERE_SURFACE_WIDTH_SEGMENTS, SPHERE_SURFACE_HEIGHT_SEGMENTS);
  const material = new THREE.MeshBasicMaterial({
    color: SPHERE_SURFACE_COLOR,
    transparent: false,
    opacity: 1,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geometry, material);

  material.transparent = false;
  material.opacity = 1;
  material.depthWrite = true;
  material.wireframe = false;
  mesh.name = "sphere-surface";
  mesh.renderOrder = -2;
  mesh.userData = { ...mesh.userData, kind: "sphere-surface", interactive: false, raycast: false };
  return mesh;
}

function createSphereWireframe(THREE) {
  const geometry = new THREE.IcosahedronGeometry(SPHERE_WIREFRAME_RADIUS, SPHERE_WIREFRAME_DETAIL);
  const material = new THREE.MeshBasicMaterial({
    color: SPHERE_WIREFRAME_COLOR,
    transparent: true,
    opacity: SPHERE_WIREFRAME_OPACITY,
    wireframe: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);

  material.wireframe = true;
  material.depthWrite = false;
  mesh.name = "sphere-wireframe";
  mesh.renderOrder = -1;
  mesh.userData = { ...mesh.userData, kind: "sphere-wireframe", interactive: false, raycast: false };
  return mesh;
}

function createSphereBackdrop(THREE) {
  return Object.freeze({
    surface: createSphereSurface(THREE),
    wireframe: createSphereWireframe(THREE),
  });
}

function createTubeGeometry(THREE, path, radius) {
  if (typeof THREE.TubeGeometry === "function") {
    return new THREE.TubeGeometry(path, EDGE_ARC_SEGMENTS, radius, EDGE_RADIAL_SEGMENTS, false);
  }

  return {
    type: "TubeGeometry",
    parameters: { path, tubularSegments: EDGE_ARC_SEGMENTS, radius, radialSegments: EDGE_RADIAL_SEGMENTS, closed: false },
    dispose() {},
  };
}

function directionBetween(from, to) {
  return normalizeToRadius({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }, 1);
}

function orientAlong(mesh, THREE, direction) {
  mesh.userData = { ...mesh.userData, direction };
  if (typeof mesh.quaternion?.setFromUnitVectors === "function") {
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toVector3(THREE, direction));
    return;
  }
  mesh.rotation.set?.(Math.atan2(direction.z, direction.y), 0, -Math.atan2(direction.x, direction.y));
}

function quaternionSnapshot(quaternion) {
  return { x: quaternion?.x || 0, y: quaternion?.y || 0, z: quaternion?.z || 0, w: quaternion?.w ?? 1 };
}

function normalizeQuaternionValues(values) {
  const length = Math.hypot(values.x, values.y, values.z, values.w) || 1;
  return { x: values.x / length, y: values.y / length, z: values.z / length, w: values.w / length };
}

function multiplyQuaternionValues(left, right) {
  return normalizeQuaternionValues({
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
  });
}

function rotatePointByQuaternion(point, quaternion) {
  const values = normalizeQuaternionValues(quaternion);
  const ix = values.w * point.x + values.y * point.z - values.z * point.y;
  const iy = values.w * point.y + values.z * point.x - values.x * point.z;
  const iz = values.w * point.z + values.x * point.y - values.y * point.x;
  const iw = -values.x * point.x - values.y * point.y - values.z * point.z;

  return {
    x: ix * values.w + iw * -values.x + iy * -values.z - iz * -values.y,
    y: iy * values.w + iw * -values.y + iz * -values.x - ix * -values.z,
    z: iz * values.w + iw * -values.z + ix * -values.y - iy * -values.x,
  };
}

function quaternionBetweenPoints(fromPoint, toPoint) {
  const from = normalizePoint(fromPoint);
  const to = normalizePoint(toPoint);
  const dot = clamp(dotPoints(from, to), -1, 1);

  if (dot > 1 - 1e-9) return { x: 0, y: 0, z: 0, w: 1 };

  if (dot < -1 + 1e-9) {
    const fallback = Math.abs(from.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const axis = normalizePoint(crossPoints(from, fallback));
    return { x: axis.x, y: axis.y, z: axis.z, w: 0 };
  }

  const axis = crossPoints(from, to);
  return normalizeQuaternionValues({ x: axis.x, y: axis.y, z: axis.z, w: 1 + dot });
}

function setQuaternionValues(quaternion, values) {
  const next = normalizeQuaternionValues(values);
  quaternion.set(next.x, next.y, next.z, next.w);
}

function objectWorldPoint(object, localPoint) {
  let point = { x: localPoint.x, y: localPoint.y, z: localPoint.z };
  let current = object;

  while (current) {
    point = rotatePointByQuaternion(point, quaternionSnapshot(current.quaternion));
    point = {
      x: point.x + (current.position?.x || 0),
      y: point.y + (current.position?.y || 0),
      z: point.z + (current.position?.z || 0),
    };
    current = current.parent;
  }

  return point;
}

function currentTime() {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : 0;
}

function createAxisAngleQuaternion(THREE, axis, angle) {
  const quaternion = new THREE.Quaternion();
  if (typeof quaternion.setFromAxisAngle === "function") return quaternion.setFromAxisAngle(axis, angle);

  const halfAngle = angle / 2;
  const sinHalf = Math.sin(halfAngle);
  return quaternion.set(axis.x * sinHalf, axis.y * sinHalf, axis.z * sinHalf, Math.cos(halfAngle));
}

function applyQuaternionDelta(group, delta) {
  if (typeof group.quaternion?.premultiply === "function") {
    group.quaternion.premultiply(delta).normalize?.();
  } else if (typeof group.quaternion?.multiplyQuaternions === "function") {
    group.quaternion.multiplyQuaternions(delta, group.quaternion).normalize?.();
  } else if (typeof group.quaternion?.set === "function") {
    const next = multiplyQuaternionValues(quaternionSnapshot(delta), quaternionSnapshot(group.quaternion));
    group.quaternion.set(next.x, next.y, next.z, next.w);
  }
  group.userData.rotationState.quaternion = quaternionSnapshot(group.quaternion);
}

export function createBoard3d(mount, config, options = {}) {
  const THREE = options.THREE || globalThis.__THE_LOCK_RENDER3D_THREE__ || THREE_DEFAULT;
  if (!canCreateWebGLContext(options)) return createFallbackBoard(mount, config);

  const onEdgeTap = typeof options.onEdgeTap === "function" ? options.onEdgeTap : null;
  const scene = new THREE.Scene();
  const size = readMountSize(mount);
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, size.width / size.height, 0.1, 1000);
  const cameraState = {
    zoom: DEFAULT_CAMERA_ZOOM,
    minZoom: MIN_CAMERA_ZOOM,
    maxZoom: MAX_CAMERA_ZOOM,
    defaultZoom: DEFAULT_CAMERA_ZOOM,
    fitDistance: cameraFitDistance(size),
  };
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return createFallbackBoard(mount, config);
  }

  camera.position.set(0, 0, cameraState.fitDistance / cameraState.zoom);
  camera.lookAt?.(0, 0, 0);

  renderer.setPixelRatio?.(readPixelRatio());
  renderer.setSize(size.width, size.height);
  renderer.setClearColor?.(0x000000, 0);
  mount.appendChild(renderer.domElement);
  const zoomControls = createZoomControls();
  if (zoomControls?.element) mount.appendChild(zoomControls.element);

  let current = config;
  let destroyed = false;
  let frame = null;
  const legalEdges = new Set();
  const edgeShakeStates = new Map();
  const nodePulseStates = new Map();
  const edgeMeshes = new Map();
  const nodeMeshes = new Map();
  const graphRoot = new THREE.Group();
  const sphereBackdrop = createSphereBackdrop(THREE);
  const rotationState = {
    dragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    velocityX: 0,
    velocityY: 0,
    quaternion: quaternionSnapshot(graphRoot.quaternion),
  };
  const nodeDragState = {
    dragging: false,
    pointerId: null,
    nodeId: null,
    scale: null,
  };
  const edgeTapState = {
    active: false,
    pointerId: null,
    edgeId: null,
    startX: 0,
    startY: 0,
    startTime: 0,
    cancelled: false,
  };
  const edgeFocusState = { edgeId: null };
  let defaultOrientationApplied = false;

  function applyCameraZoom(nextZoom = cameraState.zoom) {
    cameraState.zoom = clamp(nextZoom, cameraState.minZoom, cameraState.maxZoom);
    camera.position.set(0, 0, cameraState.fitDistance / cameraState.zoom);
    camera.lookAt?.(0, 0, 0);
    camera.updateProjectionMatrix?.();
    updateZoomControls();
    return cameraState.zoom;
  }

  function zoomIn() {
    if (destroyed) return cameraState.zoom;
    return applyCameraZoom(cameraState.zoom + CAMERA_ZOOM_STEP);
  }

  function zoomOut() {
    if (destroyed) return cameraState.zoom;
    return applyCameraZoom(cameraState.zoom - CAMERA_ZOOM_STEP);
  }

  function resetZoom() {
    if (destroyed) return cameraState.zoom;
    return applyCameraZoom(cameraState.defaultZoom);
  }

  function updateZoomControls() {
    if (!zoomControls) return;
    setButtonDisabled(zoomControls.outButton, cameraState.zoom <= cameraState.minZoom + 1e-9);
    setButtonDisabled(zoomControls.inButton, cameraState.zoom >= cameraState.maxZoom - 1e-9);
    if (zoomControls.resetButton) setAttribute(zoomControls.resetButton, "aria-label", `Reset board zoom to ${Math.round(cameraState.defaultZoom * 100)} percent`);
  }

  function createZoomButton(label, action, ariaLabel) {
    const button = createElement("button");
    if (!button) return null;
    button.type = "button";
    button.textContent = label;
    setAttribute(button, "class", "board-zoom-button");
    setAttribute(button, "aria-label", ariaLabel);
    setAttribute(button, "title", ariaLabel);
    button.addEventListener?.("click", (event) => {
      event.preventDefault?.();
      action();
    });
    return button;
  }

  function createZoomControls() {
    const element = createElement("div");
    if (!element) return null;
    setAttribute(element, "class", "board-zoom-controls");
    setAttribute(element, "role", "group");
    setAttribute(element, "aria-label", "Board zoom controls");

    const outButton = createZoomButton("-", zoomOut, "Zoom board out");
    const resetButton = createZoomButton("1x", resetZoom, "Reset board zoom to 100 percent");
    const inButton = createZoomButton("+", zoomIn, "Zoom board in");
    for (const button of [outButton, resetButton, inButton]) {
      if (button) element.appendChild(button);
    }

    return { element, outButton, resetButton, inButton };
  }

  graphRoot.name = "graph-root";
  graphRoot.userData = {
    ...graphRoot.userData,
    kind: "graph-root",
    interactive: false,
    rotationState,
    nodeDragState,
    edgeTapState,
    edgeFocusState,
    cameraState,
    visualState: { edgeShakeStates, nodePulseStates },
  };
  scene.add(graphRoot);
  graphRoot.add(sphereBackdrop.surface, sphereBackdrop.wireframe);
  updateZoomControls();

  function resize() {
    if (destroyed) return;
    const nextSize = readMountSize(mount);
    camera.aspect = nextSize.width / nextSize.height;
    cameraState.fitDistance = cameraFitDistance(nextSize);
    camera.position.set(0, 0, cameraState.fitDistance / cameraState.zoom);
    camera.updateProjectionMatrix?.();
    renderer.setPixelRatio?.(readPixelRatio());
    renderer.setSize(nextSize.width, nextSize.height);
  }

  const resizeTarget = globalThis.window;
  if (typeof resizeTarget?.addEventListener === "function") resizeTarget.addEventListener("resize", resize);

  function scheduleRenderLoop() {
    if (destroyed || frame !== null || isDocumentHidden()) return;
    frame = scheduleAnimation(renderLoop);
  }

  function pauseRenderLoop() {
    cancelAnimation(frame);
    frame = null;
  }

  function renderLoop(time) {
    frame = null;
    if (destroyed || isDocumentHidden()) return;
    stepRotationDamping();
    stepVisualStates(Number.isFinite(time) ? time : currentTime());
    refreshNodeFacing();
    refreshEdgeFacing();
    renderer.render(scene, camera);
    scheduleRenderLoop();
  }

  function handleVisibilityChange() {
    if (isDocumentHidden()) {
      pauseRenderLoop();
      return;
    }
    scheduleRenderLoop();
  }

  const visibilityTarget = globalThis.document;
  if (typeof visibilityTarget?.addEventListener === "function") visibilityTarget.addEventListener("visibilitychange", handleVisibilityChange);

  scheduleRenderLoop();

  function clearNodeMeshes() {
    for (const mesh of nodeMeshes.values()) {
      graphRoot.remove(mesh);
      disposeMesh(mesh);
    }
    nodeMeshes.clear();
  }

  function clearSphereBackdrop() {
    graphRoot.remove(sphereBackdrop.surface, sphereBackdrop.wireframe);
    disposeMesh(sphereBackdrop.surface);
    disposeMesh(sphereBackdrop.wireframe);
  }

  function clearEdgeMeshes() {
    for (const edge of edgeMeshes.values()) {
      graphRoot.remove(edge.group);
      disposeObject(edge.group);
    }
    edgeMeshes.clear();
  }

  function createNodeMesh(node, nextConfig, position) {
    const geometry = new THREE.SphereGeometry(NODE_MESH_RADIUS, NODE_WIDTH_SEGMENTS, NODE_HEIGHT_SEGMENTS);
    const material = new THREE.MeshBasicMaterial({ color: nodeColor(nextConfig, node.id), transparent: true, opacity: NODE_FRONT_OPACITY });
    const mesh = new THREE.Mesh(geometry, material);

    mesh.position.set(position.x, position.y, position.z);
    mesh.name = `node:${node.id}`;
    mesh.userData = { ...mesh.userData, kind: "node", nodeId: node.id };
    return mesh;
  }

  function renderNodes(nextConfig, nodePositions = projectedNodePositions(nextConfig)) {
    clearNodeMeshes();
    for (const node of nextConfig.level.nodes) {
      const mesh = createNodeMesh(node, nextConfig, nodePositions.get(node.id));
      nodeMeshes.set(node.id, mesh);
      graphRoot.add(mesh);
    }
  }

  function projectedNodePositions(nextConfig) {
    return relaxProjectedNodes(nextConfig.level, NODE_SURFACE_RADIUS);
  }

  function defaultOrientationPoint(nextConfig) {
    if (!nextConfig?.level?.target) return null;

    const nodePositions = projectedNodePositions(nextConfig);
    const ends = edgeEnds(nextConfig, nextConfig.level.target);
    const from = nodePositions.get(ends.from);
    const to = nodePositions.get(ends.to);
    if (!from || !to) return null;

    const target = slerpOnSphere(from, to, 0.5, NODE_SURFACE_RADIUS);
    const centroid = nextConfig.level.nodes.reduce(
      (total, node) => {
        const position = nodePositions.get(node.id);
        if (!position) return total;
        return {
          x: total.x + position.x,
          y: total.y + position.y,
          z: total.z + position.z,
        };
      },
      { x: 0, y: 0, z: 0 }
    );
    const centroidMagnitude = Math.hypot(centroid.x, centroid.y, centroid.z);
    const context = centroidMagnitude > 1e-9 ? normalizeToRadius(centroid, NODE_SURFACE_RADIUS) : target;

    return normalizeToRadius({
      x: target.x * 0.7 + context.x * 0.3,
      y: target.y * 0.7 + context.y * 0.3,
      z: target.z * 0.7 + context.z * 0.3,
    }, NODE_SURFACE_RADIUS);
  }

  function applyDefaultOrientation(nextConfig) {
    const point = defaultOrientationPoint(nextConfig);
    if (!point) return;

    setQuaternionValues(graphRoot.quaternion, quaternionBetweenPoints(point, DEFAULT_TARGET_VIEW));
    rotationState.quaternion = quaternionSnapshot(graphRoot.quaternion);
  }

  function currentNodePositions(nextConfig) {
    const relaxedPositions = projectedNodePositions(nextConfig);
    return new Map(
      nextConfig.level.nodes.map((node) => {
        const mesh = nodeMeshes.get(node.id);
        if (mesh) return [node.id, { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }];
        return [node.id, relaxedPositions.get(node.id)];
      })
    );
  }

  function bringNodeMeshesToFront() {
    for (const mesh of nodeMeshes.values()) graphRoot.add(mesh);
  }

  function createEdgeBundle(edge, nextConfig, nodePositions) {
    const ends = edgeEnds(nextConfig, edge.id);
    const from = nodePositions.get(ends.from);
    const to = nodePositions.get(ends.to);
    const points = createArcPoints(from, to, NODE_SURFACE_RADIUS);
    const path = createArcPath(THREE, points);
    const color = edgeColor(nextConfig, edge.id);
    const radius = edgeRadius(edge);
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: EDGE_FRONT_OPACITY, depthWrite: false });
    const arc = new THREE.Mesh(createTubeGeometry(THREE, path, radius), material);
    const arrowMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: EDGE_FRONT_OPACITY, depthWrite: false, side: THREE.DoubleSide ?? 2 });
    const arrowhead = new THREE.Mesh(
      new THREE.ConeGeometry(ARROWHEAD_RADIUS + radius * 0.35, ARROWHEAD_HEIGHT, ARROWHEAD_SEGMENTS),
      arrowMaterial
    );
    material.depthWrite = false;
    arrowMaterial.depthWrite = false;
    arrowMaterial.side = THREE.DoubleSide ?? 2;
    const hitMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    hitMaterial.depthWrite = false;
    const hitTarget = new THREE.Mesh(createTubeGeometry(THREE, path, EDGE_HIT_RADIUS), hitMaterial);
    const arrowPosition = path.getPoint(ARROWHEAD_T);
    const arrowPrevious = path.getPoint(Math.max(0, ARROWHEAD_T - 1 / EDGE_ARC_SEGMENTS));
    const direction = directionBetween(arrowPrevious, arrowPosition);

    group.name = `edge:${edge.id}`;
    group.userData = { ...group.userData, kind: "edge-group", edgeId: edge.id, from: ends.from, to: ends.to, baseColor: color, legal: false, visualColor: color };
    arc.name = `edge:${edge.id}:arc`;
    arc.userData = { ...arc.userData, kind: "edge-arc", edgeId: edge.id, from: ends.from, to: ends.to, weight: edge.w, radius, pathPoints: points, baseColor: color, legal: false, visualColor: color };
    arrowhead.name = `edge:${edge.id}:arrowhead`;
    arrowhead.position.copy(arrowPosition);
    arrowhead.userData = { ...arrowhead.userData, kind: "edge-arrowhead", edgeId: edge.id, from: ends.from, to: ends.to, baseColor: color, legal: false, visualColor: color };
    orientAlong(arrowhead, THREE, direction);
    hitTarget.name = `edge:${edge.id}:hit`;
    hitTarget.userData = { ...hitTarget.userData, kind: "edge-hit", edgeId: edge.id, from: ends.from, to: ends.to, raycast: true, pathPoints: points };

    group.add(arc, arrowhead, hitTarget);
    return Object.freeze({ group, arc, arrowhead, hitTarget });
  }

  function renderEdges(nextConfig, nodePositions = projectedNodePositions(nextConfig)) {
    clearEdgeMeshes();
    for (const edge of nextConfig.level.edges) {
      const bundle = createEdgeBundle(edge, nextConfig, nodePositions);
      edgeMeshes.set(edge.id, bundle);
      graphRoot.add(bundle.group);
    }
    applyAllEdgeVisualStates();
  }

  function refreshEdge(edgeId) {
    const edge = current.level.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) return;

    const previous = edgeMeshes.get(edgeId);
    if (previous) {
      graphRoot.remove(previous.group);
      disposeObject(previous.group);
    }

    const bundle = createEdgeBundle(edge, current, currentNodePositions(current));
    edgeMeshes.set(edgeId, bundle);
    graphRoot.add(bundle.group);
    applyEdgeVisualState(edgeId);
    raiseLegalEdges();
    bringNodeMeshesToFront();
    refreshEdgeFacing();
  }

  function refreshConnectedEdges(nodeId) {
    for (const edge of current.level.edges) {
      if (edge.u === nodeId || edge.v === nodeId) refreshEdge(edge.id);
    }
  }

  function applyRotation(dx, dy) {
    if (dx === 0 && dy === 0) return;
    const yaw = createAxisAngleQuaternion(THREE, new THREE.Vector3(0, 1, 0), dx * DRAG_ROTATION_SPEED);
    const pitch = createAxisAngleQuaternion(THREE, new THREE.Vector3(1, 0, 0), dy * DRAG_ROTATION_SPEED);
    applyQuaternionDelta(graphRoot, yaw);
    applyQuaternionDelta(graphRoot, pitch);
  }

  function stepRotationDamping() {
    if (rotationState.dragging) return;
    if (prefersReducedMotion()) {
      rotationState.velocityX = 0;
      rotationState.velocityY = 0;
      return;
    }
    if (Math.abs(rotationState.velocityX) < ROTATION_STOP_EPSILON && Math.abs(rotationState.velocityY) < ROTATION_STOP_EPSILON) {
      rotationState.velocityX = 0;
      rotationState.velocityY = 0;
      return;
    }

    applyRotation(rotationState.velocityX, rotationState.velocityY);
    rotationState.velocityX *= ROTATION_DAMPING;
    rotationState.velocityY *= ROTATION_DAMPING;
  }

  function pointerMatches(event) {
    return rotationState.dragging && (rotationState.pointerId === null || event.pointerId === rotationState.pointerId);
  }

  function nodePointerMatches(event) {
    return nodeDragState.dragging && (nodeDragState.pointerId === null || event.pointerId === nodeDragState.pointerId);
  }

  function edgePointerMatches(event) {
    return edgeTapState.active && (edgeTapState.pointerId === null || event.pointerId === edgeTapState.pointerId);
  }

  function nodeIdFromObject(object) {
    let candidate = object;
    while (candidate) {
      if (candidate.userData?.kind === "node" && nodeMeshes.has(candidate.userData.nodeId)) return candidate.userData.nodeId;
      candidate = candidate.parent;
    }
    return null;
  }

  function nodeIdFromPointerEvent(event) {
    if (event.nodeId && nodeMeshes.has(event.nodeId)) return event.nodeId;

    const candidates = [
      event.target,
      event.object,
      event.intersection?.object,
      event.intersections?.[0]?.object,
    ];
    for (const candidate of candidates) {
      const nodeId = nodeIdFromObject(candidate);
      if (nodeId) return nodeId;
    }

    return null;
  }

  function edgeIdFromObject(object) {
    let candidate = object;
    while (candidate) {
      if (candidate.userData?.kind === "edge-hit" && edgeMeshes.has(candidate.userData.edgeId)) return candidate.userData.edgeId;
      candidate = candidate.parent;
    }
    return null;
  }

  function pointerNdcFromEvent(event) {
    const rect = typeof renderer.domElement.getBoundingClientRect === "function"
      ? renderer.domElement.getBoundingClientRect()
      : { left: 0, top: 0, width: renderer.domElement.width || DEFAULT_WIDTH, height: renderer.domElement.height || DEFAULT_HEIGHT };
    const width = rect.width || DEFAULT_WIDTH;
    const height = rect.height || DEFAULT_HEIGHT;
    const clientX = event.clientX ?? rect.left + width / 2;
    const clientY = event.clientY ?? rect.top + height / 2;
    return {
      x: ((clientX - rect.left) / width) * 2 - 1,
      y: -(((clientY - rect.top) / height) * 2 - 1),
    };
  }

  function edgeHitTargets() {
    return [...edgeMeshes.values()].map((bundle) => bundle.hitTarget).filter((mesh) => mesh.userData?.raycast === true);
  }

  function edgeFacingPoint(edgeId) {
    const bundle = edgeMeshes.get(edgeId);
    const points = bundle?.hitTarget.userData?.pathPoints || bundle?.arc.userData?.pathPoints || [];
    return points[Math.floor(points.length / 2)] || bundle?.hitTarget.position || { x: 0, y: 0, z: NODE_SURFACE_RADIUS };
  }

  function isWorldPointFrontFacing(worldPoint) {
    const normal = normalizeToRadius(worldPoint, 1);
    const toCamera = {
      x: camera.position.x - worldPoint.x,
      y: camera.position.y - worldPoint.y,
      z: camera.position.z - worldPoint.z,
    };
    return normal.x * toCamera.x + normal.y * toCamera.y + normal.z * toCamera.z > 0;
  }

  function isEdgeFrontFacing(edgeId) {
    const bundle = edgeMeshes.get(edgeId);
    if (!bundle) return false;

    return isWorldPointFrontFacing(objectWorldPoint(bundle.hitTarget, edgeFacingPoint(edgeId)));
  }

  function isNodeFrontFacing(nodeId) {
    const mesh = nodeMeshes.get(nodeId);
    if (!mesh) return false;

    return isWorldPointFrontFacing(objectWorldPoint(mesh, { x: 0, y: 0, z: 0 }));
  }

  function refreshNodeFacing() {
    for (const [nodeId, mesh] of nodeMeshes) {
      const frontFacing = isNodeFrontFacing(nodeId);
      mesh.material.opacity = frontFacing ? NODE_FRONT_OPACITY : NODE_BACK_OPACITY;
      mesh.material.transparent = true;
      mesh.userData = { ...mesh.userData, frontFacing, interactive: frontFacing };
    }
  }

  function refreshEdgeFacing() {
    for (const [edgeId, bundle] of edgeMeshes) {
      const frontFacing = isEdgeFrontFacing(edgeId);
      const opacity = frontFacing ? EDGE_FRONT_OPACITY : EDGE_BACK_OPACITY;
      bundle.arc.material.opacity = opacity;
      bundle.arc.material.transparent = true;
      bundle.arrowhead.material.opacity = opacity;
      bundle.arrowhead.material.transparent = true;
      bundle.arc.userData = { ...bundle.arc.userData, frontFacing };
      bundle.arrowhead.userData = { ...bundle.arrowhead.userData, frontFacing };
      bundle.group.userData = { ...bundle.group.userData, frontFacing };
    }
  }

  function setMaterialColor(material, color) {
    if (typeof material.color?.set === "function") material.color.set(color);
  }

  function applyEdgeVisualState(edgeId) {
    const bundle = edgeMeshes.get(edgeId);
    if (!bundle) return;

    const baseColor = edgeColor(current, edgeId);
    const legal = legalEdges.has(edgeId);
    const visualColor = legal ? EDGE_LEGAL_COLOR : baseColor;
    setMaterialColor(bundle.arc.material, visualColor);
    setMaterialColor(bundle.arrowhead.material, visualColor);
    bundle.arc.userData = { ...bundle.arc.userData, baseColor, legal, visualColor };
    bundle.arrowhead.userData = { ...bundle.arrowhead.userData, baseColor, legal, visualColor };
    bundle.group.userData = { ...bundle.group.userData, baseColor, legal, visualColor };
  }

  function applyAllEdgeVisualStates() {
    for (const edgeId of edgeMeshes.keys()) applyEdgeVisualState(edgeId);
  }

  function raiseLegalEdges() {
    for (const edgeId of legalEdges) {
      const bundle = edgeMeshes.get(edgeId);
      if (bundle) graphRoot.add(bundle.group);
    }
    bringNodeMeshesToFront();
  }

  function resetTransientVisualStates() {
    for (const [edgeId, state] of edgeShakeStates) {
      const bundle = edgeMeshes.get(edgeId);
      if (bundle) bundle.group.position.set(state.basePosition.x, state.basePosition.y, state.basePosition.z);
    }
    for (const [nodeId, state] of nodePulseStates) {
      const mesh = nodeMeshes.get(nodeId);
      if (mesh) mesh.scale.set(state.baseScale.x, state.baseScale.y, state.baseScale.z);
    }
    edgeShakeStates.clear();
    nodePulseStates.clear();
  }

  function edgeShakeOffset(progress) {
    return Math.sin(progress * Math.PI * 2 * EDGE_SHAKE_CYCLES) * (1 - progress) * EDGE_SHAKE_AMPLITUDE;
  }

  function stepEdgeShake(edgeId, state, time) {
    const bundle = edgeMeshes.get(edgeId);
    if (!bundle) {
      edgeShakeStates.delete(edgeId);
      return;
    }

    const elapsed = Math.max(0, time - state.startedAt);
    const progress = Math.min(1, elapsed / state.durationMs);
    const offset = progress >= 1 ? 0 : edgeShakeOffset(progress);
    bundle.group.position.set(state.basePosition.x + offset, state.basePosition.y, state.basePosition.z);
    const shakeState = { active: progress < 1, edgeId, progress, offset, durationMs: state.durationMs };
    bundle.group.userData = { ...bundle.group.userData, shakeState };
    if (progress >= 1) edgeShakeStates.delete(edgeId);
  }

  function nodePulseScale(progress) {
    return 1 + (NODE_PULSE_SCALE - 1) * Math.sin(progress * Math.PI);
  }

  function stepNodePulse(nodeId, state, time) {
    const mesh = nodeMeshes.get(nodeId);
    if (!mesh) {
      nodePulseStates.delete(nodeId);
      return;
    }

    const elapsed = Math.max(0, time - state.startedAt);
    const progress = Math.min(1, elapsed / state.durationMs);
    const scale = progress >= 1 ? 1 : nodePulseScale(progress);
    mesh.scale.set(state.baseScale.x * scale, state.baseScale.y * scale, state.baseScale.z * scale);
    const pulseState = { active: progress < 1, nodeId, progress, scale, durationMs: state.durationMs };
    mesh.userData = { ...mesh.userData, pulseState };
    if (progress >= 1) nodePulseStates.delete(nodeId);
  }

  function stepVisualStates(time) {
    for (const [edgeId, state] of [...edgeShakeStates]) stepEdgeShake(edgeId, state, time);
    for (const [nodeId, state] of [...nodePulseStates]) stepNodePulse(nodeId, state, time);
  }

  function raycastEdgeHit(event) {
    if (!onEdgeTap || typeof THREE.Raycaster !== "function") return null;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera?.(pointerNdcFromEvent(event), camera);
    const intersections = typeof raycaster.intersectObjects === "function" ? raycaster.intersectObjects(edgeHitTargets(), false) : [];
    for (const intersection of intersections) {
      const edgeId = edgeIdFromObject(intersection.object);
      if (edgeId && isEdgeFrontFacing(edgeId)) return { edgeId, object: intersection.object };
    }

    return null;
  }

  function focusEdge(edgeId) {
    edgeFocusState.edgeId = edgeMeshes.has(edgeId) ? edgeId : null;
    return edgeFocusState.edgeId !== null;
  }

  function activateFocusedEdge() {
    if (!onEdgeTap || !edgeFocusState.edgeId || !isEdgeFrontFacing(edgeFocusState.edgeId)) return false;
    onEdgeTap(edgeFocusState.edgeId);
    return true;
  }

  function spherePointFromPointer(event) {
    if (event.spherePoint) return normalizeToRadius(event.spherePoint, NODE_SURFACE_RADIUS);

    const rect = typeof renderer.domElement.getBoundingClientRect === "function"
      ? renderer.domElement.getBoundingClientRect()
      : { left: 0, top: 0, width: renderer.domElement.width || DEFAULT_WIDTH, height: renderer.domElement.height || DEFAULT_HEIGHT };
    const width = rect.width || DEFAULT_WIDTH;
    const height = rect.height || DEFAULT_HEIGHT;
    const clientX = event.clientX ?? rect.left + width / 2;
    const clientY = event.clientY ?? rect.top + height / 2;
    const boardX = clamp(((clientX - rect.left) / width) * BOARD_WIDTH, 0, BOARD_WIDTH);
    const boardY = clamp(((clientY - rect.top) / height) * BOARD_HEIGHT, 0, BOARD_HEIGHT);
    return projectToSphere(boardX, boardY, NODE_SURFACE_RADIUS);
  }

  function startNodeDrag(event, nodeId) {
    const mesh = nodeMeshes.get(nodeId);
    if (!mesh || !isNodeFrontFacing(nodeId)) return false;

    refreshNodeFacing();
    nodeDragState.dragging = true;
    nodeDragState.pointerId = event.pointerId ?? null;
    nodeDragState.nodeId = nodeId;
    nodeDragState.scale = { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z };
    mesh.scale.set(NODE_DRAG_SCALE, NODE_DRAG_SCALE, NODE_DRAG_SCALE);
    mesh.userData = { ...mesh.userData, dragging: true, cosmeticDrag: true };
    renderer.domElement.setPointerCapture?.(nodeDragState.pointerId);
    return true;
  }

  function startEdgeTap(event, edgeId) {
    edgeTapState.active = true;
    edgeTapState.pointerId = event.pointerId ?? null;
    edgeTapState.edgeId = edgeId;
    edgeTapState.startX = event.clientX ?? 0;
    edgeTapState.startY = event.clientY ?? 0;
    edgeTapState.startTime = Number.isFinite(event.timeStamp) ? event.timeStamp : 0;
    edgeTapState.cancelled = false;
    focusEdge(edgeId);
    renderer.domElement.setPointerCapture?.(edgeTapState.pointerId);
    event.preventDefault?.();
    return true;
  }

  function updateEdgeTapCancellation(event) {
    const dx = (event.clientX ?? edgeTapState.startX) - edgeTapState.startX;
    const dy = (event.clientY ?? edgeTapState.startY) - edgeTapState.startY;
    const elapsed = Number.isFinite(event.timeStamp) ? event.timeStamp - edgeTapState.startTime : 0;
    if (Math.hypot(dx, dy) > TAP_MOVE_TOLERANCE || elapsed > TAP_TIME_TOLERANCE) edgeTapState.cancelled = true;
  }

  function resetEdgeTap() {
    edgeTapState.active = false;
    edgeTapState.pointerId = null;
    edgeTapState.edgeId = null;
    edgeTapState.startX = 0;
    edgeTapState.startY = 0;
    edgeTapState.startTime = 0;
    edgeTapState.cancelled = false;
  }

  function moveEdgeTap(event) {
    if (!edgePointerMatches(event)) return false;

    updateEdgeTapCancellation(event);
    event.preventDefault?.();
    return true;
  }

  function finishEdgeTap(event) {
    if (!edgePointerMatches(event)) return false;

    const edgeId = edgeTapState.edgeId;
    updateEdgeTapCancellation(event);
    const cancelled = edgeTapState.cancelled;
    renderer.domElement.releasePointerCapture?.(edgeTapState.pointerId);
    resetEdgeTap();
    if (!cancelled && edgeId && isEdgeFrontFacing(edgeId) && onEdgeTap) onEdgeTap(edgeId);
    return true;
  }

  function cancelEdgeTap(event) {
    if (!edgePointerMatches(event)) return false;

    renderer.domElement.releasePointerCapture?.(edgeTapState.pointerId);
    resetEdgeTap();
    return true;
  }

  function finishNodeDrag(event = {}) {
    if (!nodePointerMatches(event)) return false;

    const mesh = nodeMeshes.get(nodeDragState.nodeId);
    if (mesh) {
      const scale = nodeDragState.scale || { x: 1, y: 1, z: 1 };
      mesh.scale.set(scale.x, scale.y, scale.z);
      mesh.userData = { ...mesh.userData, dragging: false, cosmeticDrag: false };
    }

    renderer.domElement.releasePointerCapture?.(nodeDragState.pointerId);
    nodeDragState.dragging = false;
    nodeDragState.pointerId = null;
    nodeDragState.nodeId = null;
    nodeDragState.scale = null;
    return true;
  }

  function moveDraggedNode(event) {
    if (!nodePointerMatches(event)) return false;
    event.preventDefault?.();

    const mesh = nodeMeshes.get(nodeDragState.nodeId);
    if (!mesh) return false;

    const position = spherePointFromPointer(event);
    mesh.position.set(position.x, position.y, position.z);
    refreshConnectedEdges(nodeDragState.nodeId);
    return true;
  }

  function finishRotation(event = {}) {
    if (!pointerMatches(event)) return false;
    renderer.domElement.releasePointerCapture?.(rotationState.pointerId);
    rotationState.dragging = false;
    rotationState.pointerId = null;
    if (prefersReducedMotion()) {
      rotationState.velocityX = 0;
      rotationState.velocityY = 0;
    }
    return true;
  }

  function cancelActivePointers() {
    if (nodeDragState.dragging) finishNodeDrag({ pointerId: nodeDragState.pointerId });
    if (edgeTapState.active) cancelEdgeTap({ pointerId: edgeTapState.pointerId });
    if (rotationState.dragging) finishRotation({ pointerId: rotationState.pointerId });
  }

  function handlePointerDown(event) {
    if (event.isPrimary === false) return;
    if (event.button !== undefined && event.button !== 0) return;
    const nodeId = nodeIdFromPointerEvent(event);
    if (nodeId && startNodeDrag(event, nodeId)) return;
    const edgeHit = raycastEdgeHit(event);
    if (edgeHit && startEdgeTap(event, edgeHit.edgeId)) return;

    rotationState.dragging = true;
    rotationState.pointerId = event.pointerId ?? null;
    rotationState.lastX = event.clientX ?? 0;
    rotationState.lastY = event.clientY ?? 0;
    rotationState.velocityX = 0;
    rotationState.velocityY = 0;
    renderer.domElement.setPointerCapture?.(rotationState.pointerId);
  }

  function handlePointerMove(event) {
    if (moveDraggedNode(event)) return;
    if (moveEdgeTap(event)) return;
    if (!pointerMatches(event)) return;
    event.preventDefault?.();

    const nextX = event.clientX ?? rotationState.lastX;
    const nextY = event.clientY ?? rotationState.lastY;
    const dx = nextX - rotationState.lastX;
    const dy = nextY - rotationState.lastY;
    rotationState.lastX = nextX;
    rotationState.lastY = nextY;
    rotationState.velocityX = dx;
    rotationState.velocityY = dy;
    applyRotation(dx, dy);
  }

  function handlePointerEnd(event) {
    if (finishNodeDrag(event)) return;
    if (finishEdgeTap(event)) return;
    finishRotation(event);
  }

  function handlePointerCancel(event) {
    if (finishNodeDrag(event)) return;
    if (cancelEdgeTap(event)) return;
    handlePointerEnd(event);
  }

  const pointerTarget = renderer.domElement;
  if (pointerTarget && (pointerTarget.tabIndex === undefined || pointerTarget.tabIndex < 0)) pointerTarget.tabIndex = 0;
  pointerTarget?.setAttribute?.("role", "application");
  pointerTarget?.setAttribute?.("aria-label", "3D puzzle board");
  function handleKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    if (activateFocusedEdge()) event.preventDefault?.();
  }

  if (typeof pointerTarget?.addEventListener === "function") {
    pointerTarget.addEventListener("pointerdown", handlePointerDown);
    pointerTarget.addEventListener("pointermove", handlePointerMove);
    pointerTarget.addEventListener("pointerup", handlePointerEnd);
    pointerTarget.addEventListener("pointercancel", handlePointerCancel);
    pointerTarget.addEventListener("keydown", handleKeyDown);
  }

  function removePointerListeners() {
    if (typeof pointerTarget?.removeEventListener !== "function") return;
    pointerTarget.removeEventListener("pointerdown", handlePointerDown);
    pointerTarget.removeEventListener("pointermove", handlePointerMove);
    pointerTarget.removeEventListener("pointerup", handlePointerEnd);
    pointerTarget.removeEventListener("pointercancel", handlePointerCancel);
    pointerTarget.removeEventListener("keydown", handleKeyDown);
  }

  function update(nextConfig) {
    cancelActivePointers();
    resetTransientVisualStates();
    current = nextConfig;
    if (!defaultOrientationApplied) {
      applyDefaultOrientation(current);
      defaultOrientationApplied = true;
    }
    const nodePositions = projectedNodePositions(current);
    renderEdges(current, nodePositions);
    renderNodes(current, nodePositions);
    refreshNodeFacing();
    refreshEdgeFacing();
    if (edgeFocusState.edgeId && !edgeMeshes.has(edgeFocusState.edgeId)) edgeFocusState.edgeId = null;
  }

  function markLegal(edgeIds) {
    if (destroyed) return;
    legalEdges.clear();
    for (const edgeId of edgeIds || []) {
      if (edgeMeshes.has(edgeId)) legalEdges.add(edgeId);
    }
    applyAllEdgeVisualStates();
    raiseLegalEdges();
  }

  function shakeEdge(edgeId) {
    if (destroyed) return;
    const bundle = edgeMeshes.get(edgeId);
    if (!bundle) return;

    const basePosition = { x: 0, y: 0, z: 0 };
    bundle.group.position.set(basePosition.x, basePosition.y, basePosition.z);
    if (prefersReducedMotion()) {
      edgeShakeStates.delete(edgeId);
      bundle.group.userData = {
        ...bundle.group.userData,
        shakeState: { active: false, edgeId, progress: 1, offset: 0, durationMs: 0 },
      };
      return;
    }
    edgeShakeStates.set(edgeId, {
      edgeId,
      startedAt: currentTime(),
      durationMs: EDGE_SHAKE_DURATION_MS,
      basePosition,
    });
    bundle.group.userData = {
      ...bundle.group.userData,
      shakeState: { active: true, edgeId, progress: 0, offset: 0, durationMs: EDGE_SHAKE_DURATION_MS },
    };
  }

  function pulseNode(nodeId) {
    if (destroyed) return;
    const mesh = nodeMeshes.get(nodeId);
    if (!mesh) return;

    const baseScale = { x: 1, y: 1, z: 1 };
    mesh.scale.set(baseScale.x, baseScale.y, baseScale.z);
    if (prefersReducedMotion()) {
      nodePulseStates.delete(nodeId);
      mesh.userData = {
        ...mesh.userData,
        pulseState: { active: false, nodeId, progress: 1, scale: 1, durationMs: 0 },
      };
      return;
    }
    nodePulseStates.set(nodeId, {
      nodeId,
      startedAt: currentTime(),
      durationMs: NODE_PULSE_DURATION_MS,
      baseScale,
    });
    mesh.userData = {
      ...mesh.userData,
      pulseState: { active: true, nodeId, progress: 0, scale: 1, durationMs: NODE_PULSE_DURATION_MS },
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimation(frame);
    frame = null;
    cancelActivePointers();
    resetTransientVisualStates();
    if (typeof resizeTarget?.removeEventListener === "function") resizeTarget.removeEventListener("resize", resize);
    if (typeof visibilityTarget?.removeEventListener === "function") visibilityTarget.removeEventListener("visibilitychange", handleVisibilityChange);
    removePointerListeners();
    clearEdgeMeshes();
    clearNodeMeshes();
    clearSphereBackdrop();
    scene.remove(graphRoot);
    renderer.dispose?.();
    removeElement(mount, zoomControls?.element);
    removeCanvas(mount, renderer.domElement);
  }

  update(current);

  return {
    scene,
    graphRoot,
    camera,
    renderer,
    update,
    markLegal,
    shakeEdge,
    pulseNode,
    focusEdge,
    zoomIn,
    zoomOut,
    resetZoom,
    destroy,
    get config() {
      return current;
    },
    get legalEdges() {
      return new Set(legalEdges);
    },
    get edgeMeshes() {
      return new Map(edgeMeshes);
    },
    get nodeMeshes() {
      return new Map(nodeMeshes);
    },
    get zoomControls() {
      return zoomControls;
    },
    get zoom() {
      return cameraState.zoom;
    },
    get cameraState() {
      return { ...cameraState };
    },
  };
}
