import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', timeout: 15000, workers: 4, use: { baseURL: 'http://127.0.0.1:5003', browserName: 'chromium' }, webServer: { command: 'python -m http.server 5003 --directory public', port: 5003, reuseExistingServer: true } });
