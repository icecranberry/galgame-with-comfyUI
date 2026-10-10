/** 后台串行设计/保存/生图；复用系统任务浮窗，单角色同一时间只跑一批。 */
export function createSceneOutfitBatchRunner() {
  const active = new Map();
  return function start({ character, scenes, design, save, render, startTask }) {
    if (active.has(character.id)) return active.get(character.id);
    const task = startTask({ action: 'scene_outfits', meta: {
      characterId: character.id, characterName: character.display_name, scenes,
    } });
    active.set(character.id, task);
    Promise.resolve().then(async () => {
      task.onProgress({ progress: 0, stage: '正在设计服装', phase: 'design' });
      const designed = await design();
      const outfits = scenes.map(scene => designed.find(o => o.scene === scene));
      if (outfits.some(o => !o?.description?.trim() || !o?.name?.trim())) throw new Error('服装设计不完整，未保存或开始出图');
      await save(outfits);
      const completed = [], failures = [];
      for (const [index, outfit] of outfits.entries()) {
        const label = { casual: '私服', home: '居家', sleep: '睡衣' }[outfit.scene] || outfit.scene;
        task.onProgress({ progress: (index + 1) / (outfits.length + 1), stage: `正在生成${label}形象（${index + 1}/${outfits.length}）`, phase: 'render' });
        try { completed.push({ scene: outfit.scene, image_url: await render(outfit.scene) }); }
        catch (error) { failures.push(`${label}：${error.message || error}`); }
      }
      if (failures.length) throw new Error(`服装已保存，形象完成 ${completed.length}/${outfits.length}；${failures.join('；')}。可在角色形象中单独重试失败的服装。`);
      task.succeed({ outfits, completed, summary: `${outfits.length} 套服装与形象已保存` });
    }).catch(error => task.fail(error)).finally(() => active.delete(character.id));
    return task;
  };
}
export const startSceneOutfitBatch = createSceneOutfitBatchRunner();
