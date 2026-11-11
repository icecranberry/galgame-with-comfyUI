<template>
  <textarea v-if="type === 'textarea'" ref="control" v-bind="$attrs" class="studio-input studio-input--area" :value="modelValue" :rows="rows" :disabled="disabled" :readonly="readonly" @input="update" @compositionstart="composing = true" @compositionend="endComposition" />
  <input v-else ref="control" v-bind="$attrs" class="studio-input" :type="type" :value="modelValue" :disabled="disabled" :readonly="readonly" @input="update" @compositionstart="composing = true" @compositionend="endComposition" />
</template>

<script setup>
import { ref } from 'vue'
defineOptions({ inheritAttrs: false })
defineProps({ modelValue: { type: [String, Number], default: '' }, type: { type: String, default: 'text' }, rows: { type: [Number, String], default: 3 }, disabled: Boolean, readonly: Boolean })
const emit = defineEmits(['update:modelValue'])
const control = ref(null)
let composing = false
function update(event) { if (!composing) emit('update:modelValue', event.target.value) }
function endComposition(event) { composing = false; update(event) }
defineExpose({ focus: () => control.value?.focus(), blur: () => control.value?.blur(), select: () => control.value?.select() })
</script>

<style scoped>
.studio-input{display:block;box-sizing:border-box;width:100%;min-width:0;min-height:44px;margin:0;padding:11px 13px;border:1px solid var(--studio-ink);border-bottom-width:3px;border-radius:0;background:url('../../assets/studio-photocopy.svg'),var(--studio-paper);color:var(--studio-ink);font:inherit;font-size:13px;line-height:1.6;box-shadow:none;outline:none;transition:border-color .3s,background-color .3s,box-shadow .3s;color-scheme:light}
.studio-input::placeholder{color:var(--studio-muted);opacity:1}.studio-input:hover:not(:disabled){border-color:var(--studio-tag)}.studio-input:focus{border-color:var(--studio-tag);box-shadow:inset 3px 0 0 var(--studio-tag);background-color:var(--studio-paper)}.studio-input--area{resize:vertical;min-height:96px;line-height:1.85}.studio-input:read-only{background-color:var(--studio-bg);border-style:dashed;border-bottom-width:1px}.studio-input:disabled{opacity:.5;cursor:not-allowed}
:global([data-theme="dark"]) .studio-input{color-scheme:dark}
@media(max-width:600px){.studio-input{font-size:16px}}
@media(prefers-reduced-motion:reduce){.studio-input{transition:none}}
</style>
