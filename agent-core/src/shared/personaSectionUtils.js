export const PERSONA_HEADINGS = ['你的身份', '你的性格', '你的口吻', '你的语录', '你的好恶'];
export const QUOTE_ANCHOR = '这些是你说过的话的样本，用来锚定语气——任何情况下都不要逐字复读它们，要用同样的口吻说新话。';

// 部分早期卡片直接在标题同一行接英文外观。正文中的标题引用不算章节。
const APPEARANCE_HEADING_RE = /^[^\S\r\n]*(#{1,6})[^\S\r\n]*你的外观(?:[^\S\r\n]*[：:]|(?=[^\S\r\n]|\r?$))/m;

// 升级只替换首个外观标题之前的人设。保留分隔空行以及标题至文末的完整原文。
export function splitPersonaForUpgrade(text = '') {
  const card = String(text ?? '');
  const heading = APPEARANCE_HEADING_RE.exec(card);
  if (!heading) return { persona: card, suffix: '' };
  const prefix = card.slice(0, heading.index);
  const persona = prefix.trimEnd();
  const separator = prefix.slice(persona.length) || '\n\n';
  return { persona, suffix: separator + card.slice(heading.index) };
}

// 详情页只编辑外观正文。标题同一行也可能有内容，更深层的小标题属于正文。
export function splitPersonaForEditing(text) {
  const { persona, suffix } = splitPersonaForUpgrade(text);
  if (!suffix) return { persona: persona.trimEnd(), appearance: '', tail: '', suffix };
  const heading = APPEARANCE_HEADING_RE.exec(suffix);
  const body = suffix.slice(heading.index + heading[0].length);
  const next = new RegExp('\\r?\\n[^\\S\\r\\n]*#{1,' + heading[1].length + '}(?!#)[^\\S\\r\\n]*\\S').exec(body);
  const end = next?.index ?? body.length;
  return { persona, appearance: body.slice(0, end).trim(), tail: body.slice(end), suffix };
}

// 早期卡可能把自身的发型、衣着等写在身份介绍里。只搬运明确自述的原文片段，
// 不从角色语录、喜好或其他人物的描写推断外观。
export function readLegacyAppearance(persona) {
  const features = /^(?:你(?:的)?\s*)?(?:(?:拥有|有着|长着|留着|扎着|梳着|披着).*(?:长发|短发|卷发|马尾|发辫|刘海|眼睛|双眼|瞳孔|身材|肤色|翅膀|兽耳)|(?:身穿|身着|穿着|头戴|佩戴着)\S|(?:发色|瞳色|肤色|头发|眼睛|身材)(?:是|为|呈|偏))/;
  const excerpts = [];
  let inIdentity = true;
  for (const line of persona.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) {
      inIdentity = /^\s*#{1,6}\s*(?:你的身份|身份|角色介绍|简介|背景)\s*$/.test(line);
      continue;
    }
    if (!inIdentity) continue;
    for (const sentence of line.match(/[^。！？；;]+[。！？；;]?/g) || []) {
      if (!/^你/.test(sentence.trimStart()) || /[「“"『]/.test(sentence)) continue;
      for (const clause of sentence.split(/[，,]/)) {
        if (features.test(clause.trim())) excerpts.push(clause.trim());
      }
    }
  }
  return [...new Set(excerpts)].join('\n');
}

// 仅用于模型输出。模型意外夹写外观时，保留其后的有效人设章节。
export function stripGeneratedAppearance(text) {
  const lines = text.split(/\r?\n/);
  let inAppearance = false;
  return lines.filter(line => {
    if (APPEARANCE_HEADING_RE.test(line)) inAppearance = true;
    else if (line.startsWith('## ') && PERSONA_HEADINGS.includes(line.slice(3).trimEnd())) inAppearance = false;
    return !inAppearance;
  }).join('\n');
}

export function isNewPersonaFormat(text) {
  const { persona } = splitPersonaForUpgrade(text);
  const lines = new Set(persona.split(/\r?\n/).map(line => line.trim()));
  return PERSONA_HEADINGS.every(title => lines.has('## ' + title));
}

// 来源句通常紧跟姓名，也有老卡将其放在下一行。只读身份声明，避免把台词或经历中的作品当成来源。
export function extractPersonaIp(text) {
  const [first = '', second = ''] = String(text ?? '').trimStart().split(/\r?\n\s*/, 2);
  const source = /^(?:你是[^\r\n]*?[，,。；;]\s*)?(?:来自|出自)\s*(.+)/;
  const value = (source.exec(first) || /^(?:来自|出自)\s*(.+)/.exec(second))?.[1]?.trim();
  if (!value) return '';
  const quoted = /^(?:(?:游戏|动画|动漫|漫画|小说|电影|作品)\s*)?《([^》]+)》/.exec(value);
  const work = (quoted?.[1] ?? value.split(/[，,。；;！!？?]/, 1)[0]).trim();
  return /^(?:原创(?:角色|设定|作品|世界观)?|无(?:\s*IP)?)$/i.test(work) ? '' : work;
}
