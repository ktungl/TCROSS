import { defineStore } from 'pinia'
import { ref } from 'vue'
import Parse from '../lib/parse'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<Parse.User | null>(Parse.User.current() ?? null)
  const error = ref('')

  async function logIn(username: string, password: string): Promise<void> {
    error.value = ''
    try {
      user.value = await Parse.User.logIn(username, password)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '登入失敗'
      throw e
    }
  }

  async function logOut(): Promise<void> {
    await Parse.User.logOut()
    user.value = null
  }

  return { user, error, logIn, logOut }
})
