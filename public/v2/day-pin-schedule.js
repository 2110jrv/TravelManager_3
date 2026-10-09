import {TRIP} from './config.js';
import {occursOn} from './domain.js';
import {agendaForDay,chronological,agendaGaps} from './itinerary.js';
import {visitedCities,matchPin} from './day-cities.js';
import {cityKey,cityList} from './event-cities.js';
import {pinLocality} from './pin-identity.js';
import {mapsUrls} from './location.js';
import {gpsFor} from './places.js';
export const canSchedule=(access,user)=>Boolean(user?.authorized&&access?.user_id===user.id&&['ADMIN','TRAVELER'].includes(access.role)&&access.can_edit);
export async function scheduleId(trip,day,pin){
 const hex=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${trip}:${day}:${pin}`))),b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function scheduledInstant(day,time,timezone=TRIP.timezone){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Usa una hora válida.');
 const target=Date.parse(`${day}T${time}:00Z`);let instant=target;
 const format=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const local=value=>{const p=Object.fromEntries(format.formatToParts(new Date(value)).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`;};
 for(let i=0;i<3;i++)instant+=target-Date.parse(local(instant));
 if(local(instant)!==`${day}T${time}:00Z`)throw Error('Esta hora no existe en la zona horaria del viaje.');
 return new Date(instant).toISOString();
}
export function dayPlan(events,records,day,locations={}){
 const pins=records.filter(r=>r.kind==='places_of_interest'&&!r.deleted_at),schedules=records.filter(r=>r.kind==='day_pin_schedule'&&!r.deleted_at&&r.data.active&&r.data.date===day),scheduled=new Set(records.filter(r=>r.kind==='day_pin_schedule'&&!r.deleted_at&&r.data.active).map(r=>r.data.pin_id));
 const cities=cityList([...visitedCities(events,records,day,locations).cities,...schedules.map(s=>pinLocality(pins.find(p=>p.id===s.data.pin_id)?.data||{}))]),keys=new Set(cities.map(cityKey)),calendarPins=new Set(),places=pins.map(r=>({...r.data,id:r.id}));
 for(const e of events.filter(e=>occursOn(e,day))){
  const refs=[{...e,gps:gpsFor(e)},...(e.visited_places||[]),...[e.origin_pin||e.originPin||e.origin_pin_id,e.destination_pin||e.destinationPin||e.destination_pin_id].filter(Boolean).map(p=>typeof p==='object'?p:{pin_id:p}),...[...mapsUrls(e.location),...mapsUrls(e.description)].map(url=>({url,gps:locations[url]?.point}))];
  for(const ref of refs)for(const p of matchPin(ref,places).candidates)calendarPins.add(p.id);
 }
 const relevant=pins.filter(r=>cityList([pinLocality(r.data),...(r.data.assigned_areas||[])]).some(c=>keys.has(cityKey(c)))||(r.data.assignment_mode==='manual'&&(r.data.assigned_dates||[]).includes(day))).filter(r=>!calendarPins.has(r.id));
 const options=relevant.filter(r=>!scheduled.has(r.id)),base=agendaForDay(events,day);
 const items=schedules.flatMap(s=>{const pin=pins.find(p=>p.id===s.data.pin_id);if(!pin)return [];const start=s.data.start_time||s.data.scheduled_time;const end=s.data.end_time; return [{id:s.id,pin_id:pin.id,scheduled_pin:true,title:pin.data.name,description:pin.data.description,label:{name:pin.data.label||'Interés'},start:start?scheduledInstant(day,start):null,end:end?scheduledInstant(day,end):null,completed:!!s.data.completed,completed_at:s.data.completed_at||null,added_order:s.data.added_order||s.created_at,timezone:TRIP.timezone,location:pin.data.resolved_address||pinLocality(pin.data),cities:cityList([pinLocality(pin.data)]),pin}];});
 const agenda=[...base.agenda,...items].sort(chronological);return {...base,agenda,gaps:agendaGaps(agenda),options,cities,schedules,calendarPins,allScheduled:relevant.length>0&&options.length===0};
}
export async function saveSchedule(store,pin,day,time,details={}){
 if(!canSchedule((await store.get('meta','schedule-access'))?.value,store.activeUser))throw Error('Solo lectura.');
 if(!pin||pin.kind!=='places_of_interest'||pin.deleted_at)throw Error('Este pin no está disponible.');
 if(day<TRIP.start||day>TRIP.end)throw Error('Selecciona un día del viaje.');if(time)scheduledInstant(day,time);if(details.end_time)scheduledInstant(day,details.end_time);
 const all=await store.all('records');if(all.some(r=>r.kind==='day_pin_schedule'&&r.data.active&&!r.deleted_at&&r.data.pin_id===pin.id&&r.data.date!==day))throw Error('Este pin ya está programado en otro día.');const id=await scheduleId(TRIP.id,day,pin.id),old=await store.get('records',id);
 return store.mutate('day_pin_schedule',id,{date:day,pin_id:pin.id,scheduled_time:time||null,start_time:time||null,...details,active:true,added_order:old?.data.added_order||old?.created_at||new Date().toISOString(),created_by:old?.data.created_by||store.activeUser.id});
}
export async function removeSchedule(store,pin,day){
 if(!canSchedule((await store.get('meta','schedule-access'))?.value,store.activeUser))throw Error('Solo lectura.');
 const id=await scheduleId(TRIP.id,day,pin),old=await store.get('records',id);if(old?.data.active)await store.mutate('day_pin_schedule',id,{active:false});
}
