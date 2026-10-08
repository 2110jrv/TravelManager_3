import {occursOn,localEventDate} from './domain.js';
import {chronological} from './itinerary.js';
import {locationInput,mapsUrls} from './location.js';
import {gpsFor} from './places.js';
import {mapsIdentity,pointKey,pinLocality} from './pin-identity.js';
import {cityList} from './event-cities.js';
const artificial=event=>/^\s*[✅☐]?\s*(?:ciudad|city|base)\s*:/i.test(event.title||'');
const cityKey=city=>city.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ');
const urls=pin=>[pin.url,pin.google_maps_url,pin.maps_url,pin.source_url,pin.resolved_url].filter(Boolean);
const ids=pin=>[pin.google_place_id,pin.place_id,...urls(pin).map(url=>mapsIdentity(url)).filter(key=>key?.startsWith('place:')).map(key=>key.slice(6))].filter(Boolean);
const references=pin=>[pin.pin_id,pin.pinId,pin.placeId,pin.poi_id,pin.poi_code,pin.location_id].filter(Boolean);
function candidates(records,locations){return [
 ...records.filter(r=>r.kind==='places_of_interest'&&!r.deleted_at&&!r.data?.deleted_at).map(r=>({...r.data,id:r.id})),
 ...Object.entries(locations).map(([url,p])=>({...p,url,city:p.city,gps:p.point})),
 ];}
export function matchPin(pin,places){
 let best=null,knownPoint=pin.gps||pin.coordinates;
 const priorities=[['place_id',p=>ids(pin).some(id=>ids(p).includes(id))],
  ['canonical_url',p=>urls(pin).some(url=>mapsIdentity(url)&&urls(p).some(other=>mapsIdentity(other)===mapsIdentity(url)))],
  ['explicit_pin',p=>references(pin).some(id=>[p.id,p.poi_code,...references(p)].includes(id))],
  ['coordinates',p=>pointKey(knownPoint)&&pointKey(knownPoint)===pointKey(p.gps||p.point||p)]];
 for(const [method,check] of priorities){const matches=places.filter(check);if(!matches.length)continue;
  const cities=[...new Set(matches.map(pinLocality).filter(Boolean).map(cityKey))];
  if(cities.length>1)return{method,candidates:matches,ambiguous:true,city:''};
  const place=matches.find(p=>pinLocality(p))||matches[0];const result={method,candidates:matches,place,city:pinLocality(place)};if(result.city)return result;if(!best)best=result;knownPoint ||= place.gps||place.point||place;
 }
 return best||{method:null,candidates:[],city:''};
}
function eventVisits(event,day){
 const explicit=cityList(event.cities);if(explicit.length)return explicit.map(city=>({city,explicit:true}));
 const endpoints=[];let hasEndpoints=false;
 for(const role of ['origin','destination']){
  const city=event[role+'_city']||pinLocality(event[role]),value=event[role+'_pin']||event[role+'Pin']||event[role+'_pin_id'];
  if(!city&&!value)continue;hasEndpoints=true;
  const date=role==='origin'?localEventDate(event,event.start):localEventDate({...event,timezone:event.end_timezone||event.timezone},event.end);
  if(date!==day)continue;
  if(city)for(const name of cityList(city))endpoints.push({city:name,role,explicit:true,source:'origin_destination'});
  else endpoints.push(typeof value==='object'?{...value,role}:{pin_id:value,role});
 }
 if(hasEndpoints)return endpoints;
 const input=locationInput(event),current=input&&event.location_key===input.key;
 const links=[...new Set([...mapsUrls(event.location),...mapsUrls(event.description)])];
 if(links.length)return links.map(url=>{
  const saved=(event.visited_places||[]).find(pin=>mapsIdentity(pin.url)&&mapsIdentity(pin.url)===mapsIdentity(url));
  const main=mapsIdentity(url)===mapsIdentity(input?.url);
  const refs=Object.fromEntries(['pin_id','pinId','placeId','poi_id','poi_code','location_id'].map(key=>[key,event[key]]).filter(([,value])=>value!=null));
  return {...saved,...refs,url,...(main?{gps:saved?.gps||gpsFor(event),google_place_id:saved?.google_place_id||event.google_place_id,city:saved?.city||(current?event.location_city:null)}:{})};
 });
 return [{...event,gps:gpsFor(event),city:(current?event.location_city:event.gps?.city)||pinLocality(event.structured_location)||pinLocality(event)}];
}
export function visitedCities(events,records,day,locations={}){
 const cities=[],seen=new Set(),incomplete=[],associations=[],places=candidates(records,locations);
 for(const event of events.filter(e=>occursOn(e,day)&&!artificial(e)).sort(chronological))for(const pin of eventVisits(event,day)){
  const match=pin.explicit?{method:pin.source||'EVENT_CITIES',candidates:[],city:pin.city}:matchPin(pin,places),city=match.ambiguous?'':match.city||pinLocality(pin)||pinLocality(event.structured_location)||pinLocality(event);
  const related=match.place||pin,point=pin.gps||related.gps||related.point||related;
  const missing=[...(!city?['city']:[]),...(!pin.explicit&&!pointKey(point)&&!ids(related).length&&!urls(related).length&&!references(pin).length?['pin']:[])];
  const row={event_id:event.id,title:event.title,day,role:pin.role||null,method:match.method,city,pin_id:match.place?.id||null,candidates:match.candidates.map(p=>p.id||p.url||p.source_url),cause:match.ambiguous?'ambiguous_place':missing.includes('pin')?'event_without_pin':!city?'pin_without_locality':null};
  associations.push(row);
  if(!city){incomplete.push({...row,missing});continue;}
  const key=cityKey(city);if(!seen.has(key)){seen.add(key);cities.push(city);}
 }
 return{cities,incomplete,associations};
}
export function itemCities(event,records,day,locations={}){if(artificial(event))return [];return cityList(event.cities).length?cityList(event.cities):visitedCities([event],records,day,locations).cities;}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function dayCityCards(events,records,days,selectedDay,locations={}){
 return days.map(day=>{
  const {cities,incomplete}=visitedCities(events,records,day,locations),date=new Date(day+'T12:00:00Z');
  return '<button data-action="day" data-id="'+day+'" class="'+(day===selectedDay?'active':'')+'" data-incomplete-associations="'+(cities.length?0:incomplete.length)+'"><span class="day-date"><span>'+new Intl.DateTimeFormat('en',{weekday:'short',timeZone:'UTC'}).format(date)+'</span><strong>'+Number(day.slice(8))+'</strong><span>'+new Intl.DateTimeFormat('en',{month:'short',timeZone:'UTC'}).format(date)+'</span></span><span class="day-cities">'+cities.map(city=>'<span>'+escape(city)+'</span>').join('')+'</span></button>';
 }).join('');
}

