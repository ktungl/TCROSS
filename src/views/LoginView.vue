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
const showPassword = ref(false)
const submitting = ref(false)
const welcomed = ref(false)
let enterTimer: ReturnType<typeof setTimeout> | undefined

function enter() {
  clearTimeout(enterTimer)
  router.push({ name: 'dashboard' })
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
      <h1>{{ auth.greetingName }}，您好</h1>
      <p class="sub">登入成功，正在進入系統…</p>
      <button class="btn" type="button" @click="enter">進入系統</button>
    </div>
    <div v-else class="card login-card">
      <h1>合照盟</h1>
      <p class="sub flush-m">計畫資料整合平台</p>
      <p class="sub">請登入以繼續。</p>
      <form @submit.prevent="submit">
        <label>帳號</label>
        <input v-model="username" autocomplete="username" autofocus>
        <label class="field">密碼</label>
        <div class="password-field">
          <input v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password">
          <button
            class="toggle-eye"
            type="button"
            :aria-label="showPassword ? '隱藏密碼' : '顯示密碼'"
            :title="showPassword ? '隱藏密碼' : '顯示密碼'"
            @click="showPassword = !showPassword"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
              <line v-if="showPassword" x1="3" y1="3" x2="21" y2="21" />
            </svg>
          </button>
        </div>
        <div class="row actions">
          <button class="btn" type="submit" :disabled="submitting">{{ submitting ? '登入中…' : '登入' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.password-field {
  position: relative;
}
.password-field input {
  padding-right: 38px;
}
.toggle-eye {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  padding: 4px;
  background: transparent;
  border: none;
  color: var(--ink-soft);
  cursor: pointer;
}
.toggle-eye:hover {
  color: var(--ink);
}
.welcome-card {
  text-align: center;
}
</style>
