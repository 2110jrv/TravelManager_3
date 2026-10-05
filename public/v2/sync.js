import { TRIP } from './config.js';
export class SupabaseRemote {
  constructor(client, device) { this.client = client; this.device = device; }
  async rpc(name, args) { const { data, error } = await this.client.rpc(name, args); if (error) throw Error(error.message); return data; }
  register() { return this.rpc('av2_register_device', { p_trip: TRIP.id, p_device: this.device, p_name: /Windows/.test(navigator.userAgent) ? 'PC Casa' : 'Celular' }); }
  async check() {
    if (!await this.rpc('av2_device_allowed', { p_trip: TRIP.id, p_device: this.device })) throw Error('AV2_DEVICE_REVOKED');
  }
  apply(operation) { return this.rpc(operation.action === 'resolve' ? 'av2_resolve' : 'av2_apply', { p_trip: TRIP.id, p_operation: operation }); }
  async pull() {
    const result = [];
    let after = null;
    for (;;) {
      const data = await this.rpc('av2_pull', { p_trip: TRIP.id, p_device: this.device, p_after: after });
      result.push(...data); if (data.length < 500) return result; after = data.at(-1).id;
    }
  }
  pullConflicts() { return this.rpc('av2_pull_conflicts', { p_trip: TRIP.id, p_device: this.device }); }
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
          const fileId = await this.google.uploadReceipt(local.blob, record.data.receipt_name || 'Recibo', record.data.receipt_local_id);
          await this.store.mutate('expenses', record.id, { receipt_drive_id: fileId });
          // Keep the blob even after confirmed upload; receipt metadata joins the next sync batch.
          await this.store.put('blobs', { ...local, uploaded: true, drive_file_id: fileId });
        }
      }
      await this.store.put('meta', { id: 'last-sync', value: new Date().toISOString() });
    } catch (error) {
      if (error.message.includes('AV2_DEVICE_REVOKED')) { await this.store.purge(); await this.remote.client?.auth.signOut(); }
      throw error;
    }
  }
}
