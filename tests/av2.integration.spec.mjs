import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
test('mobile shell, real Calendar snapshot, expense receipt, persistence and offline reload', async ({page,context}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/v2/?fixture=1'); await expect(page.getByRole('heading',{name:'Italia 2026',exact:true})).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.goto('/v2/#budget');
  const baseline=Number((await page.locator('.stat strong').first().innerText()).replace(/[^\d.-]/g,''));
  const snapshotPath = new URL('../.av2-private/calendar.json',import.meta.url);
  if (existsSync(snapshotPath)) {
    const snapshot = JSON.parse(readFileSync(snapshotPath,'utf8'));
    const ids = await page.evaluate(async () => { const {LocalStore}=await import('/v2/store.js'); const s=await new LocalStore().open(); return (await s.all('events')).map(x=>x.id); });
    expect(ids.sort()).toEqual(snapshot.events.map(x=>x.id).sort());
    await page.goto('/v2/#itinerary'); await expect(page.getByRole('link',{name:/SALIDA UA 2024/})).toBeVisible();
    await page.getByRole('link',{name:/SALIDA UA 2024/}).click(); await expect(page.getByRole('heading',{name:/SALIDA UA 2024/})).toBeVisible();
  }
  await page.goto('/v2/#expense/new'); await page.getByLabel('Descripción',{exact:true}).fill('Cena offline'); await page.getByLabel('Monto',{exact:true}).fill('25');
  await page.getByLabel('Foto o archivo de recibo').setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:Buffer.from('receipt')});
  await page.getByRole('button',{name:'Guardar gasto'}).click(); await expect(page.getByRole('heading',{name:'Cena offline'})).toBeVisible(); await page.getByRole('link').filter({has:page.getByRole('heading',{name:'Cena offline'})}).click();await page.getByText('Más detalles',{exact:true}).click();await expect(page.getByText(/Recibo: receipt.png/)).toBeVisible();await expect(page.getByRole('button',{name:'Quitar recibo del gasto'})).toBeVisible();await page.goto('/v2/#expenses');
  await context.setOffline(true); await page.reload(); await expect(page.getByRole('heading',{name:'Cena offline'})).toBeVisible();
  await page.locator('nav a[href="#settings"]').click();await page.getByRole('link',{name:'Presupuesto',exact:true}).click();
  await expect.poll(async()=>Number((await page.locator('.stat strong').first().innerText()).replace(/[^\d.-]/g,''))).toBeCloseTo(baseline+25);
  const state = await page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js'); const s=await new LocalStore().open(); return {records:await s.all('records'),queue:await s.all('outbox'),blobs:await s.all('blobs')};});
  expect(state.queue.length).toBe(1); expect(state.blobs.length).toBe(1); expect(state.blobs[0].uploaded).toBe(false);
  await page.screenshot({path:'test-results/av2-mobile.png',fullPage:true});
  await context.setOffline(false);
});
test('two installations, reconnect, document relation, concurrent fields, stale device and tombstones', async ({page}) => {
  await page.goto('/v2/');
  const result = await page.evaluate(async () => {
    const {LocalStore}=await import('/v2/store.js'),{SyncEngine}=await import('/v2/sync.js'),{mergeFields}=await import('/v2/domain.js');
    const a=await new LocalStore('av2-test-a').open(),b=await new LocalStore('av2-test-b').open();
    const server=new Map(),operations=new Map(); let version=0;
    const remote={check:async()=>{},pull:async()=>[...server.values()].map(x=>structuredClone(x)),apply:async op=>{
      if(operations.has(op.id)) return operations.get(op.id);
      const current=server.get(op.record_id); const merged=mergeFields(current,op);
      const record={...current,id:op.record_id,kind:op.kind,data:merged.record.data,version:++version,deleted_at:current?.deleted_at || (merged.conflicts.length ? null : op.deleted_at)};
      server.set(op.record_id,record); const result={record:structuredClone(record),conflicts:merged.conflicts};operations.set(op.id,result);return result;
    }};
    const sa=new SyncEngine(a,remote),sb=new SyncEngine(b,remote);
    await a.mutate('expenses','expense',{description:'Initial',amount:10,currency:'USD',cost_status:'PAID'});await sa.run();await sb.run();
    await a.mutate('expenses','expense',{description:'Device A'});await b.mutate('expenses','expense',{amount:20});await sa.run();await sb.run();await sa.run();
    const merged=(await a.get('records','expense')).data;
    await a.mutate('expenses','expense',{description:'A offline'});await b.mutate('expenses','expense',{description:'B offline'});await sa.run();await sb.run();
    const conflict=await b.all('conflicts');
    await a.mutate('document_links','relation',{calendar_event_id:'real-calendar-id',drive_file_id:'real-drive-id'});await sa.run();await sb.run();
    const relation=(await b.get('records','relation')).data;
    await a.mutate('expenses','expense',{},true);await sa.run();await b.mutate('expenses','expense',{amount:99});await sb.run();
    const tombstone=await b.get('records','expense');
    const deviceA=a.device,deviceB=b.device; a.db.close();const reloaded=await new LocalStore('av2-test-a').open();
    return {merged,conflict,relation,tombstone,deviceA,deviceB,reloaded:reloaded.device,pending:(await b.all('outbox')).length};
  });
  expect(result.deviceA).not.toBe(result.deviceB);expect(result.reloaded).toBe(result.deviceA);
  expect(result.merged).toEqual({description:'Device A',amount:20,currency:'USD',cost_status:'PAID'});
  expect(result.conflict[0]).toMatchObject({field:'description',current:'A offline',incoming:'B offline'});
  expect(result.relation.drive_file_id).toBe('real-drive-id');expect(result.tombstone.deleted_at).toBeTruthy();expect(result.tombstone.data.amount).toBe(20);expect(result.pending).toBe(0);
});
test('receipt persists across upload failure, retries and stores acknowledgement', async ({page}) => {
  await page.goto('/v2/');
  const result=await page.evaluate(async()=>{
    const{LocalStore}=await import('/v2/store.js'),{SyncEngine}=await import('/v2/sync.js');const s=await new LocalStore('av2-receipt-test').open();
    await s.mutate('expenses','e',{description:'Dinner',amount:10,currency:'USD',cost_status:'PAID',receipt_local_id:'receipt'},false,{id:'receipt',value:new Blob(['image'])});
    const records=new Map(); const remote={check:async()=>{},apply:async op=>{const record={id:op.record_id,kind:op.kind,data:{...records.get(op.record_id)?.data,...op.changes},version:1};records.set(record.id,record);return{record,conflicts:[]};},pull:async()=>[...records.values()]};
    let failed=false;try{await new SyncEngine(s,remote,{uploadReceipt:async()=>{throw Error('network failure');}}).run();}catch{failed=true;}
    const kept=!!(await s.get('blobs','receipt'));
    const success=new SyncEngine(s,remote,{uploadReceipt:async()=> 'drive-file'});await success.run();await success.run();
    return{failed,kept,receipt:(await s.get('records','e')).data.receipt_drive_id,blob:await s.get('blobs','receipt'),queue:(await s.all('outbox')).length};
  });
  expect(result).toMatchObject({failed:true,kept:true,receipt:'drive-file',queue:0});expect(result.blob.uploaded).toBe(true);
});
test('sequential offline edits keep queue order and survive sync without spurious conflicts',async({page})=>{
  await page.goto('/v2/');
  const result=await page.evaluate(async()=>{
    const {LocalStore}=await import('/v2/store.js'),{SyncEngine}=await import('/v2/sync.js'),{mergeFields}=await import('/v2/domain.js');
    const s=await new LocalStore('av2-queue-order').open();let record;const applied=[];
    await s.mutate('notes','note',{text:'First'});await s.mutate('notes','note',{text:'Second'});await s.mutate('notes','note',{text:'Third'});
    const remote={check:async()=>{},pull:async()=>[record],apply:async operation=>{applied.push(operation.changes.text);const result=mergeFields(record,operation);record={id:'note',kind:'notes',data:result.record.data,version:(record?.version||0)+1};return{record:structuredClone(record),conflicts:result.conflicts};}};
    await new SyncEngine(s,remote).run();return{applied,text:(await s.get('records','note')).data.text,conflicts:(await s.all('conflicts')).length};
  });expect(result).toEqual({applied:['First','Second','Third'],text:'Third',conflicts:0});
});
test('revocation purges sensitive local data and blocks uploads', async ({page}) => {
  await page.goto('/v2/');
  const result=await page.evaluate(async()=>{
    const{LocalStore}=await import('/v2/store.js'),{SyncEngine}=await import('/v2/sync.js');const s=await new LocalStore('av2-revocation-test').open();
    await s.mutate('expenses','e',{amount:1});await s.put('blobs',{id:'private',blob:new Blob(['private'])});let upload=false;
    try{await new SyncEngine(s,{check:async()=>{throw Error('AV2_DEVICE_REVOKED');}},{uploadReceipt:async()=>{upload=true;}}).run();}catch{}
    return {records:(await s.all('records')).length,blobs:(await s.all('blobs')).length,queue:(await s.all('outbox')).length,upload};
  }); expect(result).toEqual({records:0,blobs:0,queue:0,upload:false});
});
test('desktop layout and PWA scope do not overwrite legacy storage or caches', async ({page}) => {
  await page.setViewportSize({width:1440,height:1000}); await page.goto('/v2/');
  await expect(page.getByRole('heading',{name:'Italia 2026',exact:true})).toBeVisible();
  const manifest=await (await page.request.get('/v2/manifest.webmanifest')).json();expect(manifest.scope).toBe('./');expect(manifest.display).toBe('standalone');
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  const scope=await page.evaluate(async()=> (await navigator.serviceWorker.getRegistration()).scope);expect(scope).toContain('/v2/');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:'test-results/av2-desktop.png',fullPage:true});
});
test('normal runtime never loads the private Calendar fixture',async({page})=>{
 const reads=[];page.on('request',request=>{if(request.url().includes('local-calendar'))reads.push(request.url());});
 await page.goto('/v2/');await expect(page.getByRole('heading',{name:'Italia 2026',exact:true})).toBeVisible();
 const count=await page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const s=await new LocalStore().open();return(await s.all('events')).length;});expect(count).toBe(0);expect(reads).toEqual([]);
});
test('IndexedDB v1 upgrade retains records, outbox, blobs and installation identity',async({page})=>{
 await page.goto('/v2/');
 const result=await page.evaluate(async()=>{
  const identity=crypto.randomUUID();await new Promise((resolve,reject)=>{const request=indexedDB.open('av2-upgrade-fixture',1);request.onupgradeneeded=()=>{for(const name of ['records','events','outbox','conflicts','meta','blobs'])request.result.createObjectStore(name,{keyPath:'id'});};request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['records','outbox','blobs','meta'],'readwrite');tx.objectStore('meta').put({id:'device',value:identity});tx.objectStore('records').put({id:'note',kind:'notes',version:7,data:{text:'keep me'}});tx.objectStore('outbox').put({id:'operation',record_id:'note'});tx.objectStore('blobs').put({id:'ticket',blob:new Blob(['ticket'])});tx.oncomplete=()=>{db.close();resolve();};};});
  const{LocalStore}=await import('/v2/store.js');const s=await new LocalStore('av2-upgrade-fixture').open();return{identity:s.device===identity,version:s.db.version,secret:s.deviceToken.length,record:await s.get('records','note'),pending:(await s.all('outbox')).length,blobs:(await s.all('blobs')).length};
 });expect(result).toMatchObject({identity:true,version:2,secret:64,record:{version:7,data:{text:'keep me'}},pending:1,blobs:1});
});
test('explicit service worker update preserves IndexedDB and legacy caches',async({page})=>{
 await page.goto('/v2/');await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 const identity=await page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const s=await new LocalStore().open();await s.mutate('notes',crypto.randomUUID(),{text:'update-survivor'});await(await caches.open('legacy-cache-sentinel')).put('/sentinel',new Response('legacy'));return s.device;});
 await page.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js?test-update=2',{scope:'./'});});
 await expect.poll(()=>page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting)).toBe(true);
 await expect(page.locator('#update')).toBeVisible();await Promise.all([page.waitForEvent('load'),page.locator('#update').click()]);
 await expect(page.getByRole('heading',{name:'Italia 2026',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(async()=>navigator.serviceWorker.controller?.scriptURL.includes('test-update=2'))).toBe(true);
 const state=await page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const s=await new LocalStore().open();return{device:s.device,notes:(await s.all('records')).filter(x=>x.data?.text==='update-survivor').length,legacy:(await caches.keys()).includes('legacy-cache-sentinel')};});
 expect(state).toEqual({device:identity,notes:1,legacy:true});
});

test('offline expense create/delete/restore preserves one identity and advances dependent versions',async({page})=>{
 await page.goto('/v2/?fixture=1');const result=await page.evaluate(async()=>{
 const{LocalStore}=await import('/v2/store.js'),{SyncEngine}=await import('/v2/sync.js');const s=await new LocalStore().open();s.pinMode=true;s.activeUser={id:crypto.randomUUID(),authorized:true};const id=crypto.randomUUID();await s.mutate('expenses',id,{amount:10,currency:'USD',cost_status:'PAID',description:'Offline restoration'});await s.mutate('expenses',id,{},true);await s.restoreExpense(id);
 let remoteRecord=null,calls=0;const remote={check:async()=>{},apply:async operation=>{calls++;if(remoteRecord&&operation.base_version!==remoteRecord.version)throw Error('STALE_DEPENDENT_VERSION');remoteRecord={id,kind:'expenses',version:(remoteRecord?.version||0)+1,data:{...remoteRecord?.data,...operation.changes},deleted_at:operation.action==='restore'?null:operation.deleted_at};return{record:structuredClone(remoteRecord),conflicts:[]};},pull:async()=>[remoteRecord]};const engine=new SyncEngine(s,remote);await engine.run();await engine.run();return{calls,queued:(await s.all('outbox')).length,record:await s.get('records',id),copies:(await s.all('records')).filter(r=>r.id===id).length};});
 expect(result.calls).toBe(3);expect(result.queued).toBe(0);expect(result.copies).toBe(1);expect(result.record.deleted_at).toBeNull();expect(result.record.data.amount).toBe(10);
});
