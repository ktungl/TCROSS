<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { errorMessage, pushToast } from '../composables/useToast'

/** 歡迎畫面停留多久後自動進入系統 */
const WELCOME_MS = 1500

const router = useRouter()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const submitting = ref(false)
const welcomed = ref(false)
let enterTimer: ReturnType<typeof setTimeout> | undefined

function enter() {
  clearTimeout(enterTimer)
  router.push({ name: 'list' })
}

async function submit() {
  if (!username.value.trim() || !password.value) return
  submitting.value = true
  try {
    await auth.logIn(username.value.trim(), password.value)
    // 密碼正確：先顯示「○○，您好」，再自動進入系統
    welcomed.value = true
    enterTimer = setTimeout(enter, WELCOME_MS)
  } catch (e) {
    pushToast(errorMessage(e), 'error')
  } finally {
    submitting.value = false
  }
}

onBeforeUnmount(() => clearTimeout(enterTimer))
</script>

<template>
  <div class="login-page">
    <div v-if="welcomed" class="card login-card welcome-card">
      <h1 style="margin-top:0">{{ auth.greetingName }}，您好</h1>
      <p class="sub">登入成功，正在進入系統…</p>
      <button class="btn" type="button" @click="enter">進入系統</button>
    </div>
    <div v-else class="card login-card">
      <h1 style="margin-top:0">合照盟</h1>
      <p class="sub" style="margin-bottom:0">計畫資料整合平台</p>
      <p class="sub">請登入以繼續。</p>
      <form @submit.prevent="submit">
        <label>帳號</label>
        <input v-model="username" autocomplete="username" autofocus>
        <label style="margin-top:12px">密碼</label>
        <input v-model="password" type="password" autocomplete="current-password">
        <div class="row" style="margin-top:20px">
          <button class="btn" type="submit" :disabled="submitting">{{ submitting ? '登入中…' : '登入' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-card {
  width: 100%;
  max-width: 360px;
}
.welcome-card {
  text-align: center;
}
</style>
