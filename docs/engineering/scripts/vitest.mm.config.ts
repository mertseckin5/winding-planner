import { defineConfig } from 'vitest/config'

// Makine mühendisi inceleme betikleri (src/ dışı). Çalıştırma:
//   npx vitest run --config docs/engineering/scripts/vitest.mm.config.ts --reporter=verbose
export default defineConfig({
  test: {
    include: ['docs/engineering/scripts/**/*.mm.test.ts'],
    environment: 'node'
  }
})
