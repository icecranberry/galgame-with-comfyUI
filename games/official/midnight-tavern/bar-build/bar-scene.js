import * as T from 'three';
import { bouquet, effervescence } from './garnish.js';
import { createFluid } from './fluid.js';
import { engrave, decanter, coaster, iceCube, fitIceCube, placeFloatingIce, condensation, stepIce } from './craft.js';
import backbar from './backbar.webp';

const vessels = {
  gin_vodka: {
    stem: 0.96,
    wall: [
      [0.025, 0.96],
      [0.24, 1.08],
      [0.81, 1.65],
      [0.84, 1.69],
    ],
    floor: 1.02,
    rim: 1.69,
  },
  whiskey_rum: {
    square: true,
    wall: [
      [0.55, 0.03],
      [0.59, 0.09],
      [0.65, 1.15],
      [0.65, 1.2],
    ],
    floor: 0.17,
    rim: 1.2,
  },
  liqueur_sparkling: {
    stem: 0.65,
    wall: [
      [0.05, 0.65],
      [0.29, 0.72],
      [0.47, 0.91],
      [0.54, 1.13],
      [0.51, 1.36],
      [0.4, 1.62],
      [0.39, 1.78],
    ],
    floor: 0.74,
    rim: 1.78,
  },
  coffee_tea: {
    wall: [
      [0.43, 0.026],
      [0.475, 0.068],
      [0.49, 0.20],
      [0.51, 1.42],
      [0.515, 1.55],
    ],
    floor: 0.17,
    rim: 1.55,
  },
};
const vec = (x, y, z) => new T.Vector3(x, y, z);
const smooth = (n) => n * n * (3 - 2 * n);
function radius(shape, y) {
  const points = shape.wall;
  for (let i = 1; i < points.length; i++) {
    const [a, h] = points[i - 1],
      [b, k] = points[i];
    if (y <= k) return T.MathUtils.lerp(a, b, T.MathUtils.clamp((y - h) / (k - h), 0, 1));
  }
  return points.at(-1)[0];
}
function lathe(points, square = false, cuts = false) {
  const geo = new T.LatheGeometry(
    points.map(([r, y]) => new T.Vector2(r, y)),
    cuts ? 192 : 96,
  );
  if (square) {
    const attr = geo.attributes.position;
    for (let i = 0; i < attr.count; i++) {
      const x = attr.getX(i),
        z = attr.getZ(i),
        r = Math.hypot(x, z);
      if (!r) continue;
      const factor = 1 / (Math.abs(x / r) ** 8 + Math.abs(z / r) ** 8) ** 0.125;
      const y = attr.getY(i),
        angle = Math.atan2(x, z);
      // Diamond-wheel flutes taper into the exterior, leaving the inner wall smooth.
      const flute =
        cuts && r > radius(vessels.whiskey_rum, y) - 0.006
          ? 0.042 * Math.max(0, 1 - Math.abs(y - 0.22) / 0.24) * (0.5 + 0.5 * Math.cos(24 * angle)) ** 2
          : 0;
      attr.setXYZ(i, x * (1 - flute / r) * factor, y, z * (1 - flute / r) * factor);
    }
    geo.computeVertexNormals();
  }
  return geo;
}
function mesh(parent, geo, material, x = 0, y = 0, z = 0) {
  const obj = new T.Mesh(geo, material);
  obj.position.set(x, y, z);
  parent.add(obj);
  return obj;
}
function tube(points, width, segments = 28) {
  return new T.TubeGeometry(new T.CatmullRomCurve3(points), segments, width, 8, false);
}
// Each group owns its materials and geometries; shared environment & procedural textures belong to the scene.
function clearGroup(group) {
  const geometry = new Set(),
    materials = new Set();
  group.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    if (o.geometry) geometry.add(o.geometry);
    if (Array.isArray(o.material)) o.material.forEach(material => materials.add(material));
    else if (o.material) materials.add(o.material);
  });
  for (const g of geometry) g.dispose();
  for (const m of materials) m.dispose();
  group.clear();
}
const standard = (color, settings = {}) => new T.MeshStandardMaterial({ color, ...settings });
const physical = (settings) => new T.MeshPhysicalMaterial(settings);
const glass = () =>
  physical({
    color: 0xfffcf7,
    roughness: 0.036,
    metalness: 0,
    transmission: 0.99,
    ior: 1.48,
    thickness: 0.075,
    clearcoat: 1,
    envMapIntensity: 0.92,
    side: T.DoubleSide,
  });
function innerProfile(shape) {
  return [
    [Math.max(0.015, radius(shape, shape.floor) - 0.045), shape.floor],
    ...shape.wall.filter(([, y]) => y > shape.floor).map(([r, y]) => [r - 0.035, y]),
  ];
}
function shell(parent, shape) {
  const m = glass();
  const inner = innerProfile(shape).reverse();
  const profile = [
    [0, shape.wall[0][1]],
    ...(shape.square
      ? [
          ...shape.wall.slice(0, 2),
          ...Array.from({ length: 14 }, (_, i) => {
            const y = 0.105 + i * 0.027;
            return [radius(shape, y), y];
          }),
          ...shape.wall.slice(2),
        ]
      : shape.wall),
    ...inner,
    [0, shape.floor],
  ];
  const bowlGlass = m.clone();
  // The drink is already composited at full resolution. Preserve its detail
  // while sampling along the refracted ray through the outer glass.
  bowlGlass.onBeforeCompile = (shader) => {
    const clearTransmission = T.ShaderChunk.transmission_pars_fragment.replace(
      'return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );',
      'return textureLod(transmissionSamplerMap, fragCoord.xy, 0.0);',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <transmission_pars_fragment>', clearTransmission,
    );
  };
  mesh(parent, lathe(profile, shape.square, !!shape.square), bowlGlass);
  if (shape.stem)
    mesh(
      parent,
      lathe([
        [0, 0.02],
        [0.4, 0.02],
        [0.43, 0.045],
        [0.4, 0.065],
        [0.13, 0.1],
        [0.043, 0.17],
        [0.034, shape.stem],
        [0.06, shape.stem + 0.03],
      ]),
      m,
    );
  const lip = lathe(
    [
      [radius(shape, shape.rim) - 0.026, shape.rim - 0.004],
      [radius(shape, shape.rim), shape.rim - 0.006],
      [radius(shape, shape.rim), shape.rim + 0.007],
      [radius(shape, shape.rim) - 0.026, shape.rim + 0.009],
    ],
    shape.square,
  );
  mesh(parent, lip, m);
  engrave(parent, shape, radius);
}
// Keep the decoded CPU backplate between visits. Each visit still owns its GPU texture.
let preparedPlate;
function prepare() {
  if (!preparedPlate)
    preparedPlate = (async () => {
      const image = new Image();
      image.src = backbar;
      await image.decode();
      return image;
    })().catch(() => null);
  return preparedPlate;
}
function create(container, onLost, plate, onReady, onSound) {
  let firstFrame = true;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'high-performance' });
  if (!context) return null;
  const renderer = new T.WebGLRenderer({ canvas, context, antialias: true, alpha: true });
  let released = false,
    frame = 0,
    tween = null,
    observer,
    envMap,
    backdrop,
    coasterMap,
    lastFrame = null;
  const viewport = new T.Vector2(1, 1),
    origin = new T.Vector2();
  const iceSamples = context.getInternalformatParameter(context.RENDERBUFFER, context.RGBA16F, context.SAMPLES);
  const interior = new T.WebGLRenderTarget(1, 1, {
    type: T.HalfFloatType, samples: iceSamples.find(count => count <= 4) || 0,
  });
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(34, 1, 0.1, 60);
  const cup = new T.Group(),
    vessel = new T.Group(),
    liquid = new T.Group(),
    ice = new T.Group(),
    dew = new T.Group(),
    ornament = new T.Group(),
    tools = new T.Group();
  const cupModels = new Map();
  scene.add(cup, tools);
  cup.add(vessel, liquid, ice, dew, ornament);
  let shape = vessels.gin_vodka,
    fluid = null,
    fizz = null,
    cubes = [],
    drive = 0,
    circulation = 0,
    impact = 0,
    tilt = 0,
    tiltVelocity = 0,
    fill = 0,
    displacement = 0,
    mixAmount = 0,
    clock = 0,
    streamGroup = null,
    customTag,
    tagTexture;
  const keyLight = new T.DirectionalLight(0xffca88, 1.95);
  const lost = (e) => {
    e.preventDefault();
    dispose();
    onLost?.();
  };
  function dispose() {
    if (released) return;
    released = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    renderer.domElement.removeEventListener('webglcontextlost', lost);
    tween?.finish();
    tween = null;
    clearGroup(scene);
    cupModels.clear();
    tagTexture?.dispose();
    backdrop?.dispose();
    coasterMap?.dispose();
    interior.dispose();
    envMap?.dispose();
    keyLight.shadow.map?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  function animate(ms, tick, paced = false) {
    if (released) return Promise.resolve();
    if (tween) {
      tween.tick(1);
      tween.finish();
      tween = null;
    }
    if (reduced && !paced) {
      tick(1);
      return Promise.resolve();
    }
    return new Promise((finish) => {
      tween = { start: paced ? null : performance.now(), ms, tick, finish, paced };
    });
  }
  function setGarnish(recipe) {
    clearGroup(ornament);
    tagTexture?.dispose();
    tagTexture = null;
    customTag = null;
    const r = radius(shape, shape.rim),
      y = shape.rim;
    const g = new T.Group();
    ornament.add(g);
    g.position.set(-r * 0.75, y - 0.07, r * 0.5);
    g.rotation.z = 0.36;
    if (recipe.garnish) bouquet(g, recipe.garnish);
    if (recipe.customIngredient) {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 108;
      const ctx = c.getContext('2d');
      const end = 494;
      ctx.beginPath();
      ctx.moveTo(6, 53);
      ctx.lineTo(54, 9);
      ctx.lineTo(end, 9);
      ctx.quadraticCurveTo(507, 9, 507, 22);
      ctx.lineTo(507, 87);
      ctx.quadraticCurveTo(507, 100, end, 100);
      ctx.lineTo(54, 100);
      ctx.closePath();
      ctx.fillStyle = '#583a32';
      ctx.fill();
      ctx.strokeStyle = '#e3bb73';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(46, 54, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffe9bd';
      ctx.font = '500 48px "Microsoft YaHei",serif';
      ctx.fillText(recipe.customIngredient, 275, 56, 405);
      tagTexture = new T.CanvasTexture(c);
      tagTexture.colorSpace = T.SRGBColorSpace;
      customTag = new T.Sprite(new T.SpriteMaterial({ map: tagTexture, depthTest: false, toneMapped: false }));
      customTag.scale.set(0.7, 0.15, 1);
      customTag.material.rotation = -0.12;
      customTag.position.set(r + 0.28, y - 0.1, 0.27);
      ornament.add(customTag);
      mesh(
        ornament,
        tube([vec(r * 0.91, y, 0.14), vec(r + 0.06, y + 0.07, 0.19), vec(r + 0.1, y - 0.04, 0.25)], 0.012),
        standard(0xc69353),
      );
    }
  }
  function setCup(recipe, action) {
    clearGroup(liquid);
    fluid = null;
    fizz = null;
    const nextShape = vessels[recipe.baseLiquor] || vessels.gin_vodka;
    const changed = shape !== nextShape;
    if (changed || !vessel.children.length) {
      const previous = cupModels.get(shape);
      if (previous) previous.visible = false;
      clearGroup(dew);
      shape = nextShape;
      let model = cupModels.get(shape);
      if (!model) {
        model = new T.Group();
        shell(model, shape);
        vessel.add(model);
        cupModels.set(shape, model);
      }
      model.visible = true;
      if (cubes.length) condensation(dew, shape, radius);
    }
    mixAmount = 0;
    drive = 0;
    circulation = 0;
    impact = 0;
    if (recipe.baseLiquor) {
      fluid = createFluid(liquid, shape, radius, recipe, interior.texture, viewport);
      fizz = effervescence(liquid, shape, radius, recipe);
      fill = action === 'base' ? 0 : action === 'potion' ? fluid.amount - fluid.dose : fluid.amount;
      fluid.setFill(fill);
    } else fill = 0;
    if (changed && cubes.length) setIce(cubes.length, true);
    setGarnish(recipe);
  }
  function setIce(count, instant = false) {
    while (cubes.length > count) {
      const { node } = cubes.pop();
      ice.remove(node);
      clearGroup(node);
    }
    if (!count) {
      clearGroup(dew);
      return;
    }
    if (!dew.children.length) condensation(dew, shape, radius);
    const existing = cubes.length,
      inner = innerProfile(shape);
    if (reduced && !instant && count > existing) onSound?.('ice');
    const level = fluid?.level ?? shape.floor;
    for (let i = instant ? 0 : existing; i < count; i++) {
      const b = cubes[i] ?? iceCube(ice, i, interior.texture);
      if (!cubes[i]) cubes.push(b);
      fitIceCube(b, shape, inner, radius);
      const settled = instant || reduced;
      const a = (i * Math.PI * 2) / 5 + (i % 2) * 0.08;
      b.waiting = settled ? 0 : (i - existing) * 0.115;
      b.entered = settled;
      b.wet = settled;
      b.restLevel = NaN;
      b.still = 0;
      const y = settled ? level : shape.rim + 0.68 + (i - existing) * 0.09;
      const spread = Math.max(0, radius(shape, Math.min(y, shape.rim)) - 0.05 - b.bound) * 0.78;
      b.node.position.set(spread * Math.cos(a), y, spread * Math.sin(a));
      b.velocity.set(0, 0, 0);
      b.spin.set(0.54 * Math.cos(a), 0.36 * Math.sin(a), 0.62 * Math.sin(a + 0.5));
    }
    if (instant || reduced) placeFloatingIce(cubes, level, shape);
  }
  async function pour(recipe, kind) {
    if (kind === 'base') tilt = tiltVelocity = displacement = 0;
    setCup(recipe, kind);
    clearGroup(tools);
    const potion = kind === 'potion',
      start = fill;
    if (reduced) {
      onSound?.(potion ? 'drop' : 'pour');
      return animate(320, p => { fill = T.MathUtils.lerp(start, fluid.amount, smooth(p)); }, true);
    }
    const color = new T.Color(
      (potion ? window.TavernMix.dose(recipe.potions.at(-1)) : window.TavernMix.base(recipe)).color,
    );
    const flask = decanter(tools, color, potion, recipe.baseLiquor);
    streamGroup = new T.Group();
    tools.add(streamGroup);
    // Render the visible transmission explicitly so the shaft remains visible behind the glass shell.
    const streamMat = new T.ShaderMaterial({
      uniforms: { plate: { value: interior.texture }, tint: { value: color }, glow: { value: potion ? 0.17 : 0.02 } },
      vertexShader: `varying vec3 n,w;varying vec4 screen;void main(){vec4 p=modelMatrix*vec4(position,1.);
        n=normalize(mat3(modelMatrix)*normal);w=p.xyz;screen=projectionMatrix*viewMatrix*p;gl_Position=screen;}`,
      fragmentShader: `uniform sampler2D plate;uniform vec3 tint;uniform float glow;varying vec3 n,w;varying vec4 screen;
        void main(){vec3 N=normalize(n),V=normalize(cameraPosition-w);float f=pow(1.-abs(dot(N,V)),2.);
        vec2 uv=screen.xy/screen.w*.5+.5;vec2 bend=(mat3(viewMatrix)*N).xy*.035;
        vec3 sceneLight=texture2D(plate,clamp(uv+bend,.001,.999)).rgb;
        float glint=pow(max(dot(N,normalize(V+vec3(-.68,.7,.45))),0.),46.);
        vec3 c=sceneLight*(.61+.36*tint)+tint*(glow+.09)+vec3(1.,.84,.62)*(glint*2.+f*.42);
        gl_FragColor=vec4(c,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    });
    const spout = vec(-0.39, shape.rim + 0.48, 0.04),
      impactPoint = vec(-0.105, 0.01, 0.035);
    const path = new T.QuadraticBezierCurve3(spout.clone(), spout.clone(), impactPoint.clone());
    const stream = mesh(streamGroup, new T.TubeGeometry(path, 36, 0.034, 9, false), streamMat);
    const streamPositions = stream.geometry.attributes.position;
    stream.frustumCulled = false;
    const drop = mesh(streamGroup, new T.SphereGeometry(0.048, 20, 16), streamMat);
    const spray = Array.from({ length: 9 }, (_, i) =>
      mesh(streamGroup, new T.SphereGeometry(0.013 + (i % 3) * 0.005, 10, 8), streamMat),
    );
    let sounded = false, landed = false;
    return animate(potion ? 690 : 1250, (p) => {
      const enter = smooth(Math.min(p / 0.23, 1)),
        exit = smooth(T.MathUtils.clamp((p - 0.78) / 0.22, 0, 1));
      flask.rotation.z = -0.32 - enter * 1.88 + exit * 1.48;
      flask.position.copy(spout);
      flask.position.x -= (1 - enter + exit) * 1.65;
      flask.position.y += (1 - enter) * 0.28 + exit * 0.56;
      flask.visible = p < 1;
      const q = T.MathUtils.clamp((p - 0.24) / 0.48, 0, 1);
      if (!sounded && q > 0) {
        sounded = true;
        onSound?.(potion ? 'drop' : 'pour');
      }
      fill = T.MathUtils.lerp(start, fluid.amount, smooth(q));
      fluid.setFill(fill + displacement);
      const aperture = Math.sin(Math.PI * q) ** 0.44;
      impact = Math.max(impact, aperture * 0.85);
      stream.visible = q > 0 && q < 1;
      if (stream.visible) {
        path.v0.copy(flask.position);
        path.v1.set(-0.12, flask.position.y - 0.028, 0.04);
        path.v2.set(impactPoint.x, fluid.level + 0.041, impactPoint.z);
        // Ballistic centerline with an accelerating, narrowing cross-section.
        for (let i = 0; i <= 36; i++) {
          const t = i / 36,
            point = path.getPoint(t),
            dir = path.getTangent(t);
          const r = (potion ? 0.026 : 0.049) * aperture * (1 - 0.36 * t) * (1 + 0.075 * Math.sin(36 * t - 21 * q));
          for (let j = 0; j <= 9; j++) {
            const a = (j * Math.PI * 2) / 9,
              k = i * 10 + j;
            streamPositions.setXYZ(
              k,
              point.x - dir.y * Math.cos(a) * r,
              point.y + dir.x * Math.cos(a) * r,
              point.z + Math.sin(a) * r,
            );
          }
        }
        streamPositions.needsUpdate = true;
        stream.geometry.computeVertexNormals();
      }
      const tail = T.MathUtils.clamp((p - 0.72) / 0.13, 0, 1);
      drop.visible = tail > 0 && tail < 1;
      if (!landed && tail === 1) {
        landed = true;
        impact = Math.max(impact, potion ? 0.38 : 0.56);
      }
      drop.position.copy(spout).lerp(vec(-0.1, fluid.level, 0.035), tail * tail);
      drop.scale.set(0.65, 1.3, 0.65);
      for (let i = 0; i < spray.length; i++) {
        const age = (q * 2.4 + i * 0.31) % 1,
          a = i * 2.4;
        spray[i].visible = stream.visible;
        spray[i].position.set(
          -0.105 + Math.cos(a) * age * 0.18,
          fluid.level + 0.02 + Math.sin(age * Math.PI) * (0.06 + i * 0.009),
          0.035 + Math.sin(a) * age * 0.18,
        );
        spray[i].scale.setScalar(aperture * (1 - age * 0.7));
      }
      flask.userData.adjustFill(q);
    }, true).finally(() => {
      if (!released) {
        fill = fluid.amount;

        streamGroup = null;
        clearGroup(tools);
      }
    });
  }
  function stir() {
    clearGroup(tools);
    const spoon = new T.Group();
    tools.add(spoon);
    const steel = standard(0xe0cdad, { metalness: 0.98, roughness: 0.14 });
    mesh(spoon, new T.CylinderGeometry(0.013, 0.015, 1.3, 16), steel, 0, 0.65);
    const twist = Array.from({ length: 100 }, (_, i) => {
      const t = i / 99;
      return vec(0.015 * Math.cos(t * 68), 0.37 + t * 0.87, 0.015 * Math.sin(t * 68));
    });
    mesh(spoon, tube(twist, 0.006, 120), steel);
    mesh(spoon, new T.OctahedronGeometry(0.044), steel, 0, 1.33);
    mesh(spoon, new T.SphereGeometry(0.11, 32, 16), steel).scale.set(0.64, 1.28, 0.22);
    const alreadyMixed = mixAmount;
    const at = fluid?.level || shape.rim * 0.6;
    let sounded = false;
    return animate(1060, (p) => {
      const dip = smooth(Math.min(p / 0.19, 1)) * smooth(Math.min((1 - p) / 0.24, 1)),
        a = p * Math.PI * 5.2;
      const radius = Math.min(0.24, (shape.rim - at) * 0.45 + 0.11);
      spoon.position.set(
        Math.cos(a) * radius,
        shape.rim + 0.48 - dip * (shape.rim - at + 0.72),
        Math.sin(a) * radius,
      );
      spoon.rotation.set(Math.sin(a) * 0.16, -a, 0.26 - Math.cos(a) * 0.15);
      drive = dip;
      if (!sounded && p >= 0.14) {
        sounded = true;
        onSound?.('stir');
      }
      impact = Math.max(impact, 0.42 * dip);
      mixAmount = T.MathUtils.lerp(alreadyMixed, 1, smooth(T.MathUtils.clamp((p - 0.17) / 0.72, 0, 1)));
    }).finally(() => {
      if (!released) {
        drive = 0;

        clearGroup(tools);
      }
    });
  }
  try {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.03;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    container.append(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost', lost);
    const pmrem = new T.PMREMGenerator(renderer),
      room = new T.Scene();
    room.background = new T.Color(0x494340);
    try {
      // Tall warm and cool softboxes draw narrow silk highlights on the faceted surfaces.
      for (const [x, y, z, w, h, tint, intensity] of [
        [-3, 2, 1, 0.42, 5, 0xc4e5ef, 5],
        [3, 2, -1, 0.32, 4, 0xffd394, 7],
        [0, 4, -2, 2, 0.35, 0xffeed6, 4],
        [-2, 1, -3, 2.1, 2.6, 0xe69044, 1.2],
        [1, 1, 3, 1.3, 2.8, 0x8495ac, 0.85],
        [0.5, -1, 2, 4, 3, 0x936a46, 0.53],
      ]) {
        const softbox = mesh(
          room,
          new T.PlaneGeometry(w, h),
          new T.MeshBasicMaterial({ color: new T.Color(tint).multiplyScalar(intensity), side: T.DoubleSide }),
          x,
          y,
          z,
        );
        softbox.lookAt(0, 1, 0);
      }
      envMap = pmrem.fromScene(room, 0.016);
      scene.environment = envMap.texture;
    } finally {
      clearGroup(room);
      pmrem.dispose();
    }
    scene.environmentIntensity = 0.78;
    scene.background = new T.Color(0x3b2b26);
    if (plate) {
      backdrop = new T.Texture(plate);
      backdrop.needsUpdate = true;
      backdrop.colorSpace = T.SRGBColorSpace;
      scene.background = backdrop;
    }
    const shadow = mesh(scene, new T.PlaneGeometry(40, 40), new T.ShadowMaterial({ opacity: 0.32 }), 0, -0.003);
    shadow.rotation.x = -Math.PI / 2;
    shadow.receiveShadow = true;
    const contact = mesh(
      scene,
      new T.PlaneGeometry(2.5, 2.5),
      new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader:
          'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:
          'varying vec2 v;void main(){float r=length(v-.5)*2.;gl_FragColor=vec4(.04,.018,.012,.55*(1.-smoothstep(.65,.98,r)));}',
      }),
      0,
      0.001,
    );
    contact.rotation.x = -Math.PI / 2;
    const footprint = contact.clone();
    scene.add(footprint);
    footprint.position.y = 0.039;
    scene.add(new T.HemisphereLight(0xffe2ca, 0x544039, 0.9));
    keyLight.position.set(-3, 6, 3);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.normalBias = 0.012;
    Object.assign(keyLight.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 });
    keyLight.shadow.camera.updateProjectionMatrix();
    scene.add(keyLight);
    const rimLight = new T.DirectionalLight(0xffdaa3, 2.4);
    rimLight.position.set(3, 2, -4);
    scene.add(rimLight);
    const causticMaterial = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      uniforms: { tone: { value: new T.Color('#d39953') }, strength: { value: 0 }, level: { value: 0 } },
      vertexShader:
        'varying vec2 q;void main(){q=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec2 q;uniform vec3 tone;uniform float strength,level;
        void main(){float a=atan(q.y,q.x),r=length(q);float arc=exp(-abs(r-.58-.075*sin(5.*a+level))*(24.+sin(a)*5.));
        float filaments=pow(.5+.5*cos(a*19.+sin(a*6.+level)),4.);
        float light=(arc*(.3+.7*filaments)+.12*exp(-r*r*5.))*(1.-smoothstep(.79,1.,r));
        gl_FragColor=vec4(tone,strength*light);}`,
    });
    const glow = mesh(scene, new T.PlaneGeometry(2.05, 1.38), causticMaterial, 0.33, 0.038, -0.2);
    glow.rotation.x = -Math.PI / 2;
    coasterMap = coaster(scene);
    cup.position.y = 0.041;
    cup.rotation.y = -0.25;
    const maxBufferSize = Math.min(renderer.capabilities.maxTextureSize, context.getParameter(context.MAX_RENDERBUFFER_SIZE));
    const gpuInfo = context.getExtension('WEBGL_debug_renderer_info');
    const software = gpuInfo && /swiftshader|llvmpipe|software/i.test(context.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL));
    let renderScale = 1, slowFrames = 0;
    function resize() {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      // Supersample the whole composition, including shader highlights and
      // transmission. The canvas is displayed at the container's CSS size.
      const nativeRatio = Math.min(window.devicePixelRatio || 1, 2.25);
      const pixelBudget = Math.sqrt((software ? 400000 : 3840 * 2160) / (width * height));
      const preferred = software ? Math.min(1, pixelBudget) : Math.min(nativeRatio * 2, Math.max(nativeRatio, pixelBudget));
      const ratio = Math.min(preferred * renderScale, maxBufferSize / Math.max(width, height));
      renderer.setDrawingBufferSize(width, height, ratio);
      renderer.getDrawingBufferSize(viewport);
      interior.setSize(viewport.x, viewport.y);
      camera.aspect = width / height;
      const dist = Math.max(1, 0.83 / camera.aspect);
      camera.position.set(0.23, 2.46 * dist, 5.32 * dist);
      camera.lookAt(0, 1.04, 0);
      camera.fov = 34;
      camera.updateProjectionMatrix();
      if (backdrop?.image) {
        const aspect = backdrop.image.width / backdrop.image.height;
        backdrop.repeat.set(Math.min(1, camera.aspect / aspect), Math.min(1, aspect / camera.aspect));
        backdrop.offset.set((1 - backdrop.repeat.x) / 2, (1 - backdrop.repeat.y) / 2);
      }
    }
    observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    function draw(now) {
      try {
        renderFrame(now);
      } catch {
        dispose();
        onLost?.();
      }
    }
    function renderFrame(now) {
      if (released) return;
      const interval = now - (lastFrame ?? now);
      const dt = Math.min(0.08, Math.max(0, interval / 1000));
      lastFrame = now;
      // Preserve headroom for UI input when transmission and shadows saturate the renderer.
      slowFrames = interval > 38 && !document.hidden ? slowFrames + 1 : 0;
      if (slowFrames >= 6 && renderScale > 0.58) {
        renderScale = Math.max(0.58, renderScale * 0.78);
        slowFrames = 0;
        resize();
      }
      clock += dt;
      if (tween) {
        const current = tween;
        // A pour starts on its first draw. Shader compilation and missed frames
        // cannot skip the empty glass or consume the whole rise of the liquid.
        const stamp = current.paced ? clock * 1000 : now;
        current.start ??= stamp;
        const p = T.MathUtils.clamp((stamp - current.start) / current.ms, 0, 1);
        current.tick(p);
        if (p === 1) {
          tween = null;
          current.finish();
        }
      }
      impact *= Math.exp(-dt * 1.85);
      circulation = Math.max(drive, circulation * Math.exp(-dt * 1.45));
      if (fluid) {
        const displaced = cubes.reduce(
          (sum, b) => sum + T.MathUtils.clamp((fluid.level - b.node.position.y + b.r) / (2 * b.r), 0, 1) * 0.012,
          0,
        );
        displacement = T.MathUtils.damp(displacement, displaced, 10, dt);
        fluid.setFill(fill + displacement);
        if (reduced && cubes.some((b) => Math.abs(b.restLevel - fluid.level) > 0.0001))
          placeFloatingIce(cubes, fluid.level, shape);
        const steps = Math.max(1, Math.ceil(dt * 120));
        for (let i = 0; i < steps; i++) {
          tiltVelocity += ((-95 * tilt - 5 * tiltVelocity) * dt) / steps;
          tilt += (tiltVelocity * dt) / steps;
          const slope = fluid.uniforms.slope.value
            .set(-0.92 * tilt, 0.39 * tilt)
            .rotateAround(origin, cup.rotation.y);
          if (!reduced)
            stepIce(cubes, dt / steps, fluid.level, shape, drive, slope, (j) => {
              onSound?.('ice');
              impact = Math.max(j, impact);
              tiltVelocity += j * 1.45;
            });
        }
        causticMaterial.uniforms.tone.value
          .copy(fluid.uniforms.dyes.value[0])
          .lerp(fluid.uniforms.dyes.value[fluid.uniforms.count.value - 1], 0.48);
        causticMaterial.uniforms.strength.value = 0.36 * fill;
        causticMaterial.uniforms.level.value = fluid.level + tilt + drive;
        glow.position.z = cup.position.z - 0.2;
        fizz?.(reduced ? 0 : clock, fluid.level, drive, fluid.uniforms.slope.value);
        fluid.uniforms.time.value = reduced ? 0 : clock;
        fluid.uniforms.impact.value = reduced ? 0 : impact;
        fluid.uniforms.stir.value = reduced ? 0 : circulation;
        fluid.uniforms.mixed.value = mixAmount;
      }
      glow.position.x = cup.position.x + 0.33;
      footprint.position.x = cup.position.x;
      footprint.position.z = cup.position.z;
      footprint.scale.setScalar(shape.stem ? 0.42 : 0.63);
      liquid.visible = fill > 0;
      glow.visible = !!fluid && fill > 0;

      if (fluid) {
        for (const b of cubes) {
          b.crystal.visible = true;
          b.resolved.visible = false;
        }
        vessel.visible = false;
        fluid.mesh.visible = false;
        if (streamGroup) streamGroup.visible = false;
        renderer.setRenderTarget(interior);
        renderer.render(scene, camera);
        for (const b of cubes) {
          b.crystal.visible = false;
          b.resolved.visible = true;
        }
        vessel.visible = true;
        fluid.mesh.visible = true;
        if (streamGroup) streamGroup.visible = true;
        renderer.setRenderTarget(null);
      }
      renderer.render(scene, camera);
      if (firstFrame) {
        firstFrame = false;
        onReady?.();
      }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    restore(recipe) {
      cup.position.y = 0.041;
      cup.position.x = 0;
      cup.position.z = 0;
      cup.rotation.y = -0.2;

      tilt = 0;
      tiltVelocity = 0;
      displacement = 0;
      setCup(recipe);
      setIce(recipe.iceCount || 0, true);
    },
    pour,
    setIce,
    stir,
    setGarnish,
    serve() {
      let lastSpeed = 0;
      return animate(720, (p) => {
        const release = 0.25,
          peak = 1 / (release / 2 + (1 - release) / 2.5);
        const coast = (1 - p) / (1 - release);
        const slide =
          p < release ? (peak * p * p) / (2 * release) : 1 - (((1 - release) * peak) / 2.5) * coast ** 2.5;
        const speed = p < release ? (peak * p) / release : peak * coast ** 1.5;
        tiltVelocity += (speed - lastSpeed) * 0.82;
        lastSpeed = speed;
        // Cross the visible far edge of the wooden counter towards the guest on the right.
        cup.position.x = 3.3 * slide;
        cup.position.y = 0.041 * (1 - smooth(T.MathUtils.clamp((slide - 0.13) / 0.18, 0, 1)));
        cup.position.z = -1.7 * slide;
        cup.rotation.y = -0.2 + slide * 0.48;
      });
    },
    dispose,
  };
}
window.TavernBar3D = { create, prepare };
