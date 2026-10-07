const AV2_SPREADSHEET='1ioksMcQa6iE_f792eKmgJw68f_6Hdaproie2xOlcv20';
const DEVICE_HEADERS=['Usuario','Dispositivo','Installation ID','Plataforma','Navegador','Modelo detectado','Primera autorización','Último uso','Estado'];
function av2Install(){
 const sheet=SpreadsheetApp.getActiveSpreadsheet();if(sheet.getId()!==AV2_SPREADSHEET)throw new Error('Spreadsheet incorrecto');
 sheet.setSpreadsheetTimeZone('America/Puerto_Rico');sheet.getSheetByName('PINS').getRange('B2:B3').setNumberFormat('@');
 const handlers=['av2OnEdit','av2OnChange','av2Reconcile'];ScriptApp.getProjectTriggers().filter(t=>handlers.includes(t.getHandlerFunction())).forEach(t=>ScriptApp.deleteTrigger(t));
 ScriptApp.newTrigger('av2OnEdit').forSpreadsheet(sheet).onEdit().create();ScriptApp.newTrigger('av2OnChange').forSpreadsheet(sheet).onChange().create();ScriptApp.newTrigger('av2Reconcile').timeBased().everyMinutes(5).create();av2Reconcile();
}
function av2InstallDataReconciler(){ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='av2ReconcileData').forEach(t=>ScriptApp.deleteTrigger(t));ScriptApp.newTrigger('av2ReconcileData').timeBased().everyMinutes(1).create();av2ReconcileData();}
function av2ReconcileData(){av2Reconcile({dataOnly:true});}
function av2OnEdit(e){if(e&&['PINS','DISPOSITIVOS','LUGARES','GASTOS'].includes(e.range.getSheet().getName()))av2Reconcile({origin:'Google Sheet',editor:e.user?e.user.getEmail():''});}
function av2OnChange(e){if(e&&['REMOVE_ROW','INSERT_ROW','OTHER'].includes(e.changeType))av2Reconcile({origin:'Google Sheet',editor:e.user?e.user.getEmail():''});}
function av2Reconcile(event){
 const lock=LockService.getScriptLock();if(!lock.tryLock(30000))return;
 try{
  const props=PropertiesService.getScriptProperties(),endpoint=props.getProperty('AV2_SHEET_SYNC_URL'),secret=props.getProperty('AV2_SHEET_SYNC_SECRET');if(!endpoint||!secret)throw new Error('Falta configuración segura');
  const book=SpreadsheetApp.openById(AV2_SPREADSHEET),pinsSheet=book.getSheetByName('PINS'),deviceSheet=book.getSheetByName('DISPOSITIVOS'),logSheet=book.getSheetByName('REGISTRO');
  if(!pinsSheet||!deviceSheet||!logSheet)throw new Error('Falta una pestaña requerida');
  const dataOnly=!!(event&&event.dataOnly);
  const pins=dataOnly?[]:pinsSheet.getRange(2,1,2,3).getDisplayValues().map(r=>({name:r[0].trim(),pin:String(r[1]),state:r[2].trim()}));
  const rows=deviceSheet.getLastRow()>1?deviceSheet.getRange(2,1,deviceSheet.getLastRow()-1,9).getDisplayValues():[];
  const previous=JSON.parse(props.getProperty('AV2_DEVICE_SNAPSHOT')||'{}'),current={};rows.forEach(r=>{if(r[0]&&r[2])current[r[0]+'|'+r[2]]={user:r[0],name:r[1],installation_id:r[2],state:r[8]};});
  const changed=Object.keys(current).filter(k=>JSON.stringify(current[k])!==JSON.stringify(previous[k])).map(k=>current[k]);
  const deleted=Object.keys(previous).filter(k=>!current[k]);
  const cursor=Number(props.getProperty('AV2_AUDIT_CURSOR')||0),places=av2ReadPlaces(book,props),expenses=av2ReadExpenses(book,props);
  const response=UrlFetchApp.fetch(endpoint,{method:'post',contentType:'application/json',headers:{'x-av2-sheet-secret':secret},payload:JSON.stringify({spreadsheet_id:AV2_SPREADSHEET,pins,devices:dataOnly?[]:changed,deleted_keys:dataOnly?[]:deleted,audit_cursor:cursor,...(expenses?{expenses:expenses.rows,deleted_expenses:expenses.deleted}:{}),places:places.rows,deleted_places:places.deleted,places_actor:'Jonathan',places_origin:event&&event.origin==='Google Sheet'?'Google Sheet':'ChatGPT/Admin',places_external_actor:event&&event.editor||null}),muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error('Sincronización del panel no disponible ('+response.getResponseCode()+')');
  const result=JSON.parse(response.getContentText());
  // Do not overwrite an edit made while the HTTP request was in flight.
  const nowRows=deviceSheet.getLastRow()>1?deviceSheet.getRange(2,1,deviceSheet.getLastRow()-1,9).getDisplayValues():[];
  if(JSON.stringify(nowRows)!==JSON.stringify(rows))return;
  const timezone='America/Puerto_Rico',date=value=>Utilities.formatDate(new Date(value),timezone,'yyyy-MM-dd HH:mm:ss');
  const next=result.devices.map(d=>[d.user,d.friendly_name,d.installation_id,d.detected.platform||'',d.detected.browser||'',d.detected.model||'',date(d.first_authorized_at),date(d.last_used_at),d.state]);
  const count=Math.max(next.length,rows.length);if(!dataOnly&&count){const output=next.concat(Array.from({length:count-next.length},()=>Array(9).fill('')));deviceSheet.getRange(2,1,count,9).setValues(output.map(row=>row.map(value=>typeof value==='string'&&/^[=+@-]/.test(value)?"'"+value:value)));}
  const snapshot={};next.forEach(r=>snapshot[r[0]+'|'+r[2]]={user:r[0],name:r[1],installation_id:r[2],state:r[8]});if(!dataOnly)props.setProperty('AV2_DEVICE_SNAPSHOT',JSON.stringify(snapshot));
  // Audit IDs live in notes, keeping the requested eight visible columns.
  const last=logSheet.getLastRow(),seen=new Set(last>1?logSheet.getRange(Math.max(2,last-1000),1,Math.min(1001,last-1),1).getNotes().flat():[]);
  const pending=result.audit.filter(a=>!seen.has('AV2_AUDIT_ID:'+a.id));
  if(pending.length){
   const cells=pending.map(a=>({values:[date(a.timestamp),a.user,a.device_name,a.installation_id,a.action,a.entity,a.entity_id||'',a.summary].map((v,i)=>({userEnteredValue:{stringValue:String(v||'')},...(i===0?{note:'AV2_AUDIT_ID:'+a.id}:{})}))}));
   const write=UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/'+AV2_SPREADSHEET+':batchUpdate',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},payload:JSON.stringify({requests:[{appendCells:{sheetId:logSheet.getSheetId(),rows:cells,fields:'userEnteredValue,note'}}]}),muteHttpExceptions:true});if(write.getResponseCode()!==200)throw new Error('No se pudo actualizar REGISTRO');
  }
  if(result.audit.length)props.setProperty('AV2_AUDIT_CURSOR',String(result.audit[result.audit.length-1].id));
  if(result.places_result)av2WritePlaces(places,result.places_result,props);if(result.expenses_result&&expenses)av2WriteExpenses(expenses,result.expenses_result,props);
 }finally{lock.releaseLock();}
}
const PLACE_HEADERS=['POI ID','Nombre','Google Maps Link','Descripción','Label','Importancia','Ciudad/Zona','Fechas','Asignación','Estado','Place ID','Lat','Lng','Dirección resuelta','Creado por','Actualizado por','Última modificación'];
function av2InstallPlaces(){const s=SpreadsheetApp.openById(AV2_SPREADSHEET).getSheetByName('LUGARES');if(!s)throw new Error('Falta LUGARES');const rule=s.getRange(2,10).getDataValidation();if(rule&&rule.getCriteriaType()===SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST){const args=rule.getCriteriaValues();if(!args[0].includes('Revisar'))s.getRange(2,10,s.getMaxRows()-1,1).setDataValidation(rule.copy().withCriteria(SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST,[args[0].concat(['Revisar']),args[1]]).build());}av2Reconcile();}
function av2ReadPlaces(book,props){
 const sheet=book.getSheetByName('LUGARES');if(!sheet)throw new Error('Falta LUGARES; no se creará otra pestaña');
 if(JSON.stringify(sheet.getRange(1,1,1,17).getDisplayValues()[0].map(value=>String(value).trim().normalize('NFC')))!==JSON.stringify(PLACE_HEADERS))throw new Error('Headers LUGARES incorrectos');
 const count=Math.max(0,sheet.getLastRow()-1);if(count>500)throw new Error('LUGARES excede 500 filas');
 const original=count?av2PlaceCells(sheet,count):[],notes=count?sheet.getRange(2,1,count,1).getNotes():[],rows=[],ids=new Set();
 original.forEach((values,index)=>{if(values.every(v=>!v))return;const code=values[0];if(code){if(ids.has(code))throw new Error('POI ID repetido en LUGARES');ids.add(code);}let base=null;try{if(notes[index][0].startsWith('AV2_POI_BASE:'))base=JSON.parse(notes[index][0].slice(13));}catch{throw new Error('Snapshot LUGARES inválido');}
  let rowKey=null,key=null;if(!code){key='AV2_POI_NEW_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,values[1].trim().toLowerCase()+'|'+values[2].trim()));rowKey=props.getProperty(key)||Utilities.getUuid();props.setProperty(key,rowKey);}rows.push({values,base,row_key:rowKey,row_number:index+2,new_key:key});
 });
 const previous=JSON.parse(props.getProperty('AV2_POI_IDS')||'[]'),deleted=previous.filter(code=>!ids.has(code)).map(code=>({code,base:{version:Number(props.getProperty('AV2_POI_VERSION_'+code)||0)}}));
 return{sheet,original,rows,deleted};
}
function av2WritePlaces(snapshot,result,props){
 const sheet=snapshot.sheet;if(!av2DataUnchanged(snapshot,17,[7,16]))return;
 const lookup=new Map(result.places.map(p=>[p.code,p])),mapping=new Map(result.mappings.map(m=>[m.row_key,m.poi_code])),seen=new Set(),output=snapshot.original.map(()=>Array(17).fill('')),notes=snapshot.original.map(()=>['']);
 const put=(p,index,pending)=>{let values=p.values.slice(),conflict=result.conflicts.includes(p.code);if(conflict&&pending){values.splice(1,9,...pending.slice(1,10));values[9]='Revisar';}output[index]=values;notes[index]=['AV2_POI_BASE:'+JSON.stringify({data:p.data,values:values.map(v=>String(v??'')),...(conflict?{conflict:true,serverValues:p.values.map(v=>String(v??''))}:{})})];seen.add(p.code);props.setProperty('AV2_POI_VERSION_'+p.code,String(p.data.version));};
 snapshot.rows.forEach(row=>{const code=row.values[0]||mapping.get(row.row_key),p=lookup.get(code);if(p&&!seen.has(code))put(p,row.row_number-2,row.values);});
 result.places.filter(p=>!p.data.deleted_at&&!seen.has(p.code)).forEach(p=>{put(p,output.length,null);});
 const length=Math.max(output.length,snapshot.original.length);if(length){while(output.length<length){output.push(Array(17).fill(''));notes.push(['']);}if(sheet.getMaxRows()<length+1)sheet.insertRowsAfter(sheet.getMaxRows(),length+1-sheet.getMaxRows());sheet.getRange(2,1,length,17).setValues(output.map(row=>row.map(value=>typeof value==='string'&&/^[=+@-]/.test(value)?"'"+value:value)));sheet.getRange(2,1,length,1).setNotes(notes);}
 props.setProperty('AV2_POI_IDS',JSON.stringify([...seen]));snapshot.rows.filter(r=>r.new_key&&mapping.has(r.row_key)).forEach(r=>props.deleteProperty(r.new_key));snapshot.deleted.filter(r=>!seen.has(r.code)).forEach(r=>props.deleteProperty('AV2_POI_VERSION_'+r.code));
}

const EXPENSE_HEADERS=["Expense ID", "Fecha", "Descripción", "Categoría", "Monto", "Moneda", "Estado", "Método de pago", "Ciudad/Zona", "Fase", "Calendar Event ID", "Purchase ID", "Recibo / Drive File ID", "Notas", "Estado registro", "Creado por", "Actualizado por", "Última modificación", "Cargo real USD"];
function av2InstallExpenses(){Logger.log('GASTOS_INSTALL_START');const book=SpreadsheetApp.openById(AV2_SPREADSHEET);let sheet=book.getSheetByName('GASTOS');if(!sheet){sheet=book.insertSheet('GASTOS');sheet.getRange(1,1,1,19).setValues([EXPENSE_HEADERS]);sheet.setFrozenRows(1);sheet.getRange(1,1,1,19).setFontWeight('bold').setBackground('#f1f3f5');sheet.setColumnWidth(3,280);sheet.setColumnWidth(14,300);sheet.getRange(2,7,sheet.getMaxRows()-1,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Pagado','Estimado'],true).setAllowInvalid(false).build());sheet.getRange(2,15,sheet.getMaxRows()-1,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Activo','Eliminado'],true).setAllowInvalid(false).build());sheet.autoResizeColumns(1,19);}if(sheet.getLastRow()===1){sheet.getRange(1,1,1,19).setWrap(true);sheet.setRowHeight(1,44);[95,115,280,180,100,100,130,170,160,150,200,160,220,300,145,150,150,185,150].forEach((width,index)=>sheet.setColumnWidth(index+1,width));}Logger.log('GASTOS_READY:'+sheet.getSheetId());av2Reconcile();}
function av2ReadExpenses(book,props){
 const sheet=book.getSheetByName('GASTOS');if(!sheet)return null;
 if(JSON.stringify(sheet.getRange(1,1,1,19).getDisplayValues()[0].map(value=>String(value).trim().normalize('NFC')))!==JSON.stringify(EXPENSE_HEADERS))throw new Error('Headers GASTOS incorrectos');
 const count=Math.max(0,sheet.getLastRow()-1);if(count>500)throw new Error('GASTOS excede 500 filas');
 const original=count?av2ExpenseCells(sheet,count):[],notes=count?sheet.getRange(2,1,count,1).getNotes():[],rows=[],ids=new Set();
 original.forEach((values,index)=>{if(values.every(v=>!v))return;const code=values[0];let base=null;try{const marker=notes[index][0].indexOf('AV2_EXP_BASE:');if(marker>=0)base=JSON.parse(notes[index][0].slice(marker+13));}catch{throw new Error('Snapshot GASTOS inválido');}if(base?.data?.data?.expense_id)ids.add(base.data.data.expense_id);else if(code)ids.add(code);
 const key=null,rowKey=base?null:(notes[index][0].includes('AV2_EXP_ROW:')?notes[index][0].split('AV2_EXP_ROW:').at(-1).trim():Utilities.getUuid());if(!base){notes[index][0]='AV2_EXP_ROW:'+rowKey;sheet.getRange(index+2,1).setNote(notes[index][0]);}rows.push({values,base,row_key:rowKey,row_number:index+2,new_key:!code?key:null});});
 const previous=JSON.parse(props.getProperty('AV2_EXP_IDS')||'[]'),deleted=previous.filter(code=>!ids.has(code)).map(code=>({code,base:{version:Number(props.getProperty('AV2_EXP_VERSION_'+code)||0)}}));return{sheet,original,notes,rows,deleted};
}
function av2WriteExpenses(snapshot,result,props){
 const sheet=snapshot.sheet;if(!av2DataUnchanged(snapshot,19,[1,17]))return;
 const lookup=new Map(result.expenses.map(p=>[p.code,p])),mapping=new Map(result.mappings.map(m=>[m.row_key,m.expense_id])),seen=new Set(),writeRows=new Set(),output=snapshot.original.map(row=>row.slice()),notes=snapshot.notes?snapshot.notes.map(row=>row.slice()):snapshot.original.map(()=>['']);
 const put=(p,index,pending)=>{let values=p.values.slice();if(result.conflicts.includes(p.code)&&pending){values=pending.slice();values[0]=p.code;}if(values[6]==='PAID')values[6]='Pagado';else if(values[6]==='ESTIMATED')values[6]='Estimado';output[index]=values;writeRows.add(index);const conflict=result.conflicts.includes(p.code)&&pending;notes[index]=[(conflict?'Conflicto pendiente: modifica esta fila para confirmar tus valores.\n':'')+'AV2_EXP_BASE:'+JSON.stringify({data:p.record,values:(conflict?values:p.values).map(v=>String(v??'')),...(conflict?{conflict:true,serverValues:p.values.map(v=>String(v??''))}:{})})];seen.add(p.code);props.setProperty('AV2_EXP_VERSION_'+p.code,String(p.record.version));};
 snapshot.rows.forEach(row=>{const code=(row.row_key?mapping.get(row.row_key):null)||row.base?.data?.data?.expense_id||row.values[0],p=lookup.get(code);if(p&&!seen.has(code)&&!(result.errors||[]).some(e=>e.row_number===row.row_number))put(p,row.row_number-2,row.values);});
 (result.errors||[]).forEach(error=>{const i=error.row_number-2;if(i>=0&&i<notes.length)notes[i]=['Revisar: '+(error.message==='INVALID_EXPENSE_ROW'?'Completa fecha, descripción, monto numérico y moneda ISO.':error.message)+'\n'+notes[i][0].replace(/^Revisar:[^\n]*\n/,'')];});
 result.expenses.filter(p=>!p.record.deleted_at&&!seen.has(p.code)).forEach(p=>put(p,output.length,null));
 if(output.length){if(sheet.getMaxRows()<output.length+1)sheet.insertRowsAfter(sheet.getMaxRows(),output.length+1-sheet.getMaxRows());let start=0;while(start<output.length){if(!writeRows.has(start)){start++;continue;}let end=start+1;while(end<output.length&&writeRows.has(end))end++;sheet.getRange(start+2,1,end-start,19).setValues(output.slice(start,end).map(row=>row.map(v=>typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v)));start=end;}sheet.getRange(2,1,output.length,1).setNotes(notes);}
 props.setProperty('AV2_EXP_IDS',JSON.stringify([...seen]));snapshot.rows.filter(r=>r.new_key&&mapping.has(r.row_key)).forEach(r=>props.deleteProperty(r.new_key));
}

function av2ExpenseCells(sheet,count){const timezone=sheet.getParent().getSpreadsheetTimeZone();return sheet.getRange(2,1,count,19).getValues().map(row=>row.map((value,i)=>value instanceof Date?Utilities.formatDate(value,timezone,i===1?'yyyy-MM-dd':'yyyy-MM-dd HH:mm:ss'):String(value??'')));}

function av2PlaceCells(sheet,count){const timezone=sheet.getParent().getSpreadsheetTimeZone();return sheet.getRange(2,1,count,17).getValues().map(row=>row.map((value,i)=>value instanceof Date?Utilities.formatDate(value,timezone,i===7?'yyyy-MM-dd':'yyyy-MM-dd HH:mm:ss'):String(value??'')));}

// A fresh Sheets API read avoids SpreadsheetApp read-cache hiding an API edit during HTTP sync.
function av2DataUnchanged(snapshot,width,dateColumns){const range=snapshot.sheet.getName()+'!A2:'+String.fromCharCode(64+width)+'501',response=UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/'+AV2_SPREADSHEET+'/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER',{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});if(response.getResponseCode()!==200)throw new Error('No se pudo verificar el estado actual de '+snapshot.sheet.getName());const trim=rows=>{while(rows.length&&rows[rows.length-1].every(v=>!v))rows.pop();return rows;},current=(JSON.parse(response.getContentText()).values||[]).map(row=>Array.from({length:width},(_,i)=>{const value=row[i];return dateColumns.includes(i)&&typeof value==='number'?Utilities.formatDate(new Date(Math.round((value-25569)*86400000)),'UTC',i===dateColumns[0]?'yyyy-MM-dd':'yyyy-MM-dd HH:mm:ss'):String(value??'');}));return JSON.stringify(trim(current))===JSON.stringify(trim(snapshot.original.map(row=>row.slice())));}
