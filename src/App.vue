<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDbStore } from './stores/db'
import ToastStack from './components/ToastStack.vue'
import ConfirmDialogHost from './components/ConfirmDialogHost.vue'

const route = useRoute()
const router = useRouter()
const db = useDbStore()

const navItems: { name: string; label: string }[] = [
  { name: 'dashboard', label: '總覽' },
  { name: 'list', label: '活動列表' },
  { name: 'plans', label: '計畫' },
  { name: 'export', label: '匯出成果' },
]

const mobileNavOpen = ref(false)
watch(() => route.name, () => {
  mobileNavOpen.value = false
})

function selectNav(name: string) {
  router.push({ name })
}

onMounted(() => {
  db.fetchAll()
})
</script>

<template>
  <div class="shell">
    <aside :class="{ open: mobileNavOpen }">
      <div class="aside-head">
        <div class="brand">活動紀錄平台<small>ACTIVITY RECORDS</small></div>
        <button
          class="nav-toggle"
          type="button"
          :aria-expanded="mobileNavOpen"
          aria-label="開啟選單"
          @click="mobileNavOpen = !mobileNavOpen"
        >
          <span></span><span></span><span></span>
        </button>
      </div>
      <nav>
        <button
          v-for="item in navItems"
          :key="item.name"
          :aria-current="route.name === item.name"
          @click="selectNav(item.name)"
        >{{ item.label }}</button>
      </nav>
    </aside>
    <main>
      <p v-if="db.error" class="flagbox">
        <b>連線失敗</b>　{{ db.error }}（請確認 .env 內的 VITE_PARSE_APP_ID / VITE_PARSE_JS_KEY / VITE_PARSE_SERVER_URL）
      </p>
      <router-view />
    </main>
    <ToastStack />
    <ConfirmDialogHost />
  </div>
</template>
