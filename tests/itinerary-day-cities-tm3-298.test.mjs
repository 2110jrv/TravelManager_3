import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {visitedCities,dayCityCards} from '../public/v2/day-cities.js';
import {normalizeEvent} from '../public/v2/domain.js';
import {LocationCache} from '../public/v2/location-cache.js';
const day='2026-10-22';
const event=(id,city,hour=9)=>({id,title:id,start:`${day}T${String(hour).padStart(2,'0')}:00:00+02:00`,end:`${day}T${String(hour+1).padStart(2,'0')}:00:00+02:00`,timezone:'Europe/Rome',city,gps:{lat:45.4,lng:12.3,city}});
test('single city, deduplication, visit order and three date lines',()=>{
 const a=event('a','Venecia'),b=event('b','Murano',11),c=event('c','Burano',13);
 assert.deepEqual(visitedCities([a],[],day).cities,['Venecia']);
 assert.deepEqual(visitedCities([c,b,event('repeat','Venecia',10),a],[],day).cities,['Venecia','Murano','Burano']);
 assert.match(dayCityCards([a,b,c],[],[day],day),/Thu<\/span><strong>22<\/strong><span>Oct/);
 assert.deepEqual(visitedCities([{...a,title:'Ciudad: Artificial',city:'Artificial'}],[],day).cities,[]);
});
test('timezone boundary uses existing event timezone and does not guess missing cities',()=>{
 const a={...event('midnight','Roma'),start:'2026-10-21T22:15:00Z',end:'2026-10-21T22:30:00Z'};
 assert.deepEqual(visitedCities([a],[],day).cities,['Roma']);
 assert.deepEqual(visitedCities([a],[],'2026-10-21').cities,[]);
 const unknown={...event('missing',''),gps:null,location:'Hotel anywhere'};
 const result=visitedCities([unknown],[],day);assert.deepEqual(result.cities,[]);assert.deepEqual(result.incomplete[0].missing,['city','pin']);
});
test('exact pin relation resolves city; optional nearby places never imply visits',()=>{
 const a={...event('pin',''),google_place_id:'same'};
 const records=[{kind:'places_of_interest',id:'p',data:{google_place_id:'same',resolved_city:'Sorrento'}},{kind:'places_of_interest',id:'optional',data:{resolved_city:'Amalfi',assigned_dates:[day]}}];
 assert.deepEqual(visitedCities([a],records,day).cities,['Sorrento']);
 assert.deepEqual(visitedCities([a],[{...records[0],deleted_at:'deleted'}],day).cities,[]);
});
test('multiple real pin associations within a transfer retain their listed order',()=>{
 const first='https://maps.app.goo.gl/First123',second='https://maps.app.goo.gl/Second123';
 const a={...event('transfer',''),location:first,description:second,visited_places:[{url:first,city:'Sorrento',gps:{lat:40,lng:14}},{url:second,city:'Amalfi',gps:{lat:40.6,lng:14.6}}]};
 assert.deepEqual(visitedCities([a],[],day).cities,['Sorrento','Amalfi']);
 assert.deepEqual(visitedCities([{...a,description:''}],[],day).cities,['Sorrento']);
});
test('location synchronization persists city and pin ID; offline reuses the cached city',async()=>{
 const buckets={events:new Map(),meta:new Map()},url='https://maps.app.goo.gl/AbCdEf123';
 buckets.events.set('e',{...event('e',''),gps:null,location:url});
 const store={all:async name=>[...buckets[name].values()],get:async(name,id)=>buckets[name].get(id),transaction:async(names,fn)=>{const pending=[];fn({objectStore:name=>({put:r=>buckets[name].set(r.id,r),get:id=>{const request={result:buckets[name].get(id)};pending.push(()=>request.onsuccess?.());return request;}})});pending.forEach(fn=>fn());}};
 await new LocationCache(async()=>[{input:url,point:{lat:45.4,lng:12.3},city:'Venecia',place_id:'place-1'}],()=>true).refresh(store);
 assert.equal(buckets.events.get('e').google_place_id,'place-1');
 assert.deepEqual(visitedCities(await store.all('events'),[],day).cities,['Venecia']);
 await new LocationCache(()=>{throw Error('offline must not resolve')},()=>false).refresh(store);
 assert.deepEqual(visitedCities(await store.all('events'),[],day).cities,['Venecia']);
 buckets.events.set('e',{...buckets.events.get('e'),location:'Unknown location'});
 await new LocationCache(()=>[],()=>false).refresh(store);
 assert.deepEqual(visitedCities(await store.all('events'),[],day).cities,[]);
});
test('available real Calendar snapshot reports unresolved associations without inventing cities',{skip:!existsSync(new URL('../.av2-private/calendar.json',import.meta.url))},()=>{
 const snapshot=JSON.parse(readFileSync(new URL('../.av2-private/calendar.json',import.meta.url),'utf8'));
 const events=snapshot.events.map(e=>normalizeEvent(e));
 const dates=[...new Set(events.map(e=>e.start.slice(0,10)))];
 const incomplete=dates.flatMap(date=>visitedCities(events,[],date).incomplete);
 assert.ok(incomplete.length>0);
 console.log(JSON.stringify({real_snapshot:snapshot.captured_at,events:events.length,incomplete_associations:incomplete.length,event_ids:[...new Set(incomplete.map(x=>x.event_id))]}));
});
