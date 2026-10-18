import {test,expect} from '@playwright/test';

async function consent(page,{canEdit=true,details=true,grant=true}={}){
 await page.addInitScript(({canEdit,details,grant})=>{
  window.oauthCalls=[];
  window.oauthClient={rpc:async()=>({data:{can_edit:canEdit}}),auth:{oauth:{
   getAuthorizationDetails:async()=>details?{data:{client:{id:'10000000-0000-4000-8000-000000000001',name:'<script>untrusted client</script>',uri:'https://example.org'}}}:{error:{message:'expired'}},
   approveAuthorization:async()=>{window.oauthCalls.push({action:'approve'});return{data:{redirect_url:'https://example.org/callback?code=synthetic'}};},
   denyAuthorization:async()=>{window.oauthCalls.push({action:'deny'});return{};}
  }},functions:{invoke:async(path,{body})=>{window.oauthCalls.push({action:'grant',path,body});return grant?{data:{granted:true}}:{error:{message:'denied'}};}}};
 },{canEdit,details,grant});
 await page.route('**/vendor/supabase-client.mjs',r=>r.fulfill({contentType:'text/javascript',body:'export const createClient=()=>window.oauthClient;'}));
 await page.route('**/v2/store.js',r=>r.fulfill({contentType:'text/javascript',body:`export class LocalStore {async open(){this.device='20000000-0000-4000-8000-000000000001';this.deviceToken='${'b'.repeat(64)}';return this;} async get(){return null;}}`}));
 await page.route('**/v2/pin-auth.js',r=>r.fulfill({contentType:'text/javascript',body:'export class PinAccess {async validate(){}}'}));
 // No call in these tests reaches Supabase, Google, or the external OAuth callback.
 await page.route('https://cslludzuejkhsydqiabx.supabase.co/**',r=>r.abort());
 await page.route('https://example.org/**',r=>r.fulfill({contentType:'text/html',body:'Synthetic OAuth callback'}));
 await page.goto('/v2/oauth.html?authorization_id=synthetic-request-031');
}

test('OAuth consent displays client text safely and never grants write access by default',async({page})=>{
 await consent(page);
 await expect(page.locator('#consent')).toBeVisible();
 await expect(page.locator('#client-name')).toHaveText('<script>untrusted client</script>');
 await expect(page.locator('#client-name script')).toHaveCount(0);
 await expect(page.locator('#write-access')).not.toBeChecked();
 expect(await page.evaluate(()=>window.oauthCalls)).toEqual([]);
 await page.locator('#approve').click();
 await expect(page).toHaveURL('https://example.org/callback?code=synthetic');
});

test('VIEWER can authorize reading but cannot select write access',async({page})=>{
 await consent(page,{canEdit:false});
 await expect(page.locator('#write-access')).toBeDisabled();
 await expect(page.locator('#write-access')).not.toBeChecked();
});

test('failed grant cannot approve OAuth or navigate away',async({page})=>{
 await consent(page,{grant:false});
 await expect(page.locator('#consent')).toBeVisible();
 await page.locator('#write-access').check();await page.locator('#approve').click();
 await expect(page.locator('#status')).toContainText('No se completó la autorización');
 const calls=await page.evaluate(()=>window.oauthCalls);
 expect(calls).toHaveLength(1);expect(calls[0].body.can_write).toBe(true);
 expect(calls[0].action).toBe('grant');
 await expect(page).toHaveURL(/oauth.html/);
});

test('expired authorization hides consent and never stores a grant',async({page})=>{
 await consent(page,{details:false});
 await expect(page.locator('#status')).toContainText('No se pudo preparar');
 await expect(page.locator('#consent')).toBeHidden();
 expect(await page.evaluate(()=>window.oauthCalls)).toEqual([]);
});

test('rejecting consent does not create a grant',async({page})=>{
 await consent(page);await expect(page.locator('#consent')).toBeVisible();
 await page.locator('#deny').click();await expect(page.locator('#consent')).toBeHidden();
 expect(await page.evaluate(()=>window.oauthCalls)).toEqual([{action:'deny'}]);
});
