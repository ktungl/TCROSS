<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDbStore } from './stores/db'
import { useAuthStore } from './stores/auth'
import ToastStack from './components/ToastStack.vue'
import ConfirmDialogHost from './components/ConfirmDialogHost.vue'

const route = useRoute()
const router = useRouter()
const db = useDbStore()
const auth = useAuthStore()

const navItems: { name: string; label: string }[] = [
  { name: 'dashboard', label: '總覽' },
  { name: 'plans', label: '計畫' },
  { name: 'categories', label: '分類管理' },
  { name: 'list', label: '活動列表' },
  { name: 'export', label: '匯出成果' },
]

const mobileNavOpen = ref(false)
watch(() => route.name, () => {
  mobileNavOpen.value = false
})

function selectNav(name: string) {
  router.push({ name })
}

async function logOut() {
  await auth.logOut()
  router.push({ name: 'login' })
}

onMounted(() => {
  if (auth.user) db.fetchAll()
})

watch(
  () => auth.user,
  (user) => {
    if (user) db.fetchAll()
  },
)
</script>

<template>
  <div v-if="route.meta.public" class="shell-public">
    <router-view />
    <ToastStack />
    <ConfirmDialogHost />
  </div>
  <div v-else class="shell">
    <aside :class="{ open: mobileNavOpen }">
      <div class="aside-head">
        <div class="brand">合照盟<small>計畫資料整合平台</small></div>
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
        <button @click="logOut">登出</button>
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
