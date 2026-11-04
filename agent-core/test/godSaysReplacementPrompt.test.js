import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplacementRequest, validateReplacement } from '../src/services/godSays/replacementPrompt.js';
import { normalizeBook, evaluateBook } from '../src/services/lorebook/engine.js';
import { applyLorebookLayout } from '../src/services/lorebook/layout.js';

const character={id:1,display_name:'阿晴',base_prompt:'人格\n## 你的外观\n黑发、蓝眼。'};
const world='<world_setting>海岛世界。</world_setting>';
test('replacement requests keep common rules before exact persona and stable prefix before materials and instruction',()=>{
  for(const kind of ['appearance','world']) for(const environment of [{},{stageRules:world,worldRule:'世界强化'}]) {
    const input={kind,source:'黑发、蓝眼。',instruction:'改红发',...(kind==='appearance'?{character}:{})};
    const first=buildReplacementRequest(input,environment);
    const next=buildReplacementRequest({...input,source:'不同材料',instruction:'改蓝发'},environment);
    const {index,offset}=first.lorebook.cacheBoundary;
    assert.deepEqual(first.messages.slice(0,index+1),next.messages.slice(0,index+1));
    assert.equal(offset,first.messages[index].content.length);
    assert.equal(first.messages.filter(m=>m.role==='user').length,1);
    assert.equal(first.messages.at(-1).role,'user');
    assert.ok(first.lorebook.staticTexts.every(t=>!t.includes('改红发')));
    assert.deepEqual(first.lorebook.personaTexts,kind==='appearance'?[character.base_prompt]:[]);
  }
});
test('replacement worldbook preserves message roles, finds persona boundaries and keeps conditional lore in dynamic tail',()=>{
  const request=buildReplacementRequest({kind:'appearance',source:'黑发、蓝眼。',instruction:'改红发',character},{stageRules:world});
  const book=normalizeBook({entries:{0:{uid:0,constant:true,position:0,content:'BEFORE_PERSONA'},1:{uid:1,constant:false,key:['改红发'],position:4,depth:0,content:'DYNAMIC_LORE'}}}).document;
  const activation=evaluateBook(book,{}, {history:request.lorebook.history});
  const options={...request.lorebook,worldText:world,cachePlacement:true};
  assert.deepEqual(applyLorebookLayout(request.messages,{entries:[]},options).messages,request.messages);
  const result=applyLorebookLayout(request.messages,activation,options);
  assert.deepEqual(result.messages.map(m=>m.role),request.messages.map(m=>m.role));
  const joined=result.messages.map(m=>m.content).join('\n');
  assert.ok(joined.indexOf('BEFORE_PERSONA')<joined.indexOf(character.base_prompt));
  assert.ok(joined.indexOf('DYNAMIC_LORE')>joined.indexOf('【待修订原文】'));
  assert.ok(result.placements.length>=2);
});
test('replacement validation refuses empty or fenced output and foreign persona chapters',()=>{
  for(const output of ['', '```text\n红发\n```', '## 你的性格\n温柔']) assert.throws(()=>validateReplacement(output,'appearance'));
  assert.equal(validateReplacement('## 地理\n海岛','world'),'## 地理\n海岛');
});
