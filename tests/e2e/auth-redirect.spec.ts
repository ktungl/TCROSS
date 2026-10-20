import { expect, test } from '@playwright/test'

test('TC-38 未登入開 / 導向 /login', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: '登入' })).toBeVisible()
})

test('TC-38 已登入開 /login 導向 /dashboard', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[autocomplete="username"]').fill(process.env.E2E_USERNAME!)
  await page.locator('input[autocomplete="current-password"]').fill(process.env.E2E_PASSWORD!)
  await page.getByRole('button', { name: '登入' }).click()
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 })

  await page.goto('/login')
  await expect(page).toHaveURL(/\/dashboard$/)
})

test('登入欄位不接受空白（打字、貼上）', async ({ page }) => {
  await page.goto('/login')
  const username = page.locator('input[autocomplete="username"]')
  const password = page.locator('input[autocomplete="current-password"]')
  await username.pressSequentially(' ya .ting ')
  await password.fill('　ya.ting 1234\n')
  await expect(username).toHaveValue('ya.ting')
  await expect(password).toHaveValue('ya.ting1234')
})

test('瀏覽器留著失效的登入狀態時，導回登入頁並提示重新登入', async ({ page }) => {
  await page.goto('/login')
  // 模擬伺服器已不認得的 session（例如 2026-10-20 換伺服器前登入的）
  await page.evaluate((appId) => {
    localStorage.setItem(`Parse/${appId}/currentUser`, JSON.stringify({
      objectId: 'stale0000', username: 'stale', sessionToken: 'r:00000000000000000000000000000000', __type: 'Object', className: '_User',
    }))
  }, process.env.E2E_PARSE_APP_ID!)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 })
  await expect(page.getByText('登入已失效，請重新登入')).toBeVisible()
  await expect(page.getByText('連線失敗')).toHaveCount(0)
})
