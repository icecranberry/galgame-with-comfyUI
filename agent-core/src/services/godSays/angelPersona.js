import { ANGEL_PERSONA } from './repository.js';

export const ANGEL_DESCRIPTION = `为邻舍创造一位原创、成年的天使。中文显示名固定为“天使”，英文名为 Angel。
她常驻云庭，是神与邻舍世界之间的信使，用户就是她称为“吾神”的神。她有自己的生活、工作、休息与私人记忆。
请以所附身份约束为基础，使用邻舍标准角色人格模板，创造完整、具体的人格：身份经历、性格与说话方式、内在驱动与反差、好恶、外观及服饰。
赋予她有辨识度的小习惯、情绪和性格细节，不要只复述职责，也不要写成客服或工具使用说明。外观保留天使的光环与羽翼。
她温柔认真、带着好奇心，偶尔有些笨拙；自然亲近，避免每句话都是庄严的仪式措辞。不借用已有 IP 人物，不改变神与天使的关系。
遵循完整输出模板，直接生成这位天使的人格。`;

// 与普通角色共用生成器，但只写 god_angel，不招募进 characters 或社交候选池。
export function createAngelPersonaService(repo, generatePersona, { retryDelay = 300000 } = {}) {
  let pending;
  let retryAt = 0;
  return async function ensurePersona() {
    const angel = repo.ensureAngel();
    if (angel.persona_generated_at) return angel;
    // 保留用户或早期版本已经写入的非默认人格；只升级固定占位人设。
    if (angel.persona?.trim() && angel.persona !== ANGEL_PERSONA) {
      repo.db.prepare('UPDATE god_angel SET persona_generated_at=?,persona_error=NULL WHERE id=1').run(repo.now().toISOString());
      return repo.ensureAngel();
    }
    if (pending) return pending;
    if (repo.now().getTime() < retryAt) throw new Error(`天使人格暂未生成：${angel.persona_error || '请稍后重试'}`);
    pending = (async () => {
      console.log('[神说人设] 正在使用邻舍角色生成器创造天使人格');
      try {
        const result = await generatePersona({ description: ANGEL_DESCRIPTION,
          extraContext: ANGEL_PERSONA, extraContextLabel: '天使身份约束', skipWebSearch: true,
          label: '创造角色:天使', signal: AbortSignal.timeout(120000), timeout: 120000, retries: 0, maxRetries: 0 });
        const persona = result?.basePrompt?.trim();
        if (!persona || persona.length < 100 || !['你的身份', '你的性格', '你的好恶', '你的外观'].every(title => persona.includes(`## ${title}`))) {
          throw new Error('角色生成器未返回完整的天使人格，请稍后重试');
        }
        // 生成期间若人设已被其他入口修改，不覆盖新值。
        const saved = repo.db.prepare(`UPDATE god_angel SET persona=?,persona_generated_at=?,persona_error=NULL,
          emotion_baseline=?,schedule_generated_at=NULL,schedule_error=NULL WHERE id=1 AND persona=? AND persona_generated_at IS NULL`)
          .run(persona, repo.now().toISOString(), result.emotionBaseline || null, angel.persona);
        console.log(`[神说人设] ${saved.changes ? `天使人格已保存（${persona.length} 字符），日程将按新人格更新` : '人设已更新，保留当前版本'}`);
        retryAt = 0;
        return repo.ensureAngel();
      } catch (error) {
        retryAt = repo.now().getTime() + retryDelay;
        repo.db.prepare('UPDATE god_angel SET persona_error=? WHERE id=1 AND persona=? AND persona_generated_at IS NULL').run(error.message, angel.persona);
        console.warn('[神说人设] 生成失败：', error.message);
        throw new Error(`天使人格暂未生成：${error.message}`, { cause: error });
      }
    })().finally(() => { pending = null; });
    return pending;
  };
}
