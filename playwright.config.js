import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test/e2e', fullyParallel: false, timeout: 30000,
  forbidOnly: Boolean(process.env.CI), retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:8082', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node server.js 8082', url: 'http://127.0.0.1:8082', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }
  ]
});
