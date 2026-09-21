/**
 * 服务管理面板的全局开关。
 *
 * 按钮在 1483 行的 TownAdminPanel 里，面板却挂在 TownView 顶层：
 *   - 状态放模块级 ref，按钮只「写」不「读」，所以切换时 TownAdminPanel 不会重渲染；
 *   - 面板由极小的 TownServiceManagerHost 承载，只有它跟着重渲染；
 *   - 宿主不在任何 <Teleport> 里，面板的 Teleport 不再是嵌套 Teleport。
 * 这样打开/关闭只动一个很小的组件，不再连累整棵管理面板。
 */
import { ref } from 'vue'

export const serviceManagerOpen = ref(false)
export const serviceManagerWorldId = ref('')

export function openServiceManager(worldId = '') {
  serviceManagerWorldId.value = worldId || ''
  serviceManagerOpen.value = true
}

export function closeServiceManager() {
  serviceManagerOpen.value = false
}
