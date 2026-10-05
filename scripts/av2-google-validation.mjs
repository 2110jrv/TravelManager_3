import {chromium} from '@playwright/test';
import {assertRoot,privateJson} from './av2-management.mjs';
assertRoot();
const browser=await chromium.connectOverCDP('http://127.0.0.1:9224');
try{
  const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:5004/v2/'));
  if(!page)throw Error('PC_PREVIEW_NOT_OPEN');
  const status=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('av2.auth')||'null');return{session:!!s?.access_token,provider_token:!!s?.provider_token,provider_refresh_token:!!s?.provider_refresh_token};});
  if(process.argv[2]!=='validate'){console.log(JSON.stringify(status));process.exitCode=status.session?0:2;}
  else{
    if(!status.session)throw Error('GOOGLE_LOGIN_REQUIRED');
    await page.exposeFunction('__av2ProbeOffline',async id=>{
      await browser.contexts()[0].setOffline(true);
      try{return await page.evaluate(async id=>{const{LocalStore}=await import('/v2/store.js');const s=await new LocalStore().open();const copy=await s.get('blobs','drive:'+id);return{offline:!navigator.onLine,bytes:copy?.blob?.size||0};},id);}
      finally{await browser.contexts()[0].setOffline(false);}
    });
    const evidence=await page.evaluate(async()=>{
      const {createClient}=await import('/vendor/supabase-client.mjs');
      const {LocalStore}=await import('/v2/store.js');const {TRIP}=await import('/v2/config.js');
      const {SupabaseRemote,SyncEngine}=await import('/v2/sync.js');const {Devices,randomToken}=await import('/v2/devices.js');
      const {GoogleSource}=await import('/v2/google.js');const {GoogleAuthorization}=await import('/v2/google-auth.js');
      const {finance}=await import('/v2/domain.js');const {expenseSnapshots}=await import('/v2/fx.js');
      const client=createClient('https://cslludzuejkhsydqiabx.supabase.co','sb_publishable_8k8xhMZtkay30ZB45aPjGw_4u69Dp0U',{auth:{storageKey:'av2.auth',flowType:'pkce'}});
      const {data,error}=await client.auth.getUser();if(error||data.user.email!=='2110jrv@gmail.com')throw Error('OWNER_GOOGLE_SESSION_REQUIRED');
      const store=await new LocalStore().open(),auth=new GoogleAuthorization(store);
      await auth.capture('INITIAL_SESSION',(await client.auth.getSession()).data.session);
      const remote=new SupabaseRemote(client,store.device,store.deviceToken),devices=new Devices(remote);
      if(await remote.rpc('av2_device_status',remote.credentials())==='UNENROLLED'){
        const claim=await(await fetch('/v2/root-claim',{cache:'no-store'})).json();await devices.claimRoot(claim.token);
      }
      await store.put('meta',{id:'authorized',value:true});await remote.check();
      const google=new GoogleSource(()=>auth.token(),fetch,()=>remote.check(),()=>auth.invalidate());
      const evidence={at:new Date().toISOString(),owner_session:true,pc_root:(await devices.list()).find(d=>d.id===store.device)?.role};
      const info=await fetch('https://oauth2.googleapis.com/tokeninfo?'+new URLSearchParams({access_token:await auth.token()}));
      if(!info.ok)throw Error('GOOGLE_TOKENINFO_FAILED');const tokenInfo=await info.json();
      evidence.scopes=tokenInfo.scope?.split(' ');evidence.provider_expires_in=Number(tokenInfo.expires_in);
      evidence.provider_refresh_token_present=!!(await client.auth.getSession()).data.session?.provider_refresh_token;
      await google.syncCalendar(store);
      const events=(await store.all('events')).filter(e=>!e.deleted_at);
      evidence.calendar={events:events.length,all_day:events.filter(e=>e.allDay).length,timezones:[...new Set(events.map(e=>e.timezone))],labels:(await store.get('meta','calendar-labels'))?.value};
      evidence.finance=finance(events,(await store.all('records')).filter(r=>!r.deleted_at));
      evidence.drive_folders=[];
      for(const [name,id]of Object.entries(TRIP.drive)){const f=await(await google.api(`drive/v3/files/${id}?fields=id,name,mimeType,parents`)).json();evidence.drive_folders.push({key:name,...f});}
      const files=await google.listDocuments();await store.put('meta',{id:'drive-files',value:files});evidence.drive_files=files.length;
      const candidate=files.find(f=>!f.mimeType.startsWith('application/vnd.google-apps.')&&Number(f.size||0)<5000000);
      if(candidate){const blob=await google.download(candidate);await store.put('blobs',{id:`drive:${candidate.id}`,blob});evidence.offline_document={id:candidate.id,bytes:blob.size};}
      const expenseId=crypto.randomUUID(),receiptId=crypto.randomUUID(),linkId=crypto.randomUUID();let uploaded=null,qaDevice=null;
      try{
        const expense=expenseSnapshots({description:'AV2 QA Google receipt — delete after validation',amount:0.01,currency:'USD',cost_status:'PAID',receipt_local_id:receiptId,receipt_name:`AV2-QA-${receiptId}.txt`,receipt_drive_id:null});
        await store.mutate('expenses',expenseId,expense,false,{id:receiptId,value:new Blob(['Agenda Viajera QA receipt, not a real expense.'],{type:'text/plain'})});
        const engine=new SyncEngine(store,remote,google);await engine.run();
        uploaded=(await store.get('records',expenseId)).data.receipt_drive_id;if(!uploaded)throw Error('QA_RECEIPT_NOT_CONFIRMED');
        const invitation=await devices.invite();qaDevice=crypto.randomUUID();const secondRemote=new SupabaseRemote(client,qaDevice,randomToken());
        await new Devices(secondRemote).enroll(invitation.token,'AV2 QA metadata receiver');
        try{await new Devices(secondRemote).revoke(store.device);throw Error('ROOT_REVOCATION_WAS_ALLOWED');}catch(error){if(!/ROOT_DEVICE_PROTECTED/.test(error.message))throw error;}
        evidence.root_server_protected=true;
        if(!(await secondRemote.pull()).some(r=>r.id===expenseId&&r.data.receipt_drive_id===uploaded))throw Error('QA_RECEIPT_METADATA_NOT_RECEIVED');
        evidence.qa_receipt={uploaded:true,metadata_received:true};
        const qaFile=await(await google.api('drive/v3/files/'+uploaded+'?fields=id,name,mimeType,webViewLink')).json();const qaBlob=await google.download(qaFile);await store.put('blobs',{id:'drive:'+uploaded,blob:qaBlob});evidence.qa_document={download_bytes:qaBlob.size,preview_link:!!qaFile.webViewLink,offline_cache:await globalThis.__av2ProbeOffline(uploaded)};if(!evidence.qa_document.offline_cache.offline||!evidence.qa_document.offline_cache.bytes)throw Error('QA_DOCUMENT_OFFLINE_CACHE_FAILED');if(events[0]){await store.mutate('document_links',linkId,{drive_file_id:uploaded,calendar_event_id:events[0].id});await engine.run();await store.mutate('document_links',linkId,{},true);await engine.run();await google.api('drive/v3/files/'+uploaded+'?fields=id,trashed');evidence.document_link_unlink=true;}
      }finally{
        if(qaDevice)await devices.revoke(qaDevice);
        if(uploaded){await google.trashDocument(uploaded);if(evidence.qa_receipt)evidence.qa_receipt.trashed=true;await store.transaction(['blobs'],tx=>tx.objectStore('blobs').delete('drive:'+uploaded));}
        const expense=await store.get('records',expenseId);if(expense&&!expense.deleted_at){await store.mutate('expenses',expenseId,{},true);await new SyncEngine(store,remote).run();}
        if(uploaded)await store.transaction(['blobs'],tx=>tx.objectStore('blobs').delete(receiptId));
      }
      location.hash='#home';return evidence;
    });
    privateJson('google-live-evidence.json',evidence);console.log(JSON.stringify({...evidence,calendar:{...evidence.calendar,labels:Object.keys(evidence.calendar.labels||{}).length},finance:{...evidence.finance,missing:evidence.finance.missing.length}}));
    await page.reload();
  }
}finally{await browser.close();}
