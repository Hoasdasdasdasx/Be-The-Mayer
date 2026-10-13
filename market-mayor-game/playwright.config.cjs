const { defineConfig } = require('@playwright/test');
const fs = require('node:fs');
module.exports = defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    viewport: { width: 1366, height: 768 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: { command: 'node server.js', env: { PORT: '3100' }, url: 'http://127.0.0.1:3100/health', reuseExistingServer: false },
});
