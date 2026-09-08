import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import Database from 'better-sqlite3';
import { centralPersonaFixture } from './fixtures/townAppearanceFixture.js';

// Actual central module, only its DB-facing import injected. Expectations below are fixed
// editorial fixtures, never produced by the extractor/injector under test.
const source = readFileSync(new URL('../src/services/characterPersona.js', import.meta.url), 'utf8')
  .replace(/import \{ getActiveOutfits \} from '[^']+';/, '').replace(/export function /g, 'function ');
function fixture(getActiveOutfits = () => ({ limited: [], exclusive: null })) {
  return compileFunction(`${source}\nreturn {extractAppearanceSection,buildOutfitInjectionBlocks,injectOutfitsIntoAppearance,buildCharacterPersona,buildCharacterAppearanceSection,buildImageCrossRefInfo};`, ['getActiveOutfits'])(getActiveOutfits);
}
const character = { id: 7, display_name: '阿岚', short_prompt: '  阿岚会陪你读书。  ',
  base_prompt: '你是阿岚，来自山城。你爱读书。\n\n## 性格\n你很安静。\n\n## 你的外观\n你有黑发，穿灰衣。  \n' };
const limited = { limited: [{ name: '雨衣', description: '蓝发，黄色雨衣' }], exclusive: null };
const exclusive = { limited: [], exclusive: { name: '夜巡', description: '银发，黑色披风' } };
// Full fixed outputs lock all priority prose, punctuation, whitespace and ordering.
const limitedGolden = `## 你的外观
【限时服饰（当前生效，优先级最高，多套同时叠加）——画面必须完整呈现以下全部要素】
1. 雨衣：蓝发，黄色雨衣

【基础外观（仅用于填补限时服饰未提及的部位，与限时服饰冲突的描述无效）】
黑发，灰衣。

【着装裁定（优先级：限时服饰 > 基础外观，逐条执行）】
- 限时服饰描写到的每个部位（发型、发色、服装、饰品、鞋袜等），其全部属性（颜色、长度、款式、材质）必须完全按限时服饰描绘——这是对基础外观对应部位的整体替换，不是叠加。
- 基础外观中与上述特殊外观同部位或相冲突的描述一律作废，禁止出现在画面与提示词中；尤其当特殊外观改变了发型或发色时，基础外观的原发型、原发色必须完全消失，不得再出现。
- 只有特殊外观完全未提及的部位（瞳色、五官、体型等）才沿用基础外观。`;
const exclusiveGolden = `## 你的外观
【角色专属形态（当前生效，优先级最高）——画面必须完整呈现以下全部要素】
1. 夜巡：银发，黑色披风

【基础外观（仅用于填补角色专属形态未提及的部位，与角色专属形态冲突的描述无效）】
黑发，灰衣。

【着装裁定（优先级：角色专属形态 > 基础外观，逐条执行）】
- 角色专属形态描写到的每个部位（发型、发色、服装、饰品、鞋袜等），其全部属性（颜色、长度、款式、材质）必须完全按角色专属形态描绘——这是对基础外观对应部位的整体替换，不是叠加。
- 基础外观中与上述特殊外观同部位或相冲突的描述一律作废，禁止出现在画面与提示词中；尤其当特殊外观改变了发型或发色时，基础外观的原发型、原发色必须完全消失，不得再出现。
- 只有特殊外观完全未提及的部位（瞳色、五官、体型等）才沿用基础外观。`;
const bothGolden = `## 你的外观
【限时服饰（当前生效，优先级最高，多套同时叠加）——画面必须完整呈现以下全部要素】
1. 雨衣：蓝发，黄色雨衣
2. 围巾：红色围巾

【角色专属形态（当前生效，优先级次之）——画面必须完整呈现以下全部要素】
1. 夜巡：银发，黑色披风

【基础外观（仅用于填补限时服饰与角色专属形态未提及的部位，与限时服饰与角色专属形态冲突的描述无效）】
黑发，灰衣。

【着装裁定（优先级：限时服饰 > 角色专属形态 > 基础外观，逐条执行）】
- 限时服饰与角色专属形态描写到的每个部位（发型、发色、服装、饰品、鞋袜等），其全部属性（颜色、长度、款式、材质）按上述优先级取最高者的描写，必须完全照此描绘——这是对基础外观对应部位的整体替换，不是叠加。
- 基础外观中与上述特殊外观同部位或相冲突的描述一律作废，禁止出现在画面与提示词中；尤其当特殊外观改变了发型或发色时，基础外观的原发型、原发色必须完全消失，不得再出现。
- 只有特殊外观完全未提及的部位（瞳色、五官、体型等）才沿用基础外观。`;

test('no active outfits: short/full preserve historical fixed bytes including whitespace', () => {
  const f=fixture();
  assert.equal(f.buildCharacterPersona(character),'阿岚会陪你读书。\n## 你的外观\n你有黑发，穿灰衣。');
  assert.equal(f.buildCharacterPersona(character,{variant:'full'}),'你是阿岚，来自山城。你爱读书。\n\n## 性格\n你很安静。\n\n## 你的外观\n你有黑发，穿灰衣。  \n');
  assert.equal(f.buildCharacterPersona({base_prompt:'  你只是一位读者。  \r\n'},{outfits:null}),'你只是一位读者。');
  assert.equal(f.buildCharacterPersona({base_prompt:'  你只是一位读者。  \r\n'},{variant:'full',outfits:null}),'  你只是一位读者。  \r\n');
  assert.equal(f.buildCharacterPersona({short_prompt:'  简介  '},{variant:'full',outfits:null}),'  简介  ');
  assert.equal(f.buildCharacterPersona(null,{outfits:null}),'');
});

test('person substitution respects short identity boundary, full card and explicit joiner', () => {
  const f=fixture();
  assert.equal(f.buildCharacterPersona(character,{person:'阿岚',joiner:'\n---\n',outfits:null}),
    '阿岚会陪你读书。\n---\n## 阿岚的外观\n阿岚有黑发，穿灰衣。');
  assert.equal(f.buildCharacterPersona(character,{variant:'full',person:'角色',outfits:null}),
    '角色是阿岚，来自山城。角色爱读书。\n\n## 性格\n角色很安静。\n\n## 角色的外观\n角色有黑发，穿灰衣。  \n');
});

test('pure appearance and cross-reference have fixed identity/trailing section behavior', () => {
  const f=fixture();
  assert.equal(f.extractAppearanceSection(character.base_prompt),'## 你的外观\n你有黑发，穿灰衣。  \n');
  assert.equal(f.buildCharacterAppearanceSection(character,{outfits:null}),'## 你的外观\n你有黑发，穿灰衣。  \n');
  assert.equal(f.buildImageCrossRefInfo(character,{outfits:null}),'阿岚，来自山城\n## 阿岚的外观\n阿岚有黑发，穿灰衣。  \n');
  assert.equal(f.buildImageCrossRefInfo({base_prompt:'你是路人。'},{outfits:null}),'路人');
  assert.equal(f.buildCharacterAppearanceSection({base_prompt:'没有外观段'},{outfits:null}),'');
});

for (const [name,outfits,expected] of [
  ['limited only',limited,limitedGolden], ['exclusive only',exclusive,exclusiveGolden],
  ['both priorities and multiple limited layers',{limited:[...limited.limited,{name:'围巾',description:'红色围巾'}],exclusive:exclusive.exclusive},bothGolden],
]) test(`golden complete outfit injection: ${name}`, () => {
  const f=fixture(()=>assert.fail('explicit outfits must not query'));
  const c={base_prompt:'人格原文\n\n## 你的外观\n黑发，灰衣。',short_prompt:'简介'};
  assert.equal(f.buildCharacterAppearanceSection(c,{outfits}),expected);
  assert.equal(f.buildCharacterPersona(c,{outfits}),'简介\n'+expected);
  assert.equal(f.buildCharacterPersona(c,{variant:'full',outfits}),'人格原文\n\n'+expected);
  assert.equal(f.buildImageCrossRefInfo(c,{outfits}),'人格原文\n'+expected);
});

test('explicit null/empty outfits bypass lookup; automatic lookup uses character id, not alias fields', () => {
  const calls=[], f=fixture(id=>{calls.push(id);return limited;});
  const c={id:7,char_id:99,npcId:88,base_prompt:'## 你的外观\n黑发，灰衣。',short_prompt:'简介'};
  assert.equal(f.buildCharacterAppearanceSection(c),limitedGolden);assert.deepEqual(calls,[7]);
  calls.length=0;
  assert.equal(f.buildCharacterPersona(c,{outfits:null}),'简介\n## 你的外观\n黑发，灰衣。');
  assert.equal(f.buildCharacterPersona(c,{outfits:{limited:[],exclusive:null}}),'简介\n## 你的外观\n黑发，灰衣。');
  assert.deepEqual(calls,[]);
  assert.equal(f.buildCharacterAppearanceSection(c,{outfits:limited.limited}),limitedGolden);
  assert.deepEqual(calls,[]);
});

test('no appearance anchor retains documented short fallback and pure injector supplies a heading', () => {
  const f=fixture();
  assert.equal(f.buildCharacterPersona({base_prompt:'  只有整卡  '},{outfits:limited}),'只有整卡');
  const blocks={lead:'固定服装清单',baseLabel:'固定基础标签',tail:'固定裁定'};
  assert.equal(f.injectOutfitsIntoAppearance('',blocks),'## 你的外观\n固定服装清单\n\n固定裁定');
  assert.equal(f.injectOutfitsIntoAppearance('## 你的外观\n',blocks),'## 你的外观\n固定服装清单\n\n固定裁定');
  assert.equal(f.injectOutfitsIntoAppearance(' 原文\r\n ',null),' 原文\r\n ');
  assert.equal(f.buildOutfitInjectionBlocks({limited:[],exclusive:null}),null);
});

test('real outfit reader on query_only fixture DB selects correct id and honors explicit null', t => {
  const db=new Database(':memory:');t.after(()=>db.close());
  const f=centralPersonaFixture(db);
  db.prepare('INSERT INTO global_outfits VALUES(1,?,?,1,7,NULL)').run('雨衣','蓝发，黄色雨衣');
  db.prepare('INSERT INTO global_outfits VALUES(2,?,?,1,99,NULL)').run('其他角色','不可注入');
  db.pragma('query_only=ON');
  assert.equal(f.buildCharacterAppearanceSection({id:7,base_prompt:'## 你的外观\n黑发，灰衣。'}),limitedGolden);
  assert.equal(f.buildCharacterAppearanceSection({id:8,base_prompt:'## 你的外观\n黑发，灰衣。'}),'## 你的外观\n黑发，灰衣。');
  assert.equal(f.buildCharacterAppearanceSection({id:7,base_prompt:'## 你的外观\n黑发，灰衣。'},{outfits:null}),'## 你的外观\n黑发，灰衣。');
});
