import { townError } from './townEventService.js';

// Keep the legacy persisted template byte shape and values unchanged.
export const WORKSHOP_SERVICE = Object.freeze({ key: 'town.workshop', version: 1, price: 30, processingFee: 10,
  materialQuantity: 1, maxTurns: 8, idleMs: 5 * 60000, maxDurationMs: 20 * 60000,
  offerMs: 5 * 60000, leaseMs: 15000, templateId: 'town.mood_patch', templateVersion: 1 });
const moodLines = Object.freeze({ theme: '先选一个你喜欢的主题吧。', materials: '材料已经预留，确认后就开始制作。',
  crafting: '材料已投入制作，我们一起完成这枚心情修复贴。', delivery: '制作已完成，可以收下心情修复贴了。' });
const bobTemplate = Object.freeze({ ...WORKSHOP_SERVICE, key: 'town.workshop.bob_cut',
  templateId: 'town.bob_cut', outcomeKey: 'bob_cut' });
export const TOWN_SERVICE_DEFINITIONS = Object.freeze([
  Object.freeze({ serviceKey: WORKSHOP_SERVICE.key, name: '心情修复贴制作',
    description: '完成制作后获得一枚心情修复贴，在原背包选择角色使用。',
    outcomeKey: 'mood_patch', template: WORKSHOP_SERVICE, requiresProduction: false, ensureTemplateMethod: 'ensureDefaultTemplates', lines: moodLines }),
  Object.freeze({ serviceKey: bobTemplate.key, name: '波波头发型卡制作',
    description: '完成制作后获得固定波波头发型卡，在原背包选择角色使用，发型持续24小时；不附赠免费回访。',
    outcomeKey: 'bob_cut', template: bobTemplate, requiresProduction: true, ensureTemplateMethod: 'ensureBobCutTemplate',
    lines: Object.freeze({ theme: '本次制作固定波波头发型卡，确认这款发型后继续。',
      materials: moodLines.materials, crafting: '材料已投入制作，一起完成这张波波头发型卡。',
      delivery: '波波头发型卡已制作完成，收下后可在原背包选择角色使用，发型持续24小时。' }) }),
]);
export function getTownServiceDefinition(serviceKey = WORKSHOP_SERVICE.key) {
  const definition = TOWN_SERVICE_DEFINITIONS.find(value => value.serviceKey === serviceKey);
  if (!definition) throw townError('INVALID_SERVICE_KEY');
  return definition;
}
/** Only known frozen service/version pairs authorize outcomes. Old mood snapshots
 * legitimately lack outcomeKey; never patch their stored config or request hash.
 */
export function resolveTownServiceDefinition(config) {
  const template = config?.template;
  const definition = getTownServiceDefinition(template?.key);
  if (!template || Object.entries(definition.template).some(([key, value]) => template[key] !== value)
      || Object.keys(template).some(key => !Object.hasOwn(definition.template, key) && key !== 'outcomeKey')
      || (template.outcomeKey !== undefined && template.outcomeKey !== definition.outcomeKey)) {
    throw townError('INVALID_SERVICE_DEFINITION');
  }
  return definition;
}
