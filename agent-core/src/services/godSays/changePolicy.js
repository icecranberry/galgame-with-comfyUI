import { extractEditableAppearanceBody, replaceAppearanceSection } from '../characterPersona.js';
import { validateReplacement } from './replacementPrompt.js';
import { parseSceneOutfitDesign } from '../sceneOutfitPrompt.js';
import { angelOutfits, cleanAngelOutfits } from './angelWardrobe.js';

// 新增内容不确认；已有对象的替换/切换/消耗必须确认。可覆盖的生成工具按当前数据判断。
export const CONFIRMED_TOOLS = new Set([
  'update_character', 'apply_character_appearance', 'generate_scene_outfits', 'set_outfit_enabled',
  'rewrite_world_setting', 'update_world_setting', 'activate_world_setting', 'update_relationship',
  'update_group', 'add_group_members', 'set_emoji_set_enabled', 'set_schedule', 'regenerate_schedule',
  'collect_item', 'use_item', 'wake_character', 'set_media_favorite', 'inject_character_state',
  'update_angel', 'apply_angel_appearance', 'generate_angel_outfits',
]);
export const PREPARED_TOOLS = new Set(['create_outfit', 'initialize_emoji_prompts']);
export function createChangePolicy(db, api, generateReplacement, services = {}) {
  const rows = (table, where = '1=1', params = []) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
    ? db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY rowid`).all(...params) : [];
  const row = (table, id) => { const value = rows(table, 'id=?', [id])[0]; if (!value) throw new Error('目标已不存在'); return value; };
  const char = id => { const c = row('characters', id); return { id:c.id,name:c.name,display_name:c.display_name,base_prompt:c.base_prompt }; };
  const date = a => a.date || services.localDate?.() || new Date().toISOString().slice(0,10);
  function emoji(a) {
    const set = row('emoji_sets', a.set_id);
    if (set.character_id !== a.character_id) throw new Error('表情包不属于这位角色');
    return { character:char(a.character_id), set, emojis:rows('character_emojis','set_id=?',[a.set_id]).filter(e => (!a.emoji_key || e.emoji_key===a.emoji_key) && (!a.keys || a.keys.includes(e.emoji_key))) };
  }
  function needsConfirmation({name,args:a}) {
    if (name==='create_world_event') return a.supersedes_id !== undefined;
    if (name==='generate_diary') return rows('character_diaries','character_id=? AND diary_date=?',[a.character_id,date(a)]).length > 0;
    if (name==='initialize_emoji_prompts' || name==='generate_emoji_prompt') return emoji(a).emojis.some(e=>!!e.prompt||!!e.image_path);
    if (name==='generate_emoji_images') return a.overwrite===true && emoji(a).emojis.some(e=>!!e.image_path);
    if (name==='generate_emoji_image') return emoji(a).emojis.some(e=>!!e.image_path);
    return CONFIRMED_TOOLS.has(name);
  }
  function snapshot({name,args:a}) {
    if (['update_character','apply_character_appearance','create_outfit'].includes(name)) return char(a.character_id);
    if (['update_angel','apply_angel_appearance','generate_angel_outfits'].includes(name)) {
      const angel=row('god_angel',1);
      return { display_name:angel.display_name,persona:angel.persona,scene_outfits_json:angel.scene_outfits_json };
    }
    if (name==='generate_scene_outfits') return { character:{...char(a.character_id),short_prompt:row('characters',a.character_id).short_prompt||''}, outfits:rows('character_outfits','character_id=?',[a.character_id]).filter(o=>a.scenes.includes(o.scene)) };
    if (name==='set_outfit_enabled') return {character:char(a.character_id),outfits:rows('character_outfits','character_id=?',[a.character_id])};
    if (name==='rewrite_world_setting' || name==='update_world_setting') return row('world_settings',a.world_id);
    if (name==='activate_world_setting') return {target:row('world_settings',a.world_id),active:rows('world_settings','is_active=1').map(r=>r.id)};
    if (name==='update_relationship') return row('character_relationships',a.relationship_id);
    if (name==='update_group' || name==='add_group_members') return {group:row('group_chats',a.group_id),members:rows('group_members','group_id=?',[a.group_id])};
    if (name==='set_emoji_set_enabled') return row('emoji_sets',a.set_id);
    if (['generate_emoji_prompt','generate_emoji_image','initialize_emoji_prompts','generate_emoji_images'].includes(name)) return emoji(a);
    if (name==='generate_diary') return {character:char(a.character_id),date:date(a),diaries:rows('character_diaries','character_id=? AND diary_date=?',[a.character_id,date(a)])};
    if (name==='create_world_event' && a.supersedes_id) return row('god_world_events',a.supersedes_id);
    if (name==='set_schedule' || name==='regenerate_schedule') {
      const all=rows('schedule_templates');
      let members=[];
      try { members=JSON.parse(all.find(t=>t.character_id===a.character_id)?.schedule_json||'[]').find(activity=>activity.residence)?.residence?.memberIds||[]; } catch { /* 无有效居室时仅涉及本人 */ }
      const ids=new Set([a.character_id,...members]);
      return {character:char(a.character_id),members:rows('characters').filter(c=>ids.has(c.id)).map(c=>({id:c.id,display_name:c.display_name})),templates:all.filter(t=>ids.has(t.character_id)),days:rows('daily_schedules').filter(d=>ids.has(d.character_id))};
    }
    if (name==='wake_character') return row('characters',a.character_id);
    if (name==='set_media_favorite') return row('media_posts',a.post_id);
    if (name==='collect_item') return row('backpack_items',a.item_id);
    if (name==='use_item' || name==='inject_character_state') return {character:char(a.character_id),...(a.item_id?{item:row('backpack_items',a.item_id)}:{}),effects:rows('item_effects','character_id=?',[a.character_id]),outfits:rows('character_outfits','character_id=?',[a.character_id]),limited:rows('global_outfits','character_id=?',[a.character_id])};
    return null;
  }
  const pretty = value => typeof value==='string' ? value : JSON.stringify(value,null,2);
  const field = (label,before,after) => ({label,before:pretty(before??''),after:pretty(after??'')});
  const scheduleText=value=>{
    try {const parsed=typeof value==='string'?JSON.parse(value):value;const activities=Array.isArray(parsed)?parsed:parsed?.activities||[];return activities.map(a=>`${a.startTime}–${a.endTime} ${a.activity} · ${a.location||''}\n${a.description||''}`).join('\n\n');} catch {return '';}
  };
  async function prepare(operation,signal,before) {
    const {name,args:a}=operation;
    const request = async (path,body) => {
      const response=await api({method:'POST',path,body},{signal});
      if (!response.data || response.data._truncated) throw new Error('生成草稿不完整，请重新生成');
      return response.data;
    };
    if (name==='update_character') {
      if (a.display_name===undefined && a.base_prompt===undefined) throw new Error('至少提供一个修改字段');
      return {...operation,preview:[...(a.display_name!==undefined?[field('显示名称',before.display_name,a.display_name)]:[]),...(a.base_prompt!==undefined?[field('角色完整资料',before.base_prompt,a.base_prompt)]:[])]};
    }
    if (name==='update_angel') {
      if (a.display_name===undefined && a.persona===undefined) throw new Error('至少提供一个修改字段');
      return {...operation,preview:[...(a.display_name!==undefined?[field('天使名称',before.display_name,a.display_name)]:[]),...(a.persona!==undefined?[field('天使完整人设',before.persona,a.persona)]:[])],replacement:{method:'PUT',path:'/api/god-says/angel',body:{display_name:before.display_name,persona:before.persona,...a}}};
    }
    if (['apply_character_appearance','apply_angel_appearance','rewrite_world_setting'].includes(name)) {
      if (!generateReplacement) throw new Error('替换草稿生成器尚未连接');
      const angel=name==='apply_angel_appearance',appearance=name!=='rewrite_world_setting';
      const persona=angel?before.persona:before.base_prompt;
      const source=appearance?extractEditableAppearanceBody(persona):before.content;
      if (!source?.trim()) throw new Error('没有找到可修改的完整原文');
      const kind=appearance?'appearance':'world';
      const next=validateReplacement(await generateReplacement({kind,source,instruction:a.instruction,...(appearance?{character:angel?{id:'god:angel',base_prompt:persona,display_name:before.display_name}:before}:{})},signal),kind);
      const body=angel?{display_name:before.display_name,persona:replaceAppearanceSection(persona,next)}:appearance?{base_prompt:replaceAppearanceSection(persona,next)}:{name:before.name,content:next};
      return {...operation,label:before.display_name||before.name,preview:[field(appearance?'你的外观':'世界观正文',source,next)],replacement:{method:'PUT',path:angel?'/api/god-says/angel':appearance?`/api/characters/${before.id}`:`/api/config/world-settings/${before.id}`,body}};
    }
    if (name==='generate_scene_outfits' || name==='generate_angel_outfits') {
      const angel=name==='generate_angel_outfits';
      const character=angel?{display_name:before.display_name,base_prompt:before.persona}:before.character;
      const previous=angel?angelOutfits(before):before.outfits;
      const baseAppearance=extractEditableAppearanceBody(character.base_prompt);
      if (!baseAppearance?.trim()) throw new Error('没有找到默认外观，请先补全角色“你的外观”');
      const data=await request(angel?'/api/god-says/angel/outfits/draft':`/api/characters/${character.id}/outfits/generate`,{scenes:a.scenes,instruction:a.instruction,baseAppearance,save:false,generateImages:false});
      const outfits=parseSceneOutfitDesign(JSON.stringify(data),a.scenes);
      const labels={casual:'私服',home:'居家服',sleep:'睡衣'};
      return {...operation,label:character.display_name,preview:outfits.flatMap(o=>{const old=previous.find(p=>p.scene===o.scene);return [field(`${labels[o.scene]}名称`,old?.name,o.name),field(`${labels[o.scene]}完整外观`,old?.description,o.description)];}),replacement:angel?{method:'PUT',path:'/api/god-says/angel',body:{display_name:before.display_name,persona:before.persona,outfits:cleanAngelOutfits(previous.map(o=>outfits.find(p=>p.scene===o.scene)||o))}}:{method:'PUT',path:`/api/characters/${character.id}/outfits/scene`,body:{outfits}}};
    }
    if (name==='create_outfit') {
      if (!!a.description===!!a.instruction) throw new Error('instruction 与 description 必须且只能提供一个');
      const description=a.description || validateReplacement((await request('/api/characters/expand-appearance-draft',{character_id:a.character_id,base_prompt:before.base_prompt,display_name:before.display_name,brief:a.instruction})).appearance,'appearance');
      return {...operation,replacement:{method:'POST',path:`/api/characters/${a.character_id}/outfits`,body:{name:a.name,description}}};
    }
    if (name==='generate_diary') {
      const data=await request(`/api/diaries/${a.character_id}/draft`,{date:before.date});
      if (!data.draft?.content || !Array.isArray(data.draft.imagePrompts) || data.draft.imagePrompts.length!==3) throw new Error('日记草稿不完整');
      return {...operation,preview:[field('日记完整正文',before.diaries[0]?.content,data.draft.content),field('日记标题',before.diaries[0]?.title,data.draft.title),field('配图提示词',before.diaries[0]?.image_prompts,data.draft.imagePrompts)],replacement:{method:'POST',path:`/api/diaries/${a.character_id}/generate`,body:{date:before.date,draft:data.draft}}};
    }
    if (name==='regenerate_schedule') {
      const data=await request(`/api/schedule/${a.character_id}/regenerate`,{direction:a.direction,save:false});
      if (!Array.isArray(data.activities) || !data.activities.length) throw new Error('日程草稿不完整');
      return {...operation,preview:[field('完整日程',scheduleText(before.templates.find(t=>t.character_id===a.character_id)?.schedule_json),scheduleText(data.activities)),...(before.members.length>1?[field('共同生活同步','',`同步 ${before.members.map(m=>m.display_name).join('、')} 的共同睡眠注释，保留其他人的清醒活动。`)]:[])],replacement:{method:'POST',path:`/api/schedule/${a.character_id}/regenerate`,body:{activities:data.activities}}};
    }
    if (name==='initialize_emoji_prompts' || name==='generate_emoji_prompt') {
      const single=name==='generate_emoji_prompt';
      const data=await request('/api/characters/emoji/prompts',{character_ids:[a.character_id],set_id:a.set_id,style:a.style,keys:single?[a.emoji_key]:undefined,save:false});
      const result=data.results?.find(r=>r.character_id===a.character_id);
      if (!result?.ok || !result.prompts || !Object.keys(result.prompts).length) throw new Error(result?.error||'表情提示词草稿不完整');
      const entries=Object.entries(result.prompts);
      return {...operation,preview:entries.map(([key,value])=>field(key,before.emojis.find(e=>e.emoji_key===key)?.prompt,value)),replacement:{method:'POST',path:'/api/characters/emoji/prompts/apply',body:{character_id:a.character_id,set_id:a.set_id,prompts:result.prompts,style:a.style||''}}};
    }
    if (name==='generate_emoji_image' || name==='generate_emoji_images') {
      const targets=before.emojis.filter(e=>e.prompt && e.status!=='generating');
      if (!targets.length) throw new Error('没有可重新生成的表情，或任务仍在运行');
      const images=[];
      for(const target of targets) {
        const data=await request(`/api/characters/emoji/${a.character_id}/${encodeURIComponent(target.emoji_key)}/image`,{set_id:a.set_id,artist:a.artist,previewOnly:true});
        if (typeof data.image_path!=='string'||!data.image_path.startsWith('/images/emoji/')) throw new Error('没有生成有效的表情图片草稿');
        images.push({emoji_key:target.emoji_key,image_path:data.image_path});
      }
      return {...operation,preview:images.map(image=>({...field(image.emoji_key,before.emojis.find(e=>e.emoji_key===image.emoji_key)?.image_path,image.image_path),kind:'image'})),replacement:{method:'POST',path:'/api/characters/emoji/images/apply',body:{character_id:a.character_id,set_id:a.set_id,images}}};
    }
    if (name==='update_world_setting') return {...operation,preview:[field('世界观名称',before.name,a.name),field('世界观正文',before.content,a.content)]};
    if (name==='set_schedule') return {...operation,preview:[field(`${a.date} 的日程安排`,scheduleText(before.days.find(d=>d.character_id===a.character_id && d.schedule_date===a.date)?.schedule_json),`${a.start_time}–${a.end_time} ${a.activity} · ${a.location}\n${a.description}`)]};
    if (name==='create_world_event') return {...operation,preview:[field('将结束的旧事件',before.fact,'结束'),field('新的世界事实','',a.fact)]};
    if (name==='collect_item') return {...operation,preview:[field(before.name,'待收下','收入背包')]};
    if (name==='use_item') return {...operation,preview:[field('道具',before.item.name,'使用后消耗'),field('作用对象','',before.character.display_name),field('效果说明','',before.item.description)]};
    if (name==='wake_character') return {...operation,preview:[field('叫醒对象','',before.display_name),field('电话叫醒',`已尝试 ${before.wake_attempts||0} 次`,'按现有成功率尝试叫醒，消耗一次机会，不保证成功')]};
    if (name==='inject_character_state') return {...operation,preview:[field('作用对象','',before.character.display_name),field('新的状态或外观','',`${a.name}：${a.description}\n持续 ${a.hours||24} 小时`),...(a.kind==='transform'?[field('生效形态',before.outfits.filter(o=>o.enabled).map(o=>o.name).join('、'),`${a.name}（原形态暂时停用）`)]:[])]};
    if (name==='set_media_favorite') return {...operation,preview:[field('收藏状态',before.favorited_at!=null?'已收藏':'未收藏',a.favorite?'收藏':'取消收藏')]};
    if (name==='set_outfit_enabled') {
      const target=before.outfits.find(o=>o.id===a.outfit_id);
      if (!target) throw new Error('目标外观不属于这位角色');
      return {...operation,preview:[field(target.name,target.enabled?'启用':'停用',a.enabled?'启用':'停用'),...(a.enabled?[field('其他启用形态',before.outfits.filter(o=>o.enabled&&o.id!==a.outfit_id).map(o=>o.name).join('、'),'停用')]:[])]};
    }
    if (name==='set_emoji_set_enabled') return {...operation,preview:[field(before.name,before.is_active?'启用':'停用',a.enabled?'启用':'停用')]};
    return operation;
  }
  return {needsConfirmation,snapshot,prepare};
}
