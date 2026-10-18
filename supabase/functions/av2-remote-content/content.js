export const READ_TOOLS=['list_places','get_place','get_audio_guide','get_place_guide','get_place_notes','list_content_history','get_itinerary','get_sync_status','list_zones','list_routes','list_travel_records'];
// A content grant never exposes Calendar or unfiltered route/journey payloads.
export const CONTENT_EXCLUDED_TOOLS=['get_itinerary','list_routes','list_travel_records'];
export const WRITE_TOOLS=['create_place','update_audio_guide','update_place_guide','update_place_notes','update_place_metadata','rollback_content'];
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
export class ContentError extends Error{constructor(code,status=400){super(code);this.status=status;}}
const fail=(code,status)=>{throw new ContentError(code,status);};
export function validateCall(tool,args={}){
 if(!READ_TOOLS.includes(tool)&&!WRITE_TOOLS.includes(tool))fail('UNKNOWN_TOOL',404);
 if(!object(args))fail('INVALID_ARGUMENTS');
 const allowed=['place_id','expected_version','request_id','patch','history_id','limit','after'];
 if(Object.keys(args).some(k=>!allowed.includes(k)))fail('UNKNOWN_FIELD');
 if(args.place_id!=null&&!uuid(args.place_id)||args.history_id!=null&&!uuid(args.history_id)||args.after!=null&&!uuid(args.after))fail('INVALID_ID');
 if(tool.startsWith('get_')&&!['get_itinerary','get_sync_status'].includes(tool)&&!uuid(args.place_id))fail('PLACE_ID_REQUIRED');
 if(tool==='list_content_history'&&!uuid(args.place_id))fail('PLACE_ID_REQUIRED');
 if(args.limit!=null&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>100))fail('INVALID_LIMIT');
 if(WRITE_TOOLS.includes(tool)){
  if(!uuid(args.request_id)||!Number.isSafeInteger(args.expected_version)||args.expected_version<0)fail('VERSION_AND_REQUEST_ID_REQUIRED');
  if(tool==='rollback_content'){if(!uuid(args.history_id)||args.patch!=null)fail('INVALID_ROLLBACK');}
  else{
   if(!uuid(args.place_id)||!object(args.patch)||!Object.keys(args.patch).length||JSON.stringify(args.patch).length>120000)fail('INVALID_PATCH');
   const keys=tool==='update_audio_guide'?['audio_guide']:tool==='update_place_notes'?['description']:tool==='update_place_guide'?['experience','affinity','prices','sources_say','safety','questions','dairy','limitations','sources','reviewed_at']:tool==='create_place'?['name','description','label','priority','lat','lng','google_maps_url','google_place_id','resolved_address','resolved_city','coordinates_verified']:['label','priority','lat','lng','google_maps_url','google_place_id','resolved_address','resolved_city','coordinates_verified'];
   if(Object.keys(args.patch).some(k=>!keys.includes(k)))fail('FIELD_NOT_ALLOWED');
   for(const key of ['audio_guide','description'])if(key in args.patch&&(typeof args.patch[key]!=='string'||args.patch[key].length>(key==='description'?4000:80000)))fail('INVALID_TEXT');
   if(tool==='create_place'&&(typeof args.patch.name!=='string'||!args.patch.name.trim()||args.patch.name.length>250||privatePlace({data:args.patch})))fail('INVALID_PUBLIC_PLACE');
   if('lat'in args.patch||'lng'in args.patch){const{lat,lng,coordinates_verified,google_maps_url}=args.patch;if(lat!==null||lng!==null){if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||coordinates_verified!==true||!/^https:\/\//.test(google_maps_url||''))fail('VERIFIED_PUBLIC_COORDINATES_REQUIRED');}}
   if(args.patch.google_maps_url!=null){let u;try{u=new URL(args.patch.google_maps_url);}catch{fail('INVALID_HTTPS_URL');}if(u.protocol!=='https:'||u.username||u.password)fail('INVALID_HTTPS_URL');}
  }
 }
 return structuredClone(args);
}
export const privatePayload=d=>!!d&&(d.private===true||d.is_private===true||d.geo?.private===true||d.privacy?.private===true||d.permissions?.remote_access===false||['private','restricted'].includes(d.visibility)||['private','restricted'].includes(d.privacy));
export const privatePlace=(p,records=[])=>privatePayload(p)||privatePayload(p.data)||/(?:^| )(?:casa|home|hogar|domicilio|residencia)(?: |$)|^(?:mi)?casa/.test(String(p.data?.name||p.name||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim())||records.some(r=>r.data?.place_id===p.id&&(privatePayload(r.data)||privatePayload(r.data?.guide)));
export async function guideRecordId(trip,id){const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('place_guide:'+trip+':'+id)));b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const s=Array.from(b.slice(0,16),x=>x.toString(16).padStart(2,'0')).join('');return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);}
export async function contentCall(tool,input,context){
 const args=validateCall(tool,input),{rpc,credentials,canWrite,itinerary}=context;
 if(WRITE_TOOLS.includes(tool)){
  if(!canWrite)fail('READ_ONLY',403);
  const patch={...args.patch};
  const request={tool,request_id:args.request_id,expected_version:args.expected_version,...(args.place_id?{place_id:args.place_id}:{}),...(args.history_id?{history_id:args.history_id}:{patch})};
  if(tool==='create_place'&&args.expected_version!==0)fail('CREATE_REQUIRES_VERSION_ZERO');
  if(['update_audio_guide','update_place_guide'].includes(tool))request.record_id=await guideRecordId(credentials.p_trip,args.place_id);
  return rpc('av2_remote_content_write',{...credentials,p_request:request});
 }
 if(tool==='list_content_history')return rpc('av2_remote_content_history',{...credentials,p_place:args.place_id,p_after:args.after||null,p_limit:args.limit||50});
 if(tool==='get_itinerary')return itinerary();
 if(tool==='get_sync_status'){const conflicts=await rpc('av2_sync_conflicts',{...credentials,p_after:null});return{device:'ACTIVE',server_reachable:true,unresolved_conflicts:conflicts.filter(c=>!c.deleted_at&&!c.resolved_at).length,mobile_pending:'unknown_until_device_sync',gps_tracks:'device_local_only'};}
 const readAll=async name=>{const rows=[];let after=null;for(;;){const batch=await rpc(name,{...credentials,p_after:after});rows.push(...batch);if(batch.length<500)return rows;after=batch.at(-1).id;if(rows.length>10000)fail('TOO_MANY_RECORDS',413);}};
 const pulled=await Promise.allSettled([readAll('av2_sync_places'),readAll('av2_sync_pull'),rpc('av2_remote_private_place_ids',credentials)]);
 const failed=pulled.find(r=>r.status==='rejected');if(failed)throw failed.reason;
 const [places,records,privateIds]=pulled.map(r=>r.value);
 const publicPlaces=places.filter(p=>!p.deleted_at&&!privateIds.includes(p.id)&&!privatePlace(p,records)),page=rows=>{const eligible=rows.filter(r=>!args.after||r.id>args.after).sort((a,b)=>a.id.localeCompare(b.id)),items=eligible.slice(0,args.limit||50);return{items,next_after:eligible.length>items.length?items.at(-1).id:null};};
 if(tool==='list_places')return page(publicPlaces);
 if(tool==='list_zones')return page(records.filter(r=>!r.deleted_at&&r.data?.type==='place_guide'&&r.data.guide?.geo?.kind==='AREA'&&publicPlaces.some(p=>p.id===r.data.place_id)));
 if(tool==='list_routes'||tool==='list_travel_records')return page(records.filter(r=>!r.deleted_at&&!privatePayload(r.data)&&(tool==='list_routes'?r.data?.type==='travel_network':['travel_network','travel_journey'].includes(r.data?.type))));
 const pin=publicPlaces.find(p=>p.id===args.place_id);if(!pin)fail('PLACE_NOT_AVAILABLE',404);
 if(tool==='get_place')return pin;
 if(tool==='get_place_notes')return{place_id:pin.id,version:pin.version,updated_at:pin.data.updated_at,description:pin.data.description};
 const guide=records.find(r=>!r.deleted_at&&r.data?.type==='place_guide'&&r.data.place_id===pin.id);
 return{place_id:pin.id,record_id:guide?.id||await guideRecordId(credentials.p_trip,pin.id),version:guide?.version||0,updated_at:guide?.updated_at||null,...(tool==='get_audio_guide'?{audio_guide:guide?.data.guide?.audio_guide||''}:{guide:guide?.data.guide||{}})};
}
// Tool descriptions carry the field/version contract to clients without exposing credentials.
export function toolDefinitions(){
 const id={type:'string',format:'uuid'},version={type:'integer',minimum:0};
 const descriptions={
  list_places:'Lista paginada de pins autorizados. Usar UUID exacto; Casa y ubicaciones privadas están excluidos.',
  get_place:'Lee el pin completo autorizado con su UUID, poi_code y versión del pin.',
  get_audio_guide:'Lee audio_guide y la versión de la guía, independiente de la versión del pin.',
  get_place_guide:'Lee todos los campos autorizados de la guía y su versión, preservando su record_id original.',
  get_place_notes:'Lee Mis notas: el campo description del pin. Descripción y Mis notas son el mismo campo, no dos copias.',
  list_content_history:'Historial paginado de un pin autorizado: history_id, herramienta, campos y versión resultante. No entrega snapshots ni credenciales.',
  update_audio_guide:'Actualiza solamente patch.audio_guide (texto, máximo 80000 caracteres). Usar versión de get_audio_guide.',
  update_place_notes:'Actualiza solamente patch.description (Mis notas/descripción, texto, máximo 4000 caracteres). Usar versión de get_place_notes.',
  update_place_guide:'Fusiona solo los campos de investigación indicados. Usar versión de get_place_guide; conserva audio y geometría. Ausentes se conservan.',
  update_place_metadata:'Modifica solo metadatos permitidos de un pin público, con versión del pin. No cambia UUID, poi_code, nombre ni privacidad.',
  create_place:'Crea exclusivamente un pin público nuevo con UUID nuevo y expected_version=0; nunca recrear un pin existente.',
  rollback_content:'Revierte únicamente campos de history_id con expected_version actual y request_id nuevo. No borra pins ni pisa ediciones posteriores. Releer ante conflicto.'
 };
 const patchKeys={update_audio_guide:['audio_guide'],update_place_notes:['description'],update_place_guide:['experience','affinity','prices','sources_say','safety','questions','dairy','limitations','sources','reviewed_at'],update_place_metadata:['label','priority','lat','lng','google_maps_url','google_place_id','resolved_address','resolved_city','coordinates_verified'],create_place:['name','description','label','priority','lat','lng','google_maps_url','google_place_id','resolved_address','resolved_city','coordinates_verified']};
 return [...READ_TOOLS,...WRITE_TOOLS].map(name=>{
  const write=WRITE_TOOLS.includes(name),rollback=name==='rollback_content',list=name.startsWith('list_');
  const place=write?!rollback:name==='list_content_history'||name.startsWith('get_')&&!['get_itinerary','get_sync_status'].includes(name);
  const properties={...(place?{place_id:id}:{}),...(write?{expected_version:version,request_id:id}:{}),...(rollback?{history_id:id}:{}),...(list?{limit:{type:'integer',minimum:1,maximum:100},after:id}:{})};
  if(patchKeys[name])properties.patch={type:'object',minProperties:1,additionalProperties:false,properties:Object.fromEntries(patchKeys[name].map(k=>[k,k==='audio_guide'?{type:'string',maxLength:80000}:k==='description'?{type:'string',maxLength:4000}:{}]))};
  return {name,description:descriptions[name]||name.replaceAll('_',' ')+'; solo lectura autorizada. GPS local excluido.',inputSchema:{type:'object',properties,additionalProperties:false,required:[...(place?['place_id']:[]),...(write?['expected_version','request_id',rollback?'history_id':'patch']:[])]},annotations:{readOnlyHint:!write,destructiveHint:write,idempotentHint:true,openWorldHint:false}};
 });
}
