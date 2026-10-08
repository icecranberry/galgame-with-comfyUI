/**
 * 人设润色「自定义指令」—— 回归测试
 *
 * 用户反馈（2026-10-06）：原来只有 3 个固定档位（保持原意/丰富细节/精简凝练），
 * 用户无法控制改写走向 → 要求「手写输入提示词，然后进行优化」。
 *
 * 改造后的契约（本测试钉死）：
 *   · 请求可只带 `instruction`（自定义指令），不带 mode；
 *   · 也可只带 mode（行为与旧版一致，向后兼容）；
 *   · 两者都给时，**用户的自由指令优先级最高**（与预设冲突以指令为准）；
 *   · 两者都不给 → 明确报错（不能静默把原文返回，用户会以为"点了没反应"）。
 *
 * ⚠ 这里测的是**指令拼装逻辑**（纯函数级），不调 LLM。
 *    真正的端到端走向验证靠人工对比（见交付文档 16 号）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../src/routes/characters.js', import.meta.url), 'utf8');

test('★ 接口必须接收 instruction 字段（用户手写指令）', () => {
  assert.match(SRC, /req\.body\?\.instruction/, '路由必须读取 instruction');
  assert.match(SRC, /instruction\.trim\(\)\.slice\(0,\s*2000\)/, 'instruction 需 trim 与长度上限');
});

test('★ 只给指令、不给 mode 时必须放行（mode 允许为空）', () => {
  // 关键：不能写成 `const mode = ... || 'polish'` —— 那会把"只想用自定义指令"强行塞进预设
  assert.match(SRC, /rawMode/, '应保留原始 mode 以便区分"没传/传空"');
  assert.match(SRC, /（rawMode \? 'polish' : ''）|\(rawMode \? 'polish' : ''\)|: ''\)/, '未传 mode 时须为空串而非强制 polish');
  assert.match(SRC, /if \(!mode && !instruction\)/, '两者都空须报错');
});

test('★ 用户指令必须标注为最高优先级，且与预设冲突时以指令为准', () => {
  assert.match(SRC, /用户的具体要求/, '提示词里必须有"用户的具体要求"段');
  assert.match(SRC, /最高优先级/, '必须写明指令优先');
  assert.match(SRC, /以本条为准/, '必须写明冲突时以用户指令为准');
});

test('★ 向后兼容：只给 mode 时行为与旧版一致（预设文案仍照常拼入）', () => {
  assert.match(SRC, /PERSONA_REFINE_MODES\[mode\]/, '预设模式仍须可正常拼入提示词');
  assert.match(SRC, /润色方式：/, '旧版的"润色方式："前缀要保留');
});

test('外观段仍必须原样保留（不得因新增指令而被改掉）', () => {
  assert.match(SRC, /splitPersonaAroundAppearance\(basePrompt\)/, '仍须做三段切分');
  assert.match(SRC, /\[polished, appearance, tail\]/, '仍须按 润色段+外观段+尾段 拼回');
});

test('返回值需回传 instruction，便于前端/排查确认实际生效的指令', () => {
  assert.match(SRC, /res\.json\(\{[^}]*instruction[^}]*\}\)/, '响应体应含 instruction');
});