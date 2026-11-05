import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { buildCharacterPersona, buildCharacterAppearanceSection, splitAppearanceSection, extractEditableAppearanceBody } from '../characterPersona.js';
import { buildSceneOutfitRequest, normalizeDesignScenes, parseSceneOutfitDesign } from '../sceneOutfitPrompt.js';
import { resolveClothingTags, buildClothingAppearanceMessages, parseClothingAppearance } from '../clothingLibrary.js';
import { angelOutfits, angelStandings, cleanAngelOutfits, validAngelScene, selectAngelOutfit, writeAngelStanding } from './angelWardrobe.js';
import { saveBase64Image, deleteImageFileByUrl } from '../imagePaths.js';
import { invalidateGalleryCache } from '../galleryCache.js';
import { extractImagePromptResponse } from '../imagePromptResponse.js';
import { IMAGE_PROMPT_RULE, STANDING_IMAGE_PROMPT_RULE, STANDING_ROLE_PROMPTS } from '../../builtinRules.js';
import { parseJson } from './repository.js';
import { abortable } from './agent.js';

const categories = { avatar: 'avatargen', standing: 'standing', peek: 'peek' };
const bad = text => Object.assign(new Error(text), { status: 400 });

export function buildAngelImageRequest(angel, kind, request, { systemRules, worldSetting = '', worldRule = '' }) {
  const persona = buildCharacterPersona({ id: 'god:angel', base_prompt: angel.persona }, { variant: 'full', person: angel.display_name, outfits: null });
  const role = kind === 'standing' ? STANDING_ROLE_PROMPTS[request.mode || 'normal'] : kind === 'avatar'
    ? '你是角色头像摄影师。按下方完整人格设计单人面部特写头像，脸部清晰、五官与标志性特征准确，表情符合性格，方形构图。'
    : '你是人像摄影师。拍下角色在指定日程时段活动的自然瞬间，不要求看镜头。时间、地点、光线取自该时段，不取当前墙钟；睡眠时闭眼、安静休息，符合角色外观与生活环境。计划快照不代表活动已经完成。';
  const rules = (kind === 'standing' ? STANDING_IMAGE_PROMPT_RULE : IMAGE_PROMPT_RULE).rule_content;
  const messages = [{ role: 'system', content: [systemRules, worldSetting].filter(Boolean).join('\n\n') }];
  if (worldSetting && worldRule) messages.push({ role: 'system', content: worldRule });
  messages.push({ role: 'system', content: `${role}\n\n${rules}\n直接输出英文生图提示词，不输出解释或 Markdown。` }, { role: 'system', content: persona });
  const personaIndex = messages.length - 1;
  const outfit = request.outfit || selectAngelOutfit(angel, request);
  if (outfit?.scene !== 'work' && outfit?.description) messages.push({ role: 'system', content: buildCharacterAppearanceSection(
    { id: 'god:angel', base_prompt: angel.persona }, { outfits: { limited: [outfit], exclusive: null } }) });
  const activity = request.activity;
  const task = [activity && `日程日期：${request.day}；时段：${activity.startTime}–${activity.endTime}；活动：${activity.activity}；地点：${activity.location || '云庭'}；情境：${activity.description || ''}${activity.replyDelay === -1 ? '；正在睡眠，必须闭眼' : ''}`,
    outfit?.description && (outfit.scene === 'work'
      ? '本次服装：默认服饰；使用上方角色默认外观中描述的服饰。'
      : `本次服装：${outfit.sceneLabel || outfit.scene} · ${outfit.name}；使用上方对应外观，不混穿默认服饰。`),
    request.requirement && `额外要求：${request.requirement}`, `为「${angel.display_name}」生成${kind === 'avatar' ? '头像' : kind === 'standing' ? '全身形象' : '这一日程瞬间的照片'}，只输出英文提示词。`].filter(Boolean).join('\n\n');
  messages.push({ role: 'user', content: task });
  return { messages, lorebook: { scope: `god:angel:image:${kind}`, userName: '吾神', characterName: angel.display_name, characterDescription: persona,
    personaTexts: [persona], staticTexts: messages.slice(0, personaIndex).map(m => m.content), cacheBoundary: { index: personaIndex, offset: persona.length },
    history: messages.slice(personaIndex + 1), protectedPrefix: personaIndex } };
}

export function buildAngelOutfitDesignRequest(angel, request, environment) {
  const built = buildSceneOutfitRequest({ systemRules: [environment.systemRules, environment.worldSetting].filter(Boolean).join('\n\n'),
    worldRule: environment.worldSetting ? environment.worldRule : '', persona: splitAppearanceSection(angel.persona).before.trim(),
    displayName: angel.display_name, baseAppearance: request.baseAppearance, scenes: request.scenes,
    instruction: request.instruction, currentOutfits: request.instruction ? angelOutfits(angel) : [] });
  return { ...built, lorebook: { ...built.lorebook, scope: 'god:angel:outfits', userName: '吾神' } };
}
function wardrobePrompt(messages, angel, scope) {
  const index = messages.length - 3;
  const persona = messages[index].content;
  return { messages, lorebook: { scope: `god:angel:${scope}`, characterName: angel.display_name, userName: '吾神', characterDescription: persona,
    personaTexts: [persona], staticTexts: messages.slice(0, index).map(message => message.content), cacheBoundary: { index, offset: persona.length },
    protectedPrefix: index, history: messages.slice(index + 1) } };
}

export function createAngelImageService(repo, { describe, render, promptEnvironment, settings, scheduleEnabled = () => true,
  save = saveBase64Image, remove = deleteImageFileByUrl } = {}) {
  const { db } = repo;
  db.prepare("UPDATE god_angel_image_jobs SET status='failed',error='服务重启，图片任务已中断；已有形象保留。',finished_at=? WHERE status='running'").run(repo.timestamp());
  const publicJob = row => row && ({ ...row, request: parseJson(row.request_json, {}), result: parseJson(row.result_json), request_json: undefined, result_json: undefined });
  const get = id => publicJob(db.prepare('SELECT * FROM god_angel_image_jobs WHERE id=?').get(id));
  function list() {
    const jobs = db.prepare('SELECT * FROM god_angel_image_jobs ORDER BY created_at DESC,rowid DESC LIMIT 30').all().map(publicJob);
    const tasks = db.prepare("SELECT output_paths FROM image_tasks WHERE conversation_id LIKE 'god:angel%' AND status='done' ORDER BY id DESC LIMIT 40").all();
    const angel = repo.ensureAngel();
    const images = [...new Set([angel.avatar_path, ...angelStandings(angel).map(row => row.image_url), ...tasks.flatMap(t => parseJson(t.output_paths, [])).map(url => url.startsWith('/images/') ? url : `/images/chat/${url}`)].filter(Boolean))].slice(0, 80);
    return { jobs, images };
  }
  function start(input) {
    const { kind, requirement = '', mode = 'normal', activity_index: index } = input || {};
    if ((!Object.hasOwn(categories, kind) && kind !== 'outfits') || typeof requirement !== 'string' || requirement.length > 500 || !['normal', 'dynamic'].includes(mode)) throw bad('图片任务参数无效');
    const angel = repo.ensureAngel();
    const request = { requirement: requirement.trim(), mode, day: repo.day() };
    if (kind === 'outfits') {
      if (typeof input.baseAppearance !== 'string' || !input.baseAppearance.trim() || input.baseAppearance.length > 30000) throw bad('请先填写有效的默认外观');
      try { request.scenes = normalizeDesignScenes(input.scenes); } catch (error) { throw bad(error.message); }
      request.baseAppearance = input.baseAppearance.trim();
      if (db.prepare("SELECT id FROM god_angel_image_jobs WHERE kind='standing' AND status='running'").get()) throw Object.assign(new Error('形象正在生成，请稍后再生成服装'), { status: 409 });
    }
    if (kind === 'standing') {
      request.scene = input.scene || 'work';
      if (!validAngelScene(request.scene)) throw bad('服装场景无效');
      request.outfit = selectAngelOutfit(angel, request);
      if (request.scene !== 'work' && !request.outfit?.description) throw bad('请先填写或生成这套服装，再生成形象');
      if (input.reuse_prompt === true) request.prompt = angelStandings(angel).find(row => row.scene === request.scene)?.prompt_text || '';
      if (db.prepare("SELECT id FROM god_angel_image_jobs WHERE kind='outfits' AND status='running'").get()) throw Object.assign(new Error('服装与形象正在批量生成，请稍后再试'), { status: 409 });
    }
    if (kind === 'peek') {
      if (!scheduleEnabled()) throw bad('日程功能未启用');
      if (!Number.isInteger(index) || index < 0 || index >= angel.schedule.length) throw bad('这条日程已不存在，请刷新后重试');
      request.activity = angel.schedule[index]; request.activity_index = index; request.outfit = selectAngelOutfit(angel, request);
    }
    const active = db.prepare("SELECT * FROM god_angel_image_jobs WHERE kind=? AND status='running'").get(kind);
    if (active) {
      if (kind === 'standing' && parseJson(active.request_json, {}).scene !== request.scene) throw Object.assign(new Error('其他服装形象正在生成，请稍候'), { status: 409 });
      return publicJob(active);
    }
    const id = randomUUID();
    db.prepare('INSERT INTO god_angel_image_jobs(id,kind,request_json,created_at) VALUES (?,?,?,?)').run(id, kind, JSON.stringify(request), repo.timestamp());
    const environment = promptEnvironment(kind); const imageSettings = { ...settings() };
    setImmediate(() => { void run(id, kind, request, angel, environment, imageSettings); });
    return get(id);
  }
  async function produce(id, kind, request, angel, environment, imageSettings, signal) {
    const saved = [];
    try {
      const promptRequest = buildAngelImageRequest(angel, kind, request, environment);
      const step = db.prepare('SELECT COUNT(*) n FROM god_angel_image_jobs WHERE kind=?').get(kind).n;
      const prompt = request.prompt || extractImagePromptResponse(await abortable(describe(promptRequest.messages, { signal,
        label: `天使${kind === 'avatar' ? '头像' : kind === 'standing' ? '形象' : '瞄一眼'}`, lorebook: { ...promptRequest.lorebook, turnKey: id, step } }), signal));
      if (!prompt || prompt.length < 10) throw new Error('没有生成完整的画面提示词，请重试');
      const width = kind === 'standing' ? 768 : kind === 'avatar' ? 1024 : imageSettings.eventWidth;
      const height = kind === 'standing' ? 1536 : kind === 'avatar' ? 1024 : imageSettings.eventHeight;
      const result = await abortable(render(prompt, { signal, width, height, artist: kind === 'peek' ? imageSettings.eventArtist : imageSettings.momentsArtist,
        scene: kind === 'peek' ? 'schedule' : 'portrait', promptScene: kind === 'peek' ? 'schedule' : 'avatar', persistPreparation: false }), signal);
      if (!result.success || !result.images?.length) throw new Error(result.error || '生图服务没有返回图片');
      for (const image of result.images) {
        if (!/^data:image\/(png|jpe?g|webp);base64,/.test(image.base64 || '')) throw new Error('图片数据无效');
        const type = /^data:image\/([^;]+)/.exec(image.base64)[1].replace('jpeg', 'jpg');
        saved.push({ url: save(categories[kind], `god_${kind}_${randomUUID()}.${type}`, image.base64), width, height });
      }
      let applied = false;
      db.transaction(() => {
        if (kind === 'standing') {
          const current = repo.ensureAngel();
          const scene = request.scene || 'work';
          const oldImage = angelStandings(angel).find(row => row.scene === scene)?.image_url;
          const currentImage = angelStandings(current).find(row => row.scene === scene)?.image_url;
          const oldOutfit = angelOutfits(angel).find(row => row.scene === scene)?.description;
          const currentOutfit = angelOutfits(current).find(row => row.scene === scene)?.description;
          if (current.persona === angel.persona && oldImage === currentImage && oldOutfit === currentOutfit) {
            writeAngelStanding(db, scene, saved[0].url, prompt); applied = true;
          }
        }
        db.prepare(`INSERT INTO image_tasks(conversation_id,prompt_original,prompt_refined,status,output_paths,resolution,workflow_template,finished_at)
          VALUES (?,?,?,'done',?,?,?,datetime('now'))`).run(`god:angel:${kind}${request.scene ? ':' + request.scene : ''}`, prompt, result.promptRefined || prompt,
            JSON.stringify(saved.map(image => image.url)), `${width}x${height}`, result.wfMode || null);
      })();
      invalidateGalleryCache();
      return { success: true, images: saved, prompt, applied,
        ...(kind === 'standing' && !applied ? { note: '生成期间资料、服装或形象已改变，成图保留在最近图片中，没有覆盖现有形象。' } : {}) };
    } catch (error) {
      for (const image of saved) { try { remove(image.url); } catch { /* 保留最初错误 */ } }
      throw error;
    }
  }
  async function run(id, kind, request, angel, environment, imageSettings) {
    const signal = AbortSignal.timeout(600000);
    try {
      let result;
      if (kind === 'outfits') {
        const design = buildAngelOutfitDesignRequest(angel, request, environment);
        const raw = await abortable(describe(design.messages, { signal, response_format: { type: 'json_object' }, label: '天使场景服装生成',
          lorebook: { ...design.lorebook, turnKey: id, step: db.prepare('SELECT COUNT(*) n FROM god_angel_image_jobs').get().n } }), signal);
        const outfits = parseSceneOutfitDesign(raw, request.scenes);
        const current = repo.ensureAngel();
        if (current.persona !== angel.persona || current.scene_outfits_json !== angel.scene_outfits_json) throw new Error('生成期间资料或服装已改变，请确认新资料后重试');
        const merged = angelOutfits(current).map(outfit => outfits.find(item => item.scene === outfit.scene) || outfit);
        repo.updateAngel({ display_name: current.display_name, persona: current.persona, outfits: cleanAngelOutfits(merged) });
        const completed = [], failures = [];
        for (const outfit of outfits) {
          db.prepare('UPDATE god_angel_image_jobs SET result_json=? WHERE id=?').run(JSON.stringify({ progress: `正在生成${outfit.name}形象`, completed }), id);
          try {
            const snapshot = repo.ensureAngel();
            if (snapshot.persona !== angel.persona || angelOutfits(snapshot).find(row => row.scene === outfit.scene)?.description !== outfit.description) throw new Error('资料或服装已改变');
            const image = await produce(`${id}:${outfit.scene}`, 'standing', { scene: outfit.scene, outfit, mode: request.mode }, snapshot, environment, imageSettings, signal);
            if (!image.applied) throw new Error(image.note);
            completed.push({ scene: outfit.scene, image_url: image.images[0].url });
          } catch (error) { failures.push(`${outfit.name}：${error.message}`); }
        }
        if (failures.length) throw new Error(`服装已保存，形象完成 ${completed.length}/${outfits.length}；${failures.join('；')}。可在角色形象中重试。`);
        result = { success: true, outfits, completed };
      } else result = await produce(id, kind, request, angel, environment, imageSettings, signal);
      db.prepare("UPDATE god_angel_image_jobs SET status='done',result_json=?,finished_at=? WHERE id=?").run(JSON.stringify(result), repo.timestamp(), id);
    } catch (error) {
      db.prepare("UPDATE god_angel_image_jobs SET status='failed',error=?,finished_at=? WHERE id=?").run(signal.aborted ? '这次绘制耗时过长，已经停止，请稍后重试。' : error.message, repo.timestamp(), id);
    }
  }
  async function upload(kind, base64, scene = 'work') {
    if (!['avatar', 'standing'].includes(kind)) throw bad('图片类型无效');
    if (!validAngelScene(scene)) throw bad('服装场景无效');
    if (db.prepare("SELECT id FROM god_angel_image_jobs WHERE (kind=? OR (?='standing' AND kind='outfits')) AND status='running'").get(kind, kind)) throw Object.assign(new Error('该图片正在生成，请稍后再修改'), { status: 409 });
    repo.ensureAngel();
    const column = kind === 'avatar' ? 'avatar_path' : 'standing_url';
    if (base64 === null) { db.transaction(() => { if (kind === 'standing') writeAngelStanding(db, scene, null); else db.prepare(`UPDATE god_angel SET ${column}=NULL WHERE id=1`).run(); })(); return repo.ensureAngel(); }
    const match = typeof base64 === 'string' && /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(base64);
    if (!match || base64.length > 8 * 1024 * 1024 + 64 || Buffer.byteLength(match[2], 'base64') > 6 * 1024 * 1024) throw bad('请上传6MB以内的 PNG、JPEG 或 WebP 图片');
    let buffer;
    try {
      buffer = await sharp(Buffer.from(match[2], 'base64'), { limitInputPixels: 32000000 }).rotate()
        .resize(kind === 'avatar' ? { width: 512, height: 512, fit: 'cover' } : { width: 1536, height: 3072, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    } catch { throw bad('无法读取这张图片，请选择有效的 PNG、JPEG 或 WebP'); }
    const url = save(categories[kind], `god_${kind}_${randomUUID()}.png`, `data:image/png;base64,${buffer.toString('base64')}`);
    try { db.transaction(() => { if (kind === 'standing') writeAngelStanding(db, scene, url); else db.prepare(`UPDATE god_angel SET ${column}=? WHERE id=1`).run(url); })(); }
    catch (error) { remove(url); throw error; }
    invalidateGalleryCache();
    return repo.ensureAngel();
  }
  async function clothingDraft(input) {
    const { scene = 'work', basePrompt, tags, brief = '' } = input || {};
    if (!validAngelScene(scene) || typeof basePrompt !== 'string' || !basePrompt.trim() || basePrompt.length > 100000 || typeof brief !== 'string' || brief.length > 2000) throw bad('衣服库参数无效');
    let entries;
    try { entries = resolveClothingTags(tags, scene); } catch (error) { throw bad(error.message); }
    const angel = repo.ensureAngel(), environment = promptEnvironment('clothing');
    const persona = buildCharacterPersona({ id: 'god:angel', base_prompt: basePrompt }, { variant: 'full', outfits: null });
    const messages = buildClothingAppearanceMessages({ systemRules: [environment.systemRules, environment.worldSetting].filter(Boolean).join('\n\n'),
      worldRule: environment.worldSetting ? environment.worldRule : '', persona, scene, entries, brief: brief.trim() });
    const request = wardrobePrompt(messages, angel, 'clothing');
    const signal = AbortSignal.timeout(120000);
    const raw = await abortable(describe(messages, { signal, response_format: { type: 'json_object' }, label: '天使衣服库外观生成',
      lorebook: { ...request.lorebook, turnKey: randomUUID() } }), signal);
    return { appearance: parseClothingAppearance(raw, entries, scene), tags: entries.map(entry => entry.tag) };
  }
  async function outfitDraft(input = {}) {
    const angel=repo.ensureAngel();
    const scenes=normalizeDesignScenes(input.scenes);
    if (input.instruction!==undefined && (typeof input.instruction!=='string' || input.instruction.length>4000)) throw bad('服装要求无效');
    const baseAppearance=extractEditableAppearanceBody(angel.persona);
    if (!baseAppearance?.trim()) throw bad('请先补全天使默认外观');
    const design=buildAngelOutfitDesignRequest(angel,{scenes,baseAppearance,instruction:input.instruction},promptEnvironment('outfits'));
    const signal=AbortSignal.timeout(120000);
    const raw=await abortable(describe(design.messages,{signal,response_format:{type:'json_object'},label:'天使服装草稿',lorebook:{...design.lorebook,turnKey:randomUUID()}}),signal);
    return {outfits:parseSceneOutfitDesign(raw,scenes)};
  }
  return { start, get, list, upload, clothingDraft, outfitDraft };
}
