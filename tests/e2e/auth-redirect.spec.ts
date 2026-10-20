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
