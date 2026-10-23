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
  // Parse.User 不是響應式物件，fetch() 後同一個實例的欄位變了 Vue 也不會知道，
  // 所以顯示名稱另外存一份。
  const displayName = ref(displayNameOf(user.value))
  const greetingName = computed(() => greetingNameOf(displayName.value))

  async function logIn(username: string, password: string): Promise<void> {
    user.value = await Parse.User.logIn(username, password)
    displayName.value = displayNameOf(user.value)
  }

  /** 瀏覽器裡快取的登入狀態可能是加上顯示名稱之前存的，開站時重新抓一次。
   * 回傳 false 表示伺服器不認得這個登入（例如 2026-10-20 從 Back4App 換到自架伺服器前登入的），
   * 呼叫端要請使用者重新登入；其他錯誤（網路斷線等）就沿用快取，不擋畫面。 */
  async function refreshUser(): Promise<boolean> {
    if (!user.value) return true
    try {
      await user.value.fetch()
      displayName.value = displayNameOf(user.value)
    } catch (e) {
      if (e instanceof Parse.Error && e.code === Parse.Error.INVALID_SESSION_TOKEN) return false
    }
    return true
  }

  async function logOut(): Promise<void> {
    try {
      await Parse.User.logOut()
    } catch {
      // 伺服器端的 session 已經失效時登出會失敗，但本機的登入狀態一樣要清掉
    }
    user.value = null
    displayName.value = ''
  }

  return { user, displayName, greetingName, logIn, refreshUser, logOut }
})
