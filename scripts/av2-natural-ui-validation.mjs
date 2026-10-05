import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assertRoot,privateJson,ROOT} from './av2-management.mjs';
assertRoot();const browser=await chromium.connectOverCDP('http://127.0.0.1:9224');
try{
 const context=browser.contexts()[0],page=context.pages().find(p=>p.url().startsWith('http://127.0.0.1:5004/v2/'));
 if(!page)throw Error('PC_PREVIEW_NOT_OPEN');let uiEvidence;
 await page.exposeFunction('__av2NaturalEvidence',value=>{uiEvidence=value;privateJson('google-natural-ui-evidence.json',{at:new Date().toISOString(),...value});console.log(JSON.stringify(value));});
 const install=()=>{
  let inspecting=false,completed=false;
  document.addEventListener('click',event=>{
   const button=event.target.closest('[data-action=google]');if(!button||completed||inspecting)return;
   event.preventDefault();event.stopImmediatePropagation();inspecting=true;
   (async()=>{
    try{
     const{LocalStore}=await import('/v2/store.js');const{GoogleAuthorization}=await import('/v2/google-auth.js');const{GoogleSource}=await import('/v2/google.js');
     const store=await new LocalStore().open();if((await store.get('meta','google-reauth'))?.value!==true)return;
     document.querySelector('[data-action=sync]')?.click();
     for(let i=0;i<100&&!document.querySelector('#notice')?.textContent.includes('expiró');i++)await new Promise(r=>setTimeout(r,100));
     const auth=new GoogleAuthorization(store),source=new GoogleSource(()=>auth.token()),errors=[];
     for(const path of ['calendar/v3/colors','drive/v3/files?pageSize=1'])try{await source.api(path);errors.push(false);}catch(error){errors.push(error.message.includes('expiró'));}
     await window.__av2NaturalEvidence({reauth:true,calendar_requires_reauth:errors[0],drive_requires_reauth:errors[1],events:(await store.all('events')).length,records:(await store.all('records')).length,device:store.device,ui_expired_notice_visible:document.querySelector('#notice')?.textContent.includes('expiró')});
    }finally{completed=true;inspecting=false;button.click();}
   })();
  },true);
 };
 await page.addInitScript(install);await page.evaluate(install);
 console.log('Natural-expiry UI observer active; existing expiry test remains running.');
 const deadline=Date.now()+90*60000;
 for(;;){let evidence;try{evidence=JSON.parse(readFileSync('.av2-private/google-lifecycle-evidence.json','utf8'));}catch{}
  if(evidence?.natural_expiration_observed)break;if(Date.now()>deadline)throw Error('NATURAL_TEST_COMPLETION_NOT_OBSERVED');await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(!uiEvidence?.calendar_requires_reauth||!uiEvidence?.drive_requires_reauth||!uiEvidence?.ui_expired_notice_visible)throw Error('NATURAL_UI_NOT_VERIFIED');
 const result=await promisify(execFile)(process.execPath,['scripts/av2-preuser-validation.mjs','--fresh-login'],{cwd:ROOT,windowsHide:true,timeout:120000,maxBuffer:1024*1024});console.log(result.stdout.trim());
}finally{await browser.close();}
