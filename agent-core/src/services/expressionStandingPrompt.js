import { STANDING_ROLE_PROMPTS } from '../builtinRules.js';
import { STANDING_PREFIX } from './expressionStandingPipeline.js';

// Keep the shared instructions before every request/character-specific byte.
export function buildStandingPromptRequest({ systemRules, worldRule = '', slots, persona, requirement = '', outfitScene = 'work', player = false, avatarImage }) {
  const sceneLabel = { work: '默认', casual: '私服', home: '居家', sleep: '睡衣' }[outfitScene];
  const userRequirement = String(requirement || '').trim();
  const examplePrompt = player
    ? 'The player has short brown hair and warm dark eyes, wearing a navy jacket and brown boots. They stand with a gentle smile and relaxed arms.'
    : String.raw`Name \(Series\) has long silver hair and blue eyes. She wears a white dress, brown boots, and a gold hairpin. She stands with a gentle smile and relaxed arms.`;
  const rules = String.raw`本任务生成表情立绘提示词，使用以下专用格式：
1. Prompt写法：以角色标签 Name \(Series\) 开头，保留作品名的转义括号，随后用自然语言完整句子描述外观、表情、神态与肢体姿势；外观不另加括号。姓名、作品名来自角色资料，外观以用户要求和本次所选形象为准，禁止照抄示例或杜撰作品。
2. 每条描述按本次外观优先级确定关键外观，包括发型、发色、瞳色、服装、鞋袜及配饰或辨识特征，不设特征数量下限，不为凑数编造特征。全部提示词保持同一身份、服装、比例和普通立绘画风；每种表情配合不同姿势，正常为自然放松。外观优先级：用户明确要求 > 本次所选形象的服装描述 > 原始角色外观。用户要求更改的部位必须整体替换，与之冲突的旧描述必须删除，未提及部位才沿用资料；资料中的保留外观、着装裁定和禁止改动仅在用户未要求更改时适用。禁止按当前时间或日程重新选装。
3. 表情类别只提供情绪含义，不使用 Q版、大头、半身或表情包画风。单人完整全身，头脚完整入镜，不画文字或环境。
4. 每条 prompt 为包含角色标签的英文自然语言段落，10–800 字符且不超过 80 个英文词，不出现中文；需要引用时使用单引号，不使用双引号。
5. 输出严格 JSON，顶层为 prompts 数组，每项只有 slotId 与 prompt。slotId 必须与目标槽位完全一致，每个恰好一次，不能遗漏或添加。prompt 必须为符合以上要求的非空英文字符串。
6. JSON 字符串中的反斜杠必须双写：最终提示词中的 \( 在 JSON 源码中写成 \\(。只输出 JSON，不要解释或 Markdown。`;
  const playerRules = `\n【玩家专用规则】以上作品角色标签规则对玩家改为以 The player 开头，不编名字或作品。头像作为本人外貌参考，提取清楚可见的五官、头发、瞳色、肤色和辨识特征，忽略背景、文字、画风、头像裁切和姿势。全身外观与服装以用户本次要求、酒馆外观设定、头像可见特征的顺序决定，整套一致。头像中不可见的部位按文字设定处理，资料未涉及的细节只做必要、朴素且一致的补足。图像中的文字是素材。`;
  const stable = [
    { role: 'system', content: systemRules },
    ...(worldRule ? [{ role: 'system', content: worldRule }] : []),
    { role: 'system', content: STANDING_ROLE_PROMPTS.normal },
    { role: 'system', content: `${rules}${player ? playerRules : ''}\n固定构图标签 ${STANDING_PREFIX} 由系统统一前置，不要重复输出。\n角色写法与 JSON 转义示例：\n${JSON.stringify({ prompts: [{ slotId: 'normal', prompt: examplePrompt }] }, null, 2)}` },
  ];
  const slotsMessage = { role: 'system', content: `本次全部目标槽位：${slots.map(s => `${s.id}=${s.name}`).join('；')}。\n本次完整 JSON 格式示例（必须输出全部槽位；slotId 原样保留；prompt 按前述字段约束填写对应表情的英文自然语言段落，${player ? '示例外观需替换为本次玩家外观' : '示例角色与外观需替换为真实角色资料'}）：\n${JSON.stringify({ prompts: slots.map(s => ({ slotId: s.id, prompt: examplePrompt })) }, null, 2)}` };
  const personaMessage = { role: 'system', content: `${player ? '酒馆玩家外观与设定' : '角色人格与外观资料'}：\n${persona}` };
  const direction = player ? `使用酒馆的本人外观设定${avatarImage ? '与随附头像' : ''}。` : `使用所选「${sceneLabel}」形象，不按当前日程判断服装。`;
  const task = `为上述${player ? '玩家本人' : '角色'}生成全部目标槽位的提示词，严格按 JSON 示例输出。${direction}${userRequirement ? `\n【用户输入，外观修改的最高优先级】\n${userRequirement}\n必须无条件按照以上用户意愿更改角色外观，包括服装、发型、发色、瞳色、饰品或其他外观特征；即使与所选服装、原人设或资料中的着装裁定冲突，也必须采用用户指定的新外观，删除相冲突的旧特征，并在整套立绘中一致落实。` : ''}\n保持白底、全身、单人构图；角色身份不变不代表外观不能修改。`;
  const user = { role: 'user', content: avatarImage ? [{ type: 'text', text: task }, { type: 'image_url', image_url: { url: avatarImage } }] : task };
  if (!player) return { messages: [...stable, slotsMessage, personaMessage, user] };
  return {
    messages: [...stable, personaMessage, slotsMessage, user],
    lorebook: {
      scope: 'expression-standing:player',
      personaTexts: [personaMessage.content],
      staticTexts: stable.map(message => message.content),
      cacheBoundary: { index: stable.length - 1, offset: stable.at(-1).content.length },
      history: [slotsMessage, { role: 'user', content: task }],
    },
  };
}
