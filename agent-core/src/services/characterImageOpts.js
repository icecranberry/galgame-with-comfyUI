/**
 * 角色图像参数辅助
 *
 * 与 LoRA / 自定义工作流一致：由调用方从角色行解析出值，再传给 imageSkill，
 * imageSkill 本身不感知“角色”概念。
 */

/**
 * 角色单独画师串：
 * - 返回 null = 未单独设置（使用系统画师串）
 * - 返回 ''   = 已单独设置但留空（用空字符串覆盖系统画师串，不注入任何画师串）
 * - 返回文本   = 已单独设置
 * @param {object|null} char - characters 表行（至少含 artist_override 字段）
 * @returns {string|null}
 */
export function charArtistOverride(char) {
  if (!char) return null;
  const value = char.artist_override;
  return typeof value === 'string' ? value.trim() : null;
}

/**
 * 多人场景画师串：主角色优先，其次按顺序回退到第一个设置了单独画师串的其他角色。
 * 主角色“已设置但留空”('') 视为有效覆盖，不会回退。
 * @param {object|null} mainChar    - 主角色（发图者/事件主角）
 * @param {Array<object|null>} [otherChars] - 其他角色，按优先级排序
 * @returns {string|null}
 */
export function charArtistOverrideWithFallback(mainChar, otherChars = []) {
  const main = charArtistOverride(mainChar);
  if (main !== null) return main;
  for (const c of otherChars) {
    const value = charArtistOverride(c);
    if (value !== null) return value;
  }
  return null;
}

/**
 * 生图交叉参考信息（私聊 / 测试画风共用）：从 base_prompt 截取。
 * 身份行 = 首行截到首个含「来自」的分段（去「你是」前缀），
 * 外观   = 「## 你的外观」段到末尾（「你」→角色名替换）。
 * @param {object} char - characters 表行（至少含 base_prompt, display_name）
 * @returns {string}
 */
export function extractImageCrossRefInfo(char) {
  const base = char?.base_prompt || '';
  const parts = [];

  const nl = base.indexOf('\n');
  const firstLine = (nl >= 0 ? base.slice(0, nl) : base).trim();
  if (firstLine) {
    let cut = -1;
    let start = 0;
    for (let i = 0; i < firstLine.length; i++) {
      if (firstLine[i] === '，' || firstLine[i] === '。') {
        if (firstLine.slice(start, i).includes('来自')) { cut = i; break; }
        start = i + 1;
      }
    }
    const identity = (cut >= 0 ? firstLine.slice(0, cut) : firstLine).replace(/^你是/, '').replace(/。$/, '').trim();
    if (identity) parts.push(identity);
  }

  const m = base.match(/##\s*你的外观/);
  if (m) {
    parts.push(base.slice(m.index).replace(/你/g, char.display_name || ''));
  }
  return parts.join('\n');
}
