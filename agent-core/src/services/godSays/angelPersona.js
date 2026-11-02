import { ANGEL_PERSONA } from './repository.js';
import { normalizePersonalities } from './angelPersonalities.js';
import { parseAngelPersonaOutput } from './angelPersonaPrompt.js';

// 天使使用专用人格请求，只写 god_angel，不招募进 characters 或社交候选池。
export function createAngelPersonaService(repo, generatePersona, { retryDelay = 300000 } = {}) {
  let pending;
  let retryAt = 0;
  return async function ensurePersona(options = {}) {
    const { force = false, personalities, custom = '' } = options;
    const angel = repo.ensureAngel();
    if (!force) {
      if (angel.persona_generated_at) return angel;
      // 保留用户或早期版本已经写入的非默认人格；只升级固定占位人设。
      if (angel.persona?.trim() && angel.persona !== ANGEL_PERSONA) {
        repo.db.prepare('UPDATE god_angel SET persona_generated_at=?,persona_error=NULL WHERE id=1').run(repo.now().toISOString());
        return repo.ensureAngel();
      }
      // 尚未召唤：等用户在召唤引导里选好性格，不自动生成默认人格。
      if (!angel.summoned) return angel;
    }
    if (pending) return pending;
    if (!force && repo.now().getTime() < retryAt) throw new Error(`天使人格暂未生成：${angel.persona_error || '请稍后重试'}`);
    const keys = normalizePersonalities(personalities ?? angel.personalities);
    const snapshotPersona = angel.persona;
    const snapshotGeneratedAt = angel.persona_generated_at ?? null;
    pending = (async () => {
      console.log('[神说人设] 正在创造天使人格');
      try {
        const customText = typeof custom === 'string' ? custom.trim().slice(0, 800) : '';
        const result = await generatePersona({ personalities: keys, custom: customText,
          label: '创造角色:天使', signal: AbortSignal.timeout(120000), timeout: 120000, retries: 0, maxRetries: 0 });
        const { basePrompt: persona } = parseAngelPersonaOutput(result?.basePrompt);
        // 生成期间若人设已被其他入口修改，不覆盖新值（用生成前的快照做条件）。
        const saved = repo.db.prepare(`UPDATE god_angel SET persona=?,persona_generated_at=?,persona_error=NULL,
          emotion_baseline=NULL,schedule_generated_at=NULL,schedule_error=NULL,personalities_json=?,
          summoned_at=COALESCE(summoned_at,?) WHERE id=1 AND persona=? AND persona_generated_at IS ?`)
          .run(persona, repo.now().toISOString(), JSON.stringify(keys),
            repo.now().toISOString(), snapshotPersona, snapshotGeneratedAt);
        console.log(`[神说人设] ${saved.changes ? `天使人格已保存（${persona.length} 字符），日程将按新人格更新` : '人设已更新，保留当前版本'}`);
        retryAt = 0;
        return repo.ensureAngel();
      } catch (error) {
        retryAt = repo.now().getTime() + retryDelay;
        repo.db.prepare('UPDATE god_angel SET persona_error=? WHERE id=1 AND persona=? AND persona_generated_at IS ?').run(error.message, snapshotPersona, snapshotGeneratedAt);
        console.warn('[神说人设] 生成失败：', error.message);
        throw new Error(`天使人格暂未生成：${error.message}`, { cause: error });
      }
    })().finally(() => { pending = null; });
    return pending;
  };
}
