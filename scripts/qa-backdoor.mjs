import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';

const APP_URL='https://2110jrv.github.io/TravelManager_3/';
const TRIP_ID='1aafae82-4ff7-423b-ade2-25170e8b0dd4';

function hiddenPrompt(label){return new Promise((resolve,reject)=>{process.stdout.write(label);const chars=[];const finish=(error,value)=>{process.stdin.off('data',onData);process.stdin.setRawMode?.(false);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value)};const onData=chunk=>{for(const char of String(chunk)){if(char==='\u0003')return finish(new Error('cancelled'));if(char==='\r'||char==='\n')return finish(null,chars.join(''));if(char==='\u007f'||char==='\b')chars.pop();else if(/\d/.test(char)&&chars.length<64)chars.push(char)}};process.stdin.setEncoding('utf8');process.stdin.setRawMode?.(true);process.stdin.resume();process.stdin.on('data',onData)})}
const shortCause=error=>String(error?.message||error||'unknown failure').replace(/[0-9]/g,' ').replace(/\s+/g,' ').trim().slice(0,160)||'unknown failure';
const pin4=()=>String(Math.floor(1000+Math.random()*9000));
const nameOf=suffix=>`QA Traveler ${suffix}`;
const adminNameOf=suffix=>`QA Admin ${suffix}`;
const attr=value=>JSON.stringify(String(value));

const masterPin=await hiddenPrompt('PIN maestro: ');
if(!/^\d{5,64}$/.test(masterPin)){console.log('QA BACKDOOR: FAIL invalid master PIN format');process.exit(1)}
const qaPin=pin4(),adminPin=pin4(),suffix=crypto.randomUUID().slice(0,8);
let browser=null,page=null,qaCreated=false,adminCreated=false,backdoorLoggedIn=false;
let currentStage='startup',currentSelector='';
const errors=[];const backdoorResponses=[];
const safeUrl=()=>String(page?.url()||'').replace(/\d/g,'#');
const failureRequests=()=>backdoorResponses.filter(x=>x.status>=400&&x.status<=599);
const stageSnapshot=async(stage,selector,error='')=>{if(!page)return;const visible=(await page.locator('body').innerText().catch(()=>'' )).replace(/\d/g,' ').replace(/\s+/g,' ').trim().slice(0,2000);const diagnostic={stage,selector,url:safeUrl(),requests_4xx_5xx:failureRequests(),visibleText:visible};if(error)diagnostic.error=shortCause(error);await mkdir('tmp',{recursive:true}).catch(()=>{});const prefix=`tmp/qa-backdoor-${stage}`;await page.screenshot({path:`${prefix}.png`,fullPage:true,mask:[page.locator('[data-pin-input]'),page.locator('[data-user-pin]'),page.locator('[data-user-pin-confirm]')]}).catch(()=>{});await writeFile(`${prefix}.json`,JSON.stringify(diagnostic,null,2),'utf8').catch(()=>{});return diagnostic};
const setStage=(stage,selector)=>{currentStage=stage;currentSelector=selector};
const captureFailure=async error=>{await stageSnapshot(currentStage,currentSelector,error);if(!page)return;const visible=(await page.locator('body').innerText().catch(()=>'' )).replace(/\d/g,' ').replace(/\s+/g,' ').trim().slice(0,2000);const diagnostic={stage:currentStage,selector:currentSelector,url:safeUrl(),requests_4xx_5xx:failureRequests(),visibleText:visible,error:shortCause(error)};await page.screenshot({path:'tmp/qa-backdoor-failure.png',fullPage:true,mask:[page.locator('[data-pin-input]'),page.locator('[data-user-pin]'),page.locator('[data-user-pin-confirm]')]}).catch(()=>{});await writeFile('tmp/qa-backdoor-failure.json',JSON.stringify(diagnostic,null,2),'utf8').catch(()=>{});};
const root=()=>page.locator('[data-user-manager-root]');
const row=(name)=>root().locator(`[data-user-row][data-user-name=${attr(name)}]`);
const logout=async()=>{await page.locator('[data-action="menu"]').click();await page.locator('[data-user-logout]').click();await page.locator('[data-login-form] [data-pin-input]').waitFor({state:'visible',timeout:30000})};
const cleanup=async()=>{if(!page)return;await page.goto(`${APP_URL}?qa-backdoor-cleanup=${Date.now()}`,{waitUntil:'domcontentloaded'});await page.locator('[data-login-form] [data-pin-input]').waitFor({state:'visible',timeout:10000});await page.locator('[data-pin-input]').fill(masterPin);await page.locator('[data-pin-submit]').click();setStage('manager_loaded','[data-user-manager-root]');await root().waitFor({state:'visible',timeout:10000});for(const name of [adminNameOf(suffix),nameOf(suffix)]){const target=row(name);if(await target.count()){page.once('dialog',dialog=>dialog.accept());await target.locator('[data-user-delete]').click();await target.waitFor({state:'detached',timeout:10000})}}};

try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext();page=await context.newPage();
  page.on('pageerror',()=>errors.push('pageerror'));page.on('console',message=>{if(message.type()==='error')errors.push('console')});
  page.on('response',response=>{if(response.url().includes('/functions/v1/admin-user-management')){const parsed=new globalThis.URL(response.url());backdoorResponses.push({path:parsed.pathname,status:response.status(),statusText:response.statusText()})}});
  const go=async()=>{await page.goto(`${APP_URL}?qa-backdoor=${Date.now()}`,{waitUntil:'domcontentloaded'});await page.locator('[data-pin-input]').waitFor({state:'visible',timeout:30000})};
  const login=async pin=>{await page.locator('[data-pin-input]').fill(pin);await page.locator('[data-pin-submit]').click()};
  const backdoor=async()=>{await go();await login(masterPin);setStage('manager_loaded','[data-user-manager-root]');await Promise.race([root().waitFor({state:'visible',timeout:30000}),page.locator('.bottom-nav [data-view]').first().waitFor({state:'visible',timeout:30000})]);if(await root().count()!==1||!(await root().isVisible()))throw Error('backdoor did not return USER_MANAGER_ONLY');backdoorLoggedIn=true;if(await page.locator('.bottom-nav [data-view]').count())throw Error('backdoor exposed app navigation');await stageSnapshot('manager_loaded','[data-user-manager-root]')};
  const addUser=async(name,pin,role,stage='user_created')=>{const manager=root();manager.locator('[data-add-user]').click();const form=manager.locator('[data-admin-user-form]');setStage('add_user_opened','[data-user-manager-root] [data-admin-user-form]');await form.waitFor({state:'visible',timeout:10000});await stageSnapshot('add_user_opened','[data-user-manager-root] [data-admin-user-form]');await form.locator('[data-user-name]').fill(name);await form.locator('[data-user-pin]').fill(pin);await form.locator('[data-user-pin-confirm]').fill(pin);await form.locator('[data-user-role]').selectOption(role);await form.locator('[data-user-status]').selectOption('ACTIVE');await form.locator('[data-user-trips]').selectOption(TRIP_ID);setStage(stage,'[data-user-manager-root] [data-user-save]');await form.locator('[data-user-save]').click();setStage(stage,`[data-user-manager-root] [data-user-row][data-user-name=${attr(name)}]`);await row(name).waitFor({state:'visible',timeout:30000});await stageSnapshot(stage,`[data-user-manager-root] [data-user-row][data-user-name=${attr(name)}]`)};
  const setChatPermission=async enabled=>{const checkbox=root().locator('[data-role-permission][data-role="TRAVELER"][data-permission="writeChat"]');setStage('permission_changed','[data-user-manager-root] [data-role-permission][data-role="TRAVELER"][data-permission="writeChat"]');await checkbox.waitFor({state:'visible',timeout:30000});if(await checkbox.isChecked()!==enabled){await checkbox.click();await page.waitForTimeout(500);await checkbox.waitFor({state:'visible'});if(await checkbox.isChecked()!==enabled)throw Error('permission update did not persist')}await stageSnapshot('permission_changed','[data-user-manager-root] [data-role-permission][data-role="TRAVELER"][data-permission="writeChat"]')};
  const openChat=async()=>{await page.locator('[data-view="chat"]').click();await page.locator('[data-chat-ready="true"]').waitFor({state:'visible',timeout:30000})};
  const loginQA=async pin=>{await go();await login(pin);setStage('user_login','[data-user-role="TRAVELER"]');await page.locator('[data-user-role="TRAVELER"]').waitFor({state:'visible',timeout:30000});await page.locator(`[data-user-name=${attr(nameOf(suffix))}]`).waitFor({state:'visible',timeout:30000});await page.locator('[data-view="settings"]').click();await page.locator(`[data-trip-name="Italy October/November 2026"]`).waitFor({state:'visible',timeout:30000});await stageSnapshot('user_login','[data-user-role="TRAVELER"]')};

  await backdoor();
  await addUser(nameOf(suffix),qaPin,'TRAVELER');qaCreated=true;
  await logout();
  await loginQA(qaPin);
  await openChat();await page.locator('[data-chat-send]').waitFor({state:'visible'});const message=`QA ${suffix}`;await page.locator('[data-chat-send] textarea').fill(message);await page.locator('[data-chat-send] button').click();await page.locator(`[data-message-sender=${attr(nameOf(suffix))}]`).waitFor({state:'visible',timeout:30000});
  await logout();
  await backdoor();await setChatPermission(false);await logout();
  await loginQA(qaPin);await openChat();if(await page.locator('[data-chat-send] textarea').isEnabled())throw Error('chat write remained enabled');await logout();
  await backdoor();await setChatPermission(true);await logout();
  await loginQA(qaPin);await openChat();if(!(await page.locator('[data-chat-send] textarea').isEnabled()))throw Error('chat write did not restore');await logout();
  await backdoor();await addUser(adminNameOf(suffix),adminPin,'ADMIN','admin_created');adminCreated=true;await stageSnapshot('admin_created','[data-user-manager-root] [data-user-row]');await logout();
  await go();await login(adminPin);await page.locator('[data-user-role="ADMIN"]').waitFor({state:'visible',timeout:30000});await page.locator('[data-action="menu"]').click();if(await page.locator('[data-view="admin-users"]').count())throw Error('regular admin exposed User Manager');await logout();
  await backdoor();const adminRow=row(adminNameOf(suffix));page.once('dialog',dialog=>dialog.accept());await adminRow.locator('[data-user-delete]').click();await adminRow.waitFor({state:'detached',timeout:30000});adminCreated=false;const qaRow=row(nameOf(suffix));page.once('dialog',dialog=>dialog.accept());await qaRow.locator('[data-user-delete]').click();await qaRow.waitFor({state:'detached',timeout:30000});qaCreated=false;await stageSnapshot('user_deleted','[data-user-manager-root] [data-user-delete]');await logout();
  await go();await login(qaPin);setStage('user_deleted','[data-login-form]');await page.locator('[data-login-form]').waitFor({state:'visible',timeout:30000});
  if(errors.length)throw Error('browser console error');
  console.log('QA BACKDOOR: PASS');
}catch(error){await captureFailure(error);console.log(`QA BACKDOOR: FAIL ${shortCause(error)}`);process.exitCode=1;
}finally{if(qaCreated||adminCreated)await cleanup().catch(()=>{});await browser?.close().catch(()=>{});void backdoorLoggedIn;}
