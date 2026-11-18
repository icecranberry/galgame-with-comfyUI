import { ConvexPolyhedron, Vec3 } from 'cannon-es';
import {
  BoxGeometry, CanvasTexture, DodecahedronGeometry, Float32BufferAttribute, IcosahedronGeometry,
  MeshPhysicalMaterial, OctahedronGeometry, TetrahedronGeometry,
  RepeatWrapping, SRGBColorSpace, Vector3
} from 'three';

const columns = 5;
const cell = 160;
const up = new Vector3(0, 0, 1);

export function createHull(radius, sides) {
  const shapes = { 4: TetrahedronGeometry, 8: OctahedronGeometry, 10: IcosahedronGeometry, 12: DodecahedronGeometry, 20: IcosahedronGeometry };
  const Shape = shapes[sides];
  const edge = radius * 2 / Math.sqrt(3);
  const mesh = Shape ? new Shape(radius, 0) : new BoxGeometry(edge, edge, edge);
  const geometry = mesh.index ? mesh.toNonIndexed() : mesh;
  if (geometry !== mesh) mesh.dispose();
  const { position, normal } = geometry.attributes;
  const vertices = [], triangles = [], faces = [];
  const vertexIndices = new Map(), triangleFaces = [];
  for (let i = 0; i < position.count; i += 3) {
    const indices = [0, 1, 2].map(offset => {
      const corner = new Vector3().fromBufferAttribute(position, i + offset);
      const key = corner.toArray().map(value => Math.round(value * 1e5)).join(',');
      if (!vertexIndices.has(key)) {
        vertexIndices.set(key, vertices.length);
        vertices.push(corner);
      }
      return vertexIndices.get(key);
    });
    const direction = new Vector3().fromBufferAttribute(normal, i).normalize();
    let face = faces.find(candidate => candidate.normal.dot(direction) > .99999);
    if (!face) {
      face = { normal: direction, indices: new Set() };
      faces.push(face);
    }
    indices.forEach(index => face.indices.add(index));
    triangles.push(indices);
    triangleFaces.push(face);
  }

  let pairedDigit = 0;
  let labelDiameter = Infinity;
  for (const [index, face] of faces.entries()) {
    if (face.digit === undefined) {
      if (sides === 3 || sides === 10) {
        const opposite = faces.find(other => other.normal.dot(face.normal) < -.99999);
        face.digit = opposite.digit = pairedDigit++;
      } else face.digit = index;
    }
    const corners = [...face.indices].map(index => vertices[index]);
    const center = corners.reduce((sum, corner) => sum.add(corner), new Vector3()).divideScalar(corners.length);
    const heading = corners[0].clone().sub(center).normalize();
    if (corners.length === 4) heading.applyAxisAngle(face.normal, Math.PI / 4);
    const across = heading.clone().cross(face.normal).normalize();
    const offsets = corners.map(corner => {
      const delta = corner.clone().sub(center);
      return [delta.dot(across), delta.dot(heading)];
    });
    const span = Math.max(...offsets.flat().map(Math.abs));
    const uvScale = .44 / span;
    face.uv = new Map([...face.indices].map((corner, i) => [corner, offsets[i].map(value => .5 + value * uvScale)]));
    // Keep the ink inside the face's inscribed circle, with room for texture filtering.
    const inradius = corners[0].distanceTo(center) * Math.cos(Math.PI / corners.length);
    labelDiameter = Math.min(labelDiameter, 2 * inradius * uvScale * cell * .9);
  }

  return { geometry, vertices, triangles, triangleFaces, faces, labelDiameter };
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
  texture.repeat.set(columns, 2);
  return texture;
}

export function createMaterial({ sides, tens, percentile }, roughnessMap, labelDiameter) {
  const rows = Math.ceil(sides / columns);
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

  for (let digit = 0; digit < sides; digit++) {
    const left = (digit % columns) * cell, top = Math.floor(digit / columns) * cell;
    const tone = colors.createLinearGradient(left, top, left + cell, top + cell);
    tone.addColorStop(0, 'rgba(45, 24, 9, .20)');
    tone.addColorStop(0.48, 'rgba(255, 215, 145, .07)');
    tone.addColorStop(1, 'rgba(45, 24, 9, .19)');
    colors.fillStyle = tone;
    colors.fillRect(left, top, cell, cell);
  }

  for (const ctx of [colors, height]) {
    ctx.font = `700 ${tens || sides > 10 ? 57 : 66}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ctx === height ? '#000000' : tens ? '#f2e3c2' : '#161310';
  }
  for (let digit = 0; digit < sides; digit++) {
    const x = (digit % columns + 0.5) * cell;
    const y = (Math.floor(digit / columns) + 0.5) * cell;
    const label = tens ? `${digit}0` : String(percentile ? digit : digit + 1);
    const { actualBoundingBoxLeft: left, actualBoundingBoxRight: right,
      actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent } = colors.measureText(label);
    const marked = label === '6' || label === '9';
    const bottom = descent + (marked ? 9 : 0);
    const scale = Math.min(1, labelDiameter / Math.hypot(left + right, ascent + bottom));
    const baseline = (ascent - bottom) / 2;
    for (const ctx of [colors, height]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.fillText(label, (left - right) / 2, baseline);
      if (marked) ctx.fillRect(-10, baseline + descent + 6, 20, 3);
      ctx.restore();
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

export function mapLandingDigit(hull, sides, rotation, target) {
  const natural = readTopDigit(hull, rotation);
  // Swap both groups before playback so paired faces keep the same digit count.
  for (const face of hull.faces) {
    if (face.digit === natural) face.digit = target;
    else if (face.digit === target) face.digit = natural;
  }

  const rows = Math.ceil(sides / columns);
  const uvs = [];
  hull.triangles.forEach((triangle, index) => {
    const face = hull.triangleFaces[index];
    const col = face.digit % columns, row = Math.floor(face.digit / columns);
    for (const corner of triangle) {
      const [u, v] = face.uv.get(corner);
      uvs.push((col + u) / columns, 1 - (row + 1 - v) / rows);
    }
  });
  hull.geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
}
