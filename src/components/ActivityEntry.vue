<script setup lang="ts">
import { ref } from 'vue'
import { gaps, nFiles, score } from '../utils/activity'
import type { ActivityRecord } from '../types'

defineProps<{
  activity: ActivityRecord
  planName: (id: string) => string
}>()
defineEmits<{ duplicate: [] }>()

const root = ref<HTMLElement | null>(null)
</script>

<template>
  <div ref="root" class="entry" role="button" tabindex="0" @keydown.enter="root?.click()">
    <span class="date mono">{{ activity.date || '未定日期' }}</span>
    <span>
      <span class="name">{{ activity.name }}</span>
      <span class="meta">{{ activity.place || '—' }}　·　{{ activity.owner || '未指定負責人' }}　·　檔案 {{ nFiles(activity) }} 件</span>
    </span>
    <span class="plans">
      <template v-if="activity.plans.length">
        <span v-for="pid in activity.plans" :key="pid" class="tag">{{ planName(pid) }}</span>
      </template>
      <span v-else class="tag">未歸計畫</span>
    </span>
    <div class="dial">
      <div class="bars">
        <i v-for="i in 5" :key="i" :class="i - 1 < 5 - gaps(activity).length ? 'on' : 'gap'"></i>
      </div>
      <span class="pct mono">{{ score(activity) }}%</span>
    </div>
    <button class="btn ghost sm dup" @click.stop="$emit('duplicate')">複製此活動</button>
  </div>
</template>
