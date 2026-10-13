<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDbStore } from '../stores/db'
import { assistClassify } from '../lib/middleware'
import { errorMessage, pushToast } from '../composables/useToast'

const props = defineProps<{ text: string; categories: string[]; plans: string[] }>()
const emit = defineEmits<{ add: [planIds: string[], categories: string[]] }>()

const db = useDbStore()
const loading = ref(false)
const result = ref<{ categories: string[]; planIds: string[]; reason: string } | null>(null)

// 只列出還沒選的建議
const newPlans = computed(() => (result.value?.planIds ?? []).filter((id) => !props.plans.includes(id)))
const newCategories = computed(() => (result.value?.categories ?? []).filter((c) => !props.categories.includes(c)))

async function suggest() {
  if (!props.text.trim()) {
    pushToast('請先填寫活動名稱', 'error')
    return
  }
  loading.value = true
  try {
    result.value = await assistClassify(props.text)
    if (!result.value.categories.length && !result.value.planIds.length) {
      pushToast('AI 找不到適合的分類或計畫', 'error')
    }
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    loading.value = false
  }
}

function add(planIds: string[], categories: string[]) {
  emit('add', planIds, categories)
}
</script>

<template>
  <div class="classify">
    <button class="btn ghost sm" type="button" :disabled="loading" @click="suggest">
      {{ loading ? '推薦中…' : 'AI 推薦計畫與分類' }}
    </button>
    <template v-if="result && (newPlans.length || newCategories.length)">
      <span class="hint">點選加入：</span>
      <button v-for="id in newPlans" :key="id" class="chip" type="button" @click="add([id], [])">＋計畫：{{ db.planName(id) }}</button>
      <button v-for="c in newCategories" :key="c" class="chip" type="button" @click="add([], [c])">＋分類：{{ c }}</button>
      <button class="btn ghost sm" type="button" @click="add(newPlans, newCategories)">全部加入</button>
      <p v-if="result.reason" class="hint">{{ result.reason }}</p>
    </template>
  </div>
</template>

<style scoped>
.classify{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px}
.classify .hint{width:auto}
.chip{border:1px solid var(--gold-400);background:var(--gold-100);border-radius:999px;padding:3px 10px;font:inherit;font-size:12.5px;cursor:pointer;color:inherit}
.chip:hover{background:var(--gold-400)}
</style>
