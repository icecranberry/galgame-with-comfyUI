// 迁移（一次性）: 记忆证据闸门 —— 为 memory_fragments 增加「逐字证据」三列。
//
// ── 这个迁移解决什么问题 ────────────────────────────────────────
// T1（千千结逆向移植，2026-10-07）：邻舍的记忆提取链路只要求模型写
// `reasoning:"只写支撑判断的对话依据"` —— 这是**自由文本**，写入前**不做任何复算**。
// 结果是"模型编造记忆"无法被拦截：它说"用户喜欢咖啡"，但对话里从没提过咖啡，也会照存。
//
// 千千结的做法是在写入前把每条证据的逐字引文拿回原文**数出现次数**（`occurrence`），
// 对不上就拒收 —— 这是唯一能根治幻觉的机制。
//
// 本迁移只**加列**（纯增量、不碰存量数据）：
//   · evidence_text      —— 逐字引文（LLM 必须从对话原文里摘，不是自己总结）
//   · evidence_count     —— 该引文在来源消息里出现的第几次（≥1）
//   · evidence_msg_id    —— 引文所属的 raw_messages.id（定位比对源）
//   · evidence_verified  —— 复算结果（1=通过 / 0=未通过 / NULL=闸门未开或未校验）
//
// ⚠ 三列全部**可空**：闸门默认关闭（`FEATURE_MEMORY_EVIDENCE_GATE`），
//   关闭时写入 NULL，行为与上线前逐字节一致（项目红线 4「默认不改行为」）。
//
// ⚠ 加列前查 PRAGMA 判断，天然幂等（老库升级到本机制时 schema_migrations 为空，
//   会全部重跑一次，见红线 13）。

export const id = '002_memory_evidence_gate';
export const description = '记忆证据闸门：memory_fragments 增加逐字引文/出现次数/来源消息/校验结果四列';

export function run(db) {
  try {
    const cols = new Set(db.prepare('PRAGMA table_info(memory_fragments)').all().map(c => c.name));
    // 表还不存在（初始化顺序异常）→ 下轮再跑，不要抛错阻断启动
    if (!cols.size) return;

    const add = (name, decl) => {
      if (cols.has(name)) return false;
      db.exec(`ALTER TABLE memory_fragments ADD COLUMN ${name} ${decl}`);
      return true;
    };

    // 逐字引文：LLM 必须原样摘录对话里的一句话，不许自己复述
    const a = add('evidence_text', 'TEXT');
    // 第几次出现：同一句在对话里出现多次时，用它定位是哪一处（1 起）
    const b = add('evidence_count', 'INTEGER');
    // 来源消息 id：指向 raw_messages.id，复算时拿它取原文
    const c = add('evidence_msg_id', 'INTEGER');
    // 校验结果：1 通过 / 0 未通过 / NULL 未校验（闸门关闭时的常态）
    const d = add('evidence_verified', 'INTEGER');

    const added = [a && 'evidence_text', b && 'evidence_count', c && 'evidence_msg_id', d && 'evidence_verified']
      .filter(Boolean);
    if (added.length) {
      console.log(`[migration] 记忆证据闸门：memory_fragments 新增 ${added.join(' / ')}`);
    }
  } catch (err) {
    // 吞错留痕交给 registry（记 schema_migrations_failed 并在下次启动重试）
    console.log('[migration] 记忆证据闸门加列跳过:', err.message);
  }
}