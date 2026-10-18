import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, occursOn, finance, dateKey, mergeFields } from '../public/v2/domain.js';
import { GoogleSource } from '../public/v2/google.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const raw = (id = 'event') => ({ id, summary:'✅ Test', start:{date:'2026-10-21'}, end:{date:'2026-10-24'}, description:'[AGENDA_VIAJERA] COST=100 CURRENCY=USD COST_STATUS=PAID [/AGENDA_VIAJERA]' });
test('multiday event appears on every included day and counts once financially', () => {
  const e = normalizeEvent(raw());
  for (const day of ['2026-10-21','2026-10-22','2026-10-23']) assert.equal(occursOn(e,day),true);
  assert.equal(occursOn(e,'2026-10-24'),false);
  assert.equal(finance([e,e,e],[]).paid,100);
  assert.deepEqual(finance([e,e,e],[]).by_currency.USD,{paid:100,estimated:0,projected:100});
});
test('structured costs, prefixes and official labels remain independent', () => {
  const e = normalizeEvent({...raw(),event_label_id:'transport',description:'[AGENDA_VIAJERA]\nCOST=12.50\nCURRENCY=EUR\nCOST_STATUS=ESTIMATED\n[/AGENDA_VIAJERA]'}, {}, {transport:{name:'Transportation',background_color:'#123456'}});
  assert.equal(e.cost,12.5); assert.equal(e.cost_status,'ESTIMATED'); assert.equal(e.purchase_status,'PAID'); assert.equal(e.label.name,'Transportation');
  const none = normalizeEvent({...raw(),summary:'Hotel',description:''});
  assert.equal(none.cost_status,null); assert.equal(none.purchase_status,null); assert.equal(none.label,null);
  assert.equal(normalizeEvent({...raw(),description:'[AGENDA_VIAJERA] COST=invalid CURRENCY=USD COST_STATUS=PAID [/AGENDA_VIAJERA]'}).cost,null);
});
test('timezone and exclusive midnight end survive DST', () => {
  const e = normalizeEvent({...raw(),start:{dateTime:'2026-10-24T23:00:00+02:00',timeZone:'Europe/Rome'},end:{dateTime:'2026-10-26T00:00:00+01:00'}});
  assert.equal(occursOn(e,'2026-10-25'),true); assert.equal(occursOn(e,'2026-10-26'),false);
  assert.equal(dateKey(new Date('2026-10-20T23:30:00Z')),'2026-10-21');
});
test('multicurrency projection stays explicitly partial without rate', () => {
  const e = normalizeEvent({...raw(),description:'[AGENDA_VIAJERA] COST=20 CURRENCY=EUR COST_STATUS=PAID [/AGENDA_VIAJERA]'});
  const f = finance([e],[{id:'e',data:{amount:10,currency:'CHF',exchange_rate:1.2,cost_status:'ESTIMATED'}}],100);
  assert.equal(f.paid,0); assert.equal(f.estimated,12); assert.equal(f.projected,12); assert.equal(f.missing.length,1); assert.equal(f.budget,100);
  assert.deepEqual(f.by_currency.EUR,{paid:20,estimated:0,projected:20});
});
test('different fields merge, same field preserves alternatives, tombstone blocks stale edit', () => {
  const current = {id:'a',version:2,data:{description:'New',amount:10}};
  const op = {base_version:1,base:{description:'Old',amount:10},changes:{amount:20}};
  assert.deepEqual(mergeFields(current,op).record.data,{description:'New',amount:20});
  const conflict = mergeFields(current,{...op,changes:{description:'Offline'}});
  assert.equal(conflict.record.data.description,'New'); assert.equal(conflict.conflicts[0].incoming,'Offline');
  assert.equal(mergeFields({...current,deleted_at:'2026-10-05'},op).record.deleted_at,'2026-10-05');
});
test('Calendar pagination, 410 resync, and stable ID update are non-destructive', async () => {
  const values = new Map([['meta:calendar-sync',{id:'calendar-sync',value:'expired',query_version:2}],['events:event',normalizeEvent(raw())],['events:missing',normalizeEvent(raw('missing'))]]);
  const requests = []; let step = 0;
  const google = new GoogleSource(async () => 'token', async url => {
    requests.push(url);
    if (url.endsWith('/colors')) return Response.json({event:{}});
    if(url.includes('eventLabelVersion=1')&&!url.includes('/events?'))return Response.json({timeZone:'Europe/Rome',labelProperties:{eventLabels:[]}});
    step++; if (step===1) return new Response('',{status:410});
    if (step===2) return Response.json({items:[{...raw(),summary:'Updated'}],nextPageToken:'page2'});
    return Response.json({items:[raw('second')],nextSyncToken:'fresh'});
  });
  const store = {
    get:async (kind,id) => values.get(`${kind}:${id}`),
    all:async kind => [...values.entries()].filter(([key]) => key.startsWith(`${kind}:`)).map(([,value]) => value),
    transaction:async (kinds, callback) => callback({objectStore:kind => ({put:value => values.set(`${kind}:${value.id}`,value)})})
  };
  assert.equal(await google.syncCalendar(store),2);
  assert.equal(values.get('events:event').title,'Updated'); assert.ok(values.get('events:missing').deleted_at);
  assert.equal(values.get('meta:calendar-sync').value,'fresh'); assert.ok(requests.at(-1).includes('pageToken=page2'));
  assert.equal(requests.filter(url=>url.includes('syncToken=expired')).length,1);
});
test('failed Calendar page never acknowledges sync token or applies a partial import', async () => {
  let transactions = 0;
  const google = new GoogleSource(async () => 'token',async url => url.endsWith('/colors') ? Response.json({event:{}}) : new Response('',{status:403}));
  await assert.rejects(google.syncCalendar({get:async()=>null,transaction:async()=>transactions++}),/403/);
  assert.equal(transactions,0);
});
test('Google expiration persists across reopen and Supabase refresh without losing offline work', async () => {
  const {GoogleAuthorization}=await import('../public/v2/google-auth.js');
  const rows=new Map([['expense',{id:'expense',value:'offline work'}]]);
  const store={get:async(_,id)=>rows.get(id),transaction:async(_,fn)=>fn({objectStore:()=>({put:row=>rows.set(row.id,row),delete:id=>rows.delete(id)})})};
  const auth=new GoogleAuthorization(store);
  await auth.capture('SIGNED_IN',{provider_token:'initial'});
  const source=new GoogleSource(()=>auth.token(),async()=>new Response('',{status:401}),async()=>{},()=>auth.invalidate());
  await assert.rejects(source.api('calendar/v3/colors'),/expiró/);
  const reopened=new GoogleAuthorization(store);
  await reopened.capture('INITIAL_SESSION',{provider_token:'initial'});
  await reopened.capture('TOKEN_REFRESHED',{provider_token:'initial'});
  await reopened.capture('SIGNED_IN',{provider_token:'initial'});
  await assert.rejects(reopened.token(),/expiró/);
  assert.equal(rows.get('expense').value,'offline work');
  await reopened.capture('SIGNED_IN',{provider_token:'renewed'});
  assert.equal(await reopened.token(),'renewed');
});
test('Google request uses fetch without binding it to the source instance',async()=>{
  const google=new GoogleSource(async()=> 'token',function(){assert.equal(this,undefined);return Response.json({ok:true});});
  assert.equal((await(await google.api('calendar/v3/colors')).json()).ok,true);
});
test('receipt retry finds existing Drive upload rather than duplicating it', async () => {
  let uploads = 0;
  const google = new GoogleSource(async () => 'token',async (url,options) => { if (options.method==='POST') uploads++; return Response.json({files:[{id:'existing-file'}]}); });
  assert.equal(await google.uploadReceipt(new Blob(['receipt']),'Receipt','abcdef12'),'existing-file'); assert.equal(uploads,0);
});
test('both legacy service workers preserve v2 caches and ignore its private preview endpoint',async()=>{
  for(const name of ['sw.js','service-worker.js']) {
    const handlers={},removed=[];
    runInNewContext(readFileSync(new URL(`../public/${name}`,import.meta.url),'utf8'),{
      URL,fetch:()=>{throw Error('unexpected legacy fetch');},
      caches:{keys:async()=>['old-legacy','av2-shell-current'],delete:async key=>removed.push(key)},
      self:{location:{href:`http://127.0.0.1:5004/${name}`,origin:'http://127.0.0.1:5004'},clients:{claim:async()=>{}},addEventListener:(type,callback)=>{handlers[type]=callback;}}
    });
    let activation;handlers.activate({waitUntil:promise=>{activation=promise;}});await activation;
    assert.ok(!removed.includes('av2-shell-current'));assert.ok(removed.includes('old-legacy'));
    let intercepted=false;handlers.fetch({request:{method:'GET',url:'http://127.0.0.1:5004/v2/local-calendar',mode:'cors'},respondWith:()=>{intercepted=true;}});
    assert.equal(intercepted,false);
  }
});

import {CalendarRefresh} from '../public/v2/calendar-refresh.js';
test('external Calendar description updates replace the same cached eventId and recalculate purchase groups',async()=>{
 const old=normalizeEvent({...raw('flight-a'),description:'',summary:'✅ Flight'}),values=new Map([['events:flight-a',old],['meta:calendar-sync',{value:'old-token',query_version:2}],['records:expense',{id:'expense',data:{amount:9,currency:'USD',cost_status:'PAID'}}],['blobs:doc',{id:'doc',value:'offline document'}]]);
 const before=finance([old],[]);assert.equal(before.missing_costs.length,1);let cost=765.35;
 const store={get:async(k,id)=>values.get(`${k}:${id}`),all:async k=>[...values].filter(([key])=>key.startsWith(k+':')).map(([,value])=>value),transaction:async(_,fn)=>fn({objectStore:k=>({put:v=>values.set(`${k}:${v.id}`,v)})})};
 const urls=[],source=new GoogleSource(async()=> 'token',async url=>{urls.push(url);if(url.endsWith('/colors'))return Response.json({event:{}});if(!url.includes('/events?'))return Response.json({timeZone:'Europe/Rome',labelProperties:{eventLabels:[{id:'flight',name:'Flights',backgroundColor:'#abcdef'}]}});return Response.json({items:Array.from({length:8},(_,i)=>({...raw(i?'flight-'+i:'flight-a'),summary:'✅ United',eventLabelId:'flight',description:`[AGENDA_VIAJERA] COST=${cost} CURRENCY=USD COST_STATUS=PAID PURCHASE_ID=UA_A4FM57 [/AGENDA_VIAJERA]`})),nextSyncToken:'next'});});
 await source.syncCalendar(store);let f=finance(await store.all('events'),[]);assert.equal(f.paid,765.35);assert.equal(f.missing_costs.length,0);assert.equal(f.by_category.Flights.projected,765.35);assert.equal((await store.all('events')).length,8);assert.ok(urls.some(url=>url.includes('syncToken=old-token')));
 cost=800;await source.syncCalendar(store);f=finance(await store.all('events'),[]);assert.equal(f.paid,800);assert.equal(f.by_currency.USD.paid,800);assert.equal((await store.all('events')).length,8);assert.equal((await store.get('events','flight-a')).cost,800);assert.equal((await store.get('meta','calendar-sync')).value,'next');assert.equal((await store.get('records','expense')).data.amount,9);assert.equal((await store.get('blobs','doc')).value,'offline document');
});
test('reconnect and stale foreground trigger Calendar refresh; fresh foreground, hidden and offline do not',async()=>{
 let clock=100000,stamp=0,calls=0,online=true,visible=true,intervalCallback,intervals=0;const windowTarget=new EventTarget(),documentTarget=new EventTarget();
 const refresh=new CalendarRefresh({now:()=>clock,lastSync:async()=>new Date(stamp).toISOString(),available:async()=>online,visible:()=>visible,refresh:async()=>{calls++;stamp=clock;},setTimer:fn=>{intervalCallback=fn;intervals++;return intervals;},clearTimer:()=>{}});refresh.start(windowTarget,documentTarget);
 const settle=async()=>{await new Promise(r=>setImmediate(r));if(refresh.running)await refresh.running;};
 documentTarget.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(calls,1);clock+=30000;documentTarget.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(calls,1);
 clock+=31000;documentTarget.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(calls,2);windowTarget.dispatchEvent(new Event('online'));await settle();assert.equal(calls,3);
 online=false;clock+=400000;intervalCallback();await settle();assert.equal(calls,3);online=true;visible=false;documentTarget.dispatchEvent(new Event('visibilitychange'));intervalCallback();await settle();assert.equal(calls,3);
 visible=true;documentTarget.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(calls,4);clock+=300001;intervalCallback();await settle();assert.equal(calls,5);refresh.stop();
});
test('overlapping Calendar refresh triggers share one request and a failed refresh can retry',async()=>{
 let release,calls=0;const policy=new CalendarRefresh({lastSync:async()=>null,available:async()=>true,refresh:async()=>{calls++;await new Promise(r=>release=r);}});const a=policy.request({force:true}),b=policy.request({force:true});assert.equal(a,b);await new Promise(r=>setImmediate(r));assert.equal(calls,1);release();await a;
 policy.refresh=async()=>{throw Error('network failure');};await assert.rejects(policy.request({force:true}),/network failure/);policy.refresh=async()=>calls++;await policy.request({force:true});assert.equal(calls,2);
});
