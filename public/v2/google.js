import { TRIP } from './config.js';
import { normalizeEvent } from './domain.js';
export class GoogleSource {
  constructor(getToken, request = fetch) { this.getToken = getToken; this.request = request; }
  async api(path, options = {}) {
    const token = await this.getToken();
    if (!token) throw Error('Autoriza Google para leer Calendar y Drive.');
    const response = await this.request(`https://www.googleapis.com/${path}`, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
    if (!response.ok) { const error = Error(response.status === 401 ? 'La autorización Google expiró. Conecta nuevamente.' : `Google: error ${response.status}`); error.status = response.status; throw error; }
    return response;
  }
  async syncCalendar(store) {
    const colors = await (await this.api('calendar/v3/colors')).json();
    const saved = await store.get('meta', 'calendar-sync');
    const labels = (await store.get('meta', 'calendar-labels'))?.value || {};
    let token = saved?.value, page = null, changes = [], nextSync = null;
    do {
      const params = new URLSearchParams({ singleEvents: 'true', showDeleted: 'true', maxResults: '2500' });
      if (token) params.set('syncToken', token);
      if (page) params.set('pageToken', page);
      let response;
      try { response = await this.api(`calendar/v3/calendars/${encodeURIComponent(TRIP.calendarId)}/events?${params}`); }
      catch (error) { if (error.status !== 410 || !token) throw error; token = null; page = null; changes = []; continue; }
      const batch = await response.json(); changes.push(...(batch.items || [])); page = batch.nextPageToken; nextSync = batch.nextSyncToken;
      if (!page && !nextSync) throw Error('Calendar no devolvió un token de sincronización.');
    } while (page || (!nextSync && token === null));
    const ids = new Set(changes.map(x => x.id));
    const previous = token ? [] : await store.all('events');
    await store.transaction(['events', 'meta'], tx => {
      for (const raw of changes) tx.objectStore('events').put(normalizeEvent(raw, colors.event, labels));
      // Mark missing Calendar events individually; never replace the local database.
      for (const event of previous) if (!ids.has(event.id)) tx.objectStore('events').put({ ...event, deleted_at: new Date().toISOString() });
      tx.objectStore('meta').put({ id: 'calendar-sync', value: nextSync, synced_at: new Date().toISOString() });
    });
    return changes.length;
  }
  async listDocuments() {
    const result = [], folders = [TRIP.drive.trip], visited = new Set();
    while (folders.length) {
      const folder = folders.shift(); if (visited.has(folder)) continue; visited.add(folder);
      let page = null;
      do {
        const params = new URLSearchParams({ q: `'${folder}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType,size,webViewLink,modifiedTime)', pageSize: '1000' });
        if (page) params.set('pageToken', page);
        const data = await (await this.api(`drive/v3/files?${params}`)).json();
        for (const file of data.files || []) { if (file.mimeType === 'application/vnd.google-apps.folder') folders.push(file.id); else result.push(file); }
        page = data.nextPageToken;
      } while (page);
    }
    return result;
  }
  async download(file) {
    if (file.mimeType.startsWith('application/vnd.google-apps.')) throw Error('Exporta este documento como PDF antes de prepararlo offline.');
    return (await this.api(`drive/v3/files/${encodeURIComponent(file.id)}?alt=media`)).blob();
  }
  async uploadReceipt(blob, name, operationId) {
    // A stable appProperties key makes retry after lost upload acknowledgement idempotent.
    const params = new URLSearchParams({ q: `'${TRIP.drive.receipts}' in parents and trashed=false and appProperties has { key='av2_receipt' and value='${operationId}' }`, fields: 'files(id)' });
    const existing = await (await this.api(`drive/v3/files?${params}`)).json();
    if (existing.files?.length) return existing.files[0].id;
    const boundary = `av2_${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name, parents: [TRIP.drive.receipts], appProperties: { av2_receipt: operationId } });
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
    const token = await this.getToken(); if (!token) throw Error('Conecta Google para subir recibos.');
    const response = await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    if (!response.ok) throw Error(`Drive upload: ${response.status}`);
    return (await response.json()).id;
  }
}
