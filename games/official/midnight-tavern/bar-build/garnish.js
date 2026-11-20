import * as T from 'three';

const turn = Math.PI * 2;
const point = (x, y, z) => new T.Vector3(x, y, z);
function put(parent, geometry, material, x = 0, y = 0, z = 0) {
  const mesh = new T.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
function branch(group, points, width, material) {
  return put(group, new T.TubeGeometry(new T.CatmullRomCurve3(points), 24, width, 7, false), material);
}
const satin = (color) => new T.MeshPhysicalMaterial({ color, roughness: 0.36, clearcoat: 0.32, side: T.DoubleSide });

// A fan of curled, veined petals with a scalloped velvet edge and a pale throat.
function flower(group) {
  const lobes = [
    [-1.16, 0.78],
    [-0.61, 1.05],
    [0, 1.18],
    [0.63, 0.99],
    [1.25, 0.73],
  ];
  const petal = new T.MeshPhysicalMaterial({
    vertexColors: true,
    side: T.DoubleSide,
    roughness: 0.58,
    sheen: 1,
    sheenColor: 0xb0a5e2,
  });
  for (const [angle, size] of lobes) {
    const xyz = [],
      color = [],
      indices = [];
    for (let j = 0; j <= 18; j++)
      for (let i = 0; i <= 20; i++) {
        const h = j / 18,
          u = i / 10 - 1,
          edge = Math.abs(u),
          width = 0.117 * Math.sin(Math.PI * h * 0.93) ** 0.67;
        const x = u * width,
          y = h * 0.29 * (1 - 0.085 * edge * edge),
          z = 0.03 * Math.sin(h * Math.PI) - 0.074 * h * h + 0.045 * u * u * h + 0.009 * Math.cos(u * 11) * h * h;
        xyz.push(x, y, z);
        const c = new T.Color('#f4dda9')
          .lerp(new T.Color('#636ac0'), Math.min(1, h * 2.9))
          .lerp(new T.Color('#36278a'), h * 0.88);
        c.multiplyScalar(1 + 0.18 * Math.cos(u * 20) * h + 0.23 * edge * h);
        color.push(c.r, c.g, c.b);
        if (i && j) {
          const k = j * 21 + i;
          indices.push(k - 22, k - 21, k, k - 22, k, k - 1);
        }
      }
    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.Float32BufferAttribute(xyz, 3));
    geom.setAttribute('color', new T.Float32BufferAttribute(color, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    const leaf = put(group, geom, petal);
    leaf.rotation.set(-0.32, angle * 0.32, angle);
    leaf.scale.setScalar(size);
  }
  const core = put(group, new T.SphereGeometry(0.034, 18, 12), satin(0xe9c76d), 0, 0.018, 0.024);
  core.scale.set(0.85, 1.36, 0.46);
  branch(group, [point(0, -0.12, 0), point(0, -0.04, 0), point(0, 0.02, 0)], 0.009, satin(0x42654a));
}
function limeWheel(group) {
  const wheel = new T.Group();
  group.add(wheel);
  wheel.position.y = 0.14;
  wheel.rotation.set(-0.14, 0.38, 0.1);
  const rind = put(wheel, new T.CylinderGeometry(0.19, 0.19, 0.042, 56), satin(0x679334));
  rind.rotation.x = Math.PI / 2;
  const pith = satin(0xe6e9ab), pulp = [satin(0xb8d755), satin(0xabc94b)];
  for (const side of [-1, 1]) {
    put(wheel, new T.CircleGeometry(0.182, 56), pith, 0, 0, side * 0.022);
    for (let i = 0; i < 9; i++) {
      const wedge = new T.RingGeometry(0.013, 0.17, 9, 1, i * turn / 9 + 0.021, turn / 9 - 0.042);
      put(wheel, wedge, pulp[i % 2], 0, 0, side * 0.023);
    }
  }
}

function cocktailCherry(group) {
  const contour = [[0,-0.104],[0.068,-0.095],[0.106,-0.052],[0.119,0.012],[0.107,0.067],[0.073,0.094],[0.038,0.090],[0,0.068]];
  const skin = satin(0x9f1536);
  skin.roughness = 0.20;
  skin.clearcoat = 1;
  put(group, new T.LatheGeometry(contour.map(([r,y]) => new T.Vector2(r,y)), 48), skin, 0, 0.12, 0);
  branch(group, [point(0,0.19,0), point(0.014,0.29,0), point(0.092,0.37,-0.012)], 0.006, satin(0x66522f));
  branch(group, [point(-0.15,-0.04,-0.04), point(0,0.12,0), point(0.17,0.31,0.04)], 0.007, satin(0xca9652));
}

function mintSprig(group) {
  const stem = satin(0x728b49), leaf = satin(0x43935e), veins = satin(0x9eb974);
  branch(group, [point(0,-0.09,0), point(0.012,0.15,0), point(0,0.37,0)], 0.008, stem);
  for (let i = 0; i < 6; i++) {
    const blade = new T.Group(), row = Math.floor(i / 2);
    group.add(blade);
    blade.position.y = 0.11 + row * 0.10;
    blade.rotation.set(-0.30, 0.22 + row * 0.73, (i % 2 ? 1 : -1) * (0.98 - row * 0.19));
    blade.scale.setScalar(1 - row * 0.18);
    const vertices = [], indices = [];
    for (let j = 0; j <= 16; j++) {
      const t = j / 16, w = Math.sin(Math.PI * t) ** 0.77 * (j % 2 ? 0.069 : 0.059);
      const y = 0.225 * t, z = 0.036 * Math.sin(Math.PI * t);
      vertices.push(-w,y,z * 0.24, 0,y,z, w,y,z * 0.24);
      if (j) {
        const k = 3 * j;
        indices.push(k-3,k-2,k, k,k-2,k+1, k-2,k-1,k+1, k+1,k-1,k+2);
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices,3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    put(blade, geometry, leaf);
    branch(blade, [point(0,0,0.002),point(0,0.11,0.038),point(0,0.213,0.007)], 0.0026, veins);
  }
}

function cinnamonStick(group) {
  // Extrude a ribbon of bark so both ends expose the hollow spiral.
  const spiral = new T.Shape(), steps = 64;
  for (let i = 0; i <= steps * 2 + 1; i++) {
    const inside = i > steps, t = (inside ? steps * 2 + 1 - i : i) / steps;
    const a = turn * 1.65 * t, r = 0.018 + 0.041 * t - (inside ? 0.009 : 0);
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (!i) spiral.moveTo(x,y); else spiral.lineTo(x,y);
  }
  spiral.closePath();
  const bark = satin(0x9e5630);
  bark.roughness = 0.88;
  bark.clearcoat = 0;
  const quill = put(group, new T.ExtrudeGeometry(spiral, { depth:0.54, bevelEnabled:false }), [satin(0xc28751), bark], 0,-0.12,0);
  quill.rotation.set(-1.22,-0.15,0.14);
}

function starfruit(group) {
  const outline = new T.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.092 : 0.194;
    const x = r * Math.cos(a), y = r * Math.sin(a);
    if (!i) outline.moveTo(x,y); else outline.lineTo(x,y);
  }
  outline.closePath();
  const slice = put(group, new T.ExtrudeGeometry(outline, {
    depth:0.031, bevelEnabled:true, bevelThickness:0.006, bevelSize:0.008, bevelSegments:3,
  }), [satin(0xefce5b), satin(0xb3a549)], 0,0.15,0);
  slice.rotation.y = 0.30;
  const seed = satin(0xad7942), geometry = new T.SphereGeometry(1,12,8);
  for (let i = 0; i < 3; i++) {
    const a = turn * i / 3;
    const pit = put(slice, geometry, seed, 0.039 * Math.cos(a), 0.039 * Math.sin(a), 0.038);
    pit.scale.set(0.009,0.019,0.003);
    pit.rotation.z = a;
  }
}

const rimGarnishes = { lime_wheel: limeWheel, cocktail_cherry: cocktailCherry, mint_sprig: mintSprig, cinnamon_stick: cinnamonStick, starfruit };
export function bouquet(group, id) {
  if (Object.hasOwn(rimGarnishes, id)) return rimGarnishes[id](group);
  if (id === 'butterfly_pea') {
    flower(group);
    return;
  }
  if (id === 'rosemary') {
    const bark = satin(0x716651),
      greens = [satin(0x526c58), satin(0x698567)];
    for (let arm = 0; arm < 3; arm++) {
      const twig = new T.Group();
      group.add(twig);
      twig.position.y = arm * 0.045;
      twig.rotation.z = (arm - 1) * 0.34;
      const len = arm === 1 ? 0.49 : 0.34;
      branch(twig, [point(0, -0.1, 0), point(0.012, len * 0.45, 0), point(-0.016, len, 0)], 0.007, bark);
      const needle = new T.SphereGeometry(1, 9, 6);
      for (let i = 0; i < 28; i++) {
        const a = i * 2.399,
          h = i / 28,
          r = 0.039 * (1 - 0.55 * h);
        const leaf = put(twig, needle, greens[i % 2], r * Math.cos(a), len * h, r * Math.sin(a));
        leaf.scale.set(0.009, 0.063 * (1 - 0.43 * h), 0.012);
        leaf.rotation.set(0.67 * Math.sin(a), 0, -0.67 * Math.cos(a));
      }
    }
    return;
  }
  if (id === 'chili') {
    const pepper = new T.Group();
    group.add(pepper);
    pepper.rotation.set(0.47, 0.34, -0.48);
    pepper.position.y = 0.054;
    const ring = (r, tube, mat, z) => {
      const o = put(pepper, new T.TorusGeometry(r, tube, 16, 64), mat, 0, 0, z);
      o.scale.y = 0.79;
    };
    ring(0.128, 0.039, satin(0x9f2415), 0);
    ring(0.118, 0.025, satin(0xed6340), 0.024);
    const seed = satin(0xf1c68a);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.72;
      const o = put(pepper, new T.SphereGeometry(0.02, 12, 8), seed, 0.086 * Math.cos(a), 0.067 * Math.sin(a), 0.031);
      o.scale.set(0.6, 1, 0.4);
      o.rotation.z = a;
    }
    return;
  }
  const gold = id === 'gold_leaf';
  const materials = gold
    ? [new T.MeshStandardMaterial({ color: 0xefbd50, roughness: 0.22, metalness: 0.87, side: T.DoubleSide })]
    : [satin(0xc7728a), satin(0xd5a4af), satin(0x6dbcb9), satin(0xefbe66)];
  for (let i = 0; i < (gold ? 12 : 22); i++) {
    const a = i * 2.399,
      r = 0.035 + 0.013 * (i % 8);
    const chip = put(
      group,
      new T.IcosahedronGeometry(0.024 + 0.015 * (i % 4), 0),
      materials[i % materials.length],
      r * Math.cos(a),
      0.05 + Math.sin(a) * r,
      (i % 4) * 0.013,
    );
    chip.scale.set(gold ? 1.3 : 0.8, gold ? 0.78 : 0.65, gold ? 0.075 : 0.65);
    chip.rotation.set(0.13 * i, 0.23 * i, a);
  }
}
export function effervescence(parent, shape, radius, recipe) {
  const count = recipe.baseLiquor === 'liqueur_sparkling' ? 64 : recipe.potions.length ? 38 : 11;
  const mesh = new T.InstancedMesh(
    new T.SphereGeometry(1, 10, 8),
    new T.MeshPhysicalMaterial({
      color: 0xb8e0c8,
      metalness: 0.36,
      roughness: 0.11,
      clearcoat: 1,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    }),
    count,
  );
  mesh.frustumCulled = false;
  parent.add(mesh);
  const dummy = new T.Object3D();
  return (time, level, stir, slope) => {
    for (let i = 0; i < count; i++) {
      const cycle = (i * 0.618034 + time * (0.14 + (i % 6) * 0.035)) % 1;
      const y = T.MathUtils.lerp(shape.floor + 0.014, Math.max(shape.floor + 0.015, level - 0.015), cycle);
      const a = (i % 11) * 2.399 + stir * cycle * 1.7 + 0.032 * Math.sin(time * 3 + i);
      const r = radius(shape, y) * (0.29 + (((i % 11) * 0.173) % 0.6));
      dummy.position.set(
        Math.cos(a) * r,
        y + (slope.x * Math.cos(a) + slope.y * Math.sin(a)) * r * cycle,
        Math.sin(a) * r,
      );
      dummy.scale.setScalar((0.003 + (i % 5) * 0.0016) * Math.sin(Math.PI * cycle) ** 0.45);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
}
