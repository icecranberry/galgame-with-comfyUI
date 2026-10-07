// Relative angles wrap at ±180; screen rotation keeps movement screen-aligned.
export function gravityOffset(sample, baseline, angle = 0) {
  const delta = (a, b) => ((a - b + 540) % 360) - 180
  const x = delta(sample.gamma, baseline.gamma)
  const y = delta(sample.beta, baseline.beta)
  const radians = angle * Math.PI / 180
  const normalize = value => Math.sign(value) * Math.min(1, Math.max(0, Math.abs(value) - 0.5) / 14.5)
  return {
    x: -12 * normalize(x * Math.cos(radians) + y * Math.sin(radians)),
    y: -6 * normalize(y * Math.cos(radians) - x * Math.sin(radians)),
  }
}
