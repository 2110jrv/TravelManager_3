import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'./tests', testMatch:'av2.integration.spec.mjs', timeout:30000, workers:1,
  use:{baseURL:'http://127.0.0.1:5004',browserName:'chromium'},
  webServer:{command:'node scripts/av2-preview.mjs',port:5004,reuseExistingServer:true} });
