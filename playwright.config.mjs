import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.mjs',
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:4173', headless: true },
  projects: [
    { name: 'root', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'dist', use: { viewport: { width: 375, height: 812 } } }
  ],
  webServer: {
    command: 'node scripts/dev.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false,
    env: { PORT: '4173', DEEPSEEK_API_KEY: '', GPTZERO_API_KEY: '', AI_DETECTOR_PROVIDER: 'auto' }
  }
});
