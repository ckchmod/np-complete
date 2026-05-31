export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(vector) {
    return this.set(vector.x, vector.y, vector.z);
  }

  clone() {
    return new Vector3(this.x, this.y, this.z);
  }

  add(vector) {
    this.x += vector.x;
    this.y += vector.y;
    this.z += vector.z;
    return this;
  }

  sub(vector) {
    this.x -= vector.x;
    this.y -= vector.y;
    this.z -= vector.z;
    return this;
  }

  multiplyScalar(scalar) {
    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;
    return this;
  }

  length() {
    return Math.hypot(this.x, this.y, this.z);
  }

  normalize() {
    const length = this.length() || 1;
    return this.multiplyScalar(1 / length);
  }

  dot(vector) {
    return this.x * vector.x + this.y * vector.y + this.z * vector.z;
  }
}

export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  set(x, y, z, w) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  copy(quaternion) {
    return this.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }

  clone() {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }
}

export class Color {
  constructor(value = 0xffffff) {
    this.set(value);
  }

  set(value) {
    if (value instanceof Color) {
      this.hex = value.hex;
      return this;
    }

    if (typeof value === "number") {
      this.hex = value >>> 0;
      return this;
    }

    if (typeof value === "string") {
      const normalized = value.trim().replace(/^#/, "");
      this.hex = Number.parseInt(normalized, 16) >>> 0;
      return this;
    }

    this.hex = 0xffffff;
    return this;
  }

  clone() {
    return new Color(this.hex);
  }
}

export class Object3D {
  constructor() {
    this.type = "Object3D";
    this.name = "";
    this.parent = null;
    this.children = [];
    this.position = new Vector3();
    this.rotation = new Vector3();
    this.scale = new Vector3(1, 1, 1);
    this.quaternion = new Quaternion();
    this.userData = {};
    this.visible = true;
  }

  add(...objects) {
    for (const object of objects) {
      if (!object || object === this) continue;
      if (object.parent) object.parent.remove(object);
      object.parent = this;
      this.children.push(object);
    }
    return this;
  }

  remove(...objects) {
    for (const object of objects) {
      const index = this.children.indexOf(object);
      if (index >= 0) this.children.splice(index, 1);
      if (object && object.parent === this) object.parent = null;
    }
    return this;
  }

  traverse(callback) {
    callback(this);
    for (const child of this.children) child.traverse(callback);
  }

  lookAt() {}
  updateMatrixWorld() {}
}

export class Group extends Object3D {
  constructor() {
    super();
    this.type = "Group";
  }
}

export class Scene extends Group {
  constructor() {
    super();
    this.type = "Scene";
  }
}

export class Camera extends Object3D {
  constructor() {
    super();
    this.type = "Camera";
  }
}

export class PerspectiveCamera extends Camera {
  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    super();
    this.type = "PerspectiveCamera";
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
  }
}

export class Geometry {
  constructor() {
    this.type = "Geometry";
    this.parameters = {};
  }

  dispose() {}
}

export class BufferGeometry extends Geometry {
  constructor() {
    super();
    this.type = "BufferGeometry";
  }
}

export class SphereGeometry extends BufferGeometry {
  constructor(radius = 1, widthSegments = 8, heightSegments = 6) {
    super();
    this.type = "SphereGeometry";
    this.parameters = { radius, widthSegments, heightSegments };
  }
}

export class BoxGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, depth = 1) {
    super();
    this.type = "BoxGeometry";
    this.parameters = { width, height, depth };
  }
}

export class IcosahedronGeometry extends BufferGeometry {
  constructor(radius = 1, detail = 0) {
    super();
    this.type = "IcosahedronGeometry";
    this.parameters = { radius, detail };
  }
}

export class ConeGeometry extends BufferGeometry {
  constructor(radius = 1, height = 1, radialSegments = 8) {
    super();
    this.type = "ConeGeometry";
    this.parameters = { radius, height, radialSegments };
  }
}

export class CylinderGeometry extends BufferGeometry {
  constructor(radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 8) {
    super();
    this.type = "CylinderGeometry";
    this.parameters = { radiusTop, radiusBottom, height, radialSegments };
  }
}

export class PlaneGeometry extends BufferGeometry {
  constructor(width = 1, height = 1) {
    super();
    this.type = "PlaneGeometry";
    this.parameters = { width, height };
  }
}

export class Material {
  constructor(parameters = {}) {
    this.type = "Material";
    this.color = new Color(parameters.color ?? 0xffffff);
    this.opacity = parameters.opacity ?? 1;
    this.transparent = parameters.transparent ?? false;
    this.depthWrite = parameters.depthWrite ?? true;
    this.depthTest = parameters.depthTest ?? true;
    this.side = parameters.side;
    this.visible = parameters.visible ?? true;
    this.userData = {};
  }

  dispose() {}
}

export const DoubleSide = 2;

export class MeshBasicMaterial extends Material {
  constructor(parameters = {}) {
    super(parameters);
    this.type = "MeshBasicMaterial";
  }
}

export class MeshStandardMaterial extends Material {
  constructor(parameters = {}) {
    super(parameters);
    this.type = "MeshStandardMaterial";
  }
}

export class LineBasicMaterial extends Material {
  constructor(parameters = {}) {
    super(parameters);
    this.type = "LineBasicMaterial";
  }
}

export class LineDashedMaterial extends Material {
  constructor(parameters = {}) {
    super(parameters);
    this.type = "LineDashedMaterial";
  }
}

export class Mesh extends Object3D {
  constructor(geometry = new Geometry(), material = new Material()) {
    super();
    this.type = "Mesh";
    this.geometry = geometry;
    this.material = material;
  }
}

export class Renderer {
  constructor() {
    this.type = "Renderer";
    this.domElement = {
      nodeName: "CANVAS",
      style: {},
      width: 0,
      height: 0,
      getContext() {
        return null;
      },
    };
    this.width = 0;
    this.height = 0;
    this.pixelRatio = 1;
    this.clearColor = new Color(0x000000);
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.domElement.width = width;
    this.domElement.height = height;
  }

  setPixelRatio(pixelRatio) {
    this.pixelRatio = pixelRatio;
  }

  setClearColor(color) {
    this.clearColor = new Color(color);
  }

  render() {}

  dispose() {}
}

export class WebGLRenderer extends Renderer {
  constructor(parameters = {}) {
    super();
    this.type = "WebGLRenderer";
    this.parameters = parameters;
  }
}

function collectIntersections(object, raycaster, recursive, target) {
  if (!object || object.visible === false) return;

  if (typeof object.raycast === "function") {
    object.raycast(raycaster, target);
  } else if (object.userData?.raycast !== false) {
    const distance = object.userData?.distance ?? target.length;
    target.push({
      object,
      distance,
      point: object.position.clone(),
      face: null,
      faceIndex: 0,
    });
  }

  if (recursive) {
    for (const child of object.children || []) collectIntersections(child, raycaster, true, target);
  }
}

export class Raycaster {
  constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1), near = 0, far = Infinity) {
    this.ray = { origin: origin.clone(), direction: direction.clone() };
    this.near = near;
    this.far = far;
    this.params = {};
  }

  set(origin, direction) {
    this.ray.origin = origin.clone();
    this.ray.direction = direction.clone();
  }

  setFromCamera(coords, camera) {
    this.coords = { x: coords.x, y: coords.y };
    this.camera = camera;
  }

  intersectObject(object, recursive = false) {
    return this.intersectObjects([object], recursive);
  }

  intersectObjects(objects, recursive = false) {
    const intersections = [];
    for (const object of objects) collectIntersections(object, this, recursive, intersections);
    return intersections.sort((left, right) => left.distance - right.distance);
  }
}
