import { TRIP } from './config.js';
export class SupabaseRemote {
  constructor(client, device, token, trip=TRIP.id) { this.client = client; this.device = device; this.token = token;this.trip=trip; }
  credentials() { return {p_trip:this.trip,p_device:this.device,p_token:this.token}; }
  async rpc(name, args) { const { data, error } = await this.client.rpc(name, args); if (error) throw Error(error.message); return data; }
  register() { return this.check(); }
  async check() {
    const status=await this.rpc('av2_device_status',this.credentials());
    if(status==='UNENROLLED')throw Error('AV2_DEVICE_ENROLLMENT_REQUIRED');
    if(status!=='ACTIVE')throw Error('AV2_DEVICE_REVOKED');
  }
  apply(operation) { return this.rpc('av2_sync_apply', { ...this.credentials(), p_operation: operation }); }
  async pull() {
    const result = [];
    let after = null;
    for (;;) {
      const data = await this.rpc('av2_sync_pull', { ...this.credentials(), p_after: after });
      result.push(...data); if (data.length < 500) return result; after = data.at(-1).id;
    }
  }
  async pullConflicts() {
    const result=[];let after=null;
    for(;;){const data=await this.rpc('av2_sync_conflicts',{...this.credentials(),p_after:after});result.push(...data);if(data.length<500)return result;after=data.at(-1).id;}
  }
}
export class SyncEngine {
  constructor(store, remote, google = null) { this.store = store; this.remote = remote; this.google = google; }
  async run() {
    if (this.running) return this.running;
    this.running = this.perform().finally(() => { this.running = null; }); return this.running;
  }
  async perform() {
    try {
      await this.remote.check();
      const queue = (await this.store.all('outbox')).sort((a,b) => (a.sequence || 0) - (b.sequence || 0));
      for (const operation of queue) {
        const result = await this.remote.apply(operation); await this.store.acknowledge(operation, result);
      }
      await this.store.ingest(await this.remote.pull());
      if (this.remote.pullConflicts) await this.store.ingestConflicts(await this.remote.pullConflicts());
      if (this.google) {
        for (const record of await this.store.all('records')) {
          if (record.kind !== 'expenses' || record.deleted_at || !record.data.receipt_local_id || record.data.receipt_drive_id) continue;
          const local = await this.store.get('blobs', record.data.receipt_local_id);
          if (!local) throw Error('Falta la copia local del recibo.');
          await this.remote.check();
          const fileId = await this.google.uploadReceipt(local.blob, record.data.receipt_name || 'Recibo', record.data.receipt_local_id);
          await this.store.mutate('expenses', record.id, { receipt_drive_id: fileId });
          // Keep the blob even after confirmed upload; receipt metadata joins the next sync batch.
          await this.store.put('blobs', { ...local, uploaded: true, drive_file_id: fileId });
        }
      }
      // Confirm uploaded receipt IDs remotely during the same reconnect cycle.
      const uploads=(await this.store.all('outbox')).sort((a,b)=>(a.sequence||0)-(b.sequence||0));
      for(const operation of uploads) await this.store.acknowledge(operation,await this.remote.apply(operation));
      await this.store.put('meta', { id: 'last-sync', value: new Date().toISOString() });
    } catch (error) {
      if (error.message.includes('AV2_DEVICE_REVOKED')) { await this.store.purge(); await this.remote.client?.auth.signOut({scope:'local'}); }
      throw error;
    }
  }
}
