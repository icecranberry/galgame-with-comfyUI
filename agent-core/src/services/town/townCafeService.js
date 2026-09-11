import { createTownVenueService, assertFrozenTemplate } from './townVenueService.js';
import { VENUE_PLAYBOOKS } from './townVenuePlaybooks.js';
import { townError } from './townEventService.js';

// Keep the legacy persisted template byte shape and values unchanged.
export const CAFE_SERVICE = Object.freeze({ key: 'town.cafe.drink_coffee', version: 1, price: 18,
  materialQuantity: 1, outcomeKey: 'coffee_served', maxTurns: 4,
  idleMs: 5 * 60000, maxDurationMs: 20 * 60000, offerMs: 5 * 60000, leaseMs: 15000 });
export const CAFE_WORK_SERVICE = Object.freeze({ key: 'town.cafe.work_shift', version: 1, wage: 24,
  materialQuantity: 1, outcomeKey: 'cafe_shift_done', maxTurns: 4,
  idleMs: 5 * 60000, maxDurationMs: 20 * 60000, offerMs: 5 * 60000, leaseMs: 15000 });

const CAFE_TEMPLATES = Object.freeze([CAFE_WORK_SERVICE, CAFE_SERVICE]);
const resolveCafeTemplate = template => {
  const frozen = CAFE_TEMPLATES.find(value => value.key === template?.key);
  if (!frozen) throw townError('INVALID_SERVICE_DEFINITION');
  assertFrozenTemplate(template, frozen);
  return frozen;
};
/** 咖啡馆只是通用功能建筑引擎的冻结实例：玩法阶段、托管与退款语义由 playbook 提供，
 * 价格、文案与模板字节保持 2026-09-09 的旧口径，不改动已存档会话与回执。 */
const cafeDefinition = template => {
  const frozen = resolveCafeTemplate(template);
  const work = frozen.key === CAFE_WORK_SERVICE.key;
  return { template: frozen, playbook: work ? VENUE_PLAYBOOKS.cafe_shift : VENUE_PLAYBOOKS.cafe_drink,
    payer: work ? 'venue' : 'player', product: null, businessKey: 'cafe',
    commandPrefix: 'cafe', reasonCode: 'CAFE_SERVICE_OUTCOME', completeReason: 'SERVED',
    freezeText: '本次咖啡服务已进入结算。',
    lines: { name: work ? '咖啡馆打工 · 临时代班' : '镇咖啡馆手冲咖啡',
      description: work ? '到店完成点单、备料、冲煮等固定小任务，按班次领取工资。'
        : '用 1 份咖啡豆做一杯手冲咖啡，服务完成后正式结算。',
      offered: () => work
        ? `临时代班工资 ${frozen.wage} 邻币；确认后咖啡馆会把工资托管，完成后付给你，取消全退。`
        : `手冲咖啡收费${frozen.price}邻币；确认前取消全退，服务完成后退还托管中的全额费用。`,
      active: phase => work ? '开工了：先备料，再冲煮一杯练习咖啡，完成后领工资。'
        : phase === 'menu' ? '先选一杯今天的咖啡吧。' : '材料已经备好，确认后开始冲煮。' },
    catalog: work
      ? { serviceKey: frozen.key, name: '打工 · 临时代班', description: '到店完成一班固定小任务，工资由咖啡馆托管。',
        price: 0, wage: frozen.wage, available: true, reason: null }
      : { serviceKey: frozen.key, name: '手冲咖啡', description: '用 1 份咖啡豆做一杯手冲咖啡。',
        price: frozen.price, wage: 0, available: true, reason: null } };
};

export function createTownCafeService(dependencies) {
  const { getCafe } = dependencies;
  if (typeof getCafe !== 'function') throw townError('MISSING_DEPENDENCY');
  return createTownVenueService({ ...dependencies,
    defaultServiceKey: CAFE_SERVICE.key, defaultBusinessKey: 'cafe',
    resolveDefinition: cafeDefinition,
    resolveServiceKey: serviceKey => cafeDefinition(CAFE_TEMPLATES.find(value => value.key === serviceKey)
      || (() => { throw townError('INVALID_SERVICE_KEY'); })()),
    getVenue: scope => {
      const supplied = getCafe(scope);
      return { ...supplied, businessKey: 'cafe',
        services: [CAFE_WORK_SERVICE.key, CAFE_SERVICE.key] };
    } });
}
