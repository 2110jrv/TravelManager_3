import {chromium} from '@playwright/test';
import {assertRoot,privateJson} from './av2-management.mjs';
assertRoot();const browser=await chromium.connectOverCDP('http://127.0.0.1:9224');
try{
  const context=browser.contexts()[0];let page=context.pages().find(p=>p.url().startsWith('http://127.0.0.1:5004/v2/'));
  if(!page)throw Error('PC_PREVIEW_NOT_OPEN');
  const snapshot=()=>page.evaluate(async()=>{
    const {LocalStore}=await import('/v2/store.js');const s=await new LocalStore().open();
    const events=(await s.all('events')).filter(e=>!e.deleted_at),session=JSON.parse(localStorage.getItem('av2.auth')||'null');
    return{session:!!session?.access_token,device:s.device,events:events.length,records:(await s.all('records')).length,blobs:(await s.all('blobs')).length,
      calendar:{paid:events.filter(e=>e.cost_status==='PAID').length,estimated:events.filter(e=>e.cost_status==='ESTIMATED').length,nonfinancial:events.filter(e=>!e.cost_status).length,multiday:events.filter(e=>e.allDay&&e.end>e.start).length,warnings:events.flatMap(e=>e.warnings||[]),locations:events.filter(e=>e.location).length,descriptions:events.filter(e=>e.description).length},
      reauth:(await s.get('meta','google-reauth'))?.value===true};
  });
  let naturalExpirationObserved=false;
  if(process.argv[2]==='natural'){
    const original=await page.evaluate(async()=>{
      const{GoogleAuthorization}=await import('/v2/google-auth.js');const{LocalStore}=await import('/v2/store.js');
      const token=await new GoogleAuthorization(await new LocalStore().open()).token();
      const response=await fetch('https://oauth2.googleapis.com/tokeninfo?'+new URLSearchParams({access_token:token}));if(!response.ok)throw Error('VALID_GOOGLE_TOKEN_REQUIRED');
      const info=await response.json();return{seconds:Number(info.expires_in),token};
    });
    const remaining=original.seconds;
    if(!Number.isFinite(remaining)||remaining<0||remaining>7200)throw Error('GOOGLE_EXPIRY_UNAVAILABLE');
    console.log(`Waiting ${remaining+5} seconds for the original Google token to expire naturally. Keep PC Casa Chrome open.`);
    await new Promise(resolve=>setTimeout(resolve,(remaining+5)*1000));
    await page.evaluate(async token=>{
      const{GoogleSource}=await import('/v2/google.js');const{GoogleAuthorization}=await import('/v2/google-auth.js');const{LocalStore}=await import('/v2/store.js');
      const store=await new LocalStore().open(),auth=new GoogleAuthorization(store);
      const source=new GoogleSource(async()=>token,fetch,async()=>{},async()=>{if((await store.get('meta','google-access'))?.value===token)await auth.invalidate();});
      try{await source.api('calendar/v3/colors');throw Error('TOKEN_HAS_NOT_EXPIRED');}catch(error){if(error.status!==401)throw error;}
    },original.token);
    naturalExpirationObserved=true;
    await page.goto('http://127.0.0.1:5004/v2/#settings');await page.locator('[data-action=google]').click();
    try{await page.waitForFunction(oldToken=>{if(location.origin!=='http://127.0.0.1:5004')return false;const session=JSON.parse(localStorage.getItem('av2.auth')||'null');return!!session?.access_token&&!!session.provider_token&&session.provider_token!==oldToken;},original.token,{timeout:60000});await page.waitForTimeout(1500);}
    catch{throw Error('NATURAL_EXPIRY_GOOGLE_REAUTH_REQUIRED');}
  }
  if(process.argv[2]==='invalidate'){
    const before=await snapshot();
    await page.evaluate(async()=>{
      const {GoogleSource}=await import('/v2/google.js');const {GoogleAuthorization}=await import('/v2/google-auth.js');const {LocalStore}=await import('/v2/store.js');
      const store=await new LocalStore().open(),auth=new GoogleAuthorization(store);
      const source=new GoogleSource(async()=> 'AV2-invalid-token-for-401-test',fetch,async()=>{},()=>auth.invalidate());
      try{await source.api('calendar/v3/colors');throw Error('GOOGLE_DID_NOT_REJECT_INVALID_TOKEN');}catch(error){if(error.status!==401)throw error;}
    });
    await page.reload();const after=await snapshot();if(!after.reauth||after.events!==before.events||after.device!==before.device)throw Error('REAUTH_OR_STORAGE_PRESERVATION_FAILED');
    privateJson('google-expiration-evidence.json',{at:new Date().toISOString(),method:'real Google HTTP 401 using deliberately invalid token, not natural expiration',before,after});
    await page.goto('http://127.0.0.1:5004/v2/#settings');await page.locator('[data-action=google]').click();
    console.log('Real Google 401 invalidated access; reload preserved installation and data. Re-auth flow started.');
  }else{
    const before=await snapshot();if(!before.session||before.reauth)throw Error('GOOGLE_REAUTH_REQUIRED');
    const closed=page;page=await context.newPage();await closed.close();await page.goto('http://127.0.0.1:5004/v2/#home');await page.getByRole('heading',{name:'Italia 2026',exact:true}).waitFor();
    const reopened=await snapshot();await context.setOffline(true);
    try{await page.reload();await page.getByRole('heading',{name:'Italia 2026',exact:true}).waitFor();const offline=await snapshot();if(offline.device!==before.device||offline.events!==before.events||!offline.session)throw Error('OFFLINE_PERSISTENCE_FAILED');}
    finally{await context.setOffline(false);}
    await page.locator('[href="#settings"]').click();await page.locator('[data-action=sync]').click();
    await page.waitForTimeout(2000);const after=await snapshot();
    const googleOk=await page.evaluate(async()=>{const{GoogleSource}=await import('/v2/google.js');const{GoogleAuthorization}=await import('/v2/google-auth.js');const{LocalStore}=await import('/v2/store.js');const auth=new GoogleAuthorization(await new LocalStore().open());const google=new GoogleSource(()=>auth.token());return(await google.api('calendar/v3/calendars/'+encodeURIComponent('eee85f5d7c0e07fc9a8174d8a3bc640a9b0327901c9f09059d196c1058f5d346@group.calendar.google.com')+'?eventLabelVersion=1')).ok;});
    if(!googleOk||after.reauth)throw Error('GOOGLE_REAUTH_RECOVERY_FAILED');
    privateJson('google-lifecycle-evidence.json',{at:new Date().toISOString(),reopened,after,offline_shell:true,session_preserved:true,google_real_recovered:true,natural_expiration_observed:naturalExpirationObserved,provider_refresh_strategy:'explicit Google re-authentication; no automatic provider refresh'});
    console.log(JSON.stringify({reopened,after,offline_shell:true,google_real_recovered:true}));await page.goto('http://127.0.0.1:5004/v2/#home');
  }
}finally{await browser.close();}
