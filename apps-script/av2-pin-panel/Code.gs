const AV2_SPREADSHEET='1ioksMcQa6iE_f792eKmgJw68f_6Hdaproie2xOlcv20';
const DEVICE_HEADERS=['Usuario','Dispositivo','Installation ID','Plataforma','Navegador','Modelo detectado','Primera autorización','Último uso','Estado'];
function av2Install(){
 const sheet=SpreadsheetApp.getActiveSpreadsheet();if(sheet.getId()!==AV2_SPREADSHEET)throw new Error('Spreadsheet incorrecto');
 sheet.setSpreadsheetTimeZone('America/Puerto_Rico');sheet.getSheetByName('PINS').getRange('B2:B3').setNumberFormat('@');
 const handlers=['av2OnEdit','av2OnChange','av2Reconcile'];ScriptApp.getProjectTriggers().filter(t=>handlers.includes(t.getHandlerFunction())).forEach(t=>ScriptApp.deleteTrigger(t));
 ScriptApp.newTrigger('av2OnEdit').forSpreadsheet(sheet).onEdit().create();ScriptApp.newTrigger('av2OnChange').forSpreadsheet(sheet).onChange().create();ScriptApp.newTrigger('av2Reconcile').timeBased().everyMinutes(5).create();av2Reconcile();
}
function av2OnEdit(e){if(e&&['PINS','DISPOSITIVOS'].includes(e.range.getSheet().getName()))av2Reconcile();}
function av2OnChange(e){if(e&&['REMOVE_ROW','INSERT_ROW','OTHER'].includes(e.changeType))av2Reconcile();}
function av2Reconcile(){
 const lock=LockService.getScriptLock();if(!lock.tryLock(30000))return;
 try{
  const props=PropertiesService.getScriptProperties(),endpoint=props.getProperty('AV2_SHEET_SYNC_URL'),secret=props.getProperty('AV2_SHEET_SYNC_SECRET');if(!endpoint||!secret)throw new Error('Falta configuración segura');
  const book=SpreadsheetApp.openById(AV2_SPREADSHEET),pinsSheet=book.getSheetByName('PINS'),deviceSheet=book.getSheetByName('DISPOSITIVOS'),logSheet=book.getSheetByName('REGISTRO');
  if(!pinsSheet||!deviceSheet||!logSheet)throw new Error('Falta una pestaña requerida');
  const pins=pinsSheet.getRange(2,1,2,3).getDisplayValues().map(r=>({name:r[0].trim(),pin:String(r[1]),state:r[2].trim()}));
  const rows=deviceSheet.getLastRow()>1?deviceSheet.getRange(2,1,deviceSheet.getLastRow()-1,9).getDisplayValues():[];
  const previous=JSON.parse(props.getProperty('AV2_DEVICE_SNAPSHOT')||'{}'),current={};rows.forEach(r=>{if(r[0]&&r[2])current[r[0]+'|'+r[2]]={user:r[0],name:r[1],installation_id:r[2],state:r[8]};});
  const changed=Object.keys(current).filter(k=>JSON.stringify(current[k])!==JSON.stringify(previous[k])).map(k=>current[k]);
  const deleted=Object.keys(previous).filter(k=>!current[k]);
  const cursor=Number(props.getProperty('AV2_AUDIT_CURSOR')||0);
  const response=UrlFetchApp.fetch(endpoint,{method:'post',contentType:'application/json',headers:{'x-av2-sheet-secret':secret},payload:JSON.stringify({spreadsheet_id:AV2_SPREADSHEET,pins,devices:changed,deleted_keys:deleted,audit_cursor:cursor}),muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error('Sincronización del panel no disponible ('+response.getResponseCode()+')');
  const result=JSON.parse(response.getContentText());
  // Do not overwrite an edit made while the HTTP request was in flight.
  const nowRows=deviceSheet.getLastRow()>1?deviceSheet.getRange(2,1,deviceSheet.getLastRow()-1,9).getDisplayValues():[];
  if(JSON.stringify(nowRows)!==JSON.stringify(rows))return;
  const timezone='America/Puerto_Rico',date=value=>Utilities.formatDate(new Date(value),timezone,'yyyy-MM-dd HH:mm:ss');
  const next=result.devices.map(d=>[d.user,d.friendly_name,d.installation_id,d.detected.platform||'',d.detected.browser||'',d.detected.model||'',date(d.first_authorized_at),date(d.last_used_at),d.state]);
  const count=Math.max(next.length,rows.length);if(count){const output=next.concat(Array.from({length:count-next.length},()=>Array(9).fill('')));deviceSheet.getRange(2,1,count,9).setValues(output.map(row=>row.map(value=>typeof value==='string'&&/^[=+@-]/.test(value)?"'"+value:value)));}
  const snapshot={};next.forEach(r=>snapshot[r[0]+'|'+r[2]]={user:r[0],name:r[1],installation_id:r[2],state:r[8]});props.setProperty('AV2_DEVICE_SNAPSHOT',JSON.stringify(snapshot));
  // Audit IDs live in notes, keeping the requested eight visible columns.
  const last=logSheet.getLastRow(),seen=new Set(last>1?logSheet.getRange(Math.max(2,last-1000),1,Math.min(1001,last-1),1).getNotes().flat():[]);
  const pending=result.audit.filter(a=>!seen.has('AV2_AUDIT_ID:'+a.id));
  if(pending.length){
   const cells=pending.map(a=>({values:[date(a.timestamp),a.user,a.device_name,a.installation_id,a.action,a.entity,a.entity_id||'',a.summary].map((v,i)=>({userEnteredValue:{stringValue:String(v||'')},...(i===0?{note:'AV2_AUDIT_ID:'+a.id}:{})}))}));
   const write=UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/'+AV2_SPREADSHEET+':batchUpdate',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},payload:JSON.stringify({requests:[{appendCells:{sheetId:logSheet.getSheetId(),rows:cells,fields:'userEnteredValue,note'}}]}),muteHttpExceptions:true});if(write.getResponseCode()!==200)throw new Error('No se pudo actualizar REGISTRO');
  }
  if(result.audit.length)props.setProperty('AV2_AUDIT_CURSOR',String(result.audit[result.audit.length-1].id));
 }finally{lock.releaseLock();}
}
