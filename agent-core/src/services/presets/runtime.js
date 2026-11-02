import { createPresetRepository } from '../../db/presetRepository.js';
import { compilePreset, injectPreset, messageText } from './engine.js';

// 由创作提示词组装流程显式调用，底层请求客户端不调用此入口。
async function activePreset() {
  const { getDb } = await import('../../db/index.js');
  return createPresetRepository(getDb()).active();
}

async function requestContext(messages, opts) {
  const { getDb } = await import('../../db/index.js');
  const db = getDb();
  const { config } = await import('../../config.js');
  const metadata = opts.lorebook || {};
  const texts = messages.map(messageText);
  const character = db.prepare('SELECT name,display_name,base_prompt,short_prompt FROM characters').all().find(c => [c.base_prompt,c.short_prompt].some(p => p?.length >= 16 && texts.some(t => t.includes(p))));
  const history = metadata.history || messages.filter(m => m.role !== 'system');
  return {
    userName:config.user.nickname || '用户', personaDescription:config.user.persona || '',
    characterName:character?.display_name || character?.name || '角色', characterDescription:character?.base_prompt || '', characterPersonality:character?.short_prompt || '',
    ...metadata, ...(opts.presetContext || {}),
    lastUserMessage:opts.presetContext?.lastUserMessage ?? messageText(history.findLast(m => m.role === 'user')),
    lastCharMessage:opts.presetContext?.lastCharMessage ?? messageText(history.findLast(m => m.role === 'assistant')),
    lastMessage:opts.presetContext?.lastMessage ?? messageText(history.at(-1)),
  };
}

export function createPresetRuntime({ getActivePreset = activePreset, getContext = requestContext } = {}) {
  async function prepare(messages, opts = {}) {
    const preset = opts.preset === false ? null : await getActivePreset();
    let report = preset ? {
      ...compilePreset(preset.document, await getContext(messages, opts), preset.orderId),
      presetId:preset.id, name:preset.name, revision:preset.revision, presetActive: true,
    } : null;
    // 严格追加会话中切换/停用预设，以新的尾部 system 生效，不能删除旧请求里的规则。
    if (opts.presetPlacement === 'cache') {
      const stable = report?.stableContent || '';
      const changed = opts.frozenPrefix && typeof opts.frozenPresetContent === 'string' && stable !== opts.frozenPresetContent;
      const disabled = opts.frozenPrefix && opts.frozenPresetActive && !preset;
      const update = disabled ? '附加预设已停用；从本轮起不再沿用此前附加预设的要求，遵循基础规则与本轮要求。' : changed ? stable
        ? `附加预设固定规则已更新；从本轮起以以下内容为准：\n${stable}`
        : '附加预设固定规则已移除；从本轮起不再沿用此前附加预设的固定要求，遵循基础规则与本轮要求。' : '';
      if (report || update) {
        report ||= { content: '', stableContent: '', dynamicContent: '', entries: [], warnings: [], dynamic: false };
        report.staticUpdate = !!update;
        report.tailContent = [update, report.dynamicContent].filter(Boolean).join('\n\n');
      }
    }
    // 此闭包属于同一次业务生成，包括重试和记忆续接。
    // 后续的新生成请求会重新编译当时启用的预设。
    const apply = nextMessages => injectPreset(nextMessages, report, { placement: opts.presetPlacement, frozenPrefix: opts.frozenPrefix });
    if (report && opts.presetPlacement === 'cache') {
      for (const row of report.entries) if (row.reason === 'included') {
        row.actualAnchor = row.cacheTier === 'dynamic' || report.staticUpdate ? 'before-last-user' : opts.frozenPrefix ? 'frozen-session-prefix' : 'after-system0';
      }
      report.warnings = report.warnings.filter(w => !w.startsWith('预设含动态或未知宏'));
      if (report.dynamic) report.warnings.push('高缓存模式：首个动态或未知宏及后续条目放在末条 user 之前，固定前段保持稳定');
    }
    return { messages:apply(messages), report, apply };
  }
  return { prepare };
}
export const preparePreset = createPresetRuntime().prepare;
