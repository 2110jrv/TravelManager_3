import { TRIP } from './config.js';
export class SupabaseRemote {
  constructor(client, device, token, trip=TRIP.id) { this.client = client; this.device = device; this.token = token;this.trip=trip; }
  credentials() { return {p_trip:this.trip,p_device:this.device,p_token:this.token}; }
  async rpc(name, args) { const { data, error } = await this.client.rpc(name, args); if (error) throw Error(error.message); return data; }
  register() { return this.check(); }
  async check() {
    if(this.pinAccess){await this.pinAccess.validate();this.device=this.pinAccess.store.device;this.token=this.pinAccess.store.deviceToken;return;}
    const status=await this.rpc('av2_device_status',this.credentials());
    if(status==='UNENROLLED')throw Error('AV2_DEVICE_ENROLLMENT_REQUIRED');
    if(status!=='ACTIVE')throw Error('AV2_DEVICE_REVOKED');
  }
  apply(operation) { return this.rpc(operation.action==='restore'&&operation.kind==='expenses'?'av2_expense_restore':operation.kind==='places_of_interest'?'av2_place_apply':'av2_sync_apply', { ...this.credentials(), p_operation: operation }); }
  async pull() {
    const result = [];
    let after = null;
    for (;;) {
      const data = await this.rpc('av2_sync_pull', { ...this.credentials(), p_after: after });
      result.push(...data); if (data.length < 500) break; after = data.at(-1).id;
    }
    if(this.pinAccess){after=null;for(;;){const data=await this.rpc('av2_sync_places',{...this.credentials(),p_after:after})||[];result.push(...data);if(data.length<500)break;after=data.at(-1).id;}}
    return result;
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
      const acknowledged=new Map();const queue = (await this.store.all('outbox')).sort((a,b) => (a.sequence || 0) - (b.sequence || 0));
      for (const operation of queue) {
        if(this.store.pinMode&&operation.actor_user!==this.store.activeUser?.id)continue;
        if(this.store.pinMode){await this.remote.check();if(operation.actor_user!==this.store.activeUser?.id)continue;operation.device_id=this.store.device;}
        const predecessor=operation.kind==='expenses'?acknowledged.get(operation.record_id):null;if(predecessor){operation.base_version=predecessor.version;await this.store.put('outbox',operation);}const result = await this.remote.apply(operation); await this.store.acknowledge(operation, result);if(operation.kind==='expenses'&&result.record&&!(result.conflicts||[]).length)acknowledged.set(operation.record_id,result.record);else acknowledged.delete(operation.record_id);
      }
      await this.store.ingest(await this.remote.pull());
      if (this.remote.pullConflicts) await this.store.ingestConflicts(await this.remote.pullConflicts());
      if (this.google) {
        for (const record of await this.store.all('records')) {
          if(this.store.pinMode&&queue.some(op=>op.record_id===record.id&&op.actor_user!==this.store.activeUser?.id))continue;
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
      for(const operation of uploads){if(this.store.pinMode&&operation.actor_user!==this.store.activeUser?.id)continue;if(this.store.pinMode){await this.remote.check();if(operation.actor_user!==this.store.activeUser?.id)continue;operation.device_id=this.store.device;}await this.store.acknowledge(operation,await this.remote.apply(operation));}
      await this.store.put('meta', { id: 'last-sync', value: new Date().toISOString() });
    } catch (error) {
      if (!this.store.pinMode&&error.message.includes('AV2_DEVICE_REVOKED')) { await this.store.purge(); await this.remote.client?.auth.signOut({scope:'local'}); }
      throw error;
    }
  }
}
