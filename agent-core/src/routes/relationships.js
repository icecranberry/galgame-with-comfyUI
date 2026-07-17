import { Router } from 'express';
import { getDb, getSystemRules, getWorldSetting } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';

const router = Router();

function extractShortPersonality(basePrompt) {
  if (!basePrompt) return '未知';
  const lines = basePrompt.split('\n').filter(l => l.trim());
  if (lines.length === 0) return '未知';

  let text = lines[0].trim();
  text = text.replace(/^你是/, '');
  text = text.replace(/[（(][^）)]*[）)]/g, '');
  text = text.trim();

  if (!text.includes('来自') && lines.length > 1) {
    const secondLine = lines[1].trim().replace(/[（(][^）)]*[）)]/g, '').trim();
    if (secondLine) text += text ? `，${secondLine}` : secondLine;
  }

  if (text.length > 20) text = text.slice(0, 20);
  return text || '未知';
}

// POST /api/relationships/deduce — AI 推演角色关系 / 用户→角色关系
router.post('/deduce', async (req, res) => {
  try {
    const db = getDb();
    const { characterId, mode = 'character', boost = false, excludeNames = [] } = req.body;

    const isUserMode = mode === 'user';

    let centerName, centerDisplay, centerPrompt;
    let fromName;

    if (isUserMode) {
      const nickname = config.user?.nickname || 'User';
      const persona = config.user?.persona || '';
      const appearance = config.user?.appearance || '';
      const gender = config.user?.gender || '';

      centerName = 'user';
      centerDisplay = nickname;
      fromName = 'user';

      const userParts = [`昵称: ${nickname}`];
      if (gender) userParts.push(`性别: ${gender}`);
      if (appearance) userParts.push(`外观: ${appearance}`);
      if (persona) userParts.push(`性格/人格: ${persona}`);
      centerPrompt = userParts.join('\n');
    } else {
      if (!characterId) return res.status(400).json({ error: 'characterId is required' });

      const centerChar = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
      if (!centerChar) return res.status(404).json({ error: 'Character not found' });

      centerName = centerChar.name;
      centerDisplay = centerChar.display_name;
      centerPrompt = centerChar.base_prompt;
      fromName = centerChar.name;
    }

    const allChars = db.prepare('SELECT * FROM characters').all();
    const excludeSet = new Set([
      ...(isUserMode ? [] : [centerName]),
      'default',
      ...excludeNames.map(n => String(n))
    ]);
    const candidates = allChars.filter(c => !excludeSet.has(c.name));
    if (candidates.length === 0) return res.json({ relationships: [] });

    const charLines = allChars
      .filter(c => !excludeSet.has(c.name))
      .map(c => `- 名称: ${c.name} | 显示名: ${c.display_name} | 简介: ${extractShortPersonality(c.base_prompt)}`)
      .join('\n');

    const jailbreak = getSystemRules({ roleplay: false });
    const worldSetting = boost ? getWorldSetting() : null;

    const messages = [];

    // msgs[0] — 破限词
    if (jailbreak) {
      messages.push({ role: 'system', content: jailbreak });
    }

    // msgs[1] — 世界观（仅 boost 且已设置世界观时注入）
    if (worldSetting) {
      messages.push({ role: 'system', content: worldSetting });
    }

    // msgs[2] — 世界观穿透指令（仅 boost 且已设置世界观时注入）
    if (worldSetting) {
      const worldIntegrationBlock = `<world_integration priority="highest">
上述世界观设定不是可有可无的背景说明——它是这个虚构世界的基本法则，定义了这个世界里什么是正常的、人与人之间如何互动、社会如何运转。以下所有推演必须在这个世界观的框架内展开：

1. 角色之间的关系必须反映世界观下的社会结构和互动规则。在这个世界里，何种关系是"理所当然"的、何种关系是"不可思议"的，由世界观决定，不由现实世界的常识决定。
2. 角色对另一个角色的态度（尊敬、敌意、亲近、漠然）应以世界观定义的行为基准线来推断。世界观塑造了角色的常识和三观——角色觉得谁值得尊敬、谁危险、谁亲密，都受世界观规则的支配。
3. 跨作品角色的关系建立要有内在逻辑。即使两个角色来自不同IP，你也要找到他们在当前世界观下可能的交集点——可能是身份共鸣、价值观冲突、利益关联、或命运相似性。发散的同时必须有说服力。
4. 不要把世界观当成一段可以忽略的"前置说明"。它必须穿透到每一条关系描述中。世界观不是背景，是地基。
</world_integration>`;
      messages.push({ role: 'system', content: worldIntegrationBlock });
    }

    const boostInstruction = boost
      ? `## 发散指令\n在严格遵守上述世界观设定的前提下，请以极度发散和创造性的方式推演。发散的是关系的故事性和戏剧性（怎么认识的、经历过什么、关系的张力在哪里），而不是偏离世界观的社会规则。构想跨次元、跨作品的角色连接，但每个连接都必须在这个世界里自洽。\n\n`
      : '';

    const worldRecontextLine = worldSetting
      ? `\n## 世界观融入流程（生成每条关系前必须完成以下思考，但不要在你的输出中展示步骤）\n步骤1：从世界观中提取关键要素——这个世界的独特地点、日常行为、社会制度是什么？随手记下 3~5 个词。\n步骤2：把${isUserMode ? '用户"' + centerDisplay + '"' : '目标角色"' + centerDisplay + '"'}放进去——${isUserMode ? 'ta' : '她'}在这个世界里每天最可能做什么事？和谁互动最多？\n步骤3：遍历候选角色——每一个候选角色在这个世界里最可能是什么身份？和${isUserMode ? '用户"' + centerDisplay + '"' : '"' + centerDisplay + '"'}最可能发生什么交集？\n步骤4：把步骤3的交集压缩成 15 字以内的名词或形容词+名词标签。\n\n警告：跳过步骤1-3、直接用角色在原IP中的身份信息拼凑关系标签，等于没有遵守世界观。\n`
      : '';

    const worldExamplesLine = worldSetting
      ? `\n  世界观适配示例（仅供参考，实际请用世界观语境替换）: 公共喷泉边的常客 / 数学课上的同桌 / 头发最漂亮的学姐`
      : '';

    const taskWorldPrefix = worldSetting ? '在上述世界观框架下，' : '';
    const targetType = isUserMode ? '用户信息' : '目标角色';

    const userPrompt = `${boostInstruction}## 任务\n你是同人小说作家。${taskWorldPrefix}根据${isUserMode ? '用户（User）的信息' : '目标角色和候选角色的信息'}，推演${isUserMode ? '用户对每个候选角色的关系' : '目标角色对每个候选角色的关系'}。${worldRecontextLine}\n## ${targetType}\n名称: ${isUserMode ? 'user' : centerName}\n显示名: ${centerDisplay}\n完整设定:\n${centerPrompt}\n\n## 候选角色\n${charLines}\n\n## 要求\n1. from_name 固定为 "${fromName}"，to_name 使用候选角色列表中的「名称」字段值\n2. 每条关系只涉及一个候选角色（${isUserMode ? '用户' : '目标角色'} → 候选角色）\n3. 生成 5~10 条，不足 5 条也可\n4. 关系描述像真人说话一样自然，最终拼接成「ta是你的XXX」句式。仅允许名词或形容词+名词结构，禁止动词、介词和动态描写。15 字以内。\n  好例子: 互相看不顺眼的同事 / 一直暗恋的学姐 / 从小一起长大的死党${worldExamplesLine}\n  坏例子: 时空编织的共鸣者（太像设定集词条）/ 值得尊敬的指挥官（纯社会标签，无世界感）\n\n## 输出格式\n严格输出以下 JSON，不要其他内容:\n{"relationships":[{"from_name":"${fromName}","to_name":"角色名称","relationship_text":"关系描述"}]}`;

    messages.push({ role: 'user', content: userPrompt });

    const raw = await chatSync(messages, {
      temperature: boost ? 1.1 : 0.8,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
      label: '关系推演' + (isUserMode ? '-user' : '') + (boost ? '-boost' : ''),
    });

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*"relationships"[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch { parsed = null; }
      }
    }

    if (!parsed || !Array.isArray(parsed.relationships)) {
      return res.status(500).json({ error: 'LLM 返回格式解析失败' });
    }

    const nameToChar = {};
    for (const c of allChars) nameToChar[c.name] = c;

    const relationships = [];
    for (const item of parsed.relationships) {
      if (!item.from_name || !item.to_name || !item.relationship_text) continue;
      if (item.from_name === item.to_name) continue;
      if (item.from_name !== fromName) continue;

      if (isUserMode) {
        const toChar = nameToChar[item.to_name];
        if (!toChar) continue;

        relationships.push({
          from_name: 'user',
          from_display: centerDisplay,
          to_id: toChar.id,
          to_name: toChar.name,
          to_display: toChar.display_name,
          relationship_text: item.relationship_text.slice(0, 20).trim(),
        });
      } else {
        const fromChar = nameToChar[item.from_name];
        const toChar = nameToChar[item.to_name];
        if (!fromChar || !toChar) continue;

        relationships.push({
          from_id: fromChar.id,
          from_name: fromChar.name,
          from_display: fromChar.display_name,
          to_id: toChar.id,
          to_name: toChar.name,
          to_display: toChar.display_name,
          relationship_text: item.relationship_text.slice(0, 20).trim(),
        });
      }
    }

    res.json({ relationships });
  } catch (err) {
    console.error('[关系推演]', err);
    res.status(500).json({ error: err.message || '推演失败' });
  }
});

// GET /api/relationships?character_id=xxx — 查询某角色发起的所有关系（含被关联角色的基本信息）
router.get('/', (req, res) => {
  const db = getDb();
  const { character_id } = req.query;
  if (!character_id) {
    return res.status(400).json({ error: 'character_id is required' });
  }

  const relationships = db.prepare(`
    SELECT
      cr.id,
      cr.from_character_id,
      cr.to_character_id,
      cr.relationship_text,
      cr.created_at,
      c.display_name AS to_display_name,
      c.avatar_path AS to_avatar_path
      
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.to_character_id
    WHERE cr.from_character_id = ? AND cr.relationship_text != ''
    ORDER BY cr.created_at ASC
  `).all(character_id);

  res.json({ relationships });
});

// POST /api/relationships — 创建关系
// Body: { from_character_id, to_character_id, relationship_text }
router.post('/', (req, res) => {
  const db = getDb();
  const { from_character_id, to_character_id, relationship_text } = req.body;

  if (!from_character_id || !to_character_id) {
    return res.status(400).json({ error: 'from_character_id and to_character_id are required' });
  }
  if (!relationship_text || !relationship_text.trim()) {
    return res.status(400).json({ error: 'relationship_text cannot be empty' });
  }

  // 验证两个角色都存在
  const fromChar = db.prepare('SELECT id FROM characters WHERE id = ?').get(from_character_id);
  const toChar = db.prepare('SELECT id FROM characters WHERE id = ?').get(to_character_id);
  if (!fromChar || !toChar) {
    return res.status(404).json({ error: 'Character not found' });
  }
  if (from_character_id === to_character_id) {
    return res.status(400).json({ error: 'Cannot create self-relationship' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO character_relationships (from_character_id, to_character_id, relationship_text)
      VALUES (?, ?, ?)
    `).run(from_character_id, to_character_id, relationship_text.trim());

    const created = db.prepare(`
      SELECT
        cr.*,
        c.display_name AS to_display_name,
        c.avatar_path AS to_avatar_path
        
      FROM character_relationships cr
      JOIN characters c ON c.id = cr.to_character_id
      WHERE cr.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ relationship: created });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Relationship already exists between these characters' });
    }
    throw err;
  }
});

// PUT /api/relationships/:id — 修改关系文本
// Body: { relationship_text }
router.put('/:id', (req, res) => {
  const db = getDb();
  const { relationship_text } = req.body;

  const rel = db.prepare('SELECT id FROM character_relationships WHERE id = ?').get(req.params.id);
  if (!rel) {
    return res.status(404).json({ error: 'Relationship not found' });
  }

  if (!relationship_text || !relationship_text.trim()) {
    return res.status(400).json({ error: 'relationship_text cannot be empty' });
  }

  db.prepare('UPDATE character_relationships SET relationship_text = ? WHERE id = ?')
    .run(relationship_text.trim(), req.params.id);

  const updated = db.prepare(`
    SELECT
      cr.*,
      c.display_name AS to_display_name,
      c.avatar_path AS to_avatar_path
      
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.to_character_id
    WHERE cr.id = ?
  `).get(req.params.id);

  res.json({ relationship: updated });
});

// DELETE /api/relationships/:id — 删除关系（断开连线）
router.delete('/:id', (req, res) => {
  const db = getDb();
  const rel = db.prepare('SELECT id FROM character_relationships WHERE id = ?').get(req.params.id);
  if (!rel) {
    return res.status(404).json({ error: 'Relationship not found' });
  }

  db.prepare('DELETE FROM character_relationships WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
