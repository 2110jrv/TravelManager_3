import{test}from'node:test';import assert from'node:assert/strict';import{PGlite}from'@electric-sql/pglite';import{readFileSync}from'node:fs';
import{agendaForDay}from'../public/v2/itinerary.js';import{locationInput,locationLabel,pointFromMapsUrl,plusPoint,allowedMapsUrl}from'../public/v2/location.js';import{gpsFor,mapsPinUrl}from'../public/v2/places.js';import{LocationCache}from'../public/v2/location-cache.js';import{resolveMaps,resolveLocations}from'../supabase/functions/av2-google-token/locations.js';
const short='https://maps.app.goo.gl/76Uww5zdwCN3yMpG7',long='https://www.google.com/maps/place/Porta+Marina+e+cinta+muraria/@40.7483255,14.4825469,180m/data=!3m1!1e3!4m6!3m5!8m2!3d40.7485536!4d14.4831656',point={lat:40.7485536,lng:14.4831656};
const event=(id,title,start,end)=>({id,title,start:`2026-10-29T${start}:00+01:00`,end:`2026-10-29T${end}:00+01:00`,timezone:'Europe/Rome',label:{name:'Transportation'}});
test('real October 29 daily pass is context and never blocks 1h55 and 5min gaps',()=>{
 const pass=event('pass','☐ Pase diario de transporte (EAV / Pompeya-Herculano)','06:00','22:00'),pompei=event('pompei','Pompeya','09:00','13:00'),herculano=event('herculano','Herculano','14:55','15:55'),train=event('train','Tren Herculano → Piano di Sorrento','16:00','16:40');
 const day=agendaForDay([train,pass,herculano,pompei],'2026-10-29');assert.deepEqual(day.context.map(e=>e.id),['pass']);assert.equal(day.gaps.get('pompei').label,'1 h 55 min libres');assert.equal(day.gaps.get('herculano').label,'5 min libres');
});
test('explicit coordinates outrank Maps, which outranks Plus Code; viewport coordinates are never pins',()=>{
 assert.equal(locationInput({gps:{lat:40.123456,lng:14.123456},location:short}).source,'explicit');assert.equal(locationInput({location:short,description:'849VCWC8+R9'}).source,'google-maps');assert.deepEqual(pointFromMapsUrl(long),point);assert.equal(pointFromMapsUrl('https://www.google.com/maps/@40.123456,14.123456,15z'),null);assert.equal(pointFromMapsUrl('https://www.google.com/maps/dir/A/B/data=!3d40.123456!4d14.123456'),null);assert.equal(gpsFor({location:'Roma Termini'}),null);
});
test('full Plus Codes decode locally; short/invalid codes stay unresolved without an exact reference',()=>{
 const p=plusPoint('849VCWC8+R9');assert.ok(Math.abs(p.lat-37.4220625)<1e-8);assert.ok(Math.abs(p.lng+122.0840625)<1e-8);assert.equal(plusPoint('CWC8+R9 Mountain View'),null);assert.equal(plusPoint('ZZZZZZZZ+ZZ'),null);assert.equal(locationInput({location:'849VCWC8+R9'}).source,'plus-code');
});
test('backend follows only Maps redirects, extracts the exact place point and caches it once',async()=>{
 const cache=new Map(),repository={get:async input=>cache.get(input),save:async value=>cache.set(value.input,value)};let calls=0;
 const request=async(url,options)=>{calls++;assert.equal(options.redirect,'manual');assert.equal(url,short);return new Response(null,{status:302,headers:{location:long}});};
 const [result]=await resolveLocations([short],repository,request);assert.deepEqual(result.point,point);assert.equal(result.name,'Porta Marina e cinta muraria');assert.deepEqual(await resolveLocations([short],repository,request),[result]);assert.equal(calls,1);
});
test('resolver rejects SSRF, ambiguous points, broken links and cannot follow outside Google',async()=>{
 for(const value of ['http://maps.app.goo.gl/a','https://google.com.attacker.test/maps/a','https://www.google.com:444/maps/a','https://user:pass@www.google.com/maps/a','https://127.0.0.1/maps/a'])assert.equal(allowedMapsUrl(value),false);
 let calls=0;const result=await resolveMaps(short,async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://169.254.169.254/latest/meta-data/'}});});assert.equal(result.point,null);assert.equal(calls,1);
 assert.equal(pointFromMapsUrl(long+'!3d41.123456!4d15.123456'),null);assert.equal((await resolveMaps(short,async()=>{throw Error('offline');})).point,null);
});
function local(events){const buckets={events:new Map(events.map(e=>[e.id,e])),meta:new Map()};return{buckets,get:async(kind,id)=>buckets[kind].get(id),all:async kind=>[...buckets[kind].values()],transaction:async(_,fn)=>fn({objectStore:kind=>({put:row=>buckets[kind].set(row.id,row),get:id=>{const request={};queueMicrotask(()=>{request.result=buckets[kind].get(id);request.onsuccess?.();});return request;}})})};}
test('normalized location survives offline/reopen without the short URL; changed input invalidates old GPS',async()=>{
 const s=local([{id:'pompei',title:'Visita a Pompeya',location:short}]);let calls=0;const cache=new LocationCache(async()=>{calls++;return[{input:short,point,name:'Porta Marina · Pompei'}];},()=>true);
 await cache.refresh(s);let e=s.buckets.events.get('pompei');assert.deepEqual(gpsFor(e),point);assert.equal(locationLabel(e),'Porta Marina · Pompei');assert.equal(mapsPinUrl(e),'https://www.google.com/maps/search/?api=1&query=40.7485536,14.4831656');
 await new LocationCache(async()=>{throw Error('must not call offline');},()=>false).refresh(s);assert.deepEqual(gpsFor(s.buckets.events.get('pompei')),point);await cache.refresh(s);assert.equal(calls,1);
 s.buckets.events.set('pompei',{...e,location:'https://maps.app.goo.gl/DifferentPlace'});assert.equal(gpsFor(s.buckets.events.get('pompei')),null);assert.ok(!locationLabel(s.buckets.events.get('pompei')).includes('https://'));
 await new LocationCache(async()=>{throw Error('provider unavailable');},()=>true).refresh(s);assert.equal(gpsFor(s.buckets.events.get('pompei')),null);
});
test('normalized Supabase cache is service-only with coordinate constraints',async()=>{
 const db=new PGlite();try{await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create table public.av2_trips(id uuid primary key);grant usage on schema public to service_role,authenticated,anon;');await db.exec(readFileSync(new URL('../supabase/migrations/20261006030000_av2_map_locations.sql',import.meta.url),'utf8'));await db.exec('set role authenticated');await assert.rejects(db.query('select * from av2_map_locations'),/permission denied/);await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from av2_map_locations'),/permission denied/);}finally{await db.close();}
});
test('browser and Edge use the identical location parser',()=>{assert.equal(readFileSync(new URL('../public/v2/location.js',import.meta.url),'utf8').replace(/\r\n/g,'\n'),readFileSync(new URL('../supabase/functions/av2-google-token/location-parser.js',import.meta.url),'utf8').replace(/\r\n/g,'\n'));});
test('slow Maps resolution cannot overwrite a concurrent Calendar COST/description update',async()=>{const s=local([{id:'pompei',title:'Pompeya',location:short,cost:54.76,description:'old'}]);await new LocationCache(async()=>{s.buckets.events.set('pompei',{...s.buckets.events.get('pompei'),cost:99,description:'new external Calendar description'});return[{input:short,point,name:'Porta Marina'}];},()=>true).refresh(s);assert.equal(s.buckets.events.get('pompei').cost,99);assert.equal(s.buckets.events.get('pompei').description,'new external Calendar description');assert.deepEqual(gpsFor(s.buckets.events.get('pompei')),point);});
