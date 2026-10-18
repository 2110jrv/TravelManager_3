import {test} from 'node:test';import assert from 'node:assert/strict';
import {categoryFor,finance,normalizeEvent} from '../public/v2/domain.js';
import {agendaForDay,effectiveEnd} from '../public/v2/itinerary.js';
import {gpsFor,mapPlaces,mapsPinUrl} from '../public/v2/places.js';
const timed=(id,start,end,title=id)=>({id,title,start:`2026-10-21T${start}:00+02:00`,end:`2026-10-21T${end}:00+02:00`,timezone:'Europe/Rome',allDay:false});
test('named Google label always wins; unnamed and absent labels use semantic categories',()=>{
 assert.equal(categoryFor({title:'Pompei Plus',label:{name:'Mi categoría'}}),'Mi categoría');assert.equal(categoryFor({title:'In Footsteps of Paul'}),'Tour');assert.equal(categoryFor({title:'Pompei Plus',label:{name:'  '}}),'Tour');
 for(const title of ['Tren SBB','Pase ACTV','EAV Napoli','Vuelo United','Bus SITA','Pase transporte ATAC'])assert.equal(categoryFor({title}),'Transportation');assert.equal(categoryFor({title:'Airbnb Venecia'}),'ABB');assert.equal(categoryFor({title:'Alimentación'}),'Food');assert.equal(categoryFor({title:'Reunión'}),'Otros');
});
test('Tour original paid includes Colosseum 36, Footsteps 80 and Pompei 54.76 EUR',()=>{
 const tours=[['Colosseum & Roman Forum',36,{name:'Tour'}],['In Footsteps of Paul',80,null],['Pompei Plus',54.76,{name:null}]].map(([title,cost,label],i)=>({id:String(i),title,cost,label,currency:'EUR',cost_status:'PAID',exchange_rate:1.1235}));
 const f=finance(tours,[]);assert.equal(Number(f.by_category.Tour.by_currency.EUR.paid.toFixed(2)),170.76);assert.ok(f.by_category.Tour.paid>190);assert.equal(f.paid+f.estimated,f.projected);
});
test('intervals use the recorded final time including arrival markers',()=>{
 const arrival=timed('arrival','13:15','13:30','✅ ✈ LLEGADA UA126 FCO'),train=timed('train','15:38','16:10','Leonardo Express');assert.equal(effectiveEnd(arrival),Date.parse(arrival.start));let day=agendaForDay([train,arrival],'2026-10-21');assert.equal(day.gaps.get('arrival').label,'2 h 8 min libres');
 day=agendaForDay([timed('normal','13:15','13:30','Visita'),train],'2026-10-21');assert.equal(day.gaps.get('normal').minutes,128);
});
test('overlaps never fabricate free time and multiday/all-day contexts stay outside the agenda chain',()=>{
 const context=[{id:'city',title:'Ciudad: Roma',start:'2026-10-20T12:00:00+02:00',end:'2026-10-23T12:00:00+02:00',timezone:'Europe/Rome'},{id:'abb',title:'Airbnb',start:'2026-10-20',end:'2026-10-24',allDay:true},{id:'pass',title:'Pase ACTV',start:'2026-10-20',end:'2026-10-23',allDay:true}];
 const day=agendaForDay([...context,timed('long','09:00','13:00'),timed('short','10:00','11:00'),timed('inside','12:00','12:30'),timed('after','14:00','15:00')],'2026-10-21');assert.equal(day.context.length,3);assert.equal(day.agenda.length,4);assert.equal(day.gaps.size,3);assert.equal(day.gaps.get('long').minutes,-180);assert.equal(day.gaps.get('short').minutes,60);assert.equal(day.gaps.get('inside').minutes,90);
});
test('precise GPS is preserved and Maps links open search pins, never directions',()=>{
 const event={description:'<p>GPS:</p><p>40.646677, 14.408274</p>'};assert.deepEqual(gpsFor(event),{lat:40.646677,lng:14.408274});const url=mapsPinUrl(event);assert.equal(url,'https://www.google.com/maps/search/?api=1&query=40.646677,14.408274');assert.ok(!/dir|destination|navigation/.test(url));
 assert.equal(gpsFor({location:'Roma Termini'}),null);assert.equal(gpsFor({description:'GPS: 91.123456, 14.123456'}),null);assert.equal(gpsFor({description:'Prezzo 40.646677, 14.408274'}),null);
});
test('map places are chronological, retain repeated event locations and filter selected day',()=>{
 const a={...timed('a','09:00','10:00'),gps:{lat:40.646677,lng:14.408274}},b={...timed('b','11:00','12:00'),gps:a.gps};assert.deepEqual(mapPlaces([b,a,{id:'no-gps',start:a.start,end:a.end}]).map(e=>e.id),['a','b']);assert.equal(mapPlaces([a,b],'2026-10-22').length,0);
});
