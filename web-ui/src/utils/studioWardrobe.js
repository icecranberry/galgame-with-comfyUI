export const STUDIO_OUTFIT_LABELS = Object.freeze({ work: '默认服装', casual: '私服', home: '居家', sleep: '睡衣' })

export function studioOutfitOptions(outfits = []) {
  return Object.entries(STUDIO_OUTFIT_LABELS).flatMap(([value, label]) => {
    if (value === 'work') return [{ value, label }]
    const outfit = outfits.find(row => row.scene === value && row.description?.trim())
    return outfit ? [{ value, label, name: outfit.name?.trim() || '' }] : []
  })
}
