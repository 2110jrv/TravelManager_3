import{locationInput,validPoint}from'./location.js';
export class LocationCache{
 constructor(resolve,online=()=>navigator.onLine,now=()=>Date.now()){Object.assign(this,{resolve,online,now});}
 async refresh(store){
  const events=(await store.all('events')).filter(e=>!e.deleted_at),saved=(await store.get('meta','map-locations'))?.value||{},inputs=new Map();
  for(const event of events){const input=locationInput(event);if(input?.url&&!saved[input.key]?.point&&(!saved[input.key]||this.now()-saved[input.key].attempted_at>300000))inputs.set(input.key,input.url);}
  if(this.online())for(let offset=0;offset<inputs.size;offset+=16){const batch=[...inputs.values()].slice(offset,offset+16);try{const results=await this.resolve(batch);for(const result of results){if(!batch.includes(result.input))continue;const point=result.point; saved[result.input]={point:point&&validPoint(point.lat,point.lng)?point:null,name:result.name||null,source:'google-maps',attempted_at:this.now()};}}catch{/* Resolve failures preserve prior GPS and never fail Calendar synchronization. */}}
  await store.transaction(['events','meta'],tx=>{const records=tx.objectStore('events');for(const event of events){const request=records.get(event.id);request.onsuccess=()=>{const current=request.result;if(!current||current.deleted_at)return;const input=locationInput(current),cached=input&&saved[input.key],point=input?.point||cached?.point;const gps=point?{...point,source:input.source,input_key:input.key}:null;
   // Resolve latency must never overwrite a newer Calendar description/COST.
   records.put({...current,gps,location_key:input?.key||null,location_name:cached?.name||null,maps_url:input?.url||null});
  };}const meta=tx.objectStore('meta'),request=meta.get('map-locations');request.onsuccess=()=>{const previous=request.result?.value||{},merged={...previous,...saved};for(const key of Object.keys(previous))if(previous[key].point&&!saved[key]?.point)merged[key]=previous[key];meta.put({id:'map-locations',value:merged});};});
 }
}
