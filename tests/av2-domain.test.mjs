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
  const values = new Map([['meta:calendar-sync',{id:'calendar-sync',value:'expired'}],['events:event',normalizeEvent(raw())],['events:missing',normalizeEvent(raw('missing'))]]);
  const requests = []; let step = 0;
  const google = new GoogleSource(async () => 'token', async url => {
    requests.push(url);
    if (url.endsWith('/colors')) return Response.json({event:{}});
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
test('receipt retry finds existing Drive upload rather than duplicating it', async () => {
  let uploads = 0;
  const google = new GoogleSource(async () => 'token',async (url,options) => { if (options.method==='POST') uploads++; return Response.json({files:[{id:'existing-file'}]}); });
  assert.equal(await google.uploadReceipt(new Blob(['receipt']),'Receipt','local-id'),'existing-file'); assert.equal(uploads,0);
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
