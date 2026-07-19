import { getDb } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';

const DEFAULT_FONT_ID = 'ma_shan_zheng';

const FONT_CATALOG = [
  { id: 'ma_shan_zheng',   name: '马山正体',     desc: '粗犷有力，自然随意 → 豪爽直率,不拘小节' },
  { id: 'zcool_kuaile',    name: '站酷快乐体',   desc: '圆润可爱，俏皮活泼 → 天真烂漫,俏皮可爱' },
  { id: 'liu_jian_mao_cao',name: '刘建毛草',     desc: '狂放草书，奔放不羁 → 热血激情,勇敢无畏' },
  { id: 'long_cang',       name: '龙藏体',       desc: '工整清秀，端庄温婉 → 优雅内敛,淡雅从容' },
  { id: 'zhi_mang_xing',   name: '志莽行书',     desc: '行书飘逸，沉稳大气 → 成熟稳重,从容不迫' },
  { id: 'zcool_xiaowei',   name: '站酷小薇体',   desc: '纤细文艺，书卷气 → 知性文学,文艺细腻' },
  { id: 'zcool_qingke',    name: '站酷庆科黄油体',desc: '艺术涂鸦，创意十足 → 古灵精怪,不按常理' },
  { id: 'lxgw_wenkai',     name: '霞鹜文楷',     desc: '温润文雅的楷体手书，书卷气浓 → 温文尔雅,学识渊博' },
  { id: 'lxgw_wenkai_light',name: '霞鹜文楷细体', desc: '清瘦纤细的楷体，如青丝拂面 → 纤细敏感,柔中带刚' },
  { id: 'lxgw_marker',     name: '霞鹜马克体',   desc: '马克笔手写风格，随意洒脱 → 随性洒脱,不拘一格' },
  { id: 'dyh',             name: '得意黑',       desc: '圆润可爱，现代俏皮，略带倾斜 → 活泼开朗,现代俏皮' },
  { id: 'cef',             name: '仓耳今楷',     desc: '端正清雅的楷体，字形舒展大方 → 端庄大方,温润如玉' },
  { id: 'cubic',           name: 'Cubic体',     desc: '像素点阵风格，复古游戏感 → 古灵精怪,电波系' },
  { id: 'yozai',           name: '悠哉体',       desc: '轻松随性的手写字，笔画舒展自由 → 悠哉游哉,乐天知命' },
  { id: 'xiaolai',         name: '小赖体',       desc: '稚拙可爱的手写字，像小朋友的字迹 → 天真可爱,童心未泯' },
  { id: 'moon_stars_kai',  name: '月星楷',       desc: '星空梦幻的楷体，笔画带有柔光 → 温柔梦幻,感性浪漫' },
  { id: 'chill_round',     name: '寒蝉全圆体',   desc: '浑圆饱满，温和可爱 → 憨厚直率,温和包容' },
  { id: 'yryxk',           name: '演示悠然小楷', desc: '悠然自在的小楷手写，笔画精致 → 宁静淡泊,悠然自得' },
  { id: 'lxgw_bright',    name: '霞鹜文楷Bright',desc: '明亮轻快的楷体，字形舒展通透 → 阳光开朗,明朗豁达' },
  { id: 'tiejili',        name: '铁蒺藜体',     desc: '棱角分明，刚硬有力，如铁蒺藜般锋利 → 刚毅坚强,锋芒毕露' },
  { id: 'maoken',         name: '猫啃什锦黑',   desc: '手绘涂鸦风格，自由奔放，如同随手画就 → 放任不羁,创意随性' },
  { id: 'zhuque_fangsong',name: '朱雀仿宋',     desc: '仿宋体韵味的优雅书体，古典与现代交融 → 古典雅致,端庄秀丽' },
  { id: 'honglei_xs',     name: '鸿雷行书',     desc: '行书手写体，笔势流畅，一气呵成 → 潇洒自如,气势磅礴' },
];

const APPEARANCE_MARKERS = ['## 你的外观', '## 外观', '你的外表', '你的长相', '你的穿着', '你的服饰', '你的发型', '你的身高', '你的体型'];

export function getFontCatalog() {
  return FONT_CATALOG;
}

export function getDefaultFontId() {
  return DEFAULT_FONT_ID;
}

/**
 * 截取人格提示词到外观段之前
 */
function truncateBeforeAppearance(prompt) {
  if (!prompt) return '';
  let earliest = -1;
  for (const marker of APPEARANCE_MARKERS) {
    const idx = prompt.indexOf(marker);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx;
    }
  }
  if (earliest !== -1) return prompt.slice(0, earliest).trim();
  return prompt.trim();
}

/**
 * 调用 LLM 根据角色人格选择手写字体
 * @param {string} basePrompt - 角色完整人格提示词
 * @returns {Promise<string>} 字体 ID
 */
async function selectFontForCharacter(basePrompt) {
  const personalityTruncated = truncateBeforeAppearance(basePrompt);
  if (!personalityTruncated || personalityTruncated.length < 20) return DEFAULT_FONT_ID;

  const fontOptions = FONT_CATALOG.map(f => `- ${f.id}: ${f.desc}`).join('\n');

  const msgs = [
    {
      role: 'system',
      content: `根据角色人格描述，从以下手写字体中选出最匹配的一款，只返回JSON：{"font_id":"xxx"}\n\n字体选项：\n${fontOptions}`,
    },
    {
      role: 'user',
      content: `角色人格：\n${personalityTruncated.slice(0, 2000)}`,
    },
  ];

  try {
    const raw = await chatSync(msgs, {
      temperature: 0.5,
      max_tokens: 100,
      response_format: { type: 'json_object' },
      label: '手写字体选择',
      retries: 1,
    });

    const parsed = JSON.parse(raw.trim());
    const fontId = parsed?.font_id;
    if (fontId && FONT_CATALOG.some(f => f.id === fontId)) {
      console.log(`[handwritingFont] selected "${fontId}" for character`);
      return fontId;
    }
    console.log(`[handwritingFont] unknown font_id "${fontId}", fallback to default`);
    return DEFAULT_FONT_ID;
  } catch (err) {
    console.warn('[handwritingFont] LLM selection failed:', err.message);
    return DEFAULT_FONT_ID;
  }
}

/**
 * 确保指定角色已分配手写字体（向后兼容）
 * @param {number} characterId
 * @returns {Promise<string>} 字体 ID
 */
export async function ensureFontForCharacter(characterId) {
  const db = getDb();
  const char = db.prepare('SELECT id, base_prompt, handwriting_font FROM characters WHERE id = ?').get(characterId);
  if (!char) return DEFAULT_FONT_ID;
  if (char.handwriting_font) return char.handwriting_font;

  console.log(`[handwritingFont] character #${characterId} has no font, selecting...`);
  const fontId = await selectFontForCharacter(char.base_prompt);
  db.prepare('UPDATE characters SET handwriting_font = ? WHERE id = ?').run(fontId, characterId);
  return fontId;
}

/**
 * 为新创建的角色选择并写入字体
 * @param {number} characterId
 * @param {string} basePrompt
 * @returns {Promise<void>}
 */
export async function assignFontForNewCharacter(characterId, basePrompt) {
  const fontId = await selectFontForCharacter(basePrompt);
  try {
    getDb().prepare('UPDATE characters SET handwriting_font = ? WHERE id = ?').run(fontId, characterId);
    console.log(`[handwritingFont] assigned "${fontId}" to new character #${characterId}`);
  } catch (err) {
    console.warn(`[handwritingFont] failed to persist font for #${characterId}:`, err.message);
  }
}
