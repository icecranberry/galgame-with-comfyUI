// 只管理本程序生成的节点；模板内手工挂载的 LoRA 保持原样。
export function markLoraWorkflow(wf, { globals, characters, scene, loraIds }) {
  const trigger = wf.nodes.find(n => n.title === 'lora触发词' && n.type === 'PrimitiveString');
  const unet = wf.nodes.find(n => n.type === 'UNETLoader');
  if (!trigger || !unet) return null;
  let id = Math.max(wf.last_node_id || 0, ...wf.nodes.map(n => n.id));
  let link = Math.max(wf.last_link_id || 0, ...wf.links.map(l => l[0]));
  const seen = new Set();
  const active = [...globals.map(l => ({ ...l, source: 'global' })), ...characters.map(l => ({ ...l, source: 'character' }))]
    .filter(l => { if (seen.has(l.path)) return false; seen.add(l.path); return true; });
  for (const [i, nodeId] of loraIds.entries()) {
    const node = wf.nodes.find(n => n.id === nodeId);
    const lora = active[i];
    node.title = `${lora.source === 'global' ? '全局' : '角色'} LoRA`;
    node.properties.linsheSource = lora.source;
  }
  const strings = ['global', 'character'].map(source => {
    const nodeId = ++id;
    const linkId = ++link;
    const node = {
      id: nodeId, type: 'PrimitiveString', title: `${source === 'global' ? '全局' : '角色'} LoRA 触发词`,
      pos: [(trigger.pos?.[0] || 0) - 520, (trigger.pos?.[1] || 0) + (source === 'global' ? 0 : 140)],
      size: [400, 90], mode: 0, flags: {}, order: trigger.order || 0,
      inputs: [{ name: 'value', type: 'STRING', widget: { name: 'value' }, link: null }],
      outputs: [{ name: 'STRING', type: 'STRING', links: [linkId] }],
      properties: { 'Node name for S&R': 'PrimitiveString', linsheSource: source },
      widgets_values: [active.filter(l => l.source === source).map(l => l.triggerWord || '').filter(Boolean).join(', ')],
    };
    wf.nodes.push(node);
    wf.links.push([linkId, nodeId, 0, trigger.id, source === 'global' ? 0 : 1, 'STRING']);
    return { nodeId, linkId };
  });
  trigger.type = 'StringConcatenate';
  trigger.title = 'LoRA 触发词合并';
  trigger.properties = { 'Node name for S&R': 'StringConcatenate' };
  trigger.inputs = [
    { name: 'string_a', type: 'STRING', widget: { name: 'string_a' }, link: strings[0].linkId },
    { name: 'string_b', type: 'STRING', widget: { name: 'string_b' }, link: strings[1].linkId },
    { name: 'delimiter', type: 'STRING', widget: { name: 'delimiter' }, link: null },
  ];
  trigger.widgets_values = ['', '', ', '];
  wf.last_node_id = id;
  wf.last_link_id = link;
  const terminal = loraIds.at(-1) ?? unet.id;
  const modelLinks = wf.links.filter(l => l[1] === terminal && l[2] === 0);
  const modelTargets = (loraIds.length ? modelLinks : modelLinks.slice(0, 1)).map(l => {
    const node = wf.nodes.find(n => n.id === l[3]);
    return [String(l[3]), node.inputs[l[4]].name];
  });
  const record = {
    version: 1, scene: scene || null, globals: structuredClone(globals), characters: structuredClone(characters),
    loraIds: loraIds.map(String), modelSource: [String(unet.id), 0],
    modelTargets,
    globalTriggerId: String(strings[0].nodeId), characterTriggerId: String(strings[1].nodeId),
  };
  wf.extra = { ...wf.extra, linsheGeneration: record };
  return record;
}

export function recomposeLoraWorkflow(prompt, record, globals) {
  if (record?.version !== 1) return { prompt: structuredClone(prompt), generation: record };
  const copy = structuredClone(prompt);
  if (!copy[record.globalTriggerId] || !copy[record.characterTriggerId] || !copy[record.modelSource?.[0]]) {
    throw new Error('图片的 LoRA 来源记录与工作流不一致');
  }
  // 原链从上游逐个旁路，保留所有下游与模板节点。
  for (const id of record.loraIds) {
    const node = copy[id];
    if (!node || !Array.isArray(node.inputs.model)) throw new Error('图片的 LoRA 链来源记录不完整');
    for (const target of Object.values(copy)) for (const [key, value] of Object.entries(target.inputs)) {
      if (Array.isArray(value) && String(value[0]) === id) target.inputs[key] = [...node.inputs.model];
    }
    delete copy[id];
  }
  const seen = new Set();
  const active = [...globals.map(l => ({ ...l, source: 'global' })), ...record.characters.map(l => ({ ...l, source: 'character' }))]
    .filter(l => { if (seen.has(l.path)) return false; seen.add(l.path); return true; });
  const targets = (record.modelTargets || []).map(([id, key]) => {
    const node = copy[id], value = node?.inputs[key];
    if (!Array.isArray(value) || String(value[0]) !== record.modelSource[0] || value[1] !== record.modelSource[1]) {
      throw new Error('图片的 LoRA 模型接入口已改变');
    }
    return [node, key];
  });
  if (active.length && !targets.length) throw new Error('图片工作流缺少 LoRA 模型接入口');
  let id = Math.max(0, ...Object.keys(copy).map(Number).filter(Number.isFinite));
  let source = record.modelSource;
  const loraIds = [];
  for (const lora of active) {
    const nodeId = String(++id);
    copy[nodeId] = { class_type: 'LoraLoaderModelOnly', inputs: { model: [...source], lora_name: lora.path, strength_model: lora.weight ?? 0.6 },
      _meta: { title: `${lora.source === 'global' ? '全局' : '角色'} LoRA` } };
    source = [nodeId, 0];
    loraIds.push(nodeId);
  }
  for (const [node, key] of targets) node.inputs[key] = [...source];
  for (const [source, nodeId] of [['global', record.globalTriggerId], ['character', record.characterTriggerId]]) {
    copy[nodeId].inputs.value = active.filter(l => l.source === source).map(l => l.triggerWord || '').filter(Boolean).join(', ');
  }
  return { prompt: copy, generation: { ...structuredClone(record), globals: structuredClone(globals), loraIds } };
}
