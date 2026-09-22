import {platformRepository} from './localPlatform.js';
const now=()=>new Date().toISOString();
const user=()=>localStorage.getItem('agenda-viajera.user')||'current-user';
const device=()=>localStorage.getItem('agenda-viajera.device')||'unknown';
async function queue(repo,row,action){await repo.put('changeOperations',{id:crypto.randomUUID(),operationId:crypto.randomUUID(),tripId:row.tripId,recordType:'PHOTO',recordId:row.id,action,baseVersion:action==='CREATE'?0:1,changes:{...row,blob:undefined},userId:user(),deviceId:device(),createdAt:now(),status:'PENDING'})}
export async function listPhotos(){return (await platformRepository()).all('photos')}
export async function savePhoto(input){const repo=await platformRepository(),externalUrl=input.externalUrl||null,row={id:input.id||crypto.randomUUID(),tripId:input.tripId||'1aafae82-4ff7-423b-ade2-25170e8b0dd4',caption:String(input.caption||''),capturedAt:input.capturedAt||now(),place:String(input.place||''),agendaItemId:input.agendaItemId||null,uploader:input.uploader||user(),state:input.state||(externalUrl?'EXTERNAL_REF':'LOCAL_ONLY'),externalUrl,provider:input.provider||null,externalId:input.externalId||null,blob:input.blob||null,updatedAt:now()};await repo.put('photos',row);await queue(repo,row,input.id?'UPDATE':'CREATE');return row}
export async function deletePhoto(id){const repo=await platformRepository(),row=await repo.read('photos',id);if(row){const deleted={...row,blob:null,state:'DELETED',deletedAt:now(),updatedAt:now()};await repo.put('photos',deleted);await queue(repo,deleted,'DELETE')}return row}
