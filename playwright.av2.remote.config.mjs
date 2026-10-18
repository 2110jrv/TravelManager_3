import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'av2-remote.integration.spec.mjs',timeout:90000,workers:1,use:{baseURL:'http://127.0.0.1:5005',browserName:'chromium'},webServer:{command:'node scripts/av2-preview.mjs',port:5005,reuseExistingServer:true,env:{AV2_PREVIEW_PORT:'5005',AV2_TEST_FIXTURE:'1'}}});
