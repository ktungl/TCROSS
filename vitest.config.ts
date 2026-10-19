import { defineConfig } from 'vitest/config'

// cloud/tests 用 Node 內建 node:test 跑（npm run test:cloud），不給 Vitest 收
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts'] },
})
