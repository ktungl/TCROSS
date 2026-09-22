<script setup lang="ts">
import { ref } from 'vue'
import { onClickOutside } from '../composables/useClickOutside'

const props = defineProps<{
  modelValue: string[]
  options: { id: string; label: string }[]
  placeholder: string
}>()
const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
onClickOutside(root, () => (open.value = false))

function toggle(id: string, checked: boolean) {
  emit(
    'update:modelValue',
    checked ? [...props.modelValue, id] : props.modelValue.filter((v) => v !== id),
  )
}

function summary(): string {
  if (!props.modelValue.length) return props.placeholder
  const labels = props.options.filter((o) => props.modelValue.includes(o.id)).map((o) => o.label)
  return labels.join('、')
}
</script>

<template>
  <div class="msel" ref="root">
    <button type="button" class="msel-btn" :class="{ empty: !modelValue.length }" @click="open = !open">
      <span class="msel-summary">{{ summary() }}</span>
      <span class="msel-caret">▾</span>
    </button>
    <div v-if="open" class="msel-panel">
      <label v-for="o in options" :key="o.id" class="chk" style="padding:6px 10px">
        <input
          type="checkbox"
          :checked="modelValue.includes(o.id)"
          @change="toggle(o.id, ($event.target as HTMLInputElement).checked)"
        >{{ o.label }}
      </label>
      <span v-if="!options.length" class="empty" style="padding:6px 10px">沒有選項</span>
    </div>
  </div>
</template>

<style scoped>
.msel{position:relative}
.msel-btn{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;
  width:100%;text-align:left;cursor:pointer;font-family:inherit;font-size:14px;color:var(--ink);
  background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:9px 11px}
.msel-btn.empty{color:var(--ink-faint)}
.msel-summary{min-width:0;white-space:normal;word-break:break-word;line-height:1.5}
.msel-caret{color:var(--ink-soft);flex-shrink:0;padding-top:1px}
.msel-panel{position:absolute;z-index:20;top:calc(100% + 4px);left:0;right:0;
  max-height:220px;overflow:auto;background:var(--card);border:1px solid var(--line);
  border-radius:var(--r);box-shadow:0 6px 18px rgba(62,44,23,.15)}
.msel-panel .chk{cursor:pointer}
.msel-panel .chk:hover{background:var(--line-soft)}
</style>
