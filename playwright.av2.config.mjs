import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'./tests', testMatch:['av2.integration.spec.mjs','av2-admin-fx.integration.spec.mjs','av2-provider.integration.spec.mjs','av2-ux.integration.spec.mjs','av2-persistence.integration.spec.mjs','av2-staging.integration.spec.mjs','av2-pin.integration.spec.mjs','av2-map-docs.integration.spec.mjs'], timeout:30000, workers:1,
  use:{baseURL:'http://127.0.0.1:5005',browserName:'chromium'},
  webServer:{command:'node scripts/av2-preview.mjs',port:5005,reuseExistingServer:true,env:{AV2_PREVIEW_PORT:'5005',AV2_TEST_FIXTURE:'1'}} });
