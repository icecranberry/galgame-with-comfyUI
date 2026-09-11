/**
 * 小镇素材占格（footprint）的统一档位：向导清单步与素材库「描述新素材」共用。
 * value 是 "WxH" 字符串，落库时解析成 { w, h } 写进 meta.footprint。
 */
export const TOWN_FOOTPRINT_OPTIONS = [
  { label: '1×1', value: '1x1' },
  { label: '2×1', value: '2x1' },
  { label: '1×2', value: '1x2' },
  { label: '2×2', value: '2x2' },
  { label: '3×3', value: '3x3' },
]

/** footprint 对象 → 下拉 value */
export function townFootprintKey(footprint) {
  return `${footprint?.w || 1}x${footprint?.h || 1}`
}

/** 下拉 value → footprint 对象（钳制在 1~3 格） */
export function parseTownFootprint(value) {
  const [w, h] = String(value || '1x1').split('x').map(v => Math.max(1, Math.min(3, parseInt(v, 10) || 1)))
  return { w, h }
}
