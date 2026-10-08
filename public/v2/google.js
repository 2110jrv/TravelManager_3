import { TRIP } from './config.js';
import { normalizeEvent } from './domain.js';
import {cityMetadata,withCities} from './event-cities.js';
export class GoogleSource {
  constructor(getToken, request = fetch, guard = async()=>{}, unauthorized=async()=>{},locations=async()=>{},cities=null) { this.getToken = getToken; this.request = (...args)=>request(...args); this.guard=guard; this.unauthorized=unauthorized;this.locations=locations;this.cities=cities; }
  async api(path, options = {}, retry = true) {
    await this.guard();
    const token = await this.getToken();
    if (!token) throw Error('Autoriza Google para leer Calendar y Drive.');
    const response = await this.request(`https://www.googleapis.com/${path}`, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
    if (!response.ok) { if(response.status===401&&retry&&await this.unauthorized(token))return this.api(path,options,false);const error = Error(response.status === 401&&retry ? 'La autorización Google expiró. Conecta nuevamente.' : `Google: error ${response.status}. Tus datos guardados están conservados.`); error.status = response.status; throw error; }
    return response;
  }
  async syncCalendar(store) {
    let colors={event:{}};
    try{colors=await(await this.api('calendar/v3/colors')).json();}
    catch(error){if(error.status!==403)throw error;}
    const calendar=await (await this.api(`calendar/v3/calendars/${encodeURIComponent(TRIP.calendarId)}?eventLabelVersion=1`)).json();
    const labels=Object.fromEntries((calendar.labelProperties?.eventLabels||[]).map(label=>[label.id,label]));
    const saved = await store.get('meta', 'calendar-sync');
    let token = saved?.query_version===2?saved.value:null, page = null, changes = [], nextSync = null;
    do {
      const params = new URLSearchParams({ singleEvents: 'true', showDeleted: 'true', maxResults: '2500',eventLabelVersion:'1' });
      if (token) params.set('syncToken', token);
      else { params.set('timeMin',new Date(Date.parse(`${TRIP.start}T00:00:00Z`)-86400000).toISOString());params.set('timeMax',new Date(Date.parse(`${TRIP.end}T23:59:59Z`)+86400000).toISOString()); }
      if (page) params.set('pageToken', page);
      let response;
      try { response = await this.api(`calendar/v3/calendars/${encodeURIComponent(TRIP.calendarId)}/events?${params}`); }
      catch (error) { if (error.status !== 410 || !token) throw error; token = null; page = null; changes = []; continue; }
      const batch = await response.json(); changes.push(...(batch.items || [])); page = batch.nextPageToken; nextSync = batch.nextSyncToken;
      if (!page && !nextSync) throw Error('Calendar no devolvió un token de sincronización.');
    } while (page || (!nextSync && token === null));
    const ids = new Set(changes.map(x => x.id));
    const previous = await store.all('events');
    // Fetch the complete Sheet metadata snapshot even for incremental Calendar sync.
    // Failure occurs before the transaction, preserving the previous offline snapshot.
    const metadata=this.cities?cityMetadata(await this.cities()):null;
    const attach=event=>metadata?withCities(event,metadata):event;
    await store.transaction(['events', 'meta'], tx => {
      for (const raw of changes) tx.objectStore('events').put(attach(normalizeEvent({...raw,calendarTimezone:calendar.timeZone}, colors.event, labels)));
      // Mark missing Calendar events individually; never replace the local database.
      for (const event of previous) if (!ids.has(event.id)) {
        const label=event.label?labels[event.label.id]:null;
        const financial=normalizeEvent({id:event.id,summary:event.title,description:event.description});
        tx.objectStore('events').put(attach({...event,cost:financial.cost,currency:financial.currency,cost_status:financial.cost_status,purchase_status:financial.purchase_status,purchase_id:financial.purchase_id,financial_fields:financial.financial_fields,financial_state:financial.financial_state,warnings:financial.warnings,label:event.label?{id:event.label.id,name:label?.name||null,color:label?.backgroundColor||null}:null,...(!token?{deleted_at:new Date().toISOString()}: {})}));
      }
      tx.objectStore('meta').put({id:'calendar-labels',value:labels});
      tx.objectStore('meta').put({ id: 'calendar-sync', value: nextSync, query_version:2,source:'google-api',synced_at: new Date().toISOString() });
    });
    try{await this.locations(store);}catch{/* Saved Calendar and offline records remain available when Maps cannot resolve. */}
    return changes.length;
  }
  async listDocuments() {
    const result = [], folders = [TRIP.drive.trip], visited = new Set();
    while (folders.length) {
      const folder = folders.shift(); if (visited.has(folder)) continue; visited.add(folder);
      let page = null;
      do {
        const params = new URLSearchParams({ q: `'${folder}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType,size,webViewLink,modifiedTime,version,md5Checksum)', pageSize: '1000' });
        if (page) params.set('pageToken', page);
        const data = await (await this.api(`drive/v3/files?${params}`)).json();
        for (const file of data.files || []) { if (file.mimeType === 'application/vnd.google-apps.folder') folders.push(file.id); else result.push(file); }
        page = data.nextPageToken;
      } while (page);
    }
    return result;
  }
  async download(file) {
    await this.verifyInTrip(file.id);
    if (file.mimeType.startsWith('application/vnd.google-apps.')) return (await this.api(`drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=application%2Fpdf`)).blob();
    return (await this.api(`drive/v3/files/${encodeURIComponent(file.id)}?alt=media`)).blob();
  }
  async uploadReceipt(blob, name, operationId) {
    if(!/^[0-9a-f-]+$/i.test(operationId))throw Error('Identidad de recibo inválida.');
    // A stable appProperties key makes retry after lost upload acknowledgement idempotent.
    const params = new URLSearchParams({ q: `'${TRIP.drive.receipts}' in parents and trashed=false and appProperties has { key='av2_receipt' and value='${operationId}' }`, fields: 'files(id)' });
    const existing = await (await this.api(`drive/v3/files?${params}`)).json();
    if (existing.files?.length) return existing.files[0].id;
    const boundary = `av2_${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name, parents: [TRIP.drive.receipts], appProperties: { av2_receipt: operationId } });
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
    await this.guard();const token = await this.getToken(); if (!token) throw Error('Conecta Google para subir recibos.');
    const response = await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    if (!response.ok) {if(response.status===401)await this.unauthorized();throw Error(response.status===401?'La autorización Google expiró. Conecta nuevamente.':`Drive upload: ${response.status}`);}
    return (await response.json()).id;
  }
  async verifyInTrip(id,seen=new Set()){
    if(id===TRIP.drive.trip)return true;if(seen.has(id))throw Error('Archivo fuera de la carpeta del viaje.');seen.add(id);
    const file=await(await this.api(`drive/v3/files/${encodeURIComponent(id)}?fields=id,parents,trashed`)).json();
    if(file.trashed)throw Error('El archivo está en la papelera.');
    for(const parent of file.parents||[]) {if(parent===TRIP.drive.trip)return true;try{if(await this.verifyInTrip(parent,seen))return true;}catch{/* Try another parent, if any. */}}
    throw Error('Archivo fuera de la carpeta del viaje.');
  }
  async trashDocument(id){await this.verifyInTrip(id);await this.api(`drive/v3/files/${encodeURIComponent(id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({trashed:true})});}
}
