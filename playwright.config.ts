import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.PW_BASE_URL || 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'desktop-webkit',   use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-safari',    use: { ...devices['iPhone 14'] } },
    { name: 'mobile-android',   use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.PW_NO_SERVER ? undefined : {
    command: '/home/ubuntu/bin/npm run dev',
    url: 'http://localhost:4321',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
