<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDbStore } from './stores/db'

const route = useRoute()
const router = useRouter()
const db = useDbStore()

const navItems: { name: string; label: string }[] = [
  { name: 'list', label: '活動列表' },
  { name: 'plans', label: '計畫' },
  { name: 'export', label: '匯出成果' },
]

onMounted(() => {
  db.fetchAll()
})
</script>

<template>
  <div class="shell">
    <aside>
      <div class="brand">活動紀錄平台<small>ACTIVITY RECORDS</small></div>
      <nav>
        <button
          v-for="item in navItems"
          :key="item.name"
          :aria-current="route.name === item.name"
          @click="router.push({ name: item.name })"
        >{{ item.label }}</button>
      </nav>
      <p class="note">資料存放於 Parse Server（Back4App）。檔案上傳需要有效的 Parse 憑證。</p>
    </aside>
    <main>
      <p v-if="db.error" class="flagbox">
        <b>連線失敗</b>　{{ db.error }}（請確認 .env 內的 VITE_PARSE_APP_ID / VITE_PARSE_JS_KEY / VITE_PARSE_SERVER_URL）
      </p>
      <router-view />
    </main>
  </div>
</template>
