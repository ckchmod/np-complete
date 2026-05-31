import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Camera,
  Color,
  Geometry,
  Group,
  Material,
  Mesh,
  Raycaster,
  Renderer,
  Scene,
  Vector3,
  WebGLRenderer,
} from "./three-mock.js";

test("three-mock: scene starts empty and supports basic graph operations", () => {
  const scene = new Scene();
  const group = new Group();
  const mesh = new Mesh(new Geometry(), new Material({ color: 0xff0000, opacity: 0.5 }));

  assert.equal(scene.children.length, 0);
  scene.add(group);
  group.add(mesh);

  assert.equal(scene.children.length, 1);
  assert.equal(group.children.length, 1);
  assert.equal(mesh.parent, group);
  assert.equal(mesh.material.opacity, 0.5);
  assert.equal(mesh.material.color.hex, 0xff0000);

  mesh.position.set(1, 2, 3);
  mesh.rotation.set(4, 5, 6);
  mesh.scale.set(7, 8, 9);

  assert.deepEqual(mesh.position, new Vector3(1, 2, 3));
  assert.deepEqual(mesh.rotation, new Vector3(4, 5, 6));
  assert.deepEqual(mesh.scale, new Vector3(7, 8, 9));

  scene.remove(group);
  assert.equal(scene.children.length, 0);
});

test("three-mock: renderer and raycaster expose deterministic behavior", () => {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(320, 240);
  renderer.setPixelRatio(2);

  assert.equal(renderer.type, "WebGLRenderer");
  assert.equal(renderer.domElement.width, 320);
  assert.equal(renderer.domElement.height, 240);
  assert.equal(renderer.pixelRatio, 2);

  const camera = new Camera();
  const raycaster = new Raycaster();
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);

  const near = new Mesh();
  near.userData.distance = 1;
  const far = new Mesh();
  far.userData.distance = 5;

  const intersections = raycaster.intersectObjects([far, near]);

  assert.equal(intersections.length, 2);
  assert.equal(intersections[0].object, near);
  assert.equal(intersections[1].object, far);
  assert.equal(new Color("#00ff00").hex, 0x00ff00);
  assert.equal(renderer instanceof Renderer, true);
});
