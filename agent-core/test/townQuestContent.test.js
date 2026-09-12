import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questTemplateList } from '../src/services/town/townQuestDefinitions.js';
import { VENUE_KINDS, VENUE_SERVICE_KEYS, venueProductTemplates, venueRegularProfile, CAFE_REGULAR_PROFILE } from '../src/services/town/townVenuePlaybooks.js';

/** 内容校验：模板引用的服务键、地点、道具、熟客档位必须真实存在。
 * 内容只改 townQuestDefinitions.js 就能生效，这里守住"声明引用的东西不存在"这类静默坏档。 */

const KNOWN_SERVICE_KEYS = new Set([...VENUE_SERVICE_KEYS, 'town.cafe.drink_coffee', 'town.cafe.work_shift', 'town.workshop']);
const KNOWN_LOCATIONS = new Set(['board', 'supplier', 'workshop', 'cafe',
  ...Object.values(VENUE_KINDS).map(kind => kind.businessKey)]);
const KNOWN_ITEMS = new Map(venueProductTemplates().map(item => [item.templateId, item]));
KNOWN_ITEMS.set('town.mood_patch', { templateId: 'town.mood_patch', templateVersion: 1, effectKey: 'mood_fix' });
KNOWN_ITEMS.set('town.energy_charm', { templateId: 'town.energy_charm', templateVersion: 1, effectKey: 'energy' });
const KNOWN_BUSINESS = new Set([...Object.values(VENUE_KINDS).map(kind => kind.businessKey), 'cafe']);

test('every quest template references real services, locations, items and payers', () => {
  for (const template of questTemplateList()) {
    for (const step of template.steps) {
      if (step.type === 'service') {
        assert.ok(KNOWN_SERVICE_KEYS.has(step.serviceKey), `${template.id} 引用了未注册的服务 ${step.serviceKey}`);
      }
      if (step.locationKey) {
        assert.ok(KNOWN_LOCATIONS.has(step.locationKey), `${template.id} 引用了未知地点 ${step.locationKey}`);
      }
      if (step.type === 'deliver') {
        assert.ok(KNOWN_ITEMS.has(step.templateId), `${template.id} 要交付未发布的道具 ${step.templateId}`);
        assert.equal(step.templateVersion, KNOWN_ITEMS.get(step.templateId).templateVersion);
      }
    }
    for (const item of template.rewards.items) {
      assert.ok(KNOWN_ITEMS.has(item.templateId), `${template.id} 奖励了未发布的道具 ${item.templateId}`);
      assert.equal(item.templateVersion, KNOWN_ITEMS.get(item.templateId).templateVersion);
    }
    if (template.payer.type === 'venue') {
      assert.ok(KNOWN_BUSINESS.has(template.payer.businessKey), `${template.id} 的发布方不是已知店铺`);
    }
    if (template.trigger.type === 'venue') {
      assert.ok(KNOWN_BUSINESS.has(template.trigger.key), `${template.id} 的触发店不是已知店铺`);
    }
  }
});

test('regular-tier gated quests point at a real venue tier ladder', () => {
  for (const template of questTemplateList()) {
    if (template.minRegularTier == null) continue;
    assert.equal(template.trigger.type, 'venue', `${template.id} 的熟客门槛只应挂在店铺触发上`);
    const profile = venueRegularProfile(template.trigger.key);
    assert.ok(profile, `${template.id} 的店铺没有熟客档案`);
    assert.ok(template.minRegularTier >= 1 && template.minRegularTier <= profile.tiers.length,
      `${template.id} 的熟客档位越界`);
  }
});

test('content stays inside the town economy envelope', () => {
  for (const template of questTemplateList()) {
    assert.ok(template.rewards.coins <= 30, `${template.id} 赏钱超出单次服务定价带（30）`);
    assert.ok(template.rewards.coins >= 0);
    assert.ok(template.steps.length <= 4, `${template.id} 步骤过多`);
    if (template.trigger.type === 'venue' && template.trigger.key === 'cafe' && template.payer.type === 'venue') {
      assert.ok(CAFE_REGULAR_PROFILE.businessKey === 'cafe');
    }
  }
  // 每座功能建筑至少有一条本地奇遇，公告站与 NPC 线至少各一条
  for (const kind of Object.keys(VENUE_KINDS)) {
    assert.ok(questTemplateList().some(template => template.trigger.type === 'venue' && template.trigger.key === kind
      && template.minRegularTier == null), `${kind} 缺少无门槛本地奇遇`);
  }
  assert.ok(questTemplateList().some(template => template.trigger.type === 'board'));
  assert.ok(questTemplateList().filter(template => template.trigger.type === 'npc').length >= 4);
});
