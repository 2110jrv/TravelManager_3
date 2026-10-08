import{locationInput,validPoint,mapsUrls}from'./location.js';
export class LocationCache{
 constructor(resolve,online=()=>navigator.onLine,now=()=>Date.now()){Object.assign(this,{resolve,online,now});}
 async refresh(store){
  const events=(await store.all('events')).filter(e=>!e.deleted_at),saved=(await store.get('meta','map-locations'))?.value||{},inputs=new Map();
  for(const event of events)for(const url of new Set([...mapsUrls(event.location),...mapsUrls(event.description)])){if((!saved[url]?.point||!saved[url]?.details_checked)&&(!saved[url]||this.now()-saved[url].attempted_at>300000))inputs.set(url,url);}
  if(this.online())for(let offset=0;offset<inputs.size;offset+=16){const batch=[...inputs.values()].slice(offset,offset+16);try{const results=await this.resolve(batch);for(const result of results){if(!batch.includes(result.input))continue;const point=result.point;if(!point&&saved[result.input]?.point){saved[result.input]={...saved[result.input],attempted_at:this.now()};continue;} saved[result.input]={point:point&&validPoint(point.lat,point.lng)?point:null,name:result.name||null,address:result.address||null,city:result.city||null,place_id:result.place_id||null,details_checked:true,source:'google-maps',attempted_at:this.now()};}}catch{/* Resolve failures preserve prior GPS and never fail Calendar synchronization. */}}
  await store.transaction(['events','meta'],tx=>{const records=tx.objectStore('events');for(const event of events){const request=records.get(event.id);request.onsuccess=()=>{const current=request.result;if(!current||current.deleted_at)return;const input=locationInput(current),cached=input&&saved[input.key],point=input?.point||cached?.point;const gps=point?{...point,source:input.source,input_key:input.key}:null;
   // Resolve latency must never overwrite a newer Calendar description/COST.
   const visited_places=[...new Set([...mapsUrls(current.location),...mapsUrls(current.description)])].map(url=>({url,city:saved[url]?.city||null,google_place_id:saved[url]?.place_id||null,gps:saved[url]?.point||null}));
   records.put({...current,gps,location_key:input?.key||null,location_name:cached?.name||null,location_address:cached?.address||null,location_city:cached?.city||null,google_place_id:cached?.place_id||null,visited_places,maps_url:input?.url||null});
  };}const meta=tx.objectStore('meta'),request=meta.get('map-locations');request.onsuccess=()=>{const previous=request.result?.value||{},merged={...previous,...saved};for(const key of Object.keys(previous))if(previous[key].point&&!saved[key]?.point)merged[key]=previous[key];meta.put({id:'map-locations',value:merged});};});
 }
}
