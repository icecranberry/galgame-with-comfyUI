import DiceBox from '@drdreo/dice-box-threejs';
import { Body } from 'cannon-es';
import {
  ACESFilmicToneMapping, Mesh, MeshBasicMaterial, PCFShadowMap, PlaneGeometry, PMREMGenerator,
  Quaternion, ShadowMaterial, SpotLight, Vector3
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCollider, createHull, createMaterial, createRoughnessMap, mapLandingDigit, readTopDigit } from './percentile-dice.js';

const fps = 60;
const finishLimit = fps * 3.5;

function addReflectionStrips(room) {
  const strips = [
    { size: [1.6, 7.5], position: [-4.5, 3.6, 10], color: [17, 13.4, 8.5] },
    { size: [1.1, 5.8], position: [5.4, -3.4, 7.5], color: [4, 6.4, 11] }
  ];
  for (const { size, position, color } of strips) {
    const material = new MeshBasicMaterial();
    material.color.setRGB(...color);
    const strip = new Mesh(new PlaneGeometry(...size), material);
    strip.position.set(...position);
    strip.lookAt(0, 0, 0);
    room.add(strip);
  }
}

class GoldDiceBox extends DiceBox {
  constructor(container, diceCount, callbacks) {
    const size = Math.min(container.clientWidth, container.clientHeight);
    super(container, {
      ...callbacks, framerate: 1 / fps, gravity_multiplier: size * 0.49, theme_texture: 'none'
    });
    this.size = size;
    this.radius = size * 0.14 / Math.sqrt(diceCount) + 5;
  }

  // Keep a single tray geometry for the recording. CSS fits the canvas on resize.
  resizeWorld() {}

  async initialize() {
    await super.initialize();
    const { renderer, scene, desk, size, light } = this;
    const pixels = this.container.clientWidth * this.container.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(2200000 / pixels)));
    renderer.domElement.style.removeProperty('width');
    renderer.domElement.style.removeProperty('height');
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.shadowMap.type = PCFShadowMap;
    scene.background = null;

    const room = new RoomEnvironment();
    addReflectionStrips(room);
    const generator = new PMREMGenerator(renderer);
    try {
      this.environment = generator.fromScene(room, 0.02);
      scene.environment = this.environment.texture;
      scene.environmentIntensity = 0.94;
    } finally {
      room.dispose();
      generator.dispose();
    }

    desk.material.dispose();
    desk.material = new ShadowMaterial({ opacity: 0.45 });
    light.color.set(0xffd69b);
    light.intensity = 4.35 * size ** 2;
    light.position.set(-0.7 * size, 0.55 * size, 1.2 * size);
    light.distance = 4 * size;
    light.angle = Math.PI / 4;
    light.penumbra = 0.55;
    light.shadow.camera.near = size * 0.15;
    light.shadow.bias = -0.00015;
    light.shadow.normalBias = size * 0.001;
    light.shadow.radius = 3.5;
    scene.remove(this.light_amb);

    const rim = new SpotLight(0xa1bcff, 1.45 * size ** 2, size * 3, Math.PI / 3, 0.65);
    rim.position.set(0.8 * size, -0.6 * size, 0.8 * size);
    scene.add(rim);
    this.roughness = createRoughnessMap();
  }

  spawnDie(spec, index, count) {
    const { containerWidth: width, containerHeight: height } = this.display;
    const { radius, size } = this;
    const hull = createHull(radius, spec.sides);
    const die = new Mesh(hull.geometry, createMaterial(spec, this.roughness, hull.labelDiameter));
    const body = new Body({
      mass: 350, shape: createCollider(hull), material: this.dice_body_material,
      linearDamping: 0.56, angularDamping: 0.64, sleepSpeedLimit: size * 0.09, sleepTimeLimit: 0.5
    });
    const columns = Math.ceil(Math.sqrt(count));
    body.position.set(-width * 0.26 + (index % columns) * 2.25 * radius, height * 0.28 - Math.floor(index / columns) * 2.25 * radius, size * 0.39);
    body.velocity.set(width * 0.48 + (index % 2 ? -1.6 : 1.6) * radius, -height * 0.52, -size * 0.10);
    body.angularVelocity.set(10 + Math.random() * 6, -8 + Math.random() * 6, (index % 2 ? -1 : 1) * 5);
    body.quaternion.copy(new Quaternion().random());
    die.body = body;
    die.castShadow = true;
    this.diceList.push(die);
    this.world.addBody(body);
    this.scene.add(die);
    return hull;
  }

  roll(dice, onImpact) {
    const hulls = dice.map((spec, index) => this.spawnDie(spec, index, dice.length));
    const frames = [];
    const impacts = [];
    let strongest = 0;
    const captureImpact = ({ contact }) => {
      strongest = Math.max(strongest, Math.abs(contact.getImpactVelocityAlongNormal()) / this.size);
    };
    if (onImpact) for (const { body } of this.diceList) body.addEventListener('collide', captureImpact);
    for (let step = 0; step <= finishLimit; step++) {
      frames.push(this.diceList.map(({ body }) => ({
        position: new Vector3().copy(body.position),
        rotation: new Quaternion().copy(body.quaternion).normalize()
      })));
      if (this.diceList.every(({ body }) => body.sleepState === Body.SLEEPING)) break;
      strongest = 0;
      this.world.step(this.framerate);
      if (strongest > 0) impacts.push({ frame: step + 1, speed: strongest });
    }
    if (onImpact) for (const { body } of this.diceList) body.removeEventListener('collide', captureImpact);
    const settled = frames.at(-1);
    dice.forEach(({ sides, face }, index) => mapLandingDigit(hulls[index], sides, settled[index].rotation, face));
    this.replay(frames, impacts, onImpact, () => {
      if (dice.some(({ face }, index) => readTopDigit(hulls[index], this.diceList[index].quaternion) !== face)) {
        throw new Error('Dice faces did not match the server');
      }
      this.onRollComplete();
    });
  }

  replay(frames, impacts, onImpact, complete) {
    const last = frames.length - 1;
    let impactIndex = 0;
    let start;
    const draw = now => {
      try {
        start ??= now;
        const frame = Math.min(last, (now - start) * fps / 1000);
        const a = Math.floor(frame), b = Math.min(last, a + 1);
        this.diceList.forEach((die, i) => {
          die.position.lerpVectors(frames[a][i].position, frames[b][i].position, frame - a);
          die.quaternion.slerpQuaternions(frames[a][i].rotation, frames[b][i].rotation, frame - a);
        });
        this.renderer.render(this.scene, this.camera);
        // Physics runs ahead of the animation. Play contacts as the matching frames are drawn.
        let strongest = 0;
        while (impacts[impactIndex]?.frame <= frame) {
          const impact = impacts[impactIndex++];
          if (frame - impact.frame <= 3) strongest = Math.max(strongest, impact.speed);
        }
        if (strongest > 0) onImpact(strongest);
        if (frame < last) this.frame = requestAnimationFrame(draw);
        else complete();
      } catch (error) {
        this.onFailure(error);
      }
    };
    this.frame = requestAnimationFrame(draw);
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    for (const die of this.diceList) {
      die.geometry.dispose();
      die.material.map.dispose();
      die.material.bumpMap.dispose();
      die.material.dispose();
      this.world.removeBody(die.body);
    }
    this.desk?.geometry.dispose();
    this.desk?.material.dispose();
    this.roughness?.dispose();
    this.environment?.dispose();
    this.light?.shadow.dispose();
    this.renderer?.domElement.remove();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
  }
}

function play(container, roll, signal, onRollComplete, onImpact) {
  const sides = roll.sides || 100;
  const values = roll.rolls?.length ? roll.rolls : [roll.value];
  if (signal.aborted || ![3, 4, 6, 8, 10, 12, 20, 100].includes(sides) ||
      values.length > 6 || values.some(value => !Number.isInteger(value) || value < 1 || value > sides)) return false;
  const dice = values.flatMap(value => sides === 100 ? [
    { sides: 10, tens: true, percentile: true, face: Math.floor(value / 10) % 10 },
    { sides: 10, percentile: true, face: value % 10 },
  ] : [{ sides, face: value - 1 }]);
  return new Promise(resolve => {
    let box;
    const stop = () => {
      signal.removeEventListener('abort', stop);
      box?.renderer?.domElement.removeEventListener('webglcontextlost', stop);
      box?.dispose();
      resolve(false);
    };
    const complete = () => {
      onRollComplete();
      resolve(true);
    };
    const fail = error => {
      console.debug('TRPG dice:', error.message);
      stop();
    };
    signal.addEventListener('abort', stop, { once: true });
    box = new GoldDiceBox(container, dice.length, { onRollComplete: complete, onFailure: fail });
    box.initialize().then(() => {
      if (signal.aborted) return;
      box.renderer.domElement.addEventListener('webglcontextlost', stop, { once: true });
      box.roll(dice, onImpact);
    }).catch(fail);
  });
}

window.TrpgDice3D = { play };
