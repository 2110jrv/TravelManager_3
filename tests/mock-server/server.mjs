import http from 'node:http';
const port=Number(process.env.MOCK_PORT||5055);
const s={devices:new Map(),commands:new Map(),records:new Map(),history:new Map(),processed:new Map(),changes:new Map(),conflicts:new Map(),restores:new Map(),messages:new Map()};
const headers={'content-type':'application/json','access-control-allow-origin':'http://127.0.0.1:5003','access-control-allow-methods':'GET,POST,PUT,OPTIONS','access-control-allow-headers':'content-type'};
const json=(r,c,x)=>{r.writeHead(c,headers);r.end(JSON.stringify(x));};
const read=q=>new Promise(ok=>{let b='';q.on('data',x=>b+=x);q.on('end',()=>{try{ok(b?JSON.parse(b):{})}catch{ok({})}})});
const vals=m=>[...m.values()];
const reset=()=>{for(const m of [s.devices,s.commands,s.records,s.history,s.processed,s.changes,s.conflicts,s.restores])m.clear();s.messages.clear();};
const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
const conflict=(o,c,type,field,baseValue,currentValue,incomingValue)=>({conflictId:crypto.randomUUID(),tripId:o.tripId,recordId:o.recordId,recordType:o.recordType,type,field,baseValue,currentValue,incomingValue,currentUser:c.updatedByUser,currentDevice:c.updatedByDevice,incomingUser:o.userId,incomingDevice:o.deviceId,createdAt:new Date().toISOString(),status:'OPEN'});
function applyChange(o){
  if(s.processed.has(o.operationId))return{...clone(s.processed.get(o.operationId)),status:'DUPLICATE'};
  s.changes.set(o.operationId,clone(o));
  const current=s.records.get(o.recordId);
  if(o.action==='CREATE'){
    if(current?.deletedAt)return{status:'REJECTED_TOMBSTONE',canonical:current};
    if(current&&!current.deletedAt)return{status:'CONFLICT',conflict:conflict(o,current,'SAME_FIELD_CONFLICT',null,null,current.data,o.changes)};
    const c={recordId:o.recordId,recordType:o.recordType,tripId:o.tripId,version:1,data:clone(o.changes||{}),deletedAt:null,updatedAt:o.createdAt,updatedByUser:o.userId,updatedByDevice:o.deviceId};
    s.records.set(o.recordId,c);s.history.set(o.recordId,new Map([[1,clone(c)]]));const result={status:'APPLIED',canonical:c};s.processed.set(o.operationId,result);return result;
  }
  if(!current)return{status:'REJECTED_TOMBSTONE',canonical:null};
  const base=s.history.get(o.recordId)?.get(o.baseVersion);
  if(current.deletedAt){const c=conflict(o,current,'DELETE_VS_EDIT',null,base?.data||null,current.data,o.changes||{});s.conflicts.set(c.conflictId,c);const result={status:'CONFLICT',conflict:c,canonical:current};s.processed.set(o.operationId,result);return result;}
  if(o.baseVersion!==current.version){
    const changes=o.changes||{};let changed=false;for(const field of Object.keys(changes)){const baseValue=base?.data?.[field],currentValue=current.data?.[field],incomingValue=changes[field];if(currentValue!==incomingValue)changed=true;if(currentValue!==baseValue&&currentValue!==incomingValue){const c=conflict(o,current,'SAME_FIELD_CONFLICT',field,baseValue,currentValue,incomingValue);s.conflicts.set(c.conflictId,c);const result={status:'CONFLICT',conflict:c,canonical:current};s.processed.set(o.operationId,result);return result;}}if(!changed){const result={status:'APPLIED',canonical:current};s.processed.set(o.operationId,result);return result;}
  }
  if(o.action==='DELETE'){const c={...current,version:current.version+1,deletedAt:o.createdAt,deletedByUser:o.userId,deletedByDevice:o.deviceId,updatedAt:o.createdAt,updatedByUser:o.userId,updatedByDevice:o.deviceId};s.records.set(o.recordId,c);s.history.get(o.recordId).set(c.version,clone(c));const result={status:'APPLIED',canonical:c};s.processed.set(o.operationId,result);return result;}
  const data={...current.data,...(o.changes||{})};const c={...current,version:current.version+1,data,updatedAt:o.createdAt,updatedByUser:o.userId,updatedByDevice:o.deviceId};s.records.set(o.recordId,c);s.history.get(o.recordId).set(c.version,clone(c));const result={status:'APPLIED',canonical:c};s.processed.set(o.operationId,result);return result;
}
const server=http.createServer(async(req,res)=>{if(req.method==='OPTIONS'){res.writeHead(204,headers);return res.end()}const u=new URL(req.url,`http://${req.headers.host}`),p=u.pathname.split('/').filter(Boolean),b=await read(req);try{
if(req.method==='GET'&&u.pathname==='/health')return json(res,200,{ok:true});
if(req.method==='POST'&&u.pathname==='/reset'){reset();return json(res,200,{ok:true})}
if(p[0]==='devices'){if(req.method==='GET'&&p.length===1)return json(res,200,vals(s.devices));if(req.method==='GET'&&p[2]==='commands')return json(res,200,vals(s.commands).filter(x=>x.deviceId===p[1]));if(req.method==='GET')return json(res,200,s.devices.get(p[1])||null);if(req.method==='PUT'){const d={...(s.devices.get(p[1])||{}),...b,deviceId:p[1]};s.devices.set(p[1],d);return json(res,200,d)}if(req.method==='POST'&&p[2]==='commands'){const c={...b,id:b.id||crypto.randomUUID(),deviceId:p[1],status:'PENDING',createdAt:new Date().toISOString()};s.commands.set(c.id,c);return json(res,201,c)}}
if(p[0]==='commands'&&req.method==='POST'){const c={...s.commands.get(p[1]),status:'COMPLETED',completedAt:new Date().toISOString()};s.commands.set(p[1],c);return json(res,200,c)}
if(p[0]==='records'){if(req.method==='GET')return json(res,200,clone(s.records.get(p[1])||null));if(req.method==='PUT'){const x={...b,recordId:p[1]};s.records.set(p[1],x);if(!s.history.has(p[1]))s.history.set(p[1],new Map([[x.version||1,clone(x)]]));return json(res,200,clone(x))}}
if(p[0]==='changes'){if(req.method==='POST'){const result=applyChange(b);return json(res,200,clone(result));}const tripId=u.searchParams.get('tripId'),since=Number(u.searchParams.get('sinceVersion')||0);if(!tripId&&!u.searchParams.has('sinceVersion'))return json(res,200,vals(s.changes).map(clone));return json(res,200,vals(s.records).filter(x=>(!tripId||x.tripId===tripId)&&x.version>since).map(clone))}
if(p[0]==='restore-requests'){if(req.method==='POST'){const x={...b,id:crypto.randomUUID(),status:'PENDING',createdAt:new Date().toISOString()};s.restores.set(x.id,x);return json(res,201,x)}if(req.method==='GET')return json(res,200,vals(s.restores));if(req.method==='PUT'){const x={...s.restores.get(p[1]),...b,id:p[1]};s.restores.set(p[1],x);return json(res,200,x)}}
if(p[0]==='conflicts'){if(req.method==='GET'){const tripId=u.searchParams.get('tripId');return json(res,200,vals(s.conflicts).filter(x=>!tripId||x.tripId===tripId).map(clone));}if(req.method==='PUT'){const x={...b,conflictId:p[1]};s.conflicts.set(p[1],x);return json(res,200,clone(x))}}
if(p[0]==='messages'){
  if(req.method==='POST'){if(!b.messageId||!b.tripId||!b.conversationId||!b.senderUserId||!String(b.text||'').trim())return json(res,400,{error:'invalid message'});const old=s.messages.get(b.messageId);if(old)return json(res,200,old);const x={...b,text:String(b.text).trim(),serverCreatedAt:new Date().toISOString(),syncStatus:'SENT'};s.messages.set(x.messageId,x);return json(res,201,x)}
  if(req.method==='GET'){const trip=u.searchParams.get('tripId'),conversation=u.searchParams.get('conversationId'),user=u.searchParams.get('userId');const out=vals(s.messages).filter(m=>(!trip||m.tripId===trip)&&(!conversation||m.conversationId===conversation)&&(m.conversationType==='GROUP'?m.conversationType==='GROUP':(!user||user===m.senderUserId||user===m.recipientUserId)));return json(res,200,out)}
}
return json(res,404,{error:'not found'});
}catch(e){return json(res,500,{error:e.message})}});
server.listen(port,'127.0.0.1',()=>console.log(`mock remote ${port}`));
