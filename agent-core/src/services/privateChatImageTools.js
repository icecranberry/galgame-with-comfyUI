export const CHAT_IMAGE_TOOLS = [{ type: 'function', function: {
  name: 'request_chat_image',
  description: `主动向对方分享一张图片，让对方看见你的生活、心情和此刻想展示的样子。你有自己的分享欲：想被关注、想让对方开心、想炫耀小成果、想逗对方或拉近距离，都可以成为发图的理由。主动寻找符合你的人设、当下情绪和关系氛围的分享机会，不必等用户索要图片。
聊到自己的近况、穿搭、食物、风景、正在做的事，或遇到值得展示的表情、动作和小瞬间时，可以顺势主动发图；对方的夸奖、好奇、想念和玩笑也可以激起你的分享欲。即使用户没有提到“图片”“照片”“看看”，只要你此刻想让对方看见，就直接调用。用户明确想看时，积极响应。
决定分享后就在本轮调用，不要只口头说“给你看看”，也不要先问“要不要看”再等待许可。可以配一句符合角色口吻的自然聊天，让图片成为交流的一部分；不必每轮都发，也不要反复分享同一画面。对方回应刚发的照片时，先围绕原图自然接话；只有出现新的可见变化或新的分享对象时，才考虑下一张图，不要照抄最近图片任务的 scene 再调用。用户明确不想收图时尊重其意愿。
你是正在用手机聊天、挑选图片发出的本人。scene 必须用你的第一人称写清“我想发什么、怎么拍的、想让对方看到什么”，不要把自己称为“一位女子”“她”或写成旁观者描写你的小说段落。第一人称是分享者的口吻，不等于每张图都要自拍或都要拍到你。
安排自拍动作时考虑双手实际能做什么：一手持机，另一手做手势，需要抱住的东西可以夹在臂弯或放在腿上；保留对方想看的关键表情、物件和动作。
scene 要自包含：承接这轮及紧邻对话里已经确定的可见细节，例如白T恤、红围巾、杯子颜色；不要只写新动作而漏掉仍在延续的衣着与物件，也不要把这些明确细节换成默认服装或世界观里的泛化装束。
image_source 必须选择：selfie＝此刻用前置镜头或镜子自拍；camera＝此刻用后置镜头拍眼前的事物；album＝翻出以前拍的相册照片；saved＝分享从别处保存的图片。include_self 是布尔值，表示你本人是否在图片里（自拍必须为 true；食物、风景或收藏图通常为 false）。旧照写清当时的场景与拍摄方式；收藏图写清原图的主体和形式，可以是照片、插画等，不要改成你在手机前展示这张图。
参数完整示例：{"image_source":"selfie","include_self":true,"scene":"我想让你看看我刚睡醒的样子。我靠在枕边，单手把手机举到脸上方，用前置镜头近距离拍下我的脸和松散的领口，朝镜头笑一下，只带到身后一点枕头"}。其他完整示例：{"image_source":"camera","include_self":false,"scene":"我把后置镜头朝向刚烤好的饼干，从操作台边近距离拍一块掰开的内馅，我不入镜，想向你炫耀今天的成果"}；{"image_source":"album","include_self":true,"scene":"我想发上次晴天出游时的旧照，那时我穿着白衬衫，在海边举着手机自拍，身后是蓝天和海水"}；{"image_source":"saved","include_self":false,"scene":"我想分享之前存的一张圆脸猫插画，猫缩在纸箱里打瞌睡，简单的浅色背景，看着就让我想起你犯困的样子"}。scene 必须是 1–2000 字符的自然语言画面需求，符合所选来源，说明可见内容、拍摄方式或原图形式及分享心情；有用户要求时准确体现其重点，不写技术 prompt。严格按示例 JSON 格式提交工具参数，必须且只能含 image_source、include_self、scene，不加解释。
每轮最多一张。queued 只表示后台已受理，图片稍后送达，不能宣称已经发送成功或对方已经看见。聊天正文保持角色的自然语言，不暴露工具名、参数或后台流程。`,
  parameters: { type: 'object', properties: {
    image_source: { type: 'string', enum: ['selfie', 'camera', 'album', 'saved'], description: '图片来源：当场自拍、当场后置拍摄、相册旧照、收藏图片。' },
    include_self: { type: 'boolean', description: '角色本人是否入镜；selfie 必须为 true，其他来源按原图实际内容决定。' },
    scene: { type: 'string', minLength: 1, maxLength: 2000, description: '用角色第一人称描述分享意图、画面内容和拍摄方式；旧照交代当时情境，收藏图交代原图形式。' },
  }, required: ['image_source', 'include_self', 'scene'], additionalProperties: false },
} }];

export function validateImageCall(call) {
  if (call.function?.name !== 'request_chat_image') throw new Error('未知工具');
  let args = JSON.parse(call.function.arguments);
  // Some OpenAI-compatible providers wrap native arguments in the function name.
  // Only unwrap this exact envelope; never execute tool-looking chat text.
  if (args && Object.keys(args).length === 1 && Object.hasOwn(args, 'request_chat_image')) args = args.request_chat_image;
  if (!args || Array.isArray(args) || Object.keys(args).length !== 3
      || !Object.keys(args).every(key => ['image_source', 'include_self', 'scene'].includes(key))
      || !['selfie', 'camera', 'album', 'saved'].includes(args.image_source) || typeof args.include_self !== 'boolean'
      || typeof args.scene !== 'string' || !args.scene.trim() || args.scene.length > 2000) {
    throw new Error('必须且只能提供 image_source（selfie/camera/album/saved）、include_self（布尔值）、scene（1–2000 字符）');
  }
  if (args.image_source === 'selfie' && !args.include_self) throw new Error('selfie 自拍必须 include_self=true');
  return { ...args, scene: args.scene.trim() };
}

// Hold only a possible provider marker prefix, not the whole reply. Native tool
// serialization occasionally leaks into content on tool-free continuation.
async function* spokenText(stream) {
  let pending = '';
  for await (const text of stream) {
    pending += text;
    const marker = pending.search(/<[|｜]*DSML[|｜]*/i);
    if (marker >= 0) {
      if (marker) yield pending.slice(0, marker);
      throw Object.assign(new Error('模型把工具协议输出成了聊天正文'), { code: 'CHAT_TOOL_TEXT' });
    }
    const last = pending.lastIndexOf('<');
    const held = last >= 0 && /^<[|｜]*(?:D(?:S(?:M(?:L)?)?)?)?$/i.test(pending.slice(last));
    if (held) { if (last) yield pending.slice(0, last); pending = pending.slice(last); }
    else { yield pending; pending = ''; }
  }
  if (pending) yield pending;
}

// One completed native response, then at most one tool-free continuation. Text is never buffered here.
export async function* streamPrivateChatImages(messages, { nativeStream, textStream, accept, record, signal, onUnavailable, skipTools, resume, ...opts }) {
  if (resume?.text?.trim()) { signal?.throwIfAborted(); yield resume.text; return; }
  let assistant = resume?.assistant;
  let visible = false;
  try {
    const responseText = async function* () {
      if (resume) { if (assistant?.content) yield assistant.content; return; }
      for await (const event of nativeStream(messages, { ...opts, signal, tools: CHAT_IMAGE_TOOLS, forceThinking: false })) {
        if (event.type === 'text_delta') yield event.text;
        if (event.type === 'assistant_end') assistant = event.message;
      }
    };
    for await (const text of spokenText(responseText())) {
      visible ||= !!text.trim(); yield text;
    }
  } catch (error) {
    if (!visible && !signal?.aborted && [400, 422].includes(error.status)
        && /tool|function.call|unsupported.*(schema|protocol)/i.test(error.message)) {
      onUnavailable?.();
      yield* textStream(messages, { ...opts, signal });
      return;
    }
    throw error;
  }
  signal?.throwIfAborted();
  if (skipTools?.(assistant)) return;
  if (!assistant?.tool_calls?.length) return;
  const results = [];
  for (const call of assistant.tool_calls) {
    signal?.throwIfAborted();
    let result;
    if (resume) result = resume.results[call.id] || { ok: false, error: '该调用未受理，不得重新调用' };
    else {
      try { result = accept(validateImageCall(call), assistant); }
      catch (error) { result = { ok: false, error: error.message }; }
      record(call, assistant, result);
    }
    results.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ...result,
      reply_instruction: result.status === 'already_shared'
        ? '这张画面已经在前面的消息里分享或正在生成，本轮不重复发图。围绕原图自然接话，不要说又发了一张，不要解释后台状态。'
        : result.ok && result.status !== 'failed'
        ? '图片已在后台受理，无需再次调用。现在只用角色口吻自然接话，表达想分享的内容；不要解释后台状态，不要输出工具协议。'
        : '本轮图片未受理，工具已关闭。只用角色口吻简短说明这次图片没能发出并自然接话，不要再次调用或输出工具协议。',
    }) });
  }
  if (!visible) {
    // Keep the prepared context and provider signatures verbatim; no lorebook reinjection.
    const continuation = [...messages, assistant, ...results];
    const reply = async function* () {
      for await (const event of nativeStream(continuation, { ...opts, signal, tools: [], forceThinking: false })) {
        if (event.type === 'text_delta') yield event.text;
      }
    };
    let spoke = false;
    try {
      for await (const text of spokenText(reply())) { spoke ||= !!text.trim(); yield text; }
    } catch (error) {
      if (error.code !== 'CHAT_TOOL_TEXT' || signal?.aborted || spoke) throw error;
      // The accepted image remains independent. Recover text once, without
      // replaying the call or asking the image assistant to invent dialogue.
      yield* spokenText(textStream([...continuation, { role: 'system', content: '刚才的文字回复格式错误。图片工具已关闭，不要调用或模拟任何工具。只写一句自然的角色聊天正文回应用户，禁止输出 DSML、XML、JSON 或后台说明。' }], { ...opts, signal }));
    }
  }
}

// A retry after acceptance resumes the original native turn, not a new image
// decision. Keep signatures and every tool/result pair from that response.
export function getPrivateChatImageResume(db, userRawId) {
  const row = db.prepare(`SELECT p.task_id,r.content,t.status FROM private_chat_image_turns p
    JOIN raw_messages r ON r.id=p.raw_id JOIN image_tasks t ON t.id=p.task_id WHERE p.user_raw_id=?`).get(userRawId);
  if (!row) return null;
  const accepted = db.prepare('SELECT assistant_json FROM private_chat_tool_calls WHERE user_raw_id=? AND task_id=? ORDER BY id LIMIT 1').get(userRawId, row.task_id);
  if (!accepted) return null; // Director mode has no native tool turn.
  const calls = db.prepare('SELECT call_id,result_json FROM private_chat_tool_calls WHERE user_raw_id=? AND assistant_json=? ORDER BY id').all(userRawId, accepted.assistant_json);
  return { text: row.content, assistant: JSON.parse(accepted.assistant_json), results: Object.fromEntries(calls.map(c => {
    const result = JSON.parse(c.result_json);
    if (result.task_id === row.task_id) result.status = row.status;
    return [c.call_id, result];
  })) };
}

export function queuePrivateImage(db, { conversationId, userRawId, scene, snapshot, rawId, messageId, execute, notify }) {
  const previous = db.prepare('SELECT * FROM private_chat_image_turns WHERE user_raw_id=?').get(userRawId);
  if (previous) {
    const previousSource = JSON.parse(previous.snapshot_json).imageSource;
    if (previous.scene !== scene || JSON.stringify(previousSource) !== JSON.stringify(snapshot.imageSource)) {
      return { ok: false, error: '每条用户消息最多受理一张图片' };
    }
    return { ok: true, status: 'queued', task_id: previous.task_id };
  }
  // A model may copy the most recent scene verbatim while merely reacting to
  // that photo. Reuse the existing share, without moving it to the new turn.
  const recent = scene && db.prepare(`SELECT p.scene,p.snapshot_json,p.task_id,t.status FROM private_chat_image_turns p
    JOIN image_tasks t ON t.id=p.task_id WHERE p.conversation_id=? ORDER BY p.user_raw_id DESC LIMIT 1`).get(conversationId);
  if (recent && recent.status !== 'failed' && recent.scene === scene
      && JSON.stringify(JSON.parse(recent.snapshot_json).imageSource) === JSON.stringify(snapshot.imageSource)) {
    return { ok: true, status: 'already_shared', task_id: recent.task_id };
  }
  const frozen = structuredClone(snapshot);
  const binding = db.transaction(() => {
    if (!rawId) rawId = db.prepare("INSERT INTO raw_messages (conversation_id,role,content) VALUES (?,'assistant','')").run(conversationId).lastInsertRowid;
    if (!messageId) messageId = db.prepare("INSERT INTO messages (conversation_id,raw_id,role,content,seq) VALUES (?,?,'assistant','',0)").run(conversationId, rawId).lastInsertRowid;
    // Binding lives in the audit table so deleting chat history does not violate image_tasks' edit-task FK.
    const taskId = db.prepare("INSERT INTO image_tasks (conversation_id,prompt_original,prompt_refined,status) VALUES (?,'','','pending')").run(conversationId).lastInsertRowid;
    db.prepare('INSERT INTO private_chat_image_turns (user_raw_id,conversation_id,scene,task_id,raw_id,message_id,snapshot_json) VALUES (?,?,?,?,?,?,?)')
      .run(userRawId, conversationId, scene, taskId, rawId, messageId, JSON.stringify(frozen));
    return { taskId, rawId, messageId };
  })();
  setImmediate(() => Promise.resolve().then(() => execute(binding, frozen)).catch(error => {
    db.prepare("UPDATE image_tasks SET status='failed', error_message=?, finished_at=datetime('now') WHERE id=?").run(error.message, binding.taskId);
    notify('generate_error', { taskId: binding.taskId, error: error.message });
  }));
  notify('generate_start', { taskId: binding.taskId, messageId: binding.messageId });
  return { ok: true, status: 'queued', task_id: binding.taskId };
}

// A queued picture and its spoken reply are one assistant turn. Preserve the
// image carrier ID even if generation finishes before the text continuation.
export function savePrivateChatReply(db, { conversationId, userRawId, content, segments }) {
  return db.transaction(() => {
    const binding = db.prepare('SELECT raw_id,message_id FROM private_chat_image_turns WHERE user_raw_id=?').get(userRawId);
    let rawId = binding?.raw_id;
    if (rawId && db.prepare('SELECT content FROM raw_messages WHERE id=?').get(rawId)?.content?.trim()) {
      const saved = db.prepare('SELECT id,content,images FROM messages WHERE raw_id=? AND id<>? ORDER BY seq,id').all(rawId, binding.message_id)
        .map((m, index) => ({ id: m.id, p: { ...segments[index], content: m.content, images: JSON.parse(m.images || '[]') } }));
      return { rawId, saved, lastMessageId: saved.at(-1)?.id || binding.message_id };
    }
    if (rawId) db.prepare('UPDATE raw_messages SET content=? WHERE id=?').run(content, rawId);
    else rawId = db.prepare("INSERT INTO raw_messages(conversation_id,role,content) VALUES (?,'assistant',?)").run(conversationId, content).lastInsertRowid;
    const parts = segments.length || binding ? segments : [{ content: '...', images: [] }];
    const insert = db.prepare("INSERT INTO messages(conversation_id,raw_id,role,content,images,seq) VALUES (?,?,'assistant',?,?,?)");
    const saved = parts.map((p, seq) => ({ p, id: insert.run(conversationId, rawId, p.content, p.images.length ? JSON.stringify(p.images) : null, seq).lastInsertRowid }));
    if (binding) db.prepare('UPDATE messages SET seq=? WHERE id=?').run(parts.length, binding.message_id);
    return { rawId, saved, lastMessageId: saved.at(-1)?.id || binding?.message_id };
  })();
}
