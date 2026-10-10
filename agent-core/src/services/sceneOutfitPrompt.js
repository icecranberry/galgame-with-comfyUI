/** 场景换装的静态规范、消息分层和输出校验；默认外观只读。 */
export const GENERATED_OUTFIT_SCENES = ['casual', 'home', 'sleep'];

const DESIGN_RULES = `你是角色服装设计助手。角色已经拥有默认外观，本任务只设计私服、居家、睡衣，不生成、重写或替换默认外观（work）。

【设计范围】
- casual（私服）：休息日上街、见朋友、逛街的便装，在外一般会正常穿鞋。
- home（居家）：居家休息、做家务、看书时的宽松舒适衣物，居家一般会穿拖鞋。
- sleep（睡衣）：**睡觉时穿的睡衣或内衣**（睡裙 / 睡衣睡裤 / 吊带内衣 + 短裤 / 内裤等）。这一套是最贴身的，不要设计成能穿出门的服装。睡衣里不要出现任何鞋类物体 —— 鞋、靴、拖鞋、袜、丝袜、短袜一律不写（shoes / boots / slippers / heels / sandals / socks / stockings / pantyhose / tights），
- 只改变衣物、鞋袜及服装配饰。每套 description 都是完整外观：发色、发型、瞳色、五官、肤色、体型、身高等身体特征照默认外观保留并写入，不重新设计、不遗漏、不臆造。角色固有身体结构与标志性身体特征不能被当成服饰移除。生成完整的换装外观不等于修改默认外观，默认外观本身保持原样。
- 根据人设与世界观选择符合其文化、技术和身份的服装；延续默认外观的配色偏好、材质和审美，但三套之间以及与默认衣服之间要明显不同，不能照搬默认服装或将其叠穿在新服装上。

【描述规则：沿用修正外观格式】
- description 以「角色名 (作品名)」开头，紧接着以 has ... / wearing ... 续写外观描述，一整段连贯英文。
- 开头固定为「角色名 (作品名)」格式（半角括号）：角色名用英文名，作品名用作品的官方英文名，从本次给定的人设与默认外观中提取、转换，如 宵宫（Yoimiya），来自《原神》→ Yoimiya (Genshin Impact)。不得照抄示例角色的身份。
- 角色名之后直接以 has ... / wearing ... 续写，不要主语代词（she/he/they），不要再出现中文、「来自」或书名号。
- 先写脸与发型（发型、发色、瞳色、五官特征、可选的体型），再写服装与饰品。身体特征以默认外观为准，服装与饰品按本次场景设计；只替换穿着，不改变同一个人的身体特征。
- 只描述静态外观：不要表情、动作、姿势、场景、背景、画质与镜头描述。
- 一段连贯英文，不要换行、不要中文、不要 Markdown、列表、额外引号或任何解释，不附加英文标签串。这里的描述作为 JSON 字符串返回，JSON 必需的双引号必须保留。

【JSON 字段要求】
- outfits：数组，只包含本次指定的场景，每个场景恰好一项；禁止包含 work 或其他字段。
- scene：只能是 casual、home、sleep 中本次要求的 key，不翻译、不修改。
- name：不超过 10 个中文字的具体服装名称，不含角色名。
- description：遵守上述完整外观格式及场景要求的一段英文字符串，不换行；身体特征沿用默认外观，仅衣着不同。
以下是完整格式示例。示例展示每个字段的值与写法，不是本次角色必须照搬的款式；只返回本次要求的场景：
{"outfits":[{"scene":"casual","name":"蓝白休闲裙","description":"Cyrene (Honkai: Star Rail) has soft pastel pink hair in a fluffy shoulder-length bob with small white horn-like accessories, bright blue eyes, wearing a pale blue cotton dress with a softly fitted waist and a gently flared skirt, narrow ivory piping around the square neckline, a lightweight cream cardigan, simple brown leather flats, and a small silver pendant on a fine chain."},{"scene":"home","name":"米白针织套装","description":"Cyrene (Honkai: Star Rail) has soft pastel pink hair in a fluffy shoulder-length bob with small white horn-like accessories, bright blue eyes, wearing a loose ivory knit top with a softly rounded neckline, dropped shoulders and long sleeves gathered into broad ribbed cuffs, relaxed taupe cotton trousers with wide straight legs, and a narrow embroidered border along the neckline."},{"scene":"sleep","name":"浅蓝棉质睡裙","description":"Cyrene (Honkai: Star Rail) has soft pastel pink hair in a fluffy shoulder-length bob with small white horn-like accessories, bright blue eyes, wearing a soft pale blue cotton nightdress with narrow shoulder straps, a gently gathered neckline edged with delicate white embroidery, small fabric-covered buttons down the upper front, and a loosely stitched hem below the knees, remaining barefoot."}]}
严格按示例结构输出合法 JSON，不要解释、Markdown 代码围栏或 JSON 以外的文字。`;

export function normalizeDesignScenes(scenes = GENERATED_OUTFIT_SCENES) {
  if (!Array.isArray(scenes) || !scenes.length || scenes.some(scene => !GENERATED_OUTFIT_SCENES.includes(scene))) {
    throw new Error('只支持设计私服、居家、睡衣，默认外观不可重新生成');
  }
  return [...new Set(scenes)];
}

export function buildSceneOutfitMessages({ systemRules, worldRule, persona, shortPrompt, displayName, baseAppearance, scenes }) {
  if (!baseAppearance?.trim()) throw new Error('缺少默认外观，无法设计其他服装');
  const targets = normalizeDesignScenes(scenes);
  const summary = String(shortPrompt || '').trim();
  return [
    { role: 'system', content: systemRules },
    ...(worldRule ? [{ role: 'system', content: worldRule }] : []),
    { role: 'system', content: DESIGN_RULES },
    { role: 'system', content: `【本次角色人设】\n角色名：${displayName}\n${persona}`
      + (summary ? `\n\n【角色简述（short_prompt）】\n${summary}` : '') },
    { role: 'system', content: `【默认外观：只读设计基准】\n${baseAppearance}` },
    { role: 'user', content: `请设计 ${targets.join('、')}，严格按规定 JSON 输出，仅包含这些场景。` },
  ];
}

export function parseSceneOutfitDesign(raw, scenes) {
  const targets = normalizeDesignScenes(scenes);
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.outfits)) throw new Error('服装设计缺少 outfits 数组');
  // 只选择目标场景：即使模型多给 work，也绝不传给保存或出图流程。
  return targets.map(scene => {
    const matches = parsed.outfits.filter(outfit => outfit?.scene === scene);
    const outfit = matches[0];
    if (matches.length !== 1 || typeof outfit?.name !== 'string' || !outfit.name.trim()
      || typeof outfit.description !== 'string' || !outfit.description.trim()) {
      throw new Error(`服装设计不完整或重复：${scene}，请重试`);
    }
    const description = outfit.description.trim().replace(/\s+/g, ' ');
    if (description.length > 2400) throw new Error(`服装描述过长：${scene}，请重试`);
    return { scene, name: [...outfit.name.trim()].slice(0, 10).join(''), description };
  });
}
