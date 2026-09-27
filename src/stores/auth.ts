import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import Parse from '../lib/parse'
import { greetingNameOf } from '../utils/actor'

/** 顯示名稱（_User.displayName，由 scripts/setup-users.mjs 設定），沒設定就用帳號。 */
function displayNameOf(user: Parse.User | null): string {
  if (!user) return ''
  return (user.get('displayName') as string | undefined) || user.getUsername() || ''
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<Parse.User | null>(Parse.User.current() ?? null)
  const error = ref('')
  // Parse.User 不是響應式物件，fetch() 後同一個實例的欄位變了 Vue 也不會知道，
  // 所以顯示名稱另外存一份。
  const displayName = ref(displayNameOf(user.value))
  const greetingName = computed(() => greetingNameOf(displayName.value))

  async function logIn(username: string, password: string): Promise<void> {
    error.value = ''
    try {
      user.value = await Parse.User.logIn(username, password)
      displayName.value = displayNameOf(user.value)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '登入失敗'
      throw e
    }
  }

  /** 瀏覽器裡快取的登入狀態可能是加上顯示名稱之前存的，開站時重新抓一次。 */
  async function refreshUser(): Promise<void> {
    if (!user.value) return
    try {
      await user.value.fetch()
      displayName.value = displayNameOf(user.value)
    } catch {
      // 抓不到（例如 session 過期）就沿用快取，不擋畫面
    }
  }

  async function logOut(): Promise<void> {
    await Parse.User.logOut()
    user.value = null
    displayName.value = ''
  }

  return { user, error, displayName, greetingName, logIn, refreshUser, logOut }
})
