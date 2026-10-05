import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeEvent,finance,occursOn,validCurrency} from '../public/v2/domain.js';
import {expenseSnapshots,ReferenceRates} from '../public/v2/fx.js';
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
