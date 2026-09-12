import { defineConfig } from 'vitest/config'

export default defineConfig({
  ssr: {
    noExternal: ['@deepseek-ai/dsh-client-ui-primitives'],
  },
  server: {
    deps: {
      inline: ['@deepseek-ai/dsh-client-ui-primitives'],
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    // Profile integration tests create a full package-junction closure; higher
    // Windows file concurrency makes their latency depend on NTFS/Defender load.
    maxWorkers: process.platform === 'win32' ? 2 : undefined,
  },
})
