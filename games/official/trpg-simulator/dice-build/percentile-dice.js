import { ConvexPolyhedron, Vec3 } from 'cannon-es';
import {
  CanvasTexture, Float32BufferAttribute, IcosahedronGeometry, MeshPhysicalMaterial, Quaternion,
  RepeatWrapping, SRGBColorSpace, Vector3
} from 'three';

const columns = 5;
const rows = 2;
const cell = 160;
const up = new Vector3(0, 0, 1);
const triangleUVs = [[0.5, 0.91], [0.035, 0.105], [0.965, 0.105]];

export function createHull(radius) {
  const geometry = new IcosahedronGeometry(radius, 0);
  const { position, normal } = geometry.attributes;
  const vertices = [], triangles = [], faces = [], uvs = [];
  const vertexIndices = new Map();
  for (let i = 0; i < position.count; i += 3) {
    const corners = [0, 1, 2].map(offset => new Vector3().fromBufferAttribute(position, i + offset));
    triangles.push(corners.map(corner => {
      const key = corner.toArray().join(',');
      if (!vertexIndices.has(key)) {
        vertexIndices.set(key, vertices.length);
        vertices.push(corner);
      }
      return vertexIndices.get(key);
    }));
    const edgeCenter = corners[1].clone().lerp(corners[2], 0.5);
    faces.push({ normal: new Vector3().fromBufferAttribute(normal, i).normalize(), heading: corners[0].clone().sub(edgeCenter).normalize() });
  }

  // One digit per pair of opposite faces gives each digit two congruent faces.
  let digit = 0;
  for (const face of faces) {
    if (face.digit !== undefined) continue;
    const opposite = faces.find(other => other.normal.dot(face.normal) < -0.99999);
    face.digit = opposite.digit = digit++;
  }
  for (const face of faces) {
    const col = face.digit % columns, row = Math.floor(face.digit / columns);
    for (const [u, v] of triangleUVs) uvs.push((col + u) / columns, 1 - (row + 1 - v) / rows);
  }
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  return { geometry, vertices, triangles, faces };
}

export function createCollider(hull) {
  return new ConvexPolyhedron({
    vertices: hull.vertices.map(vertex => new Vec3(vertex.x, vertex.y, vertex.z)),
    faces: hull.triangles
  });
}

export function createRoughnessMap() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grain = ctx.createImageData(canvas.width, canvas.height);
  let seed = 31;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let y = 0; y < canvas.height; y++) {
    const brush = 195 + noise() * 57;
    for (let x = 0; x < canvas.width; x++) {
      const index = (y * canvas.width + x) * 4;
      const shade = brush - noise() * 14;
      grain.data.set([shade, shade, shade, 255], index);
    }
  }
  ctx.putImageData(grain, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(columns, rows);
  return texture;
}

export function createMaterial(tens, roughnessMap) {
  const createCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = columns * cell;
    canvas.height = rows * cell;
    return canvas;
  };
  const surface = createCanvas(), engraving = createCanvas();
  const colors = surface.getContext('2d'), height = engraving.getContext('2d');
  colors.fillStyle = tens ? '#9e7b34' : '#b89242';
  colors.fillRect(0, 0, surface.width, surface.height);
  height.fillStyle = '#ffffff';
  height.fillRect(0, 0, engraving.width, engraving.height);

  for (let digit = 0; digit < 10; digit++) {
    const left = (digit % columns) * cell, top = Math.floor(digit / columns) * cell;
    const tone = colors.createLinearGradient(left, top, left + cell, top + cell);
    tone.addColorStop(0, 'rgba(45, 24, 9, .20)');
    tone.addColorStop(0.48, 'rgba(255, 215, 145, .07)');
    tone.addColorStop(1, 'rgba(45, 24, 9, .19)');
    colors.fillStyle = tone;
    colors.fillRect(left, top, cell, cell);
  }

  for (const ctx of [colors, height]) {
    ctx.font = `700 ${tens ? 59 : 69}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ctx === height ? '#000000' : tens ? '#f2e3c2' : '#161310';
    for (let digit = 0; digit < 10; digit++) {
      const x = (digit % columns + 0.5) * cell;
      const y = (Math.floor(digit / columns) + 0.625) * cell;
      const label = tens ? `${digit}0` : String(digit);
      ctx.fillText(label, x, y, cell * 0.5);
      if (!tens && (digit === 6 || digit === 9)) ctx.fillRect(x - 10, y + 29, 20, 3);
    }
  }
  const map = new CanvasTexture(surface);
  map.colorSpace = SRGBColorSpace;
  const bumpMap = new CanvasTexture(engraving);
  return new MeshPhysicalMaterial({
    map, bumpMap, bumpScale: 0.32, metalnessMap: bumpMap,
    metalness: 0.88, roughness: 0.28, roughnessMap, anisotropy: 0.48
  });
}

export function readTopDigit(hull, rotation) {
  const localUp = up.clone().applyQuaternion(rotation.clone().invert());
  return hull.faces.reduce((top, face) => face.normal.dot(localUp) > top.normal.dot(localUp) ? face : top).digit;
}

export function alignDigit(hull, rotation, digit) {
  const candidates = hull.faces.filter(face => face.digit === digit).map(face => {
    const normal = face.normal.clone().applyQuaternion(rotation);
    const result = new Quaternion().setFromUnitVectors(normal, up).multiply(rotation);
    // Turn the print toward the screen's top edge after lifting the face.
    const heading = face.heading.clone().applyQuaternion(result);
    const yaw = new Quaternion().setFromAxisAngle(up, Math.atan2(heading.x, heading.y));
    return result.premultiply(yaw).normalize();
  });
  return candidates.reduce((nearest, candidate) => rotation.angleTo(candidate) < rotation.angleTo(nearest) ? candidate : nearest);
}
