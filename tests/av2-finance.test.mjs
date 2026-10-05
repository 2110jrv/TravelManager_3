import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeEvent,finance,occursOn,validCurrency} from '../public/v2/domain.js';
import {expenseSnapshots,ReferenceRates,FrankfurterProvider,calendarFxId} from '../public/v2/fx.js';
const event=description=>normalizeEvent({id:'e',summary:'☐ Pending',description,start:{date:'2026-10-21'},end:{date:'2026-10-24'}});
test('missing or invalid structured finance is nonfinancial with a warning, never an unrelated price',()=>{
 const outside=event('Total Paid $900');assert.equal(outside.cost,null);assert.equal(outside.cost_status,null);
 for(const text of ['COST=-1 CURRENCY=EUR COST_STATUS=PAID','COST=20 CURRENCY=XYZ COST_STATUS=PAID','COST=20 CURRENCY=EUR COST_STATUS=UNKNOWN']){
  const e=event(`Other price 100\n[AGENDA_VIAJERA] ${text} [/AGENDA_VIAJERA]`);assert.equal(e.cost_status,null);assert.equal(e.warnings.length,1);
 }
 const valid=event('[AGENDA_VIAJERA]\nCOST=16.40\nCURRENCY=EUR\nCOST_STATUS=ESTIMATED\n[/AGENDA_VIAJERA]');assert.equal(valid.cost,16.4);assert.equal(valid.warnings.length,0);
 const inconsistent=event('[AGENDA_VIAJERA] COST=20 CURRENCY=EUR COST_STATUS=PAID [/AGENDA_VIAJERA]');assert.equal(inconsistent.cost,20);assert.equal(inconsistent.warnings.length,1);
});
test('PAID FX snapshot stays fixed when reference rates change; ESTIMATED can project at a newer rate',()=>{
 const paid=expenseSnapshots({amount:100,currency:'EUR',exchange_rate:1.1,cost_status:'PAID'});
 const edited=expenseSnapshots({...paid,exchange_rate:1.4,notes:'edited'},paid);assert.equal(edited.amount_base,110.00000000000001);assert.equal(edited.fx_rate_to_base,1.1);
 const expenses=[{id:'p',data:edited},{id:'e',data:{...paid,cost_status:'ESTIMATED'}}];
 const f=finance([],expenses,null,{EUR:{rate:1.4}});assert.ok(Math.abs(f.paid-110)<1e-9);assert.equal(f.estimated,140);
 assert.equal(validCurrency('JPY'),true);assert.equal(validCurrency('XYZ'),false);
});
test('safe FX fallback never invents a foreign conversion',async()=>{assert.equal(await new ReferenceRates().get('CHF'),null);assert.equal((await new ReferenceRates().get('USD')).rate,1);});
test('reference provider validates rates and date cache survives offline and provider failure',async()=>{
 const rows=new Map(),store={get:async(_,id)=>rows.get(id),transaction:async(_,fn)=>fn({objectStore:()=>({put:row=>rows.set(row.id,row)})})};let online=true,calls=0;
 const provider=new FrankfurterProvider(async()=>{calls++;return Response.json({date:'2026-10-01',base:'CHF',quote:'USD',rate:1.25});});
 const service=new ReferenceRates(provider,store,()=>online),first=await service.get('CHF');assert.equal(first.rate,1.25);assert.equal(first.source,'Frankfurter · fuentes oficiales');assert.equal(rows.get('fx:USD:CHF:2026-10-01').value.rate,1.25);
 online=false;const offline=await service.get('CHF');assert.equal(offline.cached,true);assert.equal(offline.stale,true);assert.equal(calls,1);assert.equal(await service.get('JPY'),null);
 online=true;provider.request=async()=>{throw Error('provider outage');};const failure=await service.get('CHF','USD',true);assert.equal(failure.rate,1.25);assert.equal(failure.unavailable,true);
 const bad=new FrankfurterProvider(async()=>Response.json({date:'2026-10-01',base:'EUR',quote:'USD',rate:-1}));await assert.rejects(bad.get('EUR'),/FX_INVALID_RESPONSE/);
});
test('actual USD charge overrides PAID reporting while the original currency and snapshot remain intact',()=>{
 const paid=expenseSnapshots({amount:100,currency:'EUR',cost_status:'PAID'}, {},{rate:1.1,rate_date:'2026-10-01',source:'reference'});
 const edited=expenseSnapshots({...paid,actual_base_amount:118},paid,{rate:1.4,rate_date:'2026-10-05',source:'updated'});
 assert.equal(edited.rate_date,'2026-10-01');assert.equal(edited.fx_rate_to_base,1.1);assert.equal(edited.amount_original,100);assert.equal(edited.currency_original,'EUR');
 const f=finance([],[{id:'p',data:edited}],200,{EUR:{rate:1.4}});assert.equal(f.paid,118);assert.equal(f.difference,82);assert.equal(f.by_currency.EUR.paid,100);
 const identity=expenseSnapshots({amount:10,currency:'USD',cost_status:'PAID',actual_base_amount:12});assert.equal(finance([],[{id:'u',data:identity}]).paid,12);
 assert.ok(Math.abs(finance([],[{id:'e',data:{...edited,cost_status:'ESTIMATED'}}]).estimated-110)<1e-9);
});
test('stable Calendar financial snapshot identity changes only with its original amount or currency',async()=>{
 const e={id:'event',cost:44,currency:'EUR'};assert.equal(await calendarFxId('trip',e),await calendarFxId('trip',{...e,title:'changed'}));assert.notEqual(await calendarFxId('trip',e),await calendarFxId('trip',{...e,cost:45}));
});
test('flight origin timezone remains local, even when its UTC date differs',()=>{
 const e=normalizeEvent({id:'ua',summary:'SALIDA',start:{dateTime:'2026-10-20T22:35:00-04:00',timeZone:'America/New_York'},end:{dateTime:'2026-10-20T22:50:00-04:00',timeZone:'America/New_York'}});
 assert.equal(e.timezone,'America/New_York');assert.equal(occursOn(e,'2026-10-20'),true);assert.equal(occursOn(e,'2026-10-21'),false);
});
test('real trip lodging and 72-hour pass span days and are financially counted once',{skip:!process.env.AV2_REAL_FIXTURE},()=>{
 const snapshot=JSON.parse(readFileSync(new URL('../.av2-private/calendar.json',import.meta.url),'utf8'));
 const labels=Object.fromEntries(snapshot.labels.map(x=>[x.id,x]));const events=snapshot.events.map(x=>normalizeEvent(x,{},labels));
 const lodging=events.find(x=>x.label?.name==='ABB'&&x.cost_status==='PAID'&&x.currency==='USD');
 const pass=events.find(x=>x.id==='9ngvls8irc78kbudtt3n3g6qe0');
 assert.ok(lodging);assert.ok(occursOn(lodging,'2026-10-22'));assert.ok(occursOn(lodging,'2026-10-23'));
 assert.equal(finance([lodging,lodging,lodging],[]).paid,532.97);
 assert.ok(pass);for(const day of ['2026-11-02','2026-11-03','2026-11-04','2026-11-05'])assert.ok(occursOn(pass,day));assert.equal(pass.cost,44);assert.equal(pass.currency,'EUR');
 assert.equal(finance([pass,pass],[]).missing.length,1);
});
