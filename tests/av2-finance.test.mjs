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
import {formatMoney,formatTime,formatEventTime} from '../public/v2/format.js';
import {financialAudit} from '../public/v2/domain.js';
test('one currency formatter places symbol/prefix first across currencies and signed values',()=>{
 assert.equal(formatMoney(969.87),'$969.87');assert.equal(formatMoney(514.9,'EUR'),'€514.90');assert.equal(formatMoney(104,'CHF'),'CHF 104.00');assert.equal(formatMoney(1234.56),'$1,234.56');assert.equal(formatMoney(-10,'USD'),'-$10.00');assert.equal(formatMoney(null),'—');assert.equal(formatMoney(10,'EUR',{iso:true}),'€10.00 EUR');assert.match(formatMoney(10,'JPY'),/^¥10$/);
});
test('dual AM/PM and military formatter uses event-local zones, never the phone timezone',()=>{
 assert.equal(formatTime('2026-10-20T16:55:00-04:00','America/Puerto_Rico'),'4:55 PM (16:55)');assert.equal(formatTime('2026-10-20T20:47:00-04:00','America/New_York'),'8:47 PM (20:47)');assert.equal(formatTime('2026-10-20T22:35:00-04:00','America/New_York'),'10:35 PM (22:35)');assert.equal(formatTime('2026-10-21T13:15:00+02:00','Europe/Rome'),'1:15 PM (13:15)');assert.equal(formatTime('2026-10-24T07:50:00+02:00','Europe/Zurich'),'7:50 AM (07:50)');assert.equal(formatTime('2026-10-20T00:05:00-04:00'),'12:05 AM (00:05)');assert.equal(formatTime('2026-10-20T12:00:00-04:00'),'12:00 PM (12:00)');assert.equal(formatEventTime({allDay:true,start:'2026-10-21'}),'Todo el día');
});
test('PURCHASE_ID counts a joint reservation once; old eventId behavior and originals remain intact',()=>{
 const base={summary:'✅ Flight',start:{date:'2026-10-21'},end:{date:'2026-10-22'},description:'[AGENDA_VIAJERA] PURCHASE_ID=UA_A4FM57 COST=200 CURRENCY=USD COST_STATUS=PAID [/AGENDA_VIAJERA]'};
 const a=normalizeEvent({...base,id:'departure'}),b=normalizeEvent({...base,id:'arrival'}),c=normalizeEvent({...base,id:'return',description:base.description.replace('UA_A4FM57','UA_RETURN')});assert.equal(a.purchase_id,'UA_A4FM57');const f=finance([a,b,c],[]);assert.equal(f.paid,400);assert.equal(f.by_currency.USD.paid,400);assert.equal(a.cost,200);assert.equal(financialAudit([a,b])[0].states.includes('DUPLICATE_PURCHASE'),true);
 const old=base.description.replace('PURCHASE_ID=UA_A4FM57 ','');assert.equal(finance([normalizeEvent({...base,id:'a',description:old}),normalizeEvent({...base,id:'b',description:old})],[]).paid,400);
 const pending={...base,summary:'☐ Train',description:'[AGENDA_VIAJERA] PURCHASE_ID=TRAIN COST=10 CURRENCY=EUR COST_STATUS=ESTIMATED [/AGENDA_VIAJERA]'};assert.equal(finance([normalizeEvent({...pending,id:'one'}),normalizeEvent({...pending,id:'two'})],[],null,{EUR:{rate:1.2}}).estimated,12);
});
test('financial integrity separates missing paid/pending costs from zero and nonfinancial events',()=>{
 const raw={start:{date:'2026-10-21'},end:{date:'2026-10-22'}};const paid=normalizeEvent({...raw,id:'paid',summary:'✅ United',description:'Paid $900 outside structured block'}),pending=normalizeEvent({...raw,id:'pending',summary:'☐ Vaporetto'}),free=normalizeEvent({...raw,id:'free',summary:'Walk'}),zero=normalizeEvent({...raw,id:'zero',summary:'✅ Free',description:'[AGENDA_VIAJERA] COST=0 CURRENCY=USD COST_STATUS=PAID [/AGENDA_VIAJERA]'});
 assert.equal(paid.financial_state,'PAID_COST_MISSING');assert.equal(pending.financial_state,'ESTIMATE_MISSING');assert.equal(free.financial_state,'NON_FINANCIAL');assert.equal(zero.financial_state,'OK');const f=finance([paid,pending,free,zero],[]);assert.equal(f.partial,true);assert.equal(f.missing_costs.length,2);assert.equal(f.paid,0);assert.equal(f.financial_issues.length,2);assert.equal(f.audit.find(r=>r.id==='free').state,'NON_FINANCIAL');
 for(const[field,expected]of [['CURRENCY','MISSING_CURRENCY'],['COST_STATUS','MISSING_STATUS']]){const description='[AGENDA_VIAJERA] COST=20 CURRENCY=USD COST_STATUS=PAID [/AGENDA_VIAJERA]'.replace(new RegExp(field+'=[^ ]+'),'');assert.ok(financialAudit([normalizeEvent({...raw,id:'bad',summary:'✅ Paid',description})])[0].states.includes(expected));}
 const mismatch=normalizeEvent({...raw,id:'m',summary:'☐ Pending',description:'[AGENDA_VIAJERA] COST=20 CURRENCY=USD COST_STATUS=PAID [/AGENDA_VIAJERA]'});assert.ok(financialAudit([mismatch])[0].states.includes('SYMBOL_STATUS_MISMATCH'));
});
test('all-day formatter never invents midnight or a military time',()=>{const e=normalizeEvent({id:'stay',summary:'Hotel',start:{date:'2026-10-21'},end:{date:'2026-10-24'}});assert.equal(formatEventTime(e),'Todo el día');assert.doesNotMatch(formatEventTime(e),/AM|PM|00:00/);});
test('same instant uses each event zone and survives Europe daylight-saving transition',()=>{const instant='2026-10-25T06:50:00Z';assert.equal(formatEventTime({start:instant,timezone:'Europe/Zurich'}),'7:50 AM (07:50)');assert.equal(formatEventTime({start:instant,timezone:'America/Puerto_Rico'}),'2:50 AM (02:50)');});
