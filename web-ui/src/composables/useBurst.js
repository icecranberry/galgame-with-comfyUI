import { computed, getCurrentInstance, onUnmounted, ref } from 'vue'

/**
 * 一次性「爆心」特效：给元素挂上 animations.css 的 .like-burst
 *（爱心 pop + 粒子环），duration 后自动摘掉。
 *
 * 挂类必须同步完成，不能等一帧再挂：置顶这类操作本身会带动一次列表重排，
 * 而 Vue 在每次更新时都会摘掉正在播放的位移过渡，多补一次渲染就会把过渡打断。
 * 同步置位让「切换状态 + 播特效」落进同一次渲染，两边都不受影响。
 * 代价是同一元素在特效播放中再点一次不会重播，等播完再点照常重播。
 *
 * 用法：
 *   单元素控件  const { bursting, burst } = useBurst()   → :class="{ 'like-burst': bursting }"
 *   列表多实例  const { burstKey, burst } = useBurst()   → :class="{ 'like-burst': burstKey === c.id }"
 */
export function useBurst(duration = 650) {
  // null = 无特效；单元素场景为 true，列表场景为当前播放特效的元素 key
  const burstKey = ref(null)
  const bursting = computed(() => burstKey.value !== null)
  let timer = null

  function burst(key = true) {
    burstKey.value = key
    clearTimeout(timer)
    timer = setTimeout(() => { burstKey.value = null }, duration)
  }

  // 组件外用（单测等）没有实例可挂载生命周期钩子，跳过即可
  if (getCurrentInstance()) onUnmounted(() => clearTimeout(timer))

  return { burstKey, bursting, burst }
}
