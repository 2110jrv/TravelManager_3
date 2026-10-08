import test from 'node:test';import assert from 'node:assert/strict';
import {mapsIdentity,pinLocality} from '../public/v2/pin-identity.js';
import {visitedCities,matchPin} from '../public/v2/day-cities.js';
import {normalizeEvent} from '../public/v2/domain.js';
const day='2026-10-22',event={id:'event',title:'Roma Termini',start:day+'T09:00:00+02:00',end:day+'T10:00:00+02:00',timezone:'Europe/Rome'};
const place=(id,city,extra={})=>({id,kind:'places_of_interest',data:{resolved_city:city,...extra}});
test('canonical URLs ignore tracking, trailing slash and encoding; search names are not identities',()=>{
 assert.equal(mapsIdentity('https://maps.app.goo.gl/AbC123/?utm_source=share'),mapsIdentity('https://maps.app.goo.gl/AbC123'));
 assert.equal(mapsIdentity('https://www.google.com/maps/search/?query=Station&query_place_id=ChIJ123456789&entry=ttu'),'place:ChIJ123456789');
 assert.equal(mapsIdentity('https://www.google.com/maps/search/?query=Station'),null);
 assert.equal(mapsIdentity('https://www.google.com/maps/place/X/data=!1s0x123%3A0x456'),'fid:0x123:0x456');
});
test('matching prioritizes place ID, canonical pin URL, explicit reference, then exact coordinates',()=>{
 const a={id:'a',google_place_id:'first',resolved_city:'A'},b={id:'b',google_maps_url:'https://maps.app.goo.gl/Second123',resolved_city:'B'},c={id:'c',resolved_city:'C',lat:40,lng:14};
 assert.equal(matchPin({google_place_id:'first',url:b.google_maps_url,pin_id:'c'},[a,b,c]).city,'A');
 assert.equal(matchPin({url:b.google_maps_url+'/?utm_source=share',pin_id:'c'},[a,b,c]).city,'B');
 assert.equal(matchPin({pin_id:'c'},[a,b,c]).method,'explicit_pin');
 assert.equal(matchPin({gps:{lat:40,lng:14}},[c]).method,'coordinates');
 assert.equal(matchPin({gps:{lat:40.0001,lng:14}},[c]).city,'');
 assert.equal(matchPin({gps:{lat:40,lng:14}},[c,{...c,id:'d',resolved_city:'D'}]).ambiguous,true);
});
test('short and long pins share an existing cached point, even when names differ',()=>{
 const url='https://maps.app.goo.gl/Cache123';
 const locations={[url]:{point:{lat:40,lng:14},name:'Station'}};
 const records=[place('p','Roma',{google_maps_url:'https://www.google.com/maps/?q=40.000000,14.000000',lat:40,lng:14,name:'Different pin name'})];
 const result=visitedCities([{...event,location:url}],records,day,locations);
 assert.deepEqual(result.cities,['Roma']);assert.equal(result.associations[0].method,'coordinates');
});
test('explicit references survive Calendar normalization and do not require a private pin copy',()=>{
 const raw={id:'event',summary:'Different event name',start:{dateTime:event.start,timeZone:event.timezone},end:{dateTime:event.end},extendedProperties:{private:{pin_id:'existing'}}};
 const result=visitedCities([normalizeEvent(raw)],[place('existing','Pisa')],day);
 assert.deepEqual(result.cities,['Pisa']);assert.equal(result.incomplete.length,0);
});
test('transport endpoint pins contribute origin then destination on their actual local days',()=>{
 const records=[place('from','Roma'),place('to','Firenze')];
 assert.deepEqual(visitedCities([{...event,origin_pin_id:'from',destination_pin_id:'to'}],records,day).cities,['Roma','Firenze']);
 const overnight={...event,start:'2026-10-22T23:30:00+02:00',end:'2026-10-23T01:30:00+02:00',origin_pin_id:'from',destination_pin_id:'to'};
 assert.deepEqual(visitedCities([overnight],records,day).cities,['Roma']);
 assert.deepEqual(visitedCities([overnight],records,'2026-10-23').cities,['Firenze']);
});
test('cities come from locality fields or explicit postal addresses, never event/attraction names',()=>{
 assert.equal(pinLocality({name:'Roma Termini'}),'');assert.equal(pinLocality({name:'Torre di Pisa'}),'');
 assert.equal(pinLocality({address:{addressLocality:'Pisa'}}),'Pisa');
 assert.equal(pinLocality({name:'Via Bona Lombarda, 36, 23037 Tirano SO, Italy'}),'Tirano');
 assert.deepEqual(visitedCities([event],[place('optional','Roma',{assigned_dates:[day]})],day).cities,[]);
});
