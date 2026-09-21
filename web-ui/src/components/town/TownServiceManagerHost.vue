<template>
  <TownServiceManager :open="serviceManagerOpen" :world-id="serviceManagerWorldId" @close="closeServiceManager" />
</template>

<script setup>
// 极小的宿主：只读全局开关、只渲染服务管理面板，切换时不会连累大组件重渲染。
import TownServiceManager from './TownServiceManager.vue'
import { serviceManagerOpen, serviceManagerWorldId, closeServiceManager } from '../../town/serviceManagerState.js'
</script>
