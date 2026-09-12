import { buildWhiteGapStrengthMap } from './whiteGapDetection.js'

self.onmessage = ({ data }) => {
  try {
    const result = buildWhiteGapStrengthMap(new Uint8ClampedArray(data.pixels), data.width, data.height)
    self.postMessage(result, [result.thresholds.buffer, result.pixelCounts.buffer, result.regionCounts.buffer])
  } catch (error) {
    self.postMessage({ error: error.message || '留白查找失败，请重试' })
  }
}
