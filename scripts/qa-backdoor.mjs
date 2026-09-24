import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';

const APP_URL='https://2110jrv.github.io/TravelManager_3/';
const TRIP_ID='1aafae82-4ff7-423b-ade2-25170e8b0dd4';

function hiddenPrompt(label){return new Promise((resolve,reject)=>{process.stdout.write(label);const chars=[];const finish=(error,value)=>{process.stdin.off('data',onData);process.stdin.setRawMode?.(false);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value)};const onData=chunk=>{for(const char of String(chunk)){if(char==='\u0003')return finish(new Error('cancelled'));if(char==='\r'||char==='\n')return finish(null,chars.join(''));if(char==='\u007f'||char==='\b')chars.pop();else if(/\d/.test(char)&&chars.length<64)chars.push(char)}};process.stdin.setEncoding('utf8');process.stdin.setRawMode?.(true);process.stdin.resume();process.stdin.on('data',onData)})}
const shortCause=error=>String(error?.message||error||'unknown failure').replace(/[0-9]/g,'').replace(/\s+/g,' ').trim().slice(0,120)||'unknown failure';
const pin4=()=>String(Math.floor(1000+Math.random()*9000));
const nameOf=suffix=>`QA Traveler ${suffix}`;
const adminNameOf=suffix=>`QA Admin ${suffix}`;

const masterPin=await hiddenPrompt('PIN maestro: ');
if(!/^\d{5,64}$/.test(masterPin)){console.log('QA BACKDOOR: FAIL invalid master PIN format');process.exit(1)}
const qaPin=pin4(),adminPin=pin4(),suffix=crypto.randomUUID().slice(0,8);
let browser=null,page=null,qaCreated=false,adminCreated=false,backdoorLoggedIn=false;
const errors=[];const backdoorResponses=[];
const captureFailure=async error=>{if(!page)return;const visible=(await page.locator('body').innerText().catch(()=>'' )).replace(/\d/g,' ').replace(/\s+/g,' ').trim().slice(0,2000);const diagnostic={url:String(page.url()).replace(/\d/g,'#'),title:await page.title().catch(()=>''),visibleText:visible,backdoorResponses,error:shortCause(error)};await mkdir('tmp',{recursive:true}).catch(()=>{});await page.screenshot({path:'tmp/qa-backdoor-failure.png',fullPage:true}).catch(()=>{});await writeFile('tmp/qa-backdoor-failure.json',JSON.stringify(diagnostic,null,2),'utf8').catch(()=>{});};
const cleanup=async()=>{
  if(!page)return;
  await page.goto(`${APP_URL}?qa-backdoor-cleanup=${Date.now()}`,{waitUntil:'domcontentloaded'});
  await page.locator('input[name="pin"]').waitFor({state:'visible',timeout:10000});
  await page.locator('input[name="pin"]').fill(masterPin);
  await page.getByRole('button',{name:'Entrar'}).click();
  const managerRoot=page.locator('[data-user-manager-root]');
  await managerRoot.waitFor({state:'visible',timeout:10000});
  for(const name of [adminNameOf(suffix),nameOf(suffix)]){
    const row=managerRoot.locator(`[data-user-name="${name}"]`).locator('xpath=ancestor::tr');
    if(await row.count()){
      page.once('dialog',dialog=>dialog.accept());
      await row.getByRole('button',{name:'Borrar'}).click();
      await row.waitFor({state:'detached',timeout:10000});
    }
  }
};
try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext();page=await context.newPage();page.on('pageerror',()=>errors.push('pageerror'));page.on('console',message=>{if(message.type()==='error')errors.push('console')});page.on('response',response=>{if(response.url().includes('/functions/v1/admin-user-management')){const parsed=new globalThis.URL(response.url());backdoorResponses.push({path:parsed.pathname,status:response.status(),statusText:response.statusText()})}});
  const go=async()=>{await page.goto(`${APP_URL}?qa-backdoor=${Date.now()}`,{waitUntil:'domcontentloaded'});await page.locator('input[name="pin"]').waitFor({state:'visible',timeout:30000})};
  const login=async pin=>{await page.locator('input[name="pin"]').fill(pin);await page.getByRole('button',{name:'Entrar'}).click();};
  const logout=async()=>{await page.locator('[data-action="menu"]').click();await page.locator('[data-action="session-logout"]').click();await page.locator('input[name="pin"]').waitFor({state:'visible',timeout:30000})};
  const backdoor=async()=>{await go();await login(masterPin);const root=page.locator('[data-user-manager-root]');const normal=page.locator('.bottom-nav [data-view="home"]');await Promise.race([root.waitFor({state:'visible',timeout:30000}),normal.waitFor({state:'visible',timeout:30000})]);if(await root.count()!==1||!(await root.isVisible()))throw Error('backdoor did not return USER_MANAGER_ONLY; regular app session reached');backdoorLoggedIn=true;await root.locator('[data-action="admin-add-user"]').waitFor({state:'visible',timeout:30000});if(await page.locator('.bottom-nav [data-view]').count())throw Error('backdoor exposed app navigation')};
  const managerRoot=()=>page.locator('[data-user-manager-root]');
  const userRow=(root,name)=>root.locator(`[data-user-name="${name}"]`).locator('xpath=ancestor::tr');
  const addUser=async(name,pin,role)=>{const root=managerRoot();await root.locator('[data-action="admin-add-user"]').click();const form=root.locator('[data-admin-user-form]');await form.waitFor({state:'visible',timeout:10000});await form.locator('[name="displayName"]').fill(name);await form.locator('[name="pin"]').fill(pin);await form.locator('[name="pinConfirm"]').fill(pin);await form.locator('[name="role"]').selectOption(role);await form.locator('[name="status"]').selectOption('ACTIVE');await form.locator('[name="tripAccess"]').selectOption(TRIP_ID);await form.locator('button[type="submit"]').click();await root.locator(`[data-user-name="${name}"]`).waitFor({state:'visible',timeout:30000})};
  const setChatPermission=async enabled=>{const checkbox=managerRoot().locator('[data-role-permission][data-role="TRAVELER"][data-permission="writeChat"]');await checkbox.waitFor({state:'visible',timeout:30000});if(await checkbox.isChecked()!==enabled){await checkbox.click();await page.waitForTimeout(500);await checkbox.waitFor({state:'visible'});if(await checkbox.isChecked()!==enabled)throw Error('permission update did not persist')}};
  const openChat=async()=>{await page.getByRole('button',{name:'Chat'}).click();await page.getByRole('heading',{name:'Chat'}).waitFor({state:'visible',timeout:30000})};
  const loginQA=async pin=>{await go();await login(pin);await page.locator('.topbar').waitFor({state:'visible',timeout:30000});await page.getByText(nameOf(suffix),{exact:true}).waitFor({state:'visible',timeout:30000});if(!(await page.locator('.topbar').textContent()).includes('TRAVELER'))throw Error('traveler role missing');await page.getByRole('button',{name:'Abrir menú'}).click();await page.getByRole('button',{name:'Configuración'}).click();await page.getByText('Italy October/November 2026').waitFor({state:'visible',timeout:30000})};

  await backdoor();
  await addUser(nameOf(suffix),qaPin,'TRAVELER');qaCreated=true;
  await logout();
  await loginQA(qaPin);
  await openChat();await page.locator('[data-chat-send]').waitFor({state:'visible'});const message=`QA ${suffix}`;await page.locator('[data-chat-send] textarea').fill(message);await page.locator('[data-chat-send] button').click();await page.getByText(nameOf(suffix),{exact:true}).waitFor({state:'visible',timeout:30000});
  await logout();
  await backdoor();await setChatPermission(false);await logout();
  await loginQA(qaPin);await openChat();if(await page.locator('[data-chat-send] textarea').isEnabled())throw Error('chat write remained enabled');await logout();
  await backdoor();await setChatPermission(true);await logout();
  await loginQA(qaPin);await openChat();if(!(await page.locator('[data-chat-send] textarea').isEnabled()))throw Error('chat write did not restore');await logout();
  await backdoor();await addUser(adminNameOf(suffix),adminPin,'ADMIN');adminCreated=true;await logout();
  await go();await login(adminPin);await page.locator('.topbar').waitFor({state:'visible',timeout:30000});if(!(await page.locator('.topbar').textContent()).includes('ADMIN'))throw Error('regular admin role missing');await page.locator('[data-action="menu"]').click();if(await page.locator('[data-view="admin-users"]').count())throw Error('regular admin exposed User Manager');await logout();
  await backdoor();const root=managerRoot();const adminRow=userRow(root,adminNameOf(suffix));page.once('dialog',dialog=>dialog.accept());await adminRow.locator('[data-action="admin-delete-user"]').click();await adminRow.waitFor({state:'detached',timeout:30000});adminCreated=false;const qaRow=userRow(root,nameOf(suffix));page.once('dialog',dialog=>dialog.accept());await qaRow.locator('[data-action="admin-delete-user"]').click();await qaRow.waitFor({state:'detached',timeout:30000});qaCreated=false;await logout();
  await go();await login(qaPin);await page.getByRole('alert').waitFor({state:'visible',timeout:30000});if((await page.getByRole('alert').textContent()).includes('No se pudo')){}else throw Error('deleted QA PIN was accepted');
  if(errors.length)throw Error('browser console error');
  console.log('QA BACKDOOR: PASS');
}catch(error){await captureFailure(error);console.log(`QA BACKDOOR: FAIL ${shortCause(error)}`);process.exitCode=1;
}finally{
  if(qaCreated||adminCreated)await cleanup().catch(()=>{});
  await browser?.close().catch(()=>{});
  void qaCreated;void backdoorLoggedIn;
}
