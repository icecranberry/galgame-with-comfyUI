import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const tau = Math.PI * 2;
const v = (x, y, z) => new T.Vector3(x, y, z);
function object(group, g, m, x = 0, y = 0, z = 0) {
  const o = new T.Mesh(g, m);
  o.position.set(x, y, z);
  group.add(o);
  return o;
}
function line(group, points, width, m) {
  return object(
    group,
    new T.TubeGeometry(new T.CatmullRomCurve3(points), Math.max(12, points.length * 2), width, 6, false),
    m,
  );
}
const metal = (color, roughness = 0.22) => new T.MeshStandardMaterial({ color, metalness: 0.89, roughness });
const foil = () => metal(0xc79553);
function torus(parent, radius, wire, y, mat) {
  const ring = object(parent, new T.TorusGeometry(radius, wire, 8, 112), mat, 0, y);
  ring.rotation.x = Math.PI / 2;
  return ring;
}
export function engrave(parent, shape, radius) {
  const bronze = foil();
  const rimAt = (a, y, offset = 0) => {
    const factor = shape.square ? (Math.abs(Math.cos(a)) ** 8 + Math.abs(Math.sin(a)) ** 8) ** -0.125 : 1;
    const r = (radius(shape, y) + offset) * factor;
    return v(r * Math.cos(a), y, r * Math.sin(a));
  };
  const band = (y, w, m) =>
    line(
      parent,
      Array.from({ length: 97 }, (_, i) => rimAt((i * tau) / 96, y, 0.002)),
      w,
      m,
    );
  band(shape.rim - 0.035, 0.004, bronze);
  band(shape.rim - 0.057, 0.0025, bronze);
  if (shape.stem) {
    torus(parent, 0.392, 0.008, 0.066, bronze);
    torus(parent, 0.31, 0.004, 0.082, bronze);
    for (const h of [0.16, shape.stem * 0.58, shape.stem - 0.085]) torus(parent, 0.052, 0.012, h, bronze);
    const gem = object(
      parent,
      new T.OctahedronGeometry(0.105),
      new T.MeshPhysicalMaterial({ color: 0x19746e, metalness: 0.32, roughness: 0.1, clearcoat: 1 }),
      0,
      shape.stem * 0.57,
    );
    gem.scale.y = 1.55;
  }
  if (shape.square) {
    band(0.103, 0.003, bronze);
    const crest = (x, y) => rimAt(Math.PI * 0.5 + x, 0.68 + y, 0.0035);
    for (const scale of [1, 0.79]) {
      const points = [
        [0, 0.084],
        [0.072, 0],
        [0, -0.084],
        [-0.072, 0],
        [0, 0.084],
      ].map(([x, y]) => crest(x * scale, y * scale));
      const path = new T.CurvePath();
      for (let i = 1; i < points.length; i++) path.add(new T.LineCurve3(points[i - 1], points[i]));
      object(parent, new T.TubeGeometry(path, 32, 0.0029, 6, false), bronze);
    }
    return;
  }
  const engraving = metal(0x958369, 0.21);
  const n = 24;
  const h = shape.rim - shape.floor;
  for (let j = 0; j < n; j++) {
    const a = (tau * j) / n;
    const end = shape.floor + h * 0.27;
    const points = Array.from({ length: 13 }, (_, i) => {
      const t = i / 12;
      return rimAt(
        a + ((t - 0.5) * tau) / n,
        shape.floor + 0.015 + (end - shape.floor) * Math.sin(t * Math.PI),
        0.003,
      );
    });
    line(parent, points, 0.0026, engraving);
  }
}
export function coaster(scene) {
  const g = new T.Group();
  scene.add(g);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const c = canvas.getContext('2d');
  c.translate(512, 512);
  const grad = c.createRadialGradient(-120, -160, 22, 0, 0, 500);
  grad.addColorStop(0, '#325953');
  grad.addColorStop(0.73, '#183d3b');
  grad.addColorStop(1, '#102626');
  c.fillStyle = grad;
  c.fillRect(-512, -512, 1024, 1024);
  c.strokeStyle = '#ba975e';
  function circle(r, w) {
    c.lineWidth = w;
    c.beginPath();
    c.arc(0, 0, r, 0, tau);
    c.stroke();
  }
  for (const r of [485, 475, 440, 426, 350, 113, 99]) circle(r, r === 475 ? 4 : 1.6);
  for (let i = 0; i < 64; i++) {
    c.save();
    c.rotate((tau * i) / 64);
    c.beginPath();
    c.moveTo(0, 455);
    c.lineTo(0, i % 4 ? 465 : 473);
    c.stroke();
    c.restore();
  }
  for (let i = 0; i < 16; i++) {
    c.save();
    c.rotate((tau * i) / 16);
    c.beginPath();
    c.moveTo(0, 354);
    c.bezierCurveTo(9, 387, 19, 394, 0, 422);
    c.bezierCurveTo(-19, 394, -9, 387, 0, 354);
    c.stroke();
    c.restore();
  }
  for (let i = 0; i < 8; i++) {
    c.save();
    c.rotate((tau * i) / 8);
    c.beginPath();
    c.moveTo(0, 310);
    c.lineTo(24, 86);
    c.lineTo(0, 128);
    c.lineTo(-24, 86);
    c.closePath();
    c.stroke();
    c.restore();
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  object(g, new T.CylinderGeometry(0.946, 0.925, 0.03, 128), foil(), 0, 0.018);
  const face = object(
    g,
    new T.CircleGeometry(0.928, 128),
    new T.MeshPhysicalMaterial({ map: texture, roughness: 0.34, metalness: 0.19, clearcoat: 0.6 }),
    0,
    0.036,
  );
  face.rotation.x = -Math.PI / 2;
  face.receiveShadow = true;
  torus(g, 0.936, 0.007, 0.035, foil());
  return texture;
}
export function decanter(parent, color, small, kind) {
  const g = new T.Group();
  parent.add(g);
  const square = kind === 'whiskey_rum' && !small,
    pear = kind === 'liqueur_sparkling' || small;
  const p = pear
    ? [
        [0.035, -1.29],
        [0.19, -1.27],
        [0.31, -1.16],
        [0.38, -0.96],
        [0.38, -0.79],
        [0.32, -0.64],
        [0.16, -0.48],
        [0.09, -0.37],
        [0.08, -0.1],
        [0.102, -0.07],
        [0.102, 0],
        [0.077, 0],
      ]
    : [
        [0.02, -1.42],
        [0.25, -1.42],
        [0.3, -1.37],
        [0.315, -1.27],
        [0.315, -0.58],
        [0.3, -0.52],
        [0.16, -0.41],
        [0.101, -0.32],
        [0.1, -0.1],
        [0.129, -0.08],
        [0.129, 0],
        [0.095, 0],
      ];
  const lathe = (p) =>
    new T.LatheGeometry(
      p.map(([r, y]) => new T.Vector2(r, y)),
      square ? 12 : 96,
    );
  const body = new T.MeshPhysicalMaterial({
    color: new T.Color(0xfff8e9).lerp(color, 0.12),
    roughness: 0.048,
    metalness: 0,
    transmission: 0.985,
    thickness: 0.095,
    clearcoat: 1,
    ior: 1.5,
    side: T.DoubleSide,
  });
  object(g, lathe([...p, [p.at(-1)[0], -0.1]]), body);
  // Intersect the viewing ray with a gravity-level free surface inside the bottle profile.
  const bottom = p[0][1];
  const radiusAt = (y) => {
    for (let i = 1; i < p.length; i++)
      if (p[i][1] >= y) {
        const [r, h] = p[i - 1],
          [s, k] = p[i];
        return T.MathUtils.lerp(r, s, (y - h) / Math.max(0.0001, k - h));
      }
    return p.at(-1)[0];
  };
  const profile = Array.from({ length: 48 }, (_, i) =>
    Math.max(0.01, radiusAt(bottom + ((0 - bottom) * i) / 47) - 0.016),
  );
  const uniforms = {
    dye: { value: color },
    heights: { value: profile },
    bottom: { value: bottom },
    up: { value: v(0, 1, 0) },
    level: { value: -0.75 },
  };
  const spirit = new T.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 pos,eye;void main(){pos=position;eye=(inverse(modelMatrix)*vec4(cameraPosition,1.)).xyz;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform vec3 up,dye;uniform float level,bottom,heights[48];varying vec3 pos,eye;
    void main(){vec3 ray=normalize(pos-eye),p=pos;float dist=dot(p,up)-level;
    bool top=dist>0.;if(top){float dy=dot(ray,up);if(dy>=-.0001)discard;p-=ray*dist/dy;}
    if(p.y<bottom||p.y>0.)discard;float i=clamp((p.y-bottom)/(-bottom)*47.,0.,46.999);
    float r=mix(heights[int(i)],heights[int(i)+1],fract(i));if(top&&length(p.xz)>r)discard;
    float edge=clamp(length(p.xz)/max(.02,r),0.,1.);
    vec3 c=mix(dye*.25,dye*.82+vec3(.13,.07,.025),top?.75:pow(abs(p.x)/max(.02,r),2.));
    if(top)c+=vec3(1.,.71,.32)*(.12+.27*pow(edge,12.));gl_FragColor=vec4(c,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`,
  });
  const core = p.map(([r, y]) => [Math.max(0.006, r - 0.017), y + 0.003]);
  object(g, lathe(core), spirit);
  // Volume-weighted samples find the surface height as the filled belly rotates.
  const samples = [];
  for (let j = 0; j < 24; j++) {
    const y = bottom + ((j + 0.5) / 24) * -bottom,
      r = radiusAt(y);
    const n = Math.ceil(r * r * 140);
    for (let k = 0; k < n; k++) {
      const a = k * 2.399 + j;
      samples.push([r * Math.sqrt((k + 0.5) / n) * Math.cos(a), y]);
    }
  }
  g.userData.adjustFill = (q) => {
    const u = uniforms.up.value.set(Math.sin(g.rotation.z), Math.cos(g.rotation.z), 0);
    const projections = samples.map(([x, y]) => x * u.x + y * u.y).sort((a, b) => a - b);
    uniforms.level.value = projections[Math.floor((0.6 - 0.19 * q) * (projections.length - 1))];
  };
  const gold = foil();
  torus(g, pear ? 0.096 : 0.117, 0.013, -0.083, gold);
  torus(g, pear ? 0.09 : 0.11, 0.009, -0.13, gold);
  const belly = pear ? 0.383 : 0.317;
  for (let i = 0; i < 14; i++) {
    const a = (i * tau) / 14,
      points = Array.from({ length: 16 }, (_, j) => {
        const t = j / 15,
          theta = a + 0.17 * t;
        const r = pear ? 0.19 + 0.19 * Math.sin(Math.PI * t) : belly * 0.96;
        return v(r * Math.cos(theta), -1.26 + t * (pear ? 0.68 : 0.65), r * Math.sin(theta));
      });
    line(g, points, 0.004, gold);
  }
  const badge = object(g, new T.CylinderGeometry(0.105, 0.105, 0.018, 32), gold, 0, -0.87, belly);
  badge.rotation.x = Math.PI / 2;
  badge.scale.z = 1.25;
  const jewel = object(
    g,
    new T.OctahedronGeometry(0.062, 1),
    new T.MeshPhysicalMaterial({ color, metalness: 0.28, roughness: 0.08, clearcoat: 1 }),
    0,
    -0.87,
    belly + 0.015,
  );
  jewel.scale.set(0.82, 1.2, 0.35);
  if (small) g.scale.setScalar(0.64);
  return g;
}
// A sparse set of beads clings to the cold bowl; each streak follows the wall normal.
export function condensation(parent, shape, radius) {
  const n = 55,
    geometry = new T.SphereGeometry(1, 12, 8);
  const mat = new T.MeshPhysicalMaterial({
    color: 0xe1e8da,
    roughness: 0.06,
    metalness: 0.12,
    clearcoat: 1,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  const beads = new T.InstancedMesh(geometry, mat, n),
    dummy = new T.Object3D();
  for (let i = 0; i < n; i++) {
    const a = i * 2.399 + 0.24 * Math.sin(i * 1.7),
      h = 0.15 + 0.74 * ((i * 0.75488) % 1);
    const y = shape.floor + (shape.rim - shape.floor) * h;
    const f = shape.square ? (Math.abs(Math.cos(a)) ** 8 + Math.abs(Math.sin(a)) ** 8) ** -0.125 : 1;
    const r = (radius(shape, y) + 0.001) * f,
      sz = 0.003 + 0.009 * ((i * 0.473) % 1) ** 2;
    dummy.position.set(r * Math.cos(a), y, r * Math.sin(a));
    dummy.lookAt(0, y, 0);
    dummy.scale.set(sz, sz * (1.13 + 1.1 * ((i * 0.321) % 1)), sz * 0.59);
    dummy.updateMatrix();
    beads.setMatrixAt(i, dummy.matrix);
  }
  parent.add(beads);
}
export function iceCube(parent, i, background) {
  const node = new T.Group();
  parent.add(node);
  const size = [0.285, 0.315, 0.26, 0.28, 0.25][i];
  const geometry = new RoundedBoxGeometry(size, size * 0.91, size * 1.06, 6, size * 0.15);
  // The same displacement on coincident vertices keeps the rounded edges watertight.
  const pos = geometry.attributes.position,
    p = new T.Vector3();
  for (let k = 0; k < pos.count; k++) {
    p.fromBufferAttribute(pos, k);
    const warp = 1 + 0.025 * Math.sin(p.x * 29 + i) * Math.cos(p.z * 24 - p.y * 19);
    pos.setXYZ(k, p.x * warp + 0.032 * p.y, p.y * warp, p.z * warp);
  }
  // RoundedBox is non-indexed. Retain its continuous bevel normals across triangle seams.
  const shell = new T.MeshPhysicalMaterial({
    color: 0x000000, roughness: 0.04, ior: 1.31,
    transparent: true, depthWrite: false,
  });
  shell.onBeforeCompile = (shader) => {
    const varyings = 'varying vec3 icePoint, iceNormal, iceIncident; varying mat3 iceToView;\n';
    shader.uniforms.iceSize = { value: size };
    shader.vertexShader = varyings + 'uniform float iceSize;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      icePoint = position / iceSize;
      iceNormal = normal;
      iceIncident = position - (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
      iceToView = mat3(modelViewMatrix);`);
    shader.fragmentShader = varyings + `
      // A cool mullioned window, opposite the amber bar lamps. Project both
      // reflection rays onto the same pane in world space as the cube rotates.
      vec3 windowLight(vec3 direction) {
        vec3 axis = normalize(vec3(-0.55, 0.72, 0.54));
        vec3 right = normalize(cross(vec3(0., 1., 0.), axis));
        vec3 up = cross(axis, right);
        float facing = dot(direction, axis);
        vec2 uv = vec2(dot(direction, right), dot(direction, up)) / max(facing, 0.001);
        vec2 border = vec2(0.78, 0.60) - abs(uv);
        float pane = smoothstep(-0.035, 0.035, min(border.x, border.y)) * step(0.0, facing);
        float frame = smoothstep(0.010, 0.036, abs(uv.x + 0.20))
                    * smoothstep(0.012, 0.033, abs(uv.y - 0.16));
        float sky = smoothstep(-0.5, 1.0, direction.y);
        return vec3(0.14, 0.27, 0.40) * sky
             + vec3(1.40, 2.30, 3.15) * pane * frame * (0.76 + 0.20 * clamp(uv.y, -1.0, 1.0));
      }
      // Intersect the far box face and round its normal across the melted bevel.
      vec3 nextFacet(inout vec3 point, vec3 ray) {
        vec3 halfSize = vec3(0.5, 0.455, 0.53);
        vec3 wall = mix(-halfSize, halfSize, step(vec3(0.0), ray));
        vec3 dist = abs(wall - point) / max(abs(ray), vec3(0.0001));
        point += ray * min(dist.x, min(dist.y, dist.z));
        return normalize(sign(point) * max(abs(point) - (halfSize - 0.15), vec3(0.0)) + 0.05 * point);
      }\n` + shader.fragmentShader.replace('#include <opaque_fragment>', `
      vec3 V = normalize(vViewPosition);
      // The slight bow in a hand-cut face sweeps reflected light across its width.
      vec3 N = normalize(iceNormal + 0.22 * icePoint);
      vec3 face = normalize(iceToView * N);
      float nv = clamp(dot(face, V), 0.0, 1.0);
      float frontWeight = 0.055 + 0.84 * pow(1.0 - nv, 4.0);

      // Trace to the opposite bevel inside the cube. At a grazing internal
      // angle it mirrors the room; looking through a face still reveals the drink.
      vec3 ray = refract(normalize(iceIncident), N, 1.0 / 1.31);
      vec3 hit = icePoint;
      vec3 rear = nextFacet(hit, ray);
      float internal = 1.0 - smoothstep(0.61, 0.69, abs(dot(ray, rear)));
      float rearWeight = mix(0.065, 0.62, internal) * (1.0 - frontWeight);
      vec3 frontRay = inverseTransformDirection(reflect(-V, face), viewMatrix);
      vec3 bounce = reflect(ray, rear);
      vec3 reflectedRay = inverseTransformDirection(normalize(iceToView * bounce), viewMatrix);
      vec3 reflection = (getIBLRadiance(V, face, 0.035) + windowLight(frontRay)) * frontWeight;
      reflection += windowLight(reflectedRay) * rearWeight;
      #ifdef ENVMAP_TYPE_CUBE_UV
        reflection += textureCubeUV(envMap, envMapRotation * reflectedRay, 0.055).rgb * rearWeight;
        // A second facet can catch a strip light even when the first faces the dark bar.
        vec3 next = nextFacet(hit, bounce);
        vec3 secondRay = inverseTransformDirection(normalize(iceToView * reflect(bounce, next)), viewMatrix);
        float secondWeight = (0.12 + 0.42 * internal) * (1.0 - frontWeight);
        reflection += (textureCubeUV(envMap, envMapRotation * secondRay, 0.065).rgb + windowLight(secondRay)) * secondWeight;
      #endif
      // Alpha attenuates the background once. The HDR lamp reflection contributes
      // its full radiance even on a nearly transparent face.
      diffuseColor.a = clamp(0.018 + frontWeight + rearWeight, 0.0, 1.0);
      outgoingLight = (reflection + reflectedLight.directSpecular) / diffuseColor.a;
      #include <opaque_fragment>`);
  };
  const crystal = object(node, geometry, shell);
  // The glass transmission pass only sees opaque geometry. Replay the resolved
  // ice on its actual surface so that exposed and submerged faces meet cleanly.
  const resolved = object(node, geometry, new T.ShaderMaterial({
    uniforms: { image: { value: background } },
    vertexShader: `varying vec4 clip;
      void main(){ clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = clip; }`,
    fragmentShader: `uniform sampler2D image; varying vec4 clip;
      void main(){
        gl_FragColor = vec4(texture2D(image, clip.xy / clip.w * 0.5 + 0.5).rgb, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  resolved.visible = false;
  // A feathered fracture trapped below the surface, with a brighter edge and branching tips.
  const crack = new T.MeshBasicMaterial({ color: 0xd7f3fa, transparent: true, opacity: 0.20, depthWrite: false });
  const fracture = new T.Group();
  crystal.add(fracture);
  fracture.rotation.set(0.25, i * 1.73, 0.3 - i * 0.18);
  const rib = [
    v(-0.085, -0.073, 0.022),
    v(-0.033, -0.024, 0.015),
    v(0.006, 0.005, 0.009),
    v(0.034, 0.046, 0.003),
    v(0.074, 0.084, -0.015),
  ];
  line(fracture, rib, 0.0018, crack);
  const facets = [];
  for (let j = 1; j < rib.length; j++) {
    const root = rib[j],
      tip = v(root.x + 0.035, root.y - 0.017, root.z + 0.016);
    facets.push(...rib[j - 1].toArray(), ...root.toArray(), ...tip.toArray());
    line(fracture, [root, tip, v(tip.x + 0.015, tip.y + 0.006, tip.z)], 0.0011, crack);
  }
  const plane = new T.BufferGeometry();
  plane.setAttribute('position', new T.Float32BufferAttribute(facets, 3));
  plane.computeVertexNormals();
  object(
    fracture,
    plane,
    new T.MeshStandardMaterial({
      color: 0xa6c1c8, metalness: 0.78, roughness: 0.12,
      transparent: true,
      opacity: 0.25,
      side: T.DoubleSide,
      depthWrite: false,
    }),
  );
  const air = new T.MeshPhysicalMaterial({
    color: 0xe7f8ff,
    roughness: 0.24,
    metalness: 0.25,
    transparent: true,
    opacity: 0.67,
    depthWrite: false,
  });
  const bead = new T.SphereGeometry(1, 10, 8);
  for (let j = 0; j < 5; j++) {
    const t = j / 4,
      a = j * 2.399 + i,
      r = 0.0025 + (0.0045 * ((j * 7) % 11)) / 10;
    const bubble = object(
      crystal,
      bead,
      air,
      -0.042 + 0.035 * Math.cos(a) + 0.045 * t,
      (t - 0.5) * size * 0.65,
      0.035 * Math.sin(a),
    );
    bubble.scale.set(r, r * (1.3 + t), r);
  }
  node.rotation.set(0.37 * i, 0.46 + i, 0.32 * i);
  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere;
  return {
    node,
    crystal,
    resolved,
    size,
    hull: sphere.radius + sphere.center.length(),
    bound: 0,
    r: 0,
    velocity: v(0, 0, 0),
    spin: v(0, 0, 0),
    previous: v(0, 0, 0),
    waiting: 0,
    entered: false,
    wet: false,
    still: 0,
    restLevel: NaN,
  };
}

// Erode the actual inner bowl by a sphere enclosing every rotated corner. On
// each linear wall segment the tightest latitude of the sphere has a closed form.
function wallClearance(b, y) {
  let cap = Infinity;
  for (const wall of b.walls) {
    const low = Math.max(wall.low, y - b.bound),
      high = Math.min(wall.high, y + b.bound);
    if (low > high) continue;
    const h = T.MathUtils.clamp(y - b.bound * wall.normalY, low, high);
    const section = Math.sqrt(Math.max(0, b.bound * b.bound - (h - y) ** 2));
    cap = Math.min(cap, wall.radius + wall.slope * (h - wall.low) - section);
  }
  return cap - 0.004; // clear the tessellated glass between profile vertices
}

export function fitIceCube(b, shape, inner, radius) {
  const middle = shape.floor + (shape.rim - shape.floor) * 0.58;
  const scale = Math.min(1, (radius(shape, middle) - 0.045) / 0.6);
  b.node.scale.setScalar(scale);
  b.bound = b.hull * scale;
  b.r = b.size * 0.54 * scale; // buoyancy uses the submerged face, not the diagonal
  b.walls = inner.slice(1).map(([r, y], i) => {
    const [lower, h] = inner[i],
      slope = (r - lower) / (y - h);
    return { low: h, high: y, radius: lower, slope, normalY: slope / Math.hypot(1, slope) };
  });
  b.walls.push({ low: shape.rim, high: Infinity, radius: inner.at(-1)[0], slope: 0, normalY: 0 });
  b.ceiling = shape.rim - b.bound - 0.004;
  b.bottom = shape.floor + b.bound + 0.004;
  if (wallClearance(b, b.bottom) < 0) {
    let lo = b.bottom,
      hi = b.ceiling;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (wallClearance(b, mid) < 0) lo = mid;
      else hi = mid;
    }
    b.bottom = hi;
  }
}
function contain(b, shape) {
  const p = b.node.position,
    vel = b.velocity;
  if (p.y < b.bottom) {
    p.y = b.bottom;
    vel.y = Math.max(0, vel.y);
  }
  if (p.y <= b.ceiling || b.wet) b.entered = true;
  if (b.entered && p.y > b.ceiling) {
    p.y = b.ceiling;
    vel.y = Math.min(0, vel.y);
  }
  const cap = Math.max(0, wallClearance(b, p.y));
  const radial = shape.square ? (Math.abs(p.x) ** 8 + Math.abs(p.z) ** 8) ** 0.125 : Math.hypot(p.x, p.z);
  if (radial <= cap) return;
  // Remove outward velocity; resting contact does not supply spin.
  const nx = shape.square ? (p.x / radial) ** 7 : p.x / radial,
    nz = shape.square ? (p.z / radial) ** 7 : p.z / radial;
  p.x *= cap / radial;
  p.z *= cap / radial;
  const normalLength = nx * nx + nz * nz;
  if (normalLength > 1e-12) {
    const outward = Math.max(0, vel.x * nx + vel.z * nz) / normalLength;
    vel.x -= outward * nx;
    vel.z -= outward * nz;
  }
}

const separation = v(0, 0, 0);
function solveContacts(cubes, shape) {
  // Project against the glass last on every pass: another cube can push a
  // previously valid one through the wall, particularly near a narrowing rim.
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < cubes.length; i++)
      for (let j = i + 1; j < cubes.length; j++) {
        const a = cubes[i],
          b = cubes[j];
        if (a.waiting > 0 || b.waiting > 0) continue;
        separation.subVectors(b.node.position, a.node.position);
        const distance = separation.length(),
          overlap = a.bound + b.bound - distance;
        if (overlap <= 0) continue;
        if (distance > 1e-8) separation.multiplyScalar(1 / distance);
        else separation.set(1, 0, 0);
        a.node.position.addScaledVector(separation, -overlap * 0.5);
        b.node.position.addScaledVector(separation, overlap * 0.5);
        const approach = b.velocity.dot(separation) - a.velocity.dot(separation);
        if (approach < 0) {
          a.velocity.addScaledVector(separation, 0.5 * approach);
          b.velocity.addScaledVector(separation, -0.5 * approach);
        }
      }
    for (const b of cubes) contain(b, shape);
  }
}
export function placeFloatingIce(cubes, level, shape) {
  for (const b of cubes) {
    b.node.position.y = level - 0.39 * b.r;
    b.entered = true;
    b.wet = true;
    b.waiting = 0;
    b.velocity.set(0, 0, 0);
    b.spin.set(0, 0, 0);
    b.restLevel = level;
    b.still = 0;
  }
  solveContacts(cubes, shape);
}
export function stepIce(cubes, dt, level, shape, drive, slope, onImpact) {
  if (!dt || !cubes.length) return;
  const calm = drive < 0.003 && slope.lengthSq() < 0.000016;
  if (calm && cubes.every((b) => Math.abs(b.restLevel - level) < 0.002)) return;
  for (const b of cubes) {
    const p = b.node.position,
      vel = b.velocity;
    b.restLevel = NaN;
    b.previous.copy(p);
    if (b.waiting > 0) {
      b.waiting -= dt;
      continue;
    }
    const immersed = T.MathUtils.clamp((level + p.x * slope.x + p.z * slope.y - p.y + b.r) / (2 * b.r), 0, 1);
    if (!b.wet && immersed > 0.05) {
      b.wet = true;
      onImpact(Math.min(1, Math.abs(vel.y) * 0.28));
    }
    vel.y += (15.5 * immersed - 10.8) * dt;
    vel.multiplyScalar(Math.exp(-dt * (0.16 + 6.7 * immersed)));
    vel.x += (-drive * p.z * 25 + slope.x * 2.6) * immersed * dt;
    vel.z += (drive * p.x * 25 + slope.y * 2.6) * immersed * dt;
    p.addScaledVector(vel, dt);
    b.spin.multiplyScalar(Math.exp(-dt * (b.entered ? 6.8 : 0.8)));
    if (b.spin.lengthSq() < 0.025 ** 2) b.spin.set(0, 0, 0);
    b.node.rotation.x += dt * b.spin.x;
    b.node.rotation.y += dt * (b.spin.y + drive * 2);
    b.node.rotation.z += dt * b.spin.z;
  }
  solveContacts(cubes, shape);
  for (const b of cubes) {
    const quiet =
      calm && b.entered && b.spin.lengthSq() === 0 && b.node.position.distanceToSquared(b.previous) < (0.012 * dt) ** 2;
    b.still = quiet ? b.still + dt : 0;
  }
  if (cubes.every((b) => b.still >= 0.18)) {
    for (const b of cubes) {
      b.restLevel = level;
      b.velocity.set(0, 0, 0);
    }
  }
}
