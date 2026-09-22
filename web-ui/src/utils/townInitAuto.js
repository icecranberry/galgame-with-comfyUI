/**
 * 小镇初始化向导「自动推进」的状态机。
 *
 * 纯函数：只根据当前步骤与各项就绪情况，判断下一步该做什么动作；
 * 组件负责执行动作、等待、循环。把判定逻辑独立出来，方便单测逐步覆盖。
 *
 * 与手动流程一一对应：
 *   config   生成蓝图
 *   groundList / buildingList  确认清单并生成提示词（清单没变则直接进生成步）
 *   tiles / buildings  补齐素材  进下一步
 *   npcs  建人格卡  出全员素材  进「我」
 *   player  生成「我」的形象  规划小镇
 *   town  等布局  确认开镇
 *   done  结束
 */
export const AUTO_ACTION = Object.freeze({
  WAIT: 'wait',
  SYNC: 'sync',
  START: 'start',
  LIST_PROMPTS: 'listPrompts',
  NEXT_FROM_LIST: 'nextFromList',
  GENERATE_ASSETS: 'generateAssets',
  NEXT_STEP: 'nextStep',
  COMMIT_NPCS: 'commitNpcs',
  GEN_NPC_ASSETS: 'genNpcAssets',
  GEN_PLAYER: 'genPlayer',
  PLAN_TOWN: 'planTown',
  CONFIRM: 'confirm',
  DONE: 'done',
  STOP: 'stop',
});

/**
 * @param {object} state
 * @param {string} state.step 当前向导步骤
 * @param {string} state.status 后端 job 状态
 * @param {boolean} state.addingTown 是否「再建一座」（沿用旧完成态，需重新生成蓝图）
 * @param {boolean} state.hasBlueprint 蓝图是否已就绪
 * @param {boolean} state.listCanSkip 清单未变、提示词已就绪，可跳过 LLM
 * @param {number} state.stepReady 当前素材步已就绪数量
 * @param {number} state.stepTotal 当前素材步总数
 * @param {number} state.npcCount 居民总数
 * @param {number} state.personaReady 已生成人格卡的居民数
 * @param {number} state.portraitReady 已有立绘的居民数
 * @param {boolean} state.playerReady 「我」的三张素材是否齐全
 * @param {string} state.error 最近一次失败信息
 * @returns {{ action: string, reason?: string }}
 */
export function resolveAutoAction(state = {}) {
  const {
    step = '',
    status = '',
    addingTown = false,
    hasBlueprint = false,
    listCanSkip = false,
    stepReady = 0,
    stepTotal = 0,
    npcCount = 0,
    personaReady = 0,
    portraitReady = 0,
    playerReady = false,
    error = '',
  } = state;

  if (step === 'done') return { action: AUTO_ACTION.DONE };
  if (error) return { action: AUTO_ACTION.STOP, reason: error };

  if (step === 'config') {
    if (status === 'failed') return { action: AUTO_ACTION.STOP, reason: '蓝图生成失败' };
    if (status === 'blueprint') return { action: AUTO_ACTION.WAIT };
    // 已有蓝图但还没切到下一步：同步表单即可（syncBpForm 会接管跳步）
    if (!addingTown && hasBlueprint && status !== 'idle') {
      return { action: AUTO_ACTION.SYNC };
    }
    return { action: AUTO_ACTION.START };
  }

  if (step === 'working') {
    if (status === 'failed') return { action: AUTO_ACTION.STOP, reason: '蓝图生成失败' };
    if (hasBlueprint && status !== 'idle' && status !== 'blueprint') return { action: AUTO_ACTION.SYNC };
    return { action: AUTO_ACTION.WAIT };
  }

  if (step === 'groundList' || step === 'buildingList') {
    return { action: listCanSkip ? AUTO_ACTION.NEXT_FROM_LIST : AUTO_ACTION.LIST_PROMPTS };
  }

  if (step === 'tiles' || step === 'buildings') {
    return { action: stepReady < stepTotal ? AUTO_ACTION.GENERATE_ASSETS : AUTO_ACTION.NEXT_STEP };
  }

  if (step === 'npcs') {
    if (npcCount === 0) return { action: AUTO_ACTION.STOP, reason: '还没有居民名单，请先重新生成名单' };
    if (personaReady < npcCount) return { action: AUTO_ACTION.COMMIT_NPCS };
    if (portraitReady < npcCount) return { action: AUTO_ACTION.GEN_NPC_ASSETS };
    return { action: AUTO_ACTION.NEXT_STEP };
  }

  if (step === 'player') {
    return { action: playerReady ? AUTO_ACTION.PLAN_TOWN : AUTO_ACTION.GEN_PLAYER };
  }

  if (step === 'town') {
    if (status === 'confirm') return { action: AUTO_ACTION.CONFIRM };
    if (status === 'done') return { action: AUTO_ACTION.DONE };
    if (status === 'failed') return { action: AUTO_ACTION.STOP, reason: '布图失败' };
    return { action: AUTO_ACTION.PLAN_TOWN };
  }

  // 未知步骤（例如断点恢复中的 working）先等等看
  return { action: AUTO_ACTION.WAIT };
}