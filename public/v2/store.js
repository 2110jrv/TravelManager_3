import { TRIP, KINDS } from './config.js';
const STORES = ['records', 'events', 'outbox', 'conflicts', 'meta', 'blobs'];
export class LocalStore {
  constructor(name = 'agenda-viajera-v2') { this.name = name; }
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 2);
      request.onupgradeneeded = () => { for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' }); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    this.db.onversionchange = () => this.db.close();
    await this.transaction(['meta'], tx => {
      const meta=tx.objectStore('meta'),identity=meta.get('device'),secret=meta.get('device-token'),installation=meta.get('installation');
      installation.onsuccess=()=>{
        this.device=identity.result?.value || installation.result?.value?.device_id || crypto.randomUUID();
        this.installation=installation.result?.value?.installation_id || this.device;
        meta.put({id:'device',value:this.device});
        meta.put({id:'installation',value:{installation_id:this.installation,device_id:this.device}});
      };
      secret.onsuccess=()=>{this.deviceToken=secret.result?.value || Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');if(!secret.result) meta.put({id:'device-token',value:this.deviceToken});};
    });
    return this;
  }
  async bindDevice(device) {
    if(!device?.id||device.trip_id!==TRIP.id||device.deleted_at)throw Error('AV2_INVALID_DEVICE');
    this.device=device.id;
    await this.transaction(['meta'],tx=>{
      const meta=tx.objectStore('meta');
      meta.put({id:'device',value:this.device});
      meta.put({id:'installation',value:{installation_id:this.installation,device_id:this.device}});
      meta.put({id:'device-identity',value:device});
      meta.put({id:'authorized',value:true});
    });
  }
  async transaction(names, action) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(names, 'readwrite');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('Transacción cancelada'));
      try { action(tx); } catch (error) { tx.abort(); reject(error); }
    });
  }
  get(store, id) { return this.read(store, objectStore => objectStore.get(id)); }
  all(store) { return this.read(store, objectStore => objectStore.getAll()); }
  read(store, query) { return new Promise((resolve, reject) => { const request = query(this.db.transaction(store).objectStore(store)); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  put(store, value) { return this.transaction([store], tx => tx.objectStore(store).put(value)); }
  async mutate(kind, id, changes, deleted = false, blob = null, editBase = null) {
    if (!KINDS.includes(kind)) throw Error('Tipo no permitido');
    const now = new Date().toISOString(), operationId = crypto.randomUUID();
    await this.transaction(['records', 'outbox', 'blobs', 'meta'], tx => {
      const request = tx.objectStore('records').get(id);
      request.onsuccess = () => {
        const old = request.result;
        if (old?.deleted_at) { tx.abort(); return; }
        const base=editBase||old;
        const delta=Object.fromEntries(Object.entries(changes).filter(([field,value])=>JSON.stringify(base?.data?.[field]??null)!==JSON.stringify(value??null)));
        const record = { id, trip_id: TRIP.id, kind, version: old?.version || 0, created_at: old?.created_at || now, updated_at: now, updated_by_device: this.device, deleted_at: deleted ? now : null, data: { ...old?.data, ...delta } };
        if(old&&!deleted&&!Object.keys(delta).length)return;
        const operation = { id: operationId, record_id: id, kind, base_version: base?.version || 0, base: base?.data || {}, changes:delta, deleted_at: record.deleted_at, device_id: this.device, created_at: now };
        tx.objectStore('records').put(record);
        const counter = tx.objectStore('meta').get('queue-sequence');
        counter.onsuccess = () => { operation.sequence = (counter.result?.value || 0) + 1; tx.objectStore('meta').put({id:'queue-sequence',value:operation.sequence}); tx.objectStore('outbox').put(operation); };
        if (blob) tx.objectStore('blobs').put({ id: blob.id, blob: blob.value, uploaded: false });
      };
    });
    return this.get('records', id);
  }
  async acknowledge(operation, result) {
    await this.transaction(['records', 'outbox', 'conflicts'], tx => {
      tx.objectStore('outbox').delete(operation.id);
      const request = tx.objectStore('outbox').getAll();
      request.onsuccess = () => {
        const pending = request.result.filter(x => x.record_id === operation.record_id).sort((a,b) => (a.sequence || 0) - (b.sequence || 0));
        if (result.record) {
          const record = structuredClone(result.record);
          // Keep local edits made while a request was in flight visible until their own acknowledgement.
          if (!record.deleted_at) for (const item of pending) { Object.assign(record.data, item.changes || {}); if (item.deleted_at) record.deleted_at = item.deleted_at; }
          tx.objectStore('records').put(record);
        }
        for (const conflict of result.conflicts || []) tx.objectStore('conflicts').put({ ...conflict, id: conflict.id || crypto.randomUUID(), record_id: operation.record_id, kind: operation.kind });
      };
    });
  }
  async ingest(records) {
    await this.transaction(['records', 'outbox'], tx => {
      const request = tx.objectStore('outbox').getAll();
      request.onsuccess = () => {
        const pending = new Set(request.result.map(x => x.record_id));
        for (const record of records) if (!pending.has(record.id)) tx.objectStore('records').put(record);
      };
    });
  }
  async purge() { await this.transaction(STORES, tx => { for (const name of STORES) tx.objectStore(name).clear(); }); }
  async resolve(conflict, choice) {
    await this.transaction(['outbox', 'conflicts', 'meta'], tx => {
      const counter=tx.objectStore('meta').get('queue-sequence');
      counter.onsuccess=()=>{ const sequence=(counter.result?.value || 0)+1;tx.objectStore('meta').put({id:'queue-sequence',value:sequence});
        tx.objectStore('outbox').put({ id: crypto.randomUUID(), action: 'resolve', conflict_id: conflict.id, record_id: conflict.record_id, choice, device_id: this.device, created_at: new Date().toISOString(),sequence }); };
      tx.objectStore('conflicts').put({ ...conflict, resolving: true });
    });
  }
  async ingestConflicts(conflicts) {
    await this.transaction(['conflicts'], tx => {
      for (const conflict of conflicts) {
        if (conflict.deleted_at) tx.objectStore('conflicts').delete(conflict.id);
        else { const request = tx.objectStore('conflicts').get(conflict.id); request.onsuccess = () => tx.objectStore('conflicts').put({ ...conflict, resolving: request.result?.resolving || false }); }
      }
    });
  }
}
