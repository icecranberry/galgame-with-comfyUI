const labels = { world_id: '世界观编号', outfit_id: '外观编号', set_id: '配置编号', group_id: '群聊编号', outlet_id: '媒体编号', name: '名称', display_name: '显示名称', base_prompt: '完整人设', description: '外观描述', content: '内容', relationship_text: '关系', topic: '话题', desc: '描述', prompt: '创作方向', tagline: '简介', enabled: '启用状态', emotion_baseline: '情绪基线', member_ids: '成员编号' }

export function godChangeFields(item) {
  if (item.preview?.length) return item.preview.map((field, index) => ({ ...field, key: `replacement-${index}` }))
  if (item.name === 'activate_world_setting') return [{ key: 'world', label: '将启用的世界观', after: item.before?.target?.name + '\n' + item.before?.target?.content }]
  // A concurrency snapshot may describe the parent character, not the record being created.
  // Only compare fields when the operation and snapshot refer to the same entity.
  const before = ['update_character', 'update_world_setting', 'update_relationship'].includes(item.name)
    ? item.before : item.name === 'update_group' ? item.before?.group : null
  return Object.entries(item.args || {}).filter(([key]) => labels[key]).map(([key, value]) => ({
    key,
    label: item.name === 'create_outfit' && key === 'name' ? '新增外观名称' : labels[key],
    before: before?.[key],
    after: typeof value === 'object' ? JSON.stringify(value) : typeof value === 'boolean' ? value ? '启用' : '停用' : value,
  }))
}
