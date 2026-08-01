<template>
  <Transition
    name="collapse"
    @before-enter="beforeEnter"
    @enter="enter"
    @after-enter="afterEnter"
    @before-leave="beforeLeave"
    @leave="leave"
    @after-leave="afterLeave"
  >
    <slot v-if="show" />
  </Transition>
</template>

<script setup>
defineProps({ show: Boolean })

function beforeEnter(el) {
  el.style.maxHeight = '0'
  el.style.overflow = 'hidden'
  el.style.opacity = '0'
}
function enter(el) {
  el.style.transition = 'max-height .3s cubic-bezier(0.22, 0.61, 0.36, 1), opacity .3s ease'
  el.style.maxHeight = el.scrollHeight ? el.scrollHeight + 'px' : 'none'
  el.style.opacity = '1'
}
function afterEnter(el) {
  el.style.maxHeight = ''
  el.style.overflow = ''
  el.style.opacity = ''
  el.style.transition = ''
}
function beforeLeave(el) {
  el.style.maxHeight = el.scrollHeight + 'px'
  el.style.overflow = 'hidden'
  el.style.opacity = '1'
}
function leave(el) {
  // force reflow so the browser registers the current maxHeight before we change it
  void el.offsetHeight
  el.style.transition = 'max-height .3s cubic-bezier(0.22, 0.61, 0.36, 1), opacity .3s ease'
  el.style.maxHeight = '0'
  el.style.opacity = '0'
}
function afterLeave(el) {
  el.style.maxHeight = ''
  el.style.overflow = ''
  el.style.opacity = ''
  el.style.transition = ''
}
</script>
