import { Quaternion, Vector3 } from 'three';
import { alignDigit } from './percentile-dice.js';

const up = new Vector3(0, 0, 1);
const identity = new Quaternion();

function reach(hull, rotation, direction) {
  const localAxis = direction.clone().applyQuaternion(rotation.clone().invert());
  return Math.max(...hull.vertices.map(vertex => vertex.dot(localAxis)));
}

function planLanding(hull, frames, i, digit, duration) {
  const radius = hull.geometry.parameters.radius;
  const resting = frames.at(-1)[i];
  let end = frames.length - 1;
  // Cannon waits for its sleep timer even after all visible motion has stopped.
  while (end > 1 && resting.position.distanceTo(frames[end - 1][i].position) < radius * 0.013 &&
    resting.rotation.angleTo(frames[end - 1][i].rotation) < 0.024) end--;

  let start = Math.max(0, end - duration);
  const earliest = Math.max(0, start - Math.floor(duration / 2));
  // If the blend starts during a quiet contact, include the approach to it.
  while (start > earliest) {
    const a = frames[start - 1][i], b = frames[start][i];
    if (a.position.distanceTo(b.position) >= radius * 0.012 || a.rotation.angleTo(b.rotation) >= 0.012) break;
    start--;
  }

  const natural = frames[end][i].rotation;
  const target = alignDigit(hull, natural, digit);
  const correction = target.multiply(natural.clone().invert());
  // Translate in the direction of the added tilt so it reads as a rolling edge.
  const travel = new Vector3(correction.y, -correction.x, 0).multiplyScalar(radius * (correction.w < 0 ? -0.75 : 0.75));
  return { start, end, correction, travel };
}

function landingPose(hull, frames, frame, i, plan, eased) {
  const t = (frame - plan.start) / (plan.end - plan.start);
  // Match incoming speed, then slow the sampled physical path to rest.
  const sample = plan.start + (plan.end - plan.start) * (t + t ** 3 * (1 - t));
  const lower = Math.floor(sample), upper = Math.min(plan.end, lower + 1);
  const a = frames[lower][i], b = frames[upper][i];
  const position = a.position.clone().lerp(b.position, sample - lower);
  const natural = a.rotation.clone().slerp(b.rotation, sample - lower);
  const rotation = identity.clone().slerp(plan.correction, eased).multiply(natural).normalize();
  const clearance = Math.max(0, position.z - reach(hull, natural, up));
  position.addScaledVector(plan.travel, eased);
  position.z = reach(hull, rotation, up) + clearance * (1 - eased);
  return { position, rotation };
}

function overlap(hull, poses, axis) {
  const width = poses.reduce((sum, pose) => sum + reach(hull, pose.rotation, axis), 0);
  return width - poses[1].position.clone().sub(poses[0].position).dot(axis);
}

function separate(hull, poses, natural, strength, weights) {
  const axis = poses[1].position.clone().sub(poses[0].position).setZ(0).normalize();
  if (!axis.lengthSq()) axis.set(1, 0, 0);
  const push = Math.max(0, overlap(hull, poses, axis) - Math.max(0, overlap(hull, natural, axis)) * (1 - strength));
  const span = weights[0] + weights[1];
  if (span === 0) return;
  poses[0].position.addScaledVector(axis, -push * weights[0] / span);
  poses[1].position.addScaledVector(axis, push * weights[1] / span);
}

export function landRoll(hull, frames, digits, duration) {
  const plans = digits.map((digit, i) => planLanding(hull, frames, i, digit, duration));
  const first = Math.min(...plans.map(plan => plan.start));
  const last = Math.max(...plans.map(plan => plan.end));
  const replay = frames.slice(0, first + 1);
  for (let frame = first + 1; frame <= last; frame++) {
    const previous = replay.at(-1);
    const weights = plans.map(({ end }) => Math.max(0, end - frame));
    const progress = plans.map(({ start, end }) => Math.min(1, Math.max(0, (frame - start) / (end - start))));
    const eased = progress.map(t => t * t * (3 - 2 * t));
    const poses = plans.map((plan, i) => {
      if (frame > plan.end) return previous[i];
      if (frame <= plan.start) return { position: frames[frame][i].position.clone(), rotation: frames[frame][i].rotation };
      return landingPose(hull, frames, frame, i, plan, eased[i]);
    });
    // A die that has already landed must stay put while the other rolls out.
    if (weights[0] + weights[1] === 0) plans.forEach(({ end }, i) => { weights[i] = Number(end === frame); });
    separate(hull, poses, frames[frame], Math.max(...eased), weights);
    replay.push(poses);
  }
  return replay;
}
