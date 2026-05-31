import { test } from "node:test";
import assert from "node:assert/strict";

import { edgeEnds, makeConfig, nodeSlack } from "../src/engine.js";
import { generateLock, makeRng } from "../src/generator.js";
import { LEVELS, TUTORIALS } from "../src/levels.js";
import * as THREE_MOCK from "./helpers/three-mock.js";

function fakeElement(tagName = "div") {
  const children = [];
  const listeners = {};
  const classes = new Set();
  const attributes = {};
  return {
    tagName,
    children,
    style: {
      setProperty(name, value) {
        this[name] = value;
      },
      removeProperty(name) {
        delete this[name];
      },
    },
    dataset: {},
    textContent: "",
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, on) {
        if (on === undefined) on = !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
      contains: (name) => classes.has(name),
    },
    appendChild(child) {
      children.push(child);
      child._parent = this;
      return child;
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      if (child._parent === this) child._parent = null;
      return child;
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners[type] || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    dispatchEvent(type, event = {}) {
      for (const fn of listeners[type] || []) fn(event);
    },
    getBoundingClientRect() {
      return { width: 320, height: 640, top: 0, left: 0 };
    },
  };
}

function installRender3dEnv() {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    performance: globalThis.performance,
  };

  globalThis.document = {
    createElement: (tagName) => fakeElement(tagName),
    createElementNS: (_ns, tagName) => fakeElement(tagName),
    body: fakeElement("body"),
  };
  globalThis.window = {
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback(0);
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.performance = { now: () => 0 };

  return () => {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    globalThis.cancelAnimationFrame = previous.cancelAnimationFrame;
    globalThis.performance = previous.performance;
  };
}

function magnitude(point) {
  return Math.hypot(point.x, point.y, point.z);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function collectObjects(root) {
  const objects = [];
  root.traverse((object) => objects.push(object));
  return objects;
}

function objectsByKind(root, kind) {
  return collectObjects(root).filter((object) => object.userData?.kind === kind);
}

function quaternionSnapshot(quaternion) {
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

function quaternionDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w);
}

const CLOSE_NODE_LEVEL = Object.freeze({
  id: "close-node-relaxation",
  target: "a-to-b",
  nodes: Object.freeze([
    Object.freeze({ id: "a", x: 50, y: 80 }),
    Object.freeze({ id: "b", x: 50, y: 80 }),
  ]),
  edges: Object.freeze([
    Object.freeze({ id: "a-to-b", u: "a", v: "b", w: 2, dir: "uv" }),
    Object.freeze({ id: "b-to-a", u: "a", v: "b", w: 2, dir: "vu" }),
  ]),
});

function rotatePointByQuaternion(point, quaternion) {
  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w) || 1;
  const values = {
    x: quaternion.x / length,
    y: quaternion.y / length,
    z: quaternion.z / length,
    w: quaternion.w / length,
  };
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

function targetFacingPoint(board, edgeId) {
  const points = board.edgeMeshes.get(edgeId).arc.userData.pathPoints;
  return points[Math.floor(points.length / 2)];
}

function createPointerThreeMock() {
  class PointerRenderer extends THREE_MOCK.WebGLRenderer {
    constructor(parameters = {}) {
      super(parameters);
      const canvas = fakeElement("canvas");
      let capturedPointerId = null;
      canvas.nodeName = "CANVAS";
      canvas.width = 0;
      canvas.height = 0;
      canvas.getContext = () => null;
      canvas.setPointerCapture = (pointerId) => {
        capturedPointerId = pointerId;
      };
      canvas.releasePointerCapture = (pointerId) => {
        if (capturedPointerId === pointerId) capturedPointerId = null;
      };
      Object.defineProperty(canvas, "capturedPointerId", { get: () => capturedPointerId });
      this.domElement = canvas;
    }
  }

  return { ...THREE_MOCK, WebGLRenderer: PointerRenderer };
}

function createRaycastScopeThreeMock(scopes) {
  const base = createPointerThreeMock();

  class ScopeRaycaster extends base.Raycaster {
    intersectObjects(objects, recursive = false) {
      scopes.push({ kinds: objects.map((object) => object.userData?.kind), recursive });
      return super.intersectObjects(objects, recursive);
    }
  }

  return { ...base, Raycaster: ScopeRaycaster };
}

function assertNearPoint(actual, expected, tolerance, message) {
  assert.ok(distance(actual, expected) <= tolerance, message || `expected ${JSON.stringify(actual)} near ${JSON.stringify(expected)}`);
}

function makeEdgeNearest(board, edgeId) {
  for (const [index, candidate] of [...board.edgeMeshes.values()].entries()) candidate.hitTarget.userData.distance = index + 10;
  board.edgeMeshes.get(edgeId).hitTarget.userData.distance = 0;
}

async function loadRender3d() {
  const restore = installRender3dEnv();
  try {
    return await import("../src/render3d.js");
  } catch (error) {
    return { error };
  } finally {
    restore();
  }
}

test("render3d: createBoard3d exports the expected board API", async (t) => {
  const mod = await loadRender3d();

  await t.test("exports createBoard3d as a function", () => {
    assert.equal(typeof mod.createBoard3d, "function");
  });

  await t.test("can construct a board that exposes update()", () => {
    assert.equal(typeof mod.createBoard3d, "function");
    const host = fakeElement("div");
    const board = mod.createBoard3d(host, makeConfig(TUTORIALS[0]), { THREE: THREE_MOCK });

    assert.equal(typeof board.update, "function");
    assert.equal(board.camera.fov, 45);
    assert.ok(board.camera.position.z > 60, "portrait default camera distance should fit the full sphere inside the board");
    assert.equal(board.cameraState.zoom, 1.15);
    assert.equal(board.cameraState.minZoom, 0.75);
    assert.equal(board.cameraState.maxZoom, 2.2);
    assert.equal(board.renderer.parameters.antialias, true);
    assert.equal(board.renderer.parameters.alpha, true);
    assert.equal(host.children.includes(board.renderer.domElement), true);
    board.destroy();
  });
});

test("render3d: default camera framing fits portrait boards and zoom controls clamp accessibly", async () => {
  const mod = await loadRender3d();
  const restore = installRender3dEnv();
  const host = fakeElement("div");
  let board = null;

  try {
    board = mod.createBoard3d(host, makeConfig(TUTORIALS[0]), { THREE: THREE_MOCK });
    const initialZ = board.camera.position.z;
    const controls = board.zoomControls;

    assert.ok(initialZ > 60, "phone portrait framing should pull the camera back from the old cropped default");
    assert.equal(board.cameraState.fitDistance / board.cameraState.zoom, initialZ);
    assert.equal(host.children.includes(board.renderer.domElement), true);
    assert.equal(host.children.includes(controls.element), true);
    assert.equal(controls.element.getAttribute("role"), "group");
    assert.equal(controls.element.getAttribute("aria-label"), "Board zoom controls");
    assert.equal(controls.outButton.getAttribute("aria-label"), "Zoom board out");
    assert.equal(controls.resetButton.getAttribute("aria-label"), "Reset board zoom to 115 percent");
    assert.equal(controls.inButton.getAttribute("aria-label"), "Zoom board in");
    assert.equal(controls.outButton.disabled, false);
    assert.equal(controls.inButton.disabled, false);

    controls.inButton.dispatchEvent("click", { preventDefault() {} });
    assert.ok(Math.abs(board.zoom - 1.35) <= 1e-12);
    assert.ok(board.camera.position.z < initialZ, "zooming in should move the camera closer");

    for (let index = 0; index < 12; index += 1) board.zoomIn();
    assert.equal(board.zoom, 2.2);
    assert.equal(controls.inButton.disabled, true);
    assert.equal(controls.outButton.disabled, false);

    for (let index = 0; index < 20; index += 1) board.zoomOut();
    assert.equal(board.zoom, 0.75);
    assert.equal(controls.outButton.disabled, true);
    assert.equal(controls.inButton.disabled, false);
    assert.ok(board.camera.position.z > initialZ, "zooming out should move the camera farther away");

    controls.resetButton.dispatchEvent("click", { preventDefault() {} });
    assert.equal(board.zoom, 1.15);
    assert.equal(board.camera.position.z, initialZ);
    assert.equal(controls.outButton.disabled, false);
    assert.equal(controls.inButton.disabled, false);

    board.destroy();
    assert.equal(host.children.includes(controls.element), false);
    assert.equal(host.children.includes(board.renderer.domElement), false);
  } finally {
    board?.destroy();
    restore();
  }
});

test("render3d: unavailable WebGL returns an accessible fallback board without constructing a renderer", async () => {
  const mod = await loadRender3d();
  const restore = installRender3dEnv();
  const first = makeConfig(TUTORIALS[0]);
  const second = makeConfig(TUTORIALS[1]);
  const host = fakeElement("svg");
  let rendererConstructed = 0;

  class ThrowingRenderer extends THREE_MOCK.WebGLRenderer {
    constructor(parameters = {}) {
      rendererConstructed += 1;
      super(parameters);
      throw new Error("WebGLRenderer must not be constructed when WebGL is unavailable");
    }
  }

  try {
    const board = mod.createBoard3d(host, first, {
      THREE: { ...THREE_MOCK, WebGLRenderer: ThrowingRenderer },
      webglAvailable: false,
    });

    assert.equal(rendererConstructed, 0);
    assert.equal(board.webglAvailable, false);
    assert.equal(board.renderer, null);
    assert.equal(board.scene, null);
    assert.equal(host.children.includes(board.errorElement), true);
    assert.equal(board.errorElement.tagName, "foreignObject");
    assert.equal(board.errorElement.getAttribute("width"), "100%");
    assert.equal(board.errorElement.getAttribute("height"), "100%");

    const content = board.errorElement.children[0];
    assert.equal(content.getAttribute("role"), "status");
    assert.equal(content.getAttribute("aria-live"), "polite");
    assert.equal(content.getAttribute("aria-label"), "3D graphics unavailable");
    assert.equal(content.children[0].textContent, "3D Graphics Unavailable");
    assert.match(content.children[1].textContent, /WebGL\/3D graphics are unavailable/);
    assert.match(content.children[1].textContent, /Try another browser/);
    assert.equal(content.style.display, "flex");
    assert.equal(content.style.background, "var(--bg-surface)");
    assert.equal(content.style.color, "var(--c-white)");

    assert.equal(typeof board.update, "function");
    assert.equal(typeof board.markLegal, "function");
    assert.equal(typeof board.shakeEdge, "function");
    assert.equal(typeof board.pulseNode, "function");
    assert.equal(typeof board.destroy, "function");
    assert.equal(typeof board.focusEdge, "function");

    board.markLegal(["a", "b"]);
    assert.deepEqual([...board.legalEdges], ["a", "b"]);
    board.update(second);
    assert.equal(board.config, second);
    board.shakeEdge("missing");
    board.pulseNode("missing");
    assert.equal(board.focusEdge("missing"), false);

    board.destroy();
    assert.equal(host.children.includes(board.errorElement), false);
    board.update(first);
    assert.equal(board.config, second, "destroyed fallback board should ignore later updates");
  } finally {
    restore();
  }
});

test("render3d: board cleanup surface includes markLegal(), shakeEdge(), pulseNode(), and destroy()", async (t) => {
  const mod = await loadRender3d();

  await t.test("exposes the interaction methods", () => {
    assert.equal(typeof mod.createBoard3d, "function");
    const host = fakeElement("div");
    const board = mod.createBoard3d(host, makeConfig(TUTORIALS[0]), { THREE: THREE_MOCK });

    assert.equal(typeof board.markLegal, "function");
    assert.equal(typeof board.shakeEdge, "function");
    assert.equal(typeof board.pulseNode, "function");
    assert.equal(typeof board.destroy, "function");
    board.destroy();
  });

  await t.test("destroy() is the cleanup entry point", () => {
    assert.equal(typeof mod.createBoard3d, "function");
    const host = fakeElement("div");
    const board = mod.createBoard3d(host, makeConfig(TUTORIALS[0]), { THREE: THREE_MOCK });

    assert.equal(host.children.includes(board.renderer.domElement), true);
    board.destroy();
    assert.equal(typeof board.destroy, "function");
    assert.equal(host.children.includes(board.renderer.domElement), false);
  });
});


test("render3d: caps device pixel ratio for high-density mobile screens", async () => {
  const mod = await loadRender3d();
  const previousWindow = globalThis.window;
  let resizeHandler = null;
  let board = null;

  globalThis.window = {
    devicePixelRatio: 4,
    addEventListener(type, fn) {
      if (type === "resize") resizeHandler = fn;
    },
    removeEventListener() {},
  };

  try {
    const host = fakeElement("div");
    board = mod.createBoard3d(host, makeConfig(TUTORIALS[0]), { THREE: THREE_MOCK });

    assert.equal(board.renderer.pixelRatio, 2, "DPR must be capped at 2 on initial render");

    globalThis.window.devicePixelRatio = 1.5;
    resizeHandler?.();
    assert.equal(board.renderer.pixelRatio, 1.5, "DPR below the cap should be preserved");

    globalThis.window.devicePixelRatio = 0.5;
    resizeHandler?.();
    assert.equal(board.renderer.pixelRatio, 1, "DPR must not drop below 1");
  } finally {
    board?.destroy();
    globalThis.window = previousWindow;
  }
});

test("render3d: hidden documents pause the render loop and resume when visible", async () => {
  const mod = await loadRender3d();
  const previousDocument = globalThis.document;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const previousPerformance = globalThis.performance;
  const listeners = {};
  const frames = new Map();
  const cancelled = new Set();
  let nextFrameId = 1;
  let board = null;

  class CountingRenderer extends THREE_MOCK.WebGLRenderer {
    constructor(parameters = {}) {
      super(parameters);
      this.renderCalls = 0;
    }

    render(scene, camera) {
      this.renderCalls += 1;
      super.render(scene, camera);
    }
  }

  function dispatchVisibilityChange() {
    for (const fn of listeners.visibilitychange || []) fn();
  }

  globalThis.document = {
    hidden: true,
    visibilityState: "hidden",
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners[type] || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    cancelled.add(id);
  };
  globalThis.performance = { now: () => 0 };

  try {
    const host = fakeElement("div");
    board = mod.createBoard3d(host, makeConfig(TUTORIALS[0]), { THREE: { ...THREE_MOCK, WebGLRenderer: CountingRenderer } });

    assert.equal(frames.size, 0, "initial hidden document must not schedule RAF work");
    assert.equal(board.renderer.renderCalls, 0);

    globalThis.document.hidden = false;
    globalThis.document.visibilityState = "visible";
    dispatchVisibilityChange();

    assert.equal(frames.size, 1, "visible document should schedule one RAF");
    const firstFrame = [...frames.entries()][0];
    frames.delete(firstFrame[0]);
    firstFrame[1](16);

    assert.equal(board.renderer.renderCalls, 1, "visible RAF should render exactly once");
    assert.equal(frames.size, 1, "render loop should schedule the next visible frame");

    const secondFrame = [...frames.entries()][0];
    globalThis.document.hidden = true;
    globalThis.document.visibilityState = "hidden";
    dispatchVisibilityChange();

    assert.equal(cancelled.has(secondFrame[0]), true, "hidden document should cancel pending RAF");
    secondFrame[1](32);
    assert.equal(board.renderer.renderCalls, 1, "cancelled hidden-frame callback must not render if delivered late");

    globalThis.document.hidden = false;
    globalThis.document.visibilityState = "visible";
    dispatchVisibilityChange();
    assert.equal([...frames.keys()].some((id) => !cancelled.has(id)), true, "visibility restore should resume RAF scheduling");
  } finally {
    board?.destroy();
    globalThis.document = previousDocument;
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
    globalThis.performance = previousPerformance;
  }
});


test("render3d: projectToSphere maps portrait board coordinates onto a radius-length sphere", async (t) => {
  const mod = await loadRender3d();
  const radius = 12;
  const tolerance = 1e-9;

  await t.test("exports projectToSphere as a pure coordinate helper", () => {
    assert.equal(typeof mod.projectToSphere, "function");
    const first = mod.projectToSphere(50, 80, radius);
    const second = mod.projectToSphere(50, 80, radius);

    assert.deepEqual(first, second);
    assert.deepEqual(first, { x: 0, y: 0, z: radius });
  });

  await t.test("corners, center, and authored nodes stay on the requested sphere", () => {
    const samples = [
      { id: "top-left", x: 0, y: 0 },
      { id: "top-right", x: 100, y: 0 },
      { id: "center", x: 50, y: 80 },
      { id: "bottom-left", x: 0, y: 160 },
      { id: "bottom-right", x: 100, y: 160 },
      ...LEVELS.flatMap((level) => level.nodes.map((node) => ({ ...node, id: `${level.id}:${node.id}` }))),
    ];

    for (const sample of samples) {
      const point = mod.projectToSphere(sample.x, sample.y, radius);
      assert.ok(
        Math.abs(magnitude(point) - radius) <= tolerance,
        `${sample.id}: projected magnitude ${magnitude(point)} differs from radius ${radius}`
      );
    }
  });
});

test("render3d: projectToSphere keeps graph neighbors visually local on the sphere", async () => {
  const mod = await loadRender3d();
  const radius = 12;
  const maxNeighborDistance = radius * 0.9;

  for (const level of LEVELS) {
    const nodes = new Map(level.nodes.map((node) => [node.id, node]));
    for (const edge of level.edges) {
      const u = nodes.get(edge.u);
      const v = nodes.get(edge.v);
      const a = mod.projectToSphere(u.x, u.y, radius);
      const b = mod.projectToSphere(v.x, v.y, radius);
      const projectedDistance = distance(a, b);

      assert.ok(
        projectedDistance <= maxNeighborDistance,
        `${level.id}:${edge.id} endpoints scattered too far (${projectedDistance.toFixed(3)} > ${maxNeighborDistance.toFixed(3)})`
      );
    }
  }
});


test("render3d: relaxProjectedNodes deterministically separates overlapping nodes on the sphere", async () => {
  const mod = await loadRender3d();
  const radius = 12;
  const tolerance = 1e-9;
  const raw = new Map(CLOSE_NODE_LEVEL.nodes.map((node) => [node.id, mod.projectToSphere(node.x, node.y, radius)]));
  const first = mod.relaxProjectedNodes(CLOSE_NODE_LEVEL, radius);
  const second = mod.relaxProjectedNodes(CLOSE_NODE_LEVEL, radius);
  const rawDistance = distance(raw.get("a"), raw.get("b"));
  const relaxedDistance = distance(first.get("a"), first.get("b"));

  assert.equal(typeof mod.relaxProjectedNodes, "function");
  assert.deepEqual(first, second);
  assert.ok(relaxedDistance > rawDistance + 0.5, `expected relaxation to separate overlap beyond raw distance ${rawDistance}`);
  assert.ok(relaxedDistance <= 1.2, `relaxed close edge should remain visually local (${relaxedDistance})`);
  for (const node of CLOSE_NODE_LEVEL.nodes) {
    const relaxed = first.get(node.id);
    assert.ok(Math.abs(magnitude(relaxed) - radius) <= tolerance, `${node.id}: relaxed point must stay on sphere radius`);
    assert.ok(distance(relaxed, raw.get(node.id)) <= 0.7, `${node.id}: relaxation should stay near the raw projection`);
  }
});

test("render3d: relaxProjectedNodes keeps authored edge endpoints bounded and deterministic", async () => {
  const mod = await loadRender3d();
  const radius = 12;
  const maxNeighborDistance = radius * 0.9;

  for (const level of LEVELS) {
    const first = mod.relaxProjectedNodes(level, radius);
    const second = mod.relaxProjectedNodes(level, radius);

    assert.deepEqual(first, second, `${level.id}: relaxation must be deterministic`);
    for (const node of level.nodes) {
      assert.ok(Math.abs(magnitude(first.get(node.id)) - radius) <= 1e-9, `${level.id}:${node.id} must stay on radius`);
    }
    for (const edge of level.edges) {
      const endpointDistance = distance(first.get(edge.u), first.get(edge.v));
      assert.ok(
        endpointDistance <= maxNeighborDistance,
        `${level.id}:${edge.id} relaxed endpoints scattered too far (${endpointDistance.toFixed(3)} > ${maxNeighborDistance.toFixed(3)})`
      );
    }
  }
});


test("render3d: relaxProjectedNodes keeps generated samples bounded and deterministic", async () => {
  const mod = await loadRender3d();
  const radius = 12;
  const maxNeighborDistance = radius * 0.9;
  const generated = [
    generateLock(1, makeRng(8801)),
    generateLock(4, makeRng(8804)),
    generateLock(8, makeRng(8808)),
  ];

  for (const level of generated) {
    const first = mod.relaxProjectedNodes(level, radius);
    const second = mod.relaxProjectedNodes(level, radius);

    assert.deepEqual(first, second, `${level.id}: generated relaxation must be deterministic`);
    for (const node of level.nodes) {
      assert.ok(Math.abs(magnitude(first.get(node.id)) - radius) <= 1e-9, `${level.id}:${node.id} generated node must stay on radius`);
    }
    for (const edge of level.edges) {
      const endpointDistance = distance(first.get(edge.u), first.get(edge.v));
      assert.ok(
        endpointDistance <= maxNeighborDistance,
        `${level.id}:${edge.id} generated relaxed endpoints scattered too far (${endpointDistance.toFixed(3)} > ${maxNeighborDistance.toFixed(3)})`
      );
    }
  }
});


test("render3d: createBoard3d adds an opaque non-interactive sphere surface behind the graph", async () => {
  const mod = await loadRender3d();
  const first = makeConfig(TUTORIALS[0]);
  const second = makeConfig(TUTORIALS[2]);
  const host = fakeElement("div");
  const board = mod.createBoard3d(host, first, { THREE: THREE_MOCK });

  assert.equal(board.graphRoot.userData.kind, "graph-root");
  assert.equal(board.scene.children.includes(board.graphRoot), true);

  const surface = objectsByKind(board.scene, "sphere-surface")[0];
  const wireframe = objectsByKind(board.scene, "sphere-wireframe")[0];
  assert.ok(surface, "missing opaque sphere surface backdrop");
  assert.ok(wireframe, "missing sphere wireframe overlay");
  assert.equal(objectsByKind(board.scene, "sphere-surface").length, 1);
  assert.equal(objectsByKind(board.scene, "sphere-wireframe").length, 1);
  assert.equal(surface.type, "Mesh");
  assert.equal(surface.name, "sphere-surface");
  assert.equal(surface.geometry.type, "SphereGeometry");
  assert.equal(surface.geometry.parameters.radius, 11.82);
  assert.equal(surface.geometry.parameters.widthSegments, 48);
  assert.equal(surface.geometry.parameters.heightSegments, 24);
  assert.equal(surface.material.type, "MeshBasicMaterial");
  assert.equal(surface.material.color.hex, 0x07090f);
  assert.equal(surface.material.transparent, false);
  assert.equal(surface.material.opacity, 1);
  assert.equal(surface.material.depthWrite, true);
  assert.equal(surface.material.wireframe, false);
  assert.equal(surface.renderOrder, -2);
  assert.equal(surface.userData.interactive, false);
  assert.equal(surface.userData.raycast, false);
  assert.equal(new THREE_MOCK.Raycaster().intersectObject(surface, true).length, 0);

  assert.equal(wireframe.type, "Mesh");
  assert.equal(wireframe.name, "sphere-wireframe");
  assert.equal(wireframe.geometry.type, "IcosahedronGeometry");
  assert.equal(wireframe.geometry.parameters.radius, 12.02);
  assert.equal(wireframe.material.type, "MeshBasicMaterial");
  assert.equal(wireframe.material.color.hex, 0x77777f);
  assert.equal(wireframe.material.transparent, true);
  assert.ok(Math.abs(wireframe.material.opacity - 0.22) <= 0.01);
  assert.equal(wireframe.material.wireframe, true);
  assert.equal(wireframe.renderOrder, -1);
  assert.equal(wireframe.userData.interactive, false);
  assert.equal(wireframe.userData.raycast, false);
  assert.equal(new THREE_MOCK.Raycaster().intersectObject(wireframe, true).length, 0);
  for (const sphere of [surface, wireframe]) {
    assert.equal([...board.nodeMeshes.values()].includes(sphere), false);
    assert.equal([...board.edgeMeshes.values()].some((bundle) => Object.values(bundle).includes(sphere)), false);
  }

  const firstGraphIndex = board.graphRoot.children.findIndex((child) => child.userData?.kind === "edge-group" || child.userData?.kind === "node");
  assert.ok(firstGraphIndex > board.graphRoot.children.indexOf(surface), "sphere surface must stay earlier in graph root children than graph meshes");
  assert.ok(firstGraphIndex > board.graphRoot.children.indexOf(wireframe), "sphere wireframe must stay earlier in graph root children than graph meshes");
  assert.ok(board.graphRoot.children.indexOf(surface) < board.graphRoot.children.indexOf(wireframe), "opaque sphere should render below the wire overlay");

  board.update(second);
  assert.equal(objectsByKind(board.scene, "sphere-surface").length, 1);
  assert.equal(objectsByKind(board.scene, "sphere-surface")[0], surface);
  assert.equal(objectsByKind(board.scene, "sphere-wireframe").length, 1);
  assert.equal(objectsByKind(board.scene, "sphere-wireframe")[0], wireframe);

  let disposedSurfaceGeometry = false;
  let disposedSurfaceMaterial = false;
  let disposedWireGeometry = false;
  let disposedWireMaterial = false;
  surface.geometry.dispose = () => {
    disposedSurfaceGeometry = true;
  };
  surface.material.dispose = () => {
    disposedSurfaceMaterial = true;
  };
  wireframe.geometry.dispose = () => {
    disposedWireGeometry = true;
  };
  wireframe.material.dispose = () => {
    disposedWireMaterial = true;
  };

  board.destroy();

  assert.equal(collectObjects(board.scene).includes(surface), false);
  assert.equal(collectObjects(board.scene).includes(wireframe), false);
  assert.equal(disposedSurfaceGeometry, true);
  assert.equal(disposedSurfaceMaterial, true);
  assert.equal(disposedWireGeometry, true);
  assert.equal(disposedWireMaterial, true);
});


test("render3d: update() renders one node mesh per config node on the sphere surface", async () => {
  const mod = await loadRender3d();
  const radius = 12;
  const tolerance = 1e-9;
  const config = makeConfig(TUTORIALS[2]);
  const host = fakeElement("div");
  const board = mod.createBoard3d(host, config, { THREE: THREE_MOCK });

  board.update(config);

  assert.equal(board.nodeMeshes.size, config.level.nodes.length);
  for (const node of config.level.nodes) {
    const mesh = board.nodeMeshes.get(node.id);
    assert.ok(mesh, `missing node mesh for ${node.id}`);
    assert.equal(mesh.type, "Mesh");
    assert.equal(mesh.geometry.type, "SphereGeometry");
    assert.equal(mesh.geometry.parameters.widthSegments, 12);
    assert.equal(mesh.geometry.parameters.heightSegments, 8);
    assert.equal(mesh.visible, true);
    assert.equal(mesh.userData.nodeId, node.id);
    assert.equal(mesh.userData.kind, "node");

    const expected = mod.relaxProjectedNodes(config.level, radius).get(node.id);
    assert.deepEqual({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }, expected);
    assert.ok(
      Math.abs(magnitude(mesh.position) - radius) <= tolerance,
      `${node.id}: node mesh position must stay on radius ${radius}`
    );
  }

  board.destroy();
});

test("render3d: update() renders great-circle edge arcs with arrowheads and hit targets", async () => {
  const mod = await loadRender3d();
  const radius = 12;
  const tolerance = 1e-9;
  const config = makeConfig(TUTORIALS[1]);
  const host = fakeElement("div");
  const board = mod.createBoard3d(host, config, { THREE: THREE_MOCK });

  board.update(config);

  const copiedEdgeMeshes = board.edgeMeshes;
  assert.equal(copiedEdgeMeshes.size, config.level.edges.length);
  copiedEdgeMeshes.clear();
  assert.equal(board.edgeMeshes.size, config.level.edges.length, "edgeMeshes getter must not expose the internal Map");

  const edgeGroups = objectsByKind(board.scene, "edge-group");
  assert.equal(edgeGroups.length, config.level.edges.length);
  assert.equal(edgeGroups.flatMap((group) => group.children.filter((child) => child.userData?.kind === "edge-arc" && child.visible)).length, config.level.edges.length);

  const relaxedPositions = mod.relaxProjectedNodes(config.level, radius);
  const thinEdge = config.level.edges.find((edge) => edge.w === 1);
  const thickEdge = config.level.edges.find((edge) => edge.w === 2);

  assert.equal(board.edgeMeshes.get(thinEdge.id).arc.geometry.parameters.radius, 0.1);
  assert.equal(board.edgeMeshes.get(thickEdge.id).arc.geometry.parameters.radius, 0.2);
  assert.ok(board.edgeMeshes.get(thickEdge.id).arc.geometry.parameters.radius > board.edgeMeshes.get(thinEdge.id).arc.geometry.parameters.radius);

  for (const edge of config.level.edges) {
    const bundle = board.edgeMeshes.get(edge.id);
    const ends = edgeEnds(config, edge.id);
    const from = relaxedPositions.get(ends.from);
    const to = relaxedPositions.get(ends.to);
    const pathPoints = bundle.arc.userData.pathPoints;

    assert.ok(bundle, `missing edge bundle for ${edge.id}`);
    assert.equal(bundle.group.userData.edgeId, edge.id);
    assert.equal(bundle.arc.type, "Mesh");
    assert.equal(bundle.arc.geometry.type, "TubeGeometry");
    assert.equal(bundle.arc.userData.kind, "edge-arc");
    assert.equal(bundle.arc.userData.from, ends.from);
    assert.equal(bundle.arc.userData.to, ends.to);
    assert.equal(bundle.arc.material.color.hex, edge.id === config.level.target ? 0xff3333 : 0xd8d8de);
    assert.equal(bundle.arc.material.transparent, true);
    assert.equal(bundle.arc.material.depthWrite, false, "visible edge tubes must not write depth while transparent");
    assert.equal(bundle.arc.material.opacity, 1);
    assert.equal(bundle.arrowhead.geometry.type, "ConeGeometry");
    assert.equal(bundle.arrowhead.userData.kind, "edge-arrowhead");
    assert.equal(bundle.arrowhead.userData.to, ends.to);
    assert.equal(bundle.arrowhead.material.transparent, true);
    assert.equal(bundle.arrowhead.material.depthWrite, false, "arrowheads must not write depth while transparent");
    assert.equal(bundle.arrowhead.material.side, THREE_MOCK.DoubleSide, "arrowheads must render both cone faces at oblique/back angles");
    assert.equal(bundle.arrowhead.material.opacity, 1);
    assert.ok(distance(bundle.arrowhead.position, to) < distance(bundle.arrowhead.position, from), `${edge.id}: arrowhead must sit near current target endpoint`);
    assert.ok(Math.abs(magnitude(bundle.arrowhead.userData.direction) - 1) <= tolerance, `${edge.id}: arrowhead direction must be normalized`);
    assert.equal(bundle.arc.geometry.parameters.tubularSegments, 16);
    assert.equal(bundle.arc.geometry.parameters.radialSegments, 6);
    assert.equal(bundle.arrowhead.geometry.parameters.radialSegments, 8);
    assert.equal(pathPoints.length, 17);
    assert.equal(bundle.hitTarget.geometry.type, "TubeGeometry");
    assert.equal(bundle.hitTarget.geometry.parameters.radius, 0.42);
    assert.equal(bundle.hitTarget.geometry.parameters.tubularSegments, 16);
    assert.equal(bundle.hitTarget.geometry.parameters.radialSegments, 6);
    assert.equal(bundle.hitTarget.material.transparent, true);
    assert.equal(bundle.hitTarget.material.opacity, 0);
    assert.equal(bundle.hitTarget.material.depthWrite, false, "invisible hit targets must not occlude visible arrows");
    assert.equal(bundle.hitTarget.visible, true);
    assert.equal(bundle.hitTarget.userData.kind, "edge-hit");
    assert.equal(bundle.group.children.includes(bundle.arc), true);
    assert.equal(bundle.group.children.includes(bundle.arrowhead), true);
    assert.equal(bundle.group.children.includes(bundle.hitTarget), true);
    assertNearPoint(pathPoints[0], from, tolerance, `${edge.id}: arc starts at projected current sender`);
    assertNearPoint(pathPoints.at(-1), to, tolerance, `${edge.id}: arc ends at projected current receiver`);
    for (const point of pathPoints) {
      assert.ok(Math.abs(magnitude(point) - radius) <= tolerance, `${edge.id}: arc point must stay on radius ${radius}`);
    }
  }

  board.destroy();
});

test("render3d: createBoard3d uses relaxed positions consistently for close-node meshes and edges", async () => {
  const mod = await loadRender3d();
  const radius = 12;
  const tolerance = 1e-9;
  const config = makeConfig(CLOSE_NODE_LEVEL);
  const relaxedPositions = mod.relaxProjectedNodes(config.level, radius);
  const host = fakeElement("div");
  const board = mod.createBoard3d(host, config, { THREE: THREE_MOCK });

  assert.ok(distance(relaxedPositions.get("a"), relaxedPositions.get("b")) > 0.5);
  for (const node of config.level.nodes) {
    const mesh = board.nodeMeshes.get(node.id);
    assertNearPoint(mesh.position, relaxedPositions.get(node.id), tolerance, `${node.id}: node mesh should use relaxed position`);
  }

  for (const edge of config.level.edges) {
    const bundle = board.edgeMeshes.get(edge.id);
    const ends = edgeEnds(config, edge.id);
    assertNearPoint(bundle.arc.userData.pathPoints[0], relaxedPositions.get(ends.from), tolerance, `${edge.id}: arc starts at relaxed sender`);
    assertNearPoint(bundle.arc.userData.pathPoints.at(-1), relaxedPositions.get(ends.to), tolerance, `${edge.id}: arc ends at relaxed receiver`);
    assert.ok(distance(bundle.arrowhead.position, relaxedPositions.get(ends.to)) < distance(bundle.arrowhead.position, relaxedPositions.get(ends.from)));
  }

  board.nodeMeshes.get("a").position.set(1, 2, 3);
  board.update(config);
  assertNearPoint(board.nodeMeshes.get("a").position, relaxedPositions.get("a"), tolerance, "update() should reset mesh from relaxed config position");
  assert.equal(board.edgeMeshes.get(config.level.target).arc.userData.frontFacing, true, "target orientation should be based on relaxed edge midpoint");

  board.destroy();
});

test("render3d: default orientation starts authored target edges and graph context front-facing", async () => {
  const mod = await loadRender3d();

  for (const level of [...TUTORIALS, ...LEVELS]) {
    const config = makeConfig(level);
    const host = fakeElement("div");
    const board = mod.createBoard3d(host, config, { THREE: THREE_MOCK });
    const targetBundle = board.edgeMeshes.get(config.level.target);
    const localTargetPoint = targetFacingPoint(board, config.level.target);
    const orientedTargetPoint = rotatePointByQuaternion(localTargetPoint, board.graphRoot.quaternion);
    const targetEnds = edgeEnds(config, config.level.target);
    const frontNodes = [...board.nodeMeshes.values()].filter((mesh) => mesh.userData.frontFacing);
    const frontEdges = [...board.edgeMeshes.values()].filter((bundle) => bundle.group.userData.frontFacing);

    assert.equal(targetBundle.arc.userData.frontFacing, true, `${level.id}: target arc should start front-facing`);
    assert.equal(targetBundle.arrowhead.userData.frontFacing, true, `${level.id}: target arrowhead should start front-facing`);
    assert.equal(targetBundle.group.userData.frontFacing, true, `${level.id}: target group should start front-facing`);
    assert.equal(targetBundle.arc.material.opacity, 1, `${level.id}: target arc should start fully visible`);
    assert.equal(targetBundle.arrowhead.material.opacity, 1, `${level.id}: target arrowhead should start fully visible`);
    assert.equal(board.nodeMeshes.get(targetEnds.from).userData.frontFacing, true, `${level.id}: target sender should start on the front hemisphere`);
    assert.equal(board.nodeMeshes.get(targetEnds.to).userData.frontFacing, true, `${level.id}: target receiver should start on the front hemisphere`);
    assert.ok(frontNodes.length >= Math.ceil(config.level.nodes.length / 2), `${level.id}: at least half the graph nodes should start front-visible`);
    assert.ok(frontEdges.length >= Math.ceil(config.level.edges.length / 2), `${level.id}: at least half the graph edges should start front-visible`);
    assert.ok(orientedTargetPoint.z > 9.5, `${level.id}: target should be on the near front cap`);
    assert.ok(Math.hypot(orientedTargetPoint.x, orientedTargetPoint.y) > 0.5, `${level.id}: target should not be dead-center flat`);

    board.destroy();
  }
});

test("render3d: default orientation is deterministic for the same config", async () => {
  const mod = await loadRender3d();
  const config = makeConfig(TUTORIALS[5]);
  const firstHost = fakeElement("div");
  const secondHost = fakeElement("div");
  const first = mod.createBoard3d(firstHost, config, { THREE: THREE_MOCK });
  const second = mod.createBoard3d(secondHost, config, { THREE: THREE_MOCK });
  const firstQuaternion = quaternionSnapshot(first.graphRoot.quaternion);
  const secondQuaternion = quaternionSnapshot(second.graphRoot.quaternion);

  assert.deepEqual(firstQuaternion, secondQuaternion);
  assert.deepEqual(first.graphRoot.userData.rotationState.quaternion, firstQuaternion);
  assert.ok(quaternionDistance(firstQuaternion, { x: 0, y: 0, z: 0, w: 1 }) > 0.001, "default orientation should do real target framing work");

  first.destroy();
  second.destroy();
});

test("render3d: empty-space pointer drag rotates the graph root with deterministic inertia state", async () => {
  const mod = await loadRender3d();
  const config = makeConfig(TUTORIALS[1]);
  const host = fakeElement("div");
  const calls = [];
  const board = mod.createBoard3d(host, config, { THREE: createPointerThreeMock(), onEdgeTap: (edgeId) => calls.push(edgeId) });
  const canvas = board.renderer.domElement;
  const initial = quaternionSnapshot(board.graphRoot.quaternion);
  let preventedMoves = 0;

  for (const bundle of board.edgeMeshes.values()) bundle.hitTarget.userData.raycast = false;

  canvas.dispatchEvent("pointerdown", { pointerId: 9, isPrimary: true, button: 0, clientX: 120, clientY: 180 });
  canvas.dispatchEvent("pointermove", {
    pointerId: 9,
    isPrimary: true,
    clientX: 156,
    clientY: 204,
    preventDefault() {
      preventedMoves += 1;
    },
  });

  const moved = quaternionSnapshot(board.graphRoot.quaternion);
  const state = board.graphRoot.userData.rotationState;
  assert.ok(quaternionDistance(initial, moved) > 0.001, "drag movement should change graph-root quaternion");
  assert.equal(preventedMoves, 1, "active drag movement should prevent page scrolling");
  assert.equal(state.dragging, true);
  assert.equal(state.pointerId, 9);
  assert.equal(state.velocityX, 36);
  assert.equal(state.velocityY, 24);
  assert.deepEqual(state.quaternion, moved);
  assert.deepEqual(calls, [], "empty-space drag must not activate edge tap");
  assert.equal(canvas.capturedPointerId, 9);

  canvas.dispatchEvent("pointerup", { pointerId: 9, isPrimary: true });

  assert.equal(state.dragging, false);
  assert.equal(state.pointerId, null);
  assert.equal(canvas.capturedPointerId, null);
  assert.equal(board.edgeMeshes.size, config.level.edges.length);
  assert.equal(board.nodeMeshes.size, config.level.nodes.length);
  assert.equal(objectsByKind(board.graphRoot, "sphere-wireframe").length, 1);

  board.destroy();
});

test("render3d: simple pointer click without movement does not rotate", async () => {
  const mod = await loadRender3d();
  const host = fakeElement("div");
  const board = mod.createBoard3d(host, makeConfig(TUTORIALS[0]), { THREE: createPointerThreeMock() });
  const canvas = board.renderer.domElement;
  const initial = quaternionSnapshot(board.graphRoot.quaternion);

  canvas.dispatchEvent("pointerdown", { pointerId: 4, isPrimary: true, button: 0, clientX: 80, clientY: 90 });
  canvas.dispatchEvent("pointerup", { pointerId: 4, isPrimary: true, clientX: 80, clientY: 90 });

  assert.ok(quaternionDistance(initial, quaternionSnapshot(board.graphRoot.quaternion)) <= 1e-12);
  assert.deepEqual(board.graphRoot.userData.rotationState.quaternion, initial);
  assert.equal(board.graphRoot.userData.rotationState.velocityX, 0);
  assert.equal(board.graphRoot.userData.rotationState.velocityY, 0);

  board.destroy();
});

test("render3d: reduced motion preserves direct drag but disables rotation inertia", async () => {
  const mod = await loadRender3d();
  const previousWindow = globalThis.window;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const frames = [];
  let board = null;

  globalThis.window = {
    devicePixelRatio: 1,
    matchMedia: (query) => ({ matches: query === "(prefers-reduced-motion: reduce)", addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => {};

  try {
    const host = fakeElement("div");
    board = mod.createBoard3d(host, makeConfig(TUTORIALS[1]), { THREE: createPointerThreeMock() });
    const canvas = board.renderer.domElement;
    const initial = quaternionSnapshot(board.graphRoot.quaternion);

    canvas.dispatchEvent("pointerdown", { pointerId: 41, isPrimary: true, button: 0, clientX: 120, clientY: 180 });
    canvas.dispatchEvent("pointermove", { pointerId: 41, isPrimary: true, clientX: 156, clientY: 204, preventDefault() {} });

    const dragged = quaternionSnapshot(board.graphRoot.quaternion);
    assert.ok(quaternionDistance(initial, dragged) > 0.001, "reduced motion must still honor direct drag movement");
    assert.equal(board.graphRoot.userData.rotationState.velocityX, 36);
    assert.equal(board.graphRoot.userData.rotationState.velocityY, 24);

    canvas.dispatchEvent("pointerup", { pointerId: 41, isPrimary: true });

    const released = quaternionSnapshot(board.graphRoot.quaternion);
    assert.equal(board.graphRoot.userData.rotationState.dragging, false);
    assert.equal(board.graphRoot.userData.rotationState.velocityX, 0);
    assert.equal(board.graphRoot.userData.rotationState.velocityY, 0);

    frames.shift()(16);

    assert.deepEqual(quaternionSnapshot(board.graphRoot.quaternion), released, "reduced motion must not continue inertial rotation after release");
  } finally {
    board?.destroy();
    globalThis.window = previousWindow;
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
  }
});

test("render3d: front-facing edge pointer tap raycasts hit targets and calls onEdgeTap once", async () => {
  const mod = await loadRender3d();
  const config = makeConfig(TUTORIALS[1]);
  const host = fakeElement("div");
  const calls = [];
  const raycastScopes = [];
  const board = mod.createBoard3d(host, config, { THREE: createRaycastScopeThreeMock(raycastScopes), onEdgeTap: (edgeId) => calls.push(edgeId) });
  const canvas = board.renderer.domElement;
  const edge = config.level.edges[1];
  const bundle = board.edgeMeshes.get(edge.id);
  let prevented = 0;

  for (const [index, candidate] of [...board.edgeMeshes.values()].entries()) candidate.hitTarget.userData.distance = index + 10;
  bundle.hitTarget.userData.distance = 0;
  bundle.arc.userData.distance = -100;
  bundle.arrowhead.userData.distance = -100;

  canvas.dispatchEvent("pointerdown", {
    pointerId: 21,
    isPrimary: true,
    button: 0,
    clientX: 150,
    clientY: 240,
    preventDefault() {
      prevented += 1;
    },
  });

  assert.equal(board.graphRoot.userData.rotationState.dragging, false, "edge tap must not start empty-space rotation");
  assert.equal(board.graphRoot.userData.edgeTapState.edgeId, edge.id);
  assert.equal(board.graphRoot.userData.edgeFocusState.edgeId, edge.id);
  assert.equal(canvas.capturedPointerId, 21);

  canvas.dispatchEvent("pointerup", { pointerId: 21, isPrimary: true, clientX: 150, clientY: 240 });
  canvas.dispatchEvent("pointerup", { pointerId: 21, isPrimary: true, clientX: 150, clientY: 240 });

  assert.deepEqual(calls, [edge.id]);
  assert.deepEqual(raycastScopes, [{ kinds: Array.from({ length: config.level.edges.length }, () => "edge-hit"), recursive: false }]);
  assert.equal(prevented, 1);
  assert.equal(board.graphRoot.userData.edgeTapState.active, false);
  assert.equal(canvas.capturedPointerId, null);

  board.destroy();
});

test("render3d: moved edge pointer press cancels tap activation", async () => {
  const mod = await loadRender3d();
  const config = makeConfig(TUTORIALS[1]);
  const host = fakeElement("div");
  const calls = [];
  const board = mod.createBoard3d(host, config, { THREE: createPointerThreeMock(), onEdgeTap: (edgeId) => calls.push(edgeId) });
  const canvas = board.renderer.domElement;
  const edge = config.level.edges[1];
  const initialRotation = quaternionSnapshot(board.graphRoot.quaternion);
  let preventedMoves = 0;

  makeEdgeNearest(board, edge.id);

  canvas.dispatchEvent("pointerdown", { pointerId: 23, isPrimary: true, button: 0, clientX: 150, clientY: 240, timeStamp: 100 });
  canvas.dispatchEvent("pointermove", {
    pointerId: 23,
    isPrimary: true,
    clientX: 156,
    clientY: 240,
    timeStamp: 120,
    preventDefault() {
      preventedMoves += 1;
    },
  });
  canvas.dispatchEvent("pointerup", { pointerId: 23, isPrimary: true, clientX: 156, clientY: 240, timeStamp: 130 });

  assert.deepEqual(calls, [], "movement greater than the 5px tap tolerance must not activate edge tap");
  assert.equal(preventedMoves, 1);
  assert.equal(board.graphRoot.userData.edgeTapState.active, false);
  assert.deepEqual(quaternionSnapshot(board.graphRoot.quaternion), initialRotation, "cancelled edge press must not rotate the graph root");
  assert.equal(canvas.capturedPointerId, null);

  board.destroy();
});

test("render3d: slow edge pointer press cancels tap activation deterministically", async () => {
  const mod = await loadRender3d();
  const config = makeConfig(TUTORIALS[1]);
  const host = fakeElement("div");
  const calls = [];
  const board = mod.createBoard3d(host, config, { THREE: createPointerThreeMock(), onEdgeTap: (edgeId) => calls.push(edgeId) });
  const canvas = board.renderer.domElement;
  const edge = config.level.edges[1];

  makeEdgeNearest(board, edge.id);

  canvas.dispatchEvent("pointerdown", { pointerId: 24, isPrimary: true, button: 0, clientX: 150, clientY: 240, timeStamp: 100 });
  canvas.dispatchEvent("pointerup", { pointerId: 24, isPrimary: true, clientX: 150, clientY: 240, timeStamp: 401 });

  assert.deepEqual(calls, [], "press duration greater than 300ms must not activate edge tap");
  assert.equal(board.graphRoot.userData.edgeTapState.active, false);
  assert.equal(canvas.capturedPointerId, null);

  board.destroy();
});

test("render3d: back-facing edge pointer tap is filtered before onEdgeTap", async () => {
  const mod = await loadRender3d();
  const config = makeConfig(TUTORIALS[1]);
  const host = fakeElement("div");
  const calls = [];
  const board = mod.createBoard3d(host, config, { THREE: createPointerThreeMock(), onEdgeTap: (edgeId) => calls.push(edgeId) });
  const canvas = board.renderer.domElement;
  const edge = config.level.edges[0];

  for (const [index, candidate] of [...board.edgeMeshes.values()].entries()) candidate.hitTarget.userData.distance = index + 10;
  board.edgeMeshes.get(edge.id).hitTarget.userData.distance = 0;
  board.graphRoot.quaternion.set(0, 1, 0, 0);

  canvas.dispatchEvent("pointerdown", { pointerId: 22, isPrimary: true, button: 0, clientX: 160, clientY: 260 });
  canvas.dispatchEvent("pointerup", { pointerId: 22, isPrimary: true, clientX: 160, clientY: 260 });

  assert.deepEqual(calls, []);
  assert.equal(board.graphRoot.userData.edgeTapState.active, false);

  board.destroy();
});

test("render3d: edge hemisphere classification drives visible edge opacity only", async () => {
  const mod = await loadRender3d();
  const config = makeConfig(TUTORIALS[1]);
  const host = fakeElement("div");
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const previousPerformance = globalThis.performance;
  const frames = [];
  let board = null;

  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.performance = { now: () => 0 };

  try {
    board = mod.createBoard3d(host, config, { THREE: THREE_MOCK });
    const edge = config.level.edges[0];
    const frontBundle = board.edgeMeshes.get(edge.id);

    assert.equal(frontBundle.arc.material.transparent, true);
    assert.equal(frontBundle.arc.material.opacity, 1);
    assert.equal(frontBundle.arrowhead.material.transparent, true);
    assert.equal(frontBundle.arrowhead.material.opacity, 1);
    assert.equal(frontBundle.arc.userData.frontFacing, true);
    assert.equal(frontBundle.arrowhead.userData.frontFacing, true);
    assert.equal(frontBundle.hitTarget.material.transparent, true);
    assert.equal(frontBundle.hitTarget.material.opacity, 0);

    board.graphRoot.quaternion.set(0, 1, 0, 0);
    frames.shift()(16);

    const backBundle = board.edgeMeshes.get(edge.id);
    assert.equal(backBundle.arc.material.transparent, true);
    assert.equal(backBundle.arc.material.opacity, 0.6);
    assert.ok(backBundle.arc.material.opacity >= 0.55, "back-side edges should keep a readable opacity floor");
    assert.equal(backBundle.arc.material.depthWrite, false);
    assert.equal(backBundle.arrowhead.material.transparent, true);
    assert.equal(backBundle.arrowhead.material.opacity, 0.6);
    assert.ok(backBundle.arrowhead.material.opacity >= 0.55, "back-side arrowheads should keep a readable opacity floor");
    assert.equal(backBundle.arrowhead.material.depthWrite, false);
    assert.equal(backBundle.arrowhead.material.side, THREE_MOCK.DoubleSide);
    assert.equal(backBundle.arc.userData.frontFacing, false);
    assert.equal(backBundle.arrowhead.userData.frontFacing, false);
    assert.equal(backBundle.hitTarget.material.transparent, true);
    assert.equal(backBundle.hitTarget.material.opacity, 0);
    assert.equal(backBundle.hitTarget.material.depthWrite, false);

    board.update(config);

    const updatedBundle = board.edgeMeshes.get(edge.id);
    assert.equal(updatedBundle.arc.material.opacity, 0.6);
    assert.equal(updatedBundle.arrowhead.material.opacity, 0.6);
    assert.equal(updatedBundle.hitTarget.material.transparent, true);
    assert.equal(updatedBundle.hitTarget.material.opacity, 0);
    assert.equal(updatedBundle.hitTarget.material.depthWrite, false);
  } finally {
    board?.destroy();
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
    globalThis.performance = previousPerformance;
  }
});

test("render3d: keyboard Enter and Space activate the selected front-facing edge", async () => {
  const mod = await loadRender3d();
  const config = makeConfig(TUTORIALS[1]);
  const host = fakeElement("div");
  const calls = [];
  const board = mod.createBoard3d(host, config, { THREE: createPointerThreeMock(), onEdgeTap: (edgeId) => calls.push(edgeId) });
  const canvas = board.renderer.domElement;
  const edge = config.level.edges[0];
  let prevented = 0;

  assert.equal(canvas.tabIndex, 0);
  assert.equal(typeof board.focusEdge, "function");
  assert.equal(board.focusEdge(edge.id), true);

  canvas.dispatchEvent("keydown", {
    key: "Enter",
    preventDefault() {
      prevented += 1;
    },
  });
  canvas.dispatchEvent("keydown", {
    key: " ",
    preventDefault() {
      prevented += 1;
    },
  });

  assert.deepEqual(calls, [edge.id, edge.id]);
  assert.equal(prevented, 2);

  board.graphRoot.quaternion.set(0, 1, 0, 0);
  canvas.dispatchEvent("keydown", { key: "Enter", preventDefault() {} });
  assert.deepEqual(calls, [edge.id, edge.id], "keyboard activation must ignore selected edges rotated to the back");

  board.destroy();
});


test("render3d: node hemisphere classification drives front and back opacity", async () => {
  const mod = await loadRender3d();
  const config = makeConfig(TUTORIALS[1]);
  const host = fakeElement("div");
  const board = mod.createBoard3d(host, config, { THREE: THREE_MOCK });
  const nodeId = config.level.nodes[0].id;
  const frontMesh = board.nodeMeshes.get(nodeId);

  assert.equal(frontMesh.material.transparent, true);
  assert.equal(frontMesh.material.opacity, 1);
  assert.equal(frontMesh.userData.frontFacing, true);
  assert.equal(frontMesh.userData.interactive, true);

  board.graphRoot.quaternion.set(0, 1, 0, 0);
  board.update(config);
  const backMesh = board.nodeMeshes.get(nodeId);

  assert.equal(backMesh.material.transparent, true);
  assert.equal(backMesh.material.opacity, 0.3);
  assert.equal(backMesh.userData.frontFacing, false);
  assert.equal(backMesh.userData.interactive, false);

  board.destroy();
});

test("render3d: back-side node pointer press is ignored for node dragging", async () => {
  const mod = await loadRender3d();
  const config = makeConfig(TUTORIALS[1]);
  const host = fakeElement("div");
  const board = mod.createBoard3d(host, config, { THREE: createPointerThreeMock() });
  const canvas = board.renderer.domElement;
  const nodeId = config.level.nodes[0].id;

  board.graphRoot.quaternion.set(0, 1, 0, 0);
  board.update(config);
  const mesh = board.nodeMeshes.get(nodeId);
  const initialPosition = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };

  canvas.dispatchEvent("pointerdown", { pointerId: 31, isPrimary: true, button: 0, clientX: 160, clientY: 320, target: mesh });

  assert.equal(mesh.material.opacity, 0.3);
  assert.equal(mesh.userData.frontFacing, false);
  assert.equal(board.graphRoot.userData.nodeDragState.dragging, false);
  assert.equal(mesh.userData.dragging, undefined);
  assert.deepEqual({ x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z }, { x: 1, y: 1, z: 1 });
  assert.equal(board.graphRoot.userData.rotationState.dragging, true, "back-side node should fall through to empty-space rotation, not node drag");

  canvas.dispatchEvent("pointermove", { pointerId: 31, isPrimary: true, clientX: 190, clientY: 320, preventDefault() {} });
  canvas.dispatchEvent("pointerup", { pointerId: 31, isPrimary: true });

  assert.deepEqual({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }, initialPosition);
  assert.equal(board.graphRoot.userData.nodeDragState.dragging, false);
  assert.equal(board.graphRoot.userData.rotationState.dragging, false);
  assert.equal(canvas.capturedPointerId, null);

  board.destroy();
});

test("render3d: node pointer drag cosmetically repositions a node and refreshes connected edges", async () => {
  const mod = await loadRender3d();
  const radius = 12;
  const tolerance = 1e-9;
  const config = makeConfig(TUTORIALS[1]);
  const host = fakeElement("div");
  const board = mod.createBoard3d(host, config, { THREE: createPointerThreeMock() });
  const canvas = board.renderer.domElement;
  const edge = config.level.edges[0];
  const nodeId = edge.u;
  const node = config.level.nodes.find((candidate) => candidate.id === nodeId);
  const mesh = board.nodeMeshes.get(nodeId);
  const initialRotation = quaternionSnapshot(board.graphRoot.quaternion);
  const initialPosition = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
  const initialLevelNodes = JSON.stringify(config.level.nodes);
  let preventedMoves = 0;

  assert.equal(mesh.material.opacity, 1);
  assert.equal(mesh.userData.frontFacing, true);

  canvas.dispatchEvent("pointerdown", { pointerId: 12, isPrimary: true, button: 0, clientX: 160, clientY: 320, target: mesh });

  assert.equal(board.graphRoot.userData.rotationState.dragging, false, "node drag must not start graph rotation");
  assert.equal(mesh.userData.dragging, true);
  assert.equal(mesh.userData.cosmeticDrag, true);
  assert.ok(mesh.scale.x > 1 && mesh.scale.y > 1 && mesh.scale.z > 1, "dragged node should get scale feedback");
  assert.equal(canvas.capturedPointerId, 12);

  canvas.dispatchEvent("pointermove", {
    pointerId: 12,
    isPrimary: true,
    clientX: 300,
    clientY: 80,
    preventDefault() {
      preventedMoves += 1;
    },
  });

  const movedPosition = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
  const expected = mod.projectToSphere(93.75, 20, radius);
  const connectedBundle = board.edgeMeshes.get(edge.id);
  const draggedEndpoint = connectedBundle.arc.userData.from === nodeId
    ? connectedBundle.arc.userData.pathPoints[0]
    : connectedBundle.arc.userData.pathPoints.at(-1);

  assert.equal(preventedMoves, 1);
  assert.ok(distance(initialPosition, movedPosition) > 0.1, "node drag should move the selected mesh");
  assertNearPoint(movedPosition, expected, tolerance, "node drag should project pointer position to the sphere surface");
  assert.ok(Math.abs(magnitude(movedPosition) - radius) <= tolerance, "dragged node must remain on sphere radius");
  assertNearPoint(draggedEndpoint, movedPosition, tolerance, "connected edge endpoint should follow the dragged node");
  assert.deepEqual(quaternionSnapshot(board.graphRoot.quaternion), initialRotation, "node drag must not rotate graph root");
  assert.equal(JSON.stringify(config.level.nodes), initialLevelNodes, "cosmetic drag must not mutate level node coordinates");
  assert.deepEqual({ x: node.x, y: node.y }, { x: config.level.nodes.find((candidate) => candidate.id === nodeId).x, y: config.level.nodes.find((candidate) => candidate.id === nodeId).y });

  canvas.dispatchEvent("pointercancel", { pointerId: 12, isPrimary: true });

  assert.equal(mesh.userData.dragging, false);
  assert.equal(mesh.userData.cosmeticDrag, false);
  assert.deepEqual({ x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z }, { x: 1, y: 1, z: 1 });
  assert.equal(canvas.capturedPointerId, null);

  board.update(config);
  const resetMesh = board.nodeMeshes.get(nodeId);
  const resetPosition = { x: resetMesh.position.x, y: resetMesh.position.y, z: resetMesh.position.z };
  const projectedOriginal = mod.relaxProjectedNodes(config.level, radius).get(node.id);
  const resetBundle = board.edgeMeshes.get(edge.id);
  const resetEndpoint = resetBundle.arc.userData.from === nodeId
    ? resetBundle.arc.userData.pathPoints[0]
    : resetBundle.arc.userData.pathPoints.at(-1);

  assertNearPoint(resetPosition, projectedOriginal, tolerance, "update() should reset cosmetic node positions from config projection");
  assertNearPoint(resetEndpoint, projectedOriginal, tolerance, "update() should reset connected edge geometry from config projection");

  board.destroy();
});

test("render3d: destroy() removes pointer rotation listeners from the renderer canvas", async () => {
  const mod = await loadRender3d();
  const host = fakeElement("div");
  const board = mod.createBoard3d(host, makeConfig(TUTORIALS[0]), { THREE: createPointerThreeMock() });
  const canvas = board.renderer.domElement;
  const initial = quaternionSnapshot(board.graphRoot.quaternion);

  board.destroy();
  canvas.dispatchEvent("pointerdown", { pointerId: 3, isPrimary: true, button: 0, clientX: 40, clientY: 40 });
  canvas.dispatchEvent("pointermove", { pointerId: 3, isPrimary: true, clientX: 140, clientY: 80, preventDefault() {} });
  canvas.dispatchEvent("pointerup", { pointerId: 3, isPrimary: true });

  assert.deepEqual(quaternionSnapshot(board.graphRoot.quaternion), initial);
  assert.equal(board.graphRoot.userData.rotationState.dragging, false);
});


test("render3d: markLegal() highlights edge materials cyan and restores base colors", async () => {
  const mod = await loadRender3d();
  const config = makeConfig(TUTORIALS[2]);
  const host = fakeElement("div");
  const board = mod.createBoard3d(host, config, { THREE: THREE_MOCK });
  const targetEdgeId = config.level.target;
  const defaultEdgeId = config.level.edges.find((edge) => edge.id !== targetEdgeId).id;

  board.markLegal([targetEdgeId, defaultEdgeId]);

  assert.deepEqual([...board.legalEdges].sort(), [defaultEdgeId, targetEdgeId].sort());
  assert.equal(board.edgeMeshes.get(targetEdgeId).arc.material.color.hex, 0x00d4ff);
  assert.equal(board.edgeMeshes.get(targetEdgeId).arrowhead.material.color.hex, 0x00d4ff);
  assert.equal(board.edgeMeshes.get(defaultEdgeId).arc.material.color.hex, 0x00d4ff);
  assert.equal(board.edgeMeshes.get(defaultEdgeId).arrowhead.material.color.hex, 0x00d4ff);
  assert.equal(board.edgeMeshes.get(targetEdgeId).arc.userData.baseColor, 0xff3333);
  assert.equal(board.edgeMeshes.get(defaultEdgeId).arc.userData.baseColor, 0xd8d8de);
  assert.equal(board.edgeMeshes.get(targetEdgeId).arc.userData.legal, true);

  board.update(config);

  assert.equal(board.edgeMeshes.get(targetEdgeId).arc.material.color.hex, 0x00d4ff, "legal target stays highlighted across update");
  assert.equal(board.edgeMeshes.get(defaultEdgeId).arc.material.color.hex, 0x00d4ff, "legal default edge stays highlighted across update");
  assert.equal(board.edgeMeshes.get(targetEdgeId).arc.userData.baseColor, 0xff3333);
  assert.equal(board.edgeMeshes.get(defaultEdgeId).arc.userData.baseColor, 0xd8d8de);

  board.markLegal([]);

  assert.equal(board.legalEdges.size, 0);
  assert.equal(board.edgeMeshes.get(targetEdgeId).arc.material.color.hex, 0xff3333);
  assert.equal(board.edgeMeshes.get(targetEdgeId).arrowhead.material.color.hex, 0xff3333);
  assert.equal(board.edgeMeshes.get(defaultEdgeId).arc.material.color.hex, 0xd8d8de);
  assert.equal(board.edgeMeshes.get(defaultEdgeId).arrowhead.material.color.hex, 0xd8d8de);
  assert.equal(board.edgeMeshes.get(targetEdgeId).arc.userData.legal, false);

  board.update(config);

  assert.equal(board.edgeMeshes.get(targetEdgeId).arc.material.color.hex, 0xff3333);
  assert.equal(board.edgeMeshes.get(defaultEdgeId).arc.material.color.hex, 0xd8d8de);
  assert.equal(board.edgeMeshes.get(targetEdgeId).hitTarget.material.opacity, 0);

  board.destroy();
});

test("render3d: shakeEdge() produces deterministic edge movement and metadata", async () => {
  const mod = await loadRender3d();
  const config = makeConfig(TUTORIALS[1]);
  const host = fakeElement("div");
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const previousPerformance = globalThis.performance;
  const frames = [];
  let board = null;

  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.performance = { now: () => 0 };

  try {
    board = mod.createBoard3d(host, config, { THREE: THREE_MOCK });
    const edgeId = config.level.edges[0].id;
    const group = board.edgeMeshes.get(edgeId).group;

    board.shakeEdge(edgeId);

    assert.deepEqual({ x: group.position.x, y: group.position.y, z: group.position.z }, { x: 0, y: 0, z: 0 });
    assert.equal(group.userData.shakeState.active, true);
    assert.equal(group.userData.shakeState.edgeId, edgeId);
    assert.equal(board.graphRoot.userData.visualState.edgeShakeStates.has(edgeId), true);

    frames.shift()(87.5);

    assert.equal(group.userData.shakeState.active, true);
    assert.equal(group.userData.shakeState.progress, 0.25);
    assert.ok(Math.abs(group.position.x) > 0.01, "shake should move the edge group along a deterministic offset");
    assert.equal(group.position.y, 0);
    assert.equal(group.position.z, 0);

    frames.shift()(350);

    assert.equal(group.userData.shakeState.active, false);
    assert.equal(group.userData.shakeState.progress, 1);
    assert.deepEqual({ x: group.position.x, y: group.position.y, z: group.position.z }, { x: 0, y: 0, z: 0 });
    assert.equal(board.graphRoot.userData.visualState.edgeShakeStates.has(edgeId), false);
  } finally {
    board?.destroy();
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
    globalThis.performance = previousPerformance;
  }
});

test("render3d: pulseNode() scales a node and returns it to normal deterministically", async () => {
  const mod = await loadRender3d();
  const config = makeConfig(TUTORIALS[1]);
  const host = fakeElement("div");
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const previousPerformance = globalThis.performance;
  const frames = [];
  let board = null;

  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.performance = { now: () => 0 };

  try {
    board = mod.createBoard3d(host, config, { THREE: THREE_MOCK });
    const nodeId = config.level.nodes[0].id;
    const mesh = board.nodeMeshes.get(nodeId);

    board.pulseNode(nodeId);

    assert.deepEqual({ x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z }, { x: 1, y: 1, z: 1 });
    assert.equal(mesh.userData.pulseState.active, true);
    assert.equal(mesh.userData.pulseState.nodeId, nodeId);
    assert.equal(board.graphRoot.userData.visualState.nodePulseStates.has(nodeId), true);

    frames.shift()(225);

    assert.equal(mesh.userData.pulseState.active, true);
    assert.equal(mesh.userData.pulseState.progress, 0.5);
    assert.equal(mesh.userData.pulseState.scale, 1.45);
    assert.deepEqual({ x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z }, { x: 1.45, y: 1.45, z: 1.45 });

    frames.shift()(450);

    assert.equal(mesh.userData.pulseState.active, false);
    assert.equal(mesh.userData.pulseState.progress, 1);
    assert.deepEqual({ x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z }, { x: 1, y: 1, z: 1 });
    assert.equal(board.graphRoot.userData.visualState.nodePulseStates.has(nodeId), false);
  } finally {
    board?.destroy();
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
    globalThis.performance = previousPerformance;
  }
});

test("render3d: reduced motion collapses shake and pulse feedback without motion tweens", async () => {
  const mod = await loadRender3d();
  const previousWindow = globalThis.window;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const frames = [];
  let board = null;

  globalThis.window = {
    devicePixelRatio: 1,
    matchMedia: (query) => ({ matches: query === "(prefers-reduced-motion: reduce)", addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => {};

  try {
    const config = makeConfig(TUTORIALS[1]);
    const host = fakeElement("div");
    board = mod.createBoard3d(host, config, { THREE: THREE_MOCK });
    const edgeId = config.level.edges[0].id;
    const nodeId = config.level.nodes[0].id;
    const group = board.edgeMeshes.get(edgeId).group;
    const mesh = board.nodeMeshes.get(nodeId);

    board.shakeEdge(edgeId);
    board.pulseNode(nodeId);

    assert.deepEqual({ x: group.position.x, y: group.position.y, z: group.position.z }, { x: 0, y: 0, z: 0 });
    assert.deepEqual({ x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z }, { x: 1, y: 1, z: 1 });
    assert.equal(group.userData.shakeState.active, false);
    assert.equal(group.userData.shakeState.progress, 1);
    assert.equal(group.userData.shakeState.durationMs, 0);
    assert.equal(mesh.userData.pulseState.active, false);
    assert.equal(mesh.userData.pulseState.progress, 1);
    assert.equal(mesh.userData.pulseState.durationMs, 0);
    assert.equal(board.graphRoot.userData.visualState.edgeShakeStates.has(edgeId), false);
    assert.equal(board.graphRoot.userData.visualState.nodePulseStates.has(nodeId), false);

    frames.shift()(225);

    assert.deepEqual({ x: group.position.x, y: group.position.y, z: group.position.z }, { x: 0, y: 0, z: 0 });
    assert.deepEqual({ x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z }, { x: 1, y: 1, z: 1 });
    assert.equal(board.graphRoot.userData.visualState.edgeShakeStates.has(edgeId), false);
    assert.equal(board.graphRoot.userData.visualState.nodePulseStates.has(nodeId), false);
  } finally {
    board?.destroy();
    globalThis.window = previousWindow;
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
  }
});

test("render3d: target receiver is red and slack nodes are amber", async () => {
  const mod = await loadRender3d();
  const config = makeConfig(TUTORIALS[2]);
  const host = fakeElement("div");
  const board = mod.createBoard3d(host, config, { THREE: THREE_MOCK });

  board.update(config);

  const targetReceiver = edgeEnds(config, config.level.target).to;
  const slackNode = config.level.nodes.find((node) => node.id !== targetReceiver && nodeSlack(config, node.id) > 0);
  const defaultNode = config.level.nodes.find((node) => node.id !== targetReceiver && nodeSlack(config, node.id) === 0);

  assert.equal(board.nodeMeshes.get(targetReceiver).material.color.hex, 0xff3333);
  assert.equal(board.nodeMeshes.get(slackNode.id).material.color.hex, 0xffaa00);
  assert.equal(board.nodeMeshes.get(defaultNode.id).material.color.hex, 0xe8e8ec);

  board.destroy();
});

test("render3d: update() removes old node meshes before rebuilding", async () => {
  const mod = await loadRender3d();
  const first = makeConfig(TUTORIALS[0]);
  const second = makeConfig(TUTORIALS[2]);
  const host = fakeElement("div");
  const board = mod.createBoard3d(host, first, { THREE: THREE_MOCK });

  board.update(first);
  const firstMeshes = [...board.nodeMeshes.values()];
  assert.equal(objectsByKind(board.scene, "node").length, first.level.nodes.length);

  board.update(second);
  const secondMeshes = [...board.nodeMeshes.values()];

  assert.equal(board.nodeMeshes.size, second.level.nodes.length);
  assert.equal(objectsByKind(board.scene, "node").length, second.level.nodes.length);
  const liveObjects = collectObjects(board.scene);
  for (const mesh of firstMeshes) assert.equal(liveObjects.includes(mesh), false);
  for (const mesh of secondMeshes) assert.equal(liveObjects.includes(mesh), true);

  board.destroy();
});

test("render3d: update() removes old edge meshes before rebuilding", async () => {
  const mod = await loadRender3d();
  const first = makeConfig(TUTORIALS[0]);
  const second = makeConfig(TUTORIALS[2]);
  const host = fakeElement("div");
  const board = mod.createBoard3d(host, first, { THREE: THREE_MOCK });

  board.update(first);
  const firstBundles = [...board.edgeMeshes.values()];
  assert.equal(objectsByKind(board.scene, "edge-group").length, first.level.edges.length);

  board.update(second);
  const secondBundles = [...board.edgeMeshes.values()];
  const liveObjects = collectObjects(board.scene);

  assert.equal(board.edgeMeshes.size, second.level.edges.length);
  assert.equal(objectsByKind(board.scene, "edge-group").length, second.level.edges.length);
  for (const bundle of firstBundles) {
    assert.equal(liveObjects.includes(bundle.group), false);
    assert.equal(liveObjects.includes(bundle.arc), false);
    assert.equal(liveObjects.includes(bundle.arrowhead), false);
    assert.equal(liveObjects.includes(bundle.hitTarget), false);
  }
  for (const bundle of secondBundles) {
    assert.equal(liveObjects.includes(bundle.group), true);
    assert.equal(liveObjects.includes(bundle.arc), true);
    assert.equal(liveObjects.includes(bundle.arrowhead), true);
    assert.equal(liveObjects.includes(bundle.hitTarget), true);
  }

  board.destroy();
  assert.equal(collectObjects(board.scene).some((object) => object.userData?.kind?.startsWith?.("edge-")), false);
});
