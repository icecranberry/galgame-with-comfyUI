import DiceBox from '@drdreo/dice-box-threejs';
import { Body } from 'cannon-es';
import {
  ACESFilmicToneMapping, Mesh, MeshBasicMaterial, PCFShadowMap, PlaneGeometry, PMREMGenerator,
  Quaternion, ShadowMaterial, SpotLight, Vector3
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { landRoll } from './landing.js';
import { createCollider, createHull, createMaterial, createRoughnessMap, readTopDigit } from './percentile-dice.js';

const fps = 60;
const finishLimit = fps * 3.5;
const landingFrames = Math.round(fps * 0.42);

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
  constructor(container, callbacks) {
    const size = Math.min(container.clientWidth, container.clientHeight);
    super(container, {
      ...callbacks, framerate: 1 / fps, gravity_multiplier: size * 0.49, theme_texture: 'none'
    });
    this.size = size;
    this.radius = size * 0.104 + 6;
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

  spawnPercentileDie(i) {
    const { containerWidth: width, containerHeight: height } = this.display;
    const { radius, size } = this;
    const die = new Mesh(this.hull.geometry, createMaterial(i === 0, this.roughness));
    const body = new Body({
      mass: 350, shape: createCollider(this.hull), material: this.dice_body_material,
      linearDamping: 0.56, angularDamping: 0.64, sleepSpeedLimit: size * 0.09, sleepTimeLimit: 0.5
    });
    body.position.set(-width * 0.36 + i * 2.05 * radius, height * 0.34 + i * 0.45 * radius, size * 0.39 + i * 0.45 * radius);
    body.velocity.set(width * 0.51 + (i ? -2.1 : 2.1) * radius, -height * 0.55, -size * 0.1);
    body.angularVelocity.set(10 + Math.random() * 6, -8 + Math.random() * 6, (i ? -1 : 1) * 5);
    body.quaternion.copy(new Quaternion().random());
    die.body = body;
    die.castShadow = true;
    this.diceList.push(die);
    this.world.addBody(body);
    this.scene.add(die);
  }

  roll(value) {
    const digits = [Math.floor(value / 10) % 10, value % 10];
    this.hull = createHull(this.radius);
    this.spawnPercentileDie(0);
    this.spawnPercentileDie(1);
    const frames = [];
    // Keep the physical throw and blend the requested faces into its moving tail.
    for (let step = 0; step <= finishLimit; step++) {
      frames.push(this.diceList.map(({ body }) => ({
        position: new Vector3().copy(body.position),
        rotation: new Quaternion().copy(body.quaternion).normalize()
      })));
      if (this.diceList.every(({ body }) => body.sleepState === Body.SLEEPING)) {
        this.replay(landRoll(this.hull, frames, digits, landingFrames), () => this.completeRoll(value));
        return;
      }
      this.world.step(this.framerate);
    }
    throw new Error('Percentile dice did not settle');
  }

  completeRoll(value) {
    const rolls = this.diceList.map((die, i) => {
      const digit = readTopDigit(this.hull, die.quaternion);
      const label = i === 0 ? `${digit}0` : String(digit);
      const type = i === 0 ? 'd100' : 'd10';
      return {
        id: i, sides: 20, type, value: Number(label), label, reason: 'forced',
        position: { x: die.position.x, y: die.position.y, z: die.position.z },
        screenPosition: this.getScreenPosition(die.position), scale: die.scale.x
      };
    });
    const total = rolls.reduce((sum, die) => sum + die.value, 0) || 100;
    if (total !== value) throw new Error('Percentile faces did not match the server');
    const results = {
      notation: '1d100', modifier: 0, total,
      sets: rolls.map(roll => ({ type: roll.type, sides: roll.sides, num: 1, rolls: [roll], total: roll.value }))
    };
    this.onRollComplete(results);
    document.dispatchEvent(new CustomEvent('rollComplete', { detail: results }));
  }

  replay(frames, complete) {
    const last = frames.length - 1;
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
      die.material.map.dispose();
      die.material.bumpMap.dispose();
      die.material.dispose();
      this.world.removeBody(die.body);
    }
    this.hull?.geometry.dispose();
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

function play(container, value, signal, onRollComplete) {
  if (signal.aborted || !Number.isInteger(value) || value < 1 || value > 100) return false;
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
      console.debug('D100 WebGL fallback:', error.message);
      stop();
    };
    signal.addEventListener('abort', stop, { once: true });
    box = new GoldDiceBox(container, { onRollComplete: complete, onFailure: fail });
    box.initialize().then(() => {
      if (signal.aborted) return;
      box.renderer.domElement.addEventListener('webglcontextlost', stop, { once: true });
      box.roll(value);
    }).catch(fail);
  });
}

window.TrpgDice3D = { play };
