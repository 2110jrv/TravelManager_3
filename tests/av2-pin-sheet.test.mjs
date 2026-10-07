import{PLACE_HEADERS}from'../supabase/functions/av2-sheet-sync/places.js';
import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';
test('Sheet reconciliation detects deletion by logical key, ignores stale state, preserves PIN strings and mirrors audit once',()=>{
 const id='1ioksMcQa6iE_f792eKmgJw68f_6Hdaproie2xOlcv20',installation=crypto.randomUUID(),key='Jonathan|'+installation;
 const props=new Map([['AV2_SHEET_SYNC_URL','https://example.invalid/sync'],['AV2_SHEET_SYNC_SECRET','test-only'],['AV2_DEVICE_SNAPSHOT',JSON.stringify({[key]:{user:'Jonathan',name:'Equipo',installation_id:installation,state:'Autorizado'}})]]);
 let rows=[],logs=[],notes=[],payload,failCursor=true;
 const pins={getRange:()=>({getDisplayValues:()=>[['Jonathan','001234','Activo'],['Jenny','005678','Activo']]})};
 const devices={getLastRow:()=>rows.length+1,getRange:(r,c,n)=>({getDisplayValues:()=>rows.map(x=>[...x]),setValues:v=>{rows=v.filter(x=>x[0]);}})};
 const registro={getLastRow:()=>logs.length+1,getSheetId:()=>3,getRange:()=>({getNotes:()=>notes.map(x=>[x])})};
 const book={getSheetByName:n=>({PINS:pins,DISPOSITIVOS:devices,REGISTRO:registro,LUGARES:{getLastRow:()=>1,getRange:()=>({getDisplayValues:()=>[PLACE_HEADERS]})}}[n])};
 const response={devices:[{user:'Jonathan',friendly_name:'Equipo',installation_id:installation,detected:{},first_authorized_at:new Date().toISOString(),last_used_at:new Date().toISOString(),state:'Autorizado'}],audit:[{id:1,user:'Jonathan',device_name:'Equipo',installation_id:installation,timestamp:new Date().toISOString(),action:'create',entity:'expense',entity_id:'fake-record',summary:'Cambio de prueba'}]};
 const context={SpreadsheetApp:{openById:value=>{assert.equal(value,id);return book;}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>{if(k==='AV2_AUDIT_CURSOR'&&failCursor)throw Error('Simulated cursor failure');props.set(k,v);}})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},Utilities:{formatDate:d=>d.toISOString()},ScriptApp:{getOAuthToken:()=> 'fake-only'},UrlFetchApp:{fetch:(url,options)=>{if(url.includes('example.invalid')){payload=JSON.parse(options.payload);return{getResponseCode:()=>200,getContentText:()=>JSON.stringify(response)};}const write=JSON.parse(options.payload).requests[0].appendCells.rows;write.forEach(row=>{logs.push(row.values.map(x=>x.userEnteredValue.stringValue));notes.push(row.values[0].note);});return{getResponseCode:()=>200};}}};
 runInNewContext(readFileSync(new URL('../apps-script/av2-pin-panel/Code.gs',import.meta.url),'utf8')+';globalThis.reconcile=av2Reconcile;',context);
 assert.throws(()=>context.reconcile(),/Simulated cursor failure/);assert.deepEqual(payload.deleted_keys,[key]);assert.equal(payload.pins[0].pin,'001234');assert.equal(logs.length,1);
 failCursor=false;context.reconcile();assert.equal(logs.length,1);assert.equal(payload.devices.length,0);assert.equal(props.get('AV2_AUDIT_CURSOR'),'1');
 rows[0][8]='Revocado';context.reconcile();assert.equal(payload.devices[0].state,'Revocado');response.devices[0].friendly_name='=IMPORTXML("https://example.invalid","x")';context.reconcile();assert.equal(rows[0][1].startsWith("'="),true);
});
