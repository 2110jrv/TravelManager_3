import {
  deleteItem,
  deleteTrip,
  deleteTripDay,
  getAllItems,
  getAllSettings,
  getAllTrips,
  getDeletionQueue,
  getOrCreateDeviceId,
  getQueueRecords,
  getTripDays,
  getSyncMeta,
  countPendingQueueRecords,
  saveSyncMeta,
  saveSyncSnapshot,
  saveQueueRecord,
  updateQueueRecord,
  setSyncQueueWritesSuppressed,
  saveDeletionRecord,
  saveSettingRecord,
  saveTrip,
  saveTripDay,
  updateItem
} from './db.js';
import { getCurrentUser, getSupabaseClient } from './supabaseClient.js';

const SYNC_INTERVAL_MS = 60000;
const SYNC_DEBOUNCE_MS = 1200;
const AUTO_SYNC_COOLDOWN_MS = 30000;
const DIRTY_PROTECTION_MS = 5 * 60000;
const SNAPSHOT_REASON_PULL = 'pull';

const state = {
  status: 'signed_out',
  lastSyncAt: '',
  lastError: '',
  pendingReason: '',
  running: false,
  started: false,
  applyingRemote: false,
  conflict: false,
  lastAutoSyncAt: '',
  suppressCloudSyncUntil: 0,
  deviceId: ''
};

let intervalId = null;
let debounceId = null;
let realtimeChannel = null;
let onAppliedRemoteChanges = null;
const localRecentlyChanged = new Map();
const deletedItemIdentityKeys = new Set();

export function getSyncState() {
  return { ...state };
}

export function recordLocalChange(entityType, entityId, changedAt = new Date().toISOString()) {
  try {
    if (!entityType || !entityId) return;
    localRecentlyChanged.set(entityKey(entityType, entityId), changedAt);
    pruneRecentChanges();
  } catch (error) {
    console.warn('[TM3] recordLocalChange failed; continuing without sync marker.', error);
  }
}

export function registerDeletedItemIdentityKeys(itemOrTombstone) {
  getItemIdentityKeys(itemOrTombstone).forEach(key => deletedItemIdentityKeys.add(key));
}

export function registerDeletedItemTombstones(tombstones = []) {
  tombstones.forEach(tombstone => {
    if ((tombstone.EntityType || tombstone.entity_type) !== 'ITEM') return;
    getItemIdentityKeys(tombstone).forEach(key => deletedItemIdentityKeys.add(key));
  });
}

export async function startCloudSync(options = {}) {
  if (typeof options.onAppliedRemoteChanges === 'function') onAppliedRemoteChanges = options.onAppliedRemoteChanges;
  if (!navigator.onLine) {
    setSyncState({ status: 'offline', pendingReason: 'offline' });
    return getSyncState();
  }
  const user = await safeUser();
  if (!user) {
    stopCloudSync();
    return getSyncState();
  }
  state.deviceId = await getOrCreateDeviceId();
  if (!state.started) {
    state.started = true;
  }
  return getSyncState();
}

export function stopCloudSync() {
  if (intervalId) window.clearInterval(intervalId);
  if (debounceId) window.clearTimeout(debounceId);
  intervalId = null;
  debounceId = null;
  state.started = false;
  unsubscribeFromCloudChanges();
  setSyncState({ status: 'signed_out', pendingReason: '', lastError: '' });
}

export async function runCloudSyncNow(reason = 'manual') {
  const isManual = reason === 'manual';
  const now = Date.now();
  if (state.running) {
    if (isManual) setSyncState({ status: 'pending', pendingReason: reason });
    return getSyncState();
  }
  if (!navigator.onLine) {
    setSyncState({ status: 'offline', pendingReason: reason || 'offline' });
    return getSyncState();
  }
  const user = await safeUser();
  if (!user) {
    setSyncState({ status: 'signed_out', pendingReason: '' });
    return getSyncState();
  }
  if (!isManual && state.lastAutoSyncAt && now - Date.parse(state.lastAutoSyncAt || 0) < AUTO_SYNC_COOLDOWN_MS) {
    return getSyncState();
  }

  state.running = true;
  setSyncState({ status: 'syncing', pendingReason: reason, lastError: '' });
  try {
    const pending = await getQueueRecords('PENDING');
    const pushed = await pushPendingQueue(pending);
    state.lastSyncAt = new Date().toISOString();
    if (!isManual) state.lastAutoSyncAt = state.lastSyncAt;
    setSyncState({ status: pushed > 0 ? 'synced' : 'idle', pendingReason: '', lastError: '' });
  } catch (error) {
    setSyncState({ status: 'error', lastError: getErrorMessage(error), pendingReason: reason });
  } finally {
    state.running = false;
  }
  return getSyncState();
}

export function queueCloudSync(reason = 'change') {
  if (state.applyingRemote) return;
  if (Date.now() < Number(state.suppressCloudSyncUntil || 0)) return;
  if (!navigator.onLine) {
    setSyncState({ status: 'offline', pendingReason: reason });
    return;
  }
  if (state.running) return;
  if (reason !== 'manual' && state.lastAutoSyncAt && Date.now() - Date.parse(state.lastAutoSyncAt || 0) < AUTO_SYNC_COOLDOWN_MS) return;
  setSyncState({ status: 'pending', pendingReason: reason });
  if (debounceId) window.clearTimeout(debounceId);
  debounceId = window.setTimeout(() => {
    debounceId = null;
    runCloudSyncNow(reason);
  }, SYNC_DEBOUNCE_MS);
}

export async function pushPendingQueue(records = null) {
  const user = await safeUser();
  if (!user || !navigator.onLine) return 0;
  const client = await getSupabaseClient();
  const deviceId = state.deviceId || await getOrCreateDeviceId();
  state.deviceId = deviceId;
  const pending = records || await getQueueRecords('PENDING');
  let count = 0;
  setSyncQueueWritesSuppressed(true);
  try {
    for (const record of pending) {
      await updateQueueRecord({ ...record, Status: 'SYNCING', Attempts: Number(record.Attempts || 0) + 1, UpdatedAt: new Date().toISOString() });
      try {
        await processQueueRecord(client, record, deviceId, user);
        await updateQueueRecord({ ...record, Status: 'DONE', LastError: '', UpdatedAt: new Date().toISOString() });
        count += 1;
      } catch (error) {
        console.error('[TM3 DELETE_TRIP_DAY] fallo al procesar syncQueue', { QueueID: record.QueueID, OperationType: record.OperationType, error });
        await updateQueueRecord({ ...record, Status: 'FAILED', LastError: getErrorMessage(error), UpdatedAt: new Date().toISOString() });
      }
    }
  } finally {
    setSyncQueueWritesSuppressed(false);
  }
  return count;
}

export async function pullMasterNow() {
  return pullCloudToLocal();
}

async function processQueueRecord(client, record, deviceId, user) {
  const op = String(record.OperationType || '').toUpperCase();
  const payload = record.Payload || {};
  if (op === 'UPSERT_ITEM') {
    const row = normalizeLocalPayloadForPush(payload, payload.UpdatedAt || payload.updatedAt || new Date().toISOString());
    const { error } = await client.from('tm3_items').upsert({
      item_id: payload.ItemID,
      trip_id: payload.TripID || '',
      source_item_id: payload.SourceItemID || null,
      day_date: payload.DayDate || null,
      user_id: user.id,
      payload: row,
      updated_at: row.UpdatedAt,
      device_id: deviceId
    }, { onConflict: 'item_id' });
    if (error) throw error;
    return;
  }
  if (op === 'DELETE_ITEM') {
    const itemId = payload.ItemID || record.EntityID;
    if (!itemId) throw new Error('DELETE_ITEM sin ItemID');
    const { error } = await client.from('tm3_items').delete().eq('user_id', user.id).eq('item_id', itemId);
    if (error) throw error;
    return;
  }
  if (op === 'DELETE_TRIP_DAY') {
    const dayId = payload.TripDayID || payload.DayID || record.EntityID;
    if (!dayId) throw new Error('DELETE_TRIP_DAY sin TripDayID');
    console.log('[TM3 DELETE_TRIP_DAY] delete remoto procesado', { dayId });
    const { error } = await client.from('tm3_trip_days').delete().eq('user_id', user.id).eq('day_id', dayId);
    if (error) {
      console.error('[TM3 DELETE_TRIP_DAY] resultado remoto con error', { dayId, error });
      throw error;
    }
    console.log('[TM3 DELETE_TRIP_DAY] resultado remoto OK', { dayId });
    return;
  }
  if (op === 'UPSERT_DAY') {
    const row = normalizeLocalPayloadForPush(payload, payload.UpdatedAt || payload.updatedAt || new Date().toISOString());
    const { error } = await client.from('tm3_trip_days').upsert({
      day_id: payload.TripDayID,
      trip_id: payload.TripID || '',
      user_id: user.id,
      payload: row,
      updated_at: row.UpdatedAt,
      device_id: deviceId
    }, { onConflict: 'day_id' });
    if (error) throw error;
    return;
  }
  if (op === 'UPSERT_TRIP') {
    const row = normalizeLocalPayloadForPush(payload, payload.UpdatedAt || payload.updatedAt || new Date().toISOString());
    const { error } = await client.from('tm3_trips').upsert({
      trip_id: payload.TripID,
      user_id: user.id,
      payload: row,
      updated_at: row.UpdatedAt,
      device_id: deviceId
    }, { onConflict: 'trip_id' });
    if (error) throw error;
    return;
  }
  if (op === 'UPSERT_SETTING') {
    const row = normalizeLocalPayloadForPush(payload, payload.UpdatedAt || payload.updatedAt || new Date().toISOString());
    const { error } = await client.from('tm3_settings').upsert({
      setting_key: payload.key,
      user_id: user.id,
      payload: row,
      updated_at: row.UpdatedAt,
      device_id: deviceId
    }, { onConflict: 'user_id,setting_key' });
    if (error) throw error;
    return;
  }
  throw new Error(`Operación no soportada: ${op}`);
}

export async function pullCloudToLocal() {
  const user = await safeUser();
  if (!user || !navigator.onLine) return 0;
  const client = await getSupabaseClient();
  const cloud = await loadCloudSnapshot(client);
  const meta = await getSyncMeta();
  const remoteUpdatedAt = getRemoteUpdatedAt(cloud);
  const local = {
    tm3_trips: indexBy(await getAllTrips(), 'TripID'),
    tm3_trip_days: indexBy(await getTripDays(), 'TripDayID'),
    tm3_items: indexBy(await getAllItems(), 'ItemID'),
    tm3_settings: indexBy(await getAllSettings(), 'key'),
    tm3_deletion_queue: indexBy(await getDeletionQueue(), 'DeletionID')
  };
  const tombstones = buildTombstoneMap([
    ...local.tm3_deletion_queue.values(),
    ...cloud.tm3_deletion_queue.map(row => row.payload || row)
  ]);
  registerDeletedItemTombstones([...local.tm3_deletion_queue.values(), ...cloud.tm3_deletion_queue.map(row => row.payload || row)]);
  await createLocalSyncSnapshot('pull', cloud, local);
  let applied = 0;
  state.applyingRemote = true;
  try {
    applied += await pullDeletions(cloud.tm3_deletion_queue, local.tm3_deletion_queue);
    applied += await applyTombstones(tombstones, local);
    applied += await pullCollection(cloud.tm3_trips, local.tm3_trips, { cloudId: 'trip_id', save: saveTrip, entityType: 'TRIP', tombstones });
    applied += await pullCollection(cloud.tm3_trip_days, local.tm3_trip_days, { cloudId: 'day_id', save: saveTripDay, entityType: 'TRIP_DAY', tombstones, localByNaturalKey: indexByComputed([...local.tm3_trip_days.values()], getTripDayDateKey), getNaturalKey: getTripDayDateKey });
    applied += await pullCollection(cloud.tm3_items, local.tm3_items, { cloudId: 'item_id', save: updateItem, entityType: 'ITEM', tombstones });
    applied += await pullCollection(cloud.tm3_settings, local.tm3_settings, { cloudId: 'setting_key', save: saveSettingRecord, entityType: 'SETTING', tombstones: new Map() });
  } finally {
    state.applyingRemote = false;
  }
  await updateSyncMeta({
    ...meta,
    deviceId: meta.deviceId || (await getOrCreateDeviceId()),
    remoteUpdatedAt,
    localUpdatedAt: await getLocalUpdatedAt(),
    syncBaseRemoteUpdatedAt: remoteUpdatedAt || meta.syncBaseRemoteUpdatedAt,
    lastSuccessfulPullAt: new Date().toISOString(),
    hasLocalPendingChanges: false,
    lastConflictMessage: ''
  });
  state.suppressCloudSyncUntil = Date.now() + 10000;
  return applied;
}

export async function subscribeToCloudChanges() {
  const user = await safeUser();
  if (!user || realtimeChannel) return;
  try {
    const client = await getSupabaseClient();
    realtimeChannel = client.channel(`tm3-sync-${user.id}`);
    SYNC_TABLES.forEach(table => {
      realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${user.id}` }, payload => {
        if (Date.now() < Number(state.suppressCloudSyncUntil || 0)) return;
        if (payload?.new?.device_id && payload.new.device_id === state.deviceId) return;
        queueCloudSync('realtime');
      });
    });
    realtimeChannel.subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') queueCloudSync('realtime-fallback');
    });
  } catch (error) {
    setSyncState({ lastError: getErrorMessage(error) });
  }
}

export async function unsubscribeFromCloudChanges() {
  if (!realtimeChannel) return;
  try {
    const client = await getSupabaseClient();
    await client.removeChannel(realtimeChannel);
  } catch (_error) {
    // Realtime is best-effort; polling stays available when signed in.
  } finally {
    realtimeChannel = null;
  }
}

async function pushCollection(client, table, localRows, cloudRows, options) {
  const cloudById = indexCloud(cloudRows, options.cloudId);
  let count = 0;
  for (const row of localRows) {
    const id = row[options.idField];
    if (!id) continue;
    const localTimestamp = getLocalTimestamp(row);
    const tombstone = findTombstoneForEntity(options.tombstones, options.entityType, row, id);
    if (tombstone && compareIso(getLocalTimestamp(tombstone), localTimestamp) >= 0) continue;
    const cloud = cloudById.get(id);
    if (cloud?.deleted_at) continue;
    if (cloud && compareLocalToCloud(row, cloud) <= 0) continue;
    const pushTimestamp = localTimestamp || new Date().toISOString();
    const payload = normalizeLocalPayloadForPush(row, pushTimestamp);
    const upsertRow = {
      ...options.row(payload),
      user_id: options.user.id,
      payload,
      updated_at: pushTimestamp,
      device_id: options.deviceId
    };
    const { error } = await client.from(table).upsert(upsertRow, { onConflict: options.onConflict || options.cloudId });
    if (error) throw error;
    count += 1;
  }
  return count;
}

async function pullCollection(cloudRows, localById, options) {
  let count = 0;
  for (const row of cloudRows) {
    if (row.deleted_at) continue;
    const id = row[options.cloudId];
    const payload = row.payload;
    if (!id || !payload) continue;
    const tombstone = findTombstoneForEntity(options.tombstones, options.entityType, payload, id);
    if (tombstone && compareIso(getLocalTimestamp(tombstone), row.updated_at) >= 0) {
      if (options.entityType === 'TRIP_DAY') {
        console.log('[TM3 DELETE_TRIP_DAY] TripDay omitido por tombstone en pull', { TripDayID: id });
      }
      continue;
    }
    if (options.entityType === 'ITEM' && isDeletedItem(payload)) {
      await deleteItem(id).catch(() => {});
      count += 1;
      continue;
    }
    const local = localById.get(id) || options.localByNaturalKey?.get(options.getNaturalKey?.(payload) || '');
    if (isRecentlyChanged(options.entityType, id, row.updated_at)) continue;
    if (local && compareLocalToCloud(local, row) >= 0) continue;
    await options.save(normalizeRemotePayload(payload, row.updated_at));
    count += 1;
  }
  return count;
}

function normalizeRemotePayload(payload, updatedAt) {
  const timestamp = payload.UpdatedAt || payload.updatedAt || payload.ModifiedAt || payload.LastUpdatedAt || updatedAt;
  return {
    ...payload,
    UpdatedAt: payload.UpdatedAt || timestamp,
    ModifiedAt: payload.ModifiedAt || timestamp,
    updatedAt: payload.updatedAt || timestamp,
    SyncStatus: 'SYNCED'
  };
}

function normalizeLocalPayloadForPush(payload, updatedAt) {
  return {
    ...payload,
    UpdatedAt: payload.UpdatedAt || updatedAt,
    ModifiedAt: payload.ModifiedAt || updatedAt,
    updatedAt: payload.updatedAt || updatedAt
  };
}

async function pullDeletions(cloudRows, localById) {
  let count = 0;
  for (const row of cloudRows) {
    const payload = row.payload;
    const id = row.deletion_id || payload?.DeletionID;
    if (!id || !payload || localById.has(id)) continue;
    await saveDeletionRecord({ ...payload, DeletionID: id, SyncStatus: 'SYNCED' });
    count += 1;
  }
  return count;
}

async function applyTombstones(tombstones, local) {
  let count = 0;
  for (const tombstone of uniqueTombstones(tombstones)) {
    const type = tombstone.EntityType || tombstone.entity_type;
    const id = tombstone.EntityId || tombstone.EntityID || tombstone.entity_id;
    const ts = getLocalTimestamp(tombstone);
    if (type === 'ITEM') {
      const items = [...local.tm3_items.values()].filter(item => findTombstoneForEntity(tombstones, 'ITEM', item, item.ItemID) === tombstone);
      for (const item of items) {
        if (compareIso(ts, getLocalTimestamp(item)) >= 0) {
          await deleteItem(item.ItemID);
          registerDeletedItemIdentityKeys(item);
          count += 1;
        }
      }
    }
    if (type === 'TRIP_DAY') {
      const day = local.tm3_trip_days.get(id);
      if (day && compareIso(ts, getLocalTimestamp(day)) >= 0) {
        await deleteTripDay(id);
        count += 1;
      }
    }
    if (type === 'TRIP') {
      const trip = local.tm3_trips.get(id);
      if (trip && compareIso(ts, getLocalTimestamp(trip)) >= 0) {
        await deleteTrip(id);
        count += 1;
      }
    }
  }
  return count;
}

async function pushRemoteDeletes(client, cloud, tombstones) {
  let count = 0;
  count += await pushRemoteDeletesForTable(client, 'tm3_items', cloud.tm3_items, {
    cloudId: 'item_id',
    entityType: 'ITEM',
    tombstones
  });
  return count;
}

async function pushRemoteDeletesForTable(client, table, cloudRows, options) {
  let count = 0;
  for (const row of cloudRows || []) {
    if (row.deleted_at) continue;
    const payload = row.payload || {};
    const id = row[options.cloudId];
    const tombstone = findTombstoneForEntity(options.tombstones, options.entityType, payload, id);
    if (!tombstone || compareIso(getLocalTimestamp(tombstone), getCloudTimestamp(row)) < 0) continue;
    const { error } = await client.from(table).delete().eq(options.cloudId, id);
    if (!error) count += 1;
  }
  return count;
}

async function loadCloudSnapshot(client) {
  const entries = await Promise.all(SYNC_TABLES.map(async table => {
    const { data, error } = await client.from(table).select('*');
    if (error) throw error;
    return [table, data || []];
  }));
  return Object.fromEntries(entries);
}

function buildTombstoneMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const type = row.EntityType || row.entity_type;
    if (!type) continue;
    for (const key of getDeletionIdentityKeys(type, row)) {
      const existing = map.get(key);
      if (!existing || compareIso(getLocalTimestamp(row), getLocalTimestamp(existing)) > 0) map.set(key, row);
    }
  }
  return map;
}

function uniqueTombstones(tombstones) {
  return [...new Set(tombstones.values())];
}

function findTombstoneForEntity(tombstones, type, entity, fallbackId = '') {
  for (const key of getEntityIdentityKeys(type, entity, fallbackId)) {
    const tombstone = tombstones.get(key);
    if (tombstone) return tombstone;
  }
  return null;
}

function getDeletionIdentityKeys(type, tombstone) {
  if (type === 'ITEM') return getItemIdentityKeys(tombstone);
  if (type === 'TRIP_DAY') return getTripDayIdentityKeys(tombstone);
  const id = tombstone.EntityId || tombstone.EntityID || tombstone.entity_id;
  return id ? [tombstoneKey(type, `id:${id}`)] : [];
}

function getEntityIdentityKeys(type, entity, fallbackId = '') {
  if (type === 'ITEM') return getItemIdentityKeys({ ...entity, ItemID: entity?.ItemID || fallbackId });
  if (type === 'TRIP_DAY') return getTripDayIdentityKeys({ ...entity, TripDayID: entity?.TripDayID || entity?.DayID || fallbackId });
  const id = entity?.EntityId || entity?.EntityID || entity?.entity_id || fallbackId;
  return id ? [tombstoneKey(type, `id:${id}`)] : [];
}

function getItemIdentityKeys(item) {
  const keys = new Set();
  const listed = item.IdentityKeys || item.identityKeys || [];
  listed.forEach(key => keys.add(tombstoneKey('ITEM', String(key))));
  [item.ItemID, item.SourceItemID, item.EntityId, item.EntityID, item.entity_id].filter(Boolean).forEach(value => {
    keys.add(tombstoneKey('ITEM', `id:${String(value)}`));
  });
  const tripId = item.TripID || item.trip_id || '';
  const date = item.DayDate || item.StartDate || item.day_date || '';
  const title = normalizeIdentityText(item.Title || item.title);
  if (tripId && date && title) keys.add(tombstoneKey('ITEM', `natural:${tripId}:${date}:${title}`));
  return [...keys];
}

function getTripDayIdentityKeys(day) {
  const keys = new Set();
  [day.TripDayID, day.DayID, day.EntityId, day.EntityID, day.entity_id].filter(Boolean).forEach(value => {
    keys.add(tombstoneKey('TRIP_DAY', `id:${String(value)}`));
  });
  const tripId = day.TripID || day.trip_id || '';
  const date = day.DayDate || day.Date || day.day_date || '';
  if (tripId && date) keys.add(tombstoneKey('TRIP_DAY', `natural:${tripId}:${date}`));
  return [...keys];
}

function isDeletedItem(item) {
  return getItemIdentityKeys(item).some(key => deletedItemIdentityKeys.has(key));
}

function tombstoneKey(type, key) {
  return `${String(type || '').toUpperCase()}:${key}`;
}

function normalizeIdentityText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function entityKey(type, id) {
  return `${String(type || '').toUpperCase()}:${id}`;
}

function isRecentlyChanged(type, id, cloudTimestamp) {
  pruneRecentChanges();
  const localTimestamp = localRecentlyChanged.get(entityKey(type, id));
  return Boolean(localTimestamp && compareIso(localTimestamp, cloudTimestamp) >= 0);
}

function pruneRecentChanges() {
  if (typeof DIRTY_PROTECTION_MS !== 'number' || Number.isNaN(DIRTY_PROTECTION_MS)) return;
  const cutoff = Date.now() - DIRTY_PROTECTION_MS;
  localRecentlyChanged.forEach((timestamp, key) => {
    const time = Date.parse(timestamp || '');
    if (Number.isNaN(time) || time < cutoff) localRecentlyChanged.delete(key);
  });
}

function indexBy(rows, field) {
  return new Map((rows || []).filter(row => row?.[field]).map(row => [row[field], row]));
}

function indexByComputed(rows, getKey) {
  return new Map((rows || []).map(row => [getKey(row), row]).filter(([key]) => key));
}

function indexCloud(rows, field) {
  return new Map((rows || []).filter(row => row?.[field]).map(row => [row[field], row]));
}

function getTripDayDateKey(day) {
  const tripId = day?.TripID || '';
  const date = day?.Date || day?.DayDate || '';
  return tripId && date ? `${tripId}:${date}` : '';
}

function getLocalTimestamp(row) {
  return row?.UpdatedAt || row?.updatedAt || row?.UpdatedOn || row?.ModifiedAt || row?.LastUpdatedAt || row?.DeletedAt || row?.updated_at || '';
}

function getRemoteUpdatedAt(cloud) {
  const stamps = [];
  for (const rows of Object.values(cloud || {})) {
    for (const row of rows || []) {
      stamps.push(row?.updated_at || row?.payload?.UpdatedAt || row?.payload?.updatedAt || row?.payload?.ModifiedAt || row?.payload?.LastUpdatedAt || '');
    }
  }
  const filtered = stamps.filter(Boolean);
  return filtered.sort().at(-1) || '';
}

function hasLocalPendingChanges(localUpdatedAt, meta) {
  return Boolean(meta?.hasLocalPendingChanges || compareIso(localUpdatedAt, meta?.lastSuccessfulPullAt || '') > 0);
}

async function updateSyncMeta(patch) {
  return saveSyncMeta({ ...(await getSyncMeta()), ...patch });
}

async function createLocalSyncSnapshot(reason, cloud, local = null) {
  const snapshot = {
    SnapshotID: `snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    CreatedAt: new Date().toISOString(),
    Reason: reason,
    payload: {
      cloud,
      local: local || {
        tm3_trips: indexBy(await getAllTrips(), 'TripID'),
        tm3_trip_days: indexBy(await getTripDays(), 'TripDayID'),
        tm3_items: indexBy(await getAllItems(), 'ItemID'),
        tm3_settings: indexBy(await getAllSettings(), 'key'),
        tm3_deletion_queue: indexBy(await getDeletionQueue(), 'DeletionID')
      }
    }
  };
  await saveSyncSnapshot(snapshot);
  await updateSyncMeta({ lastSnapshotAt: snapshot.CreatedAt });
  return snapshot;
}

async function getLocalUpdatedAt() {
  const rows = [
    ...(await getAllTrips()),
    ...(await getTripDays()),
    ...(await getAllItems()),
    ...(await getAllSettings()),
    ...(await getDeletionQueue())
  ];
  return rows.reduce((latest, row) => {
    const stamp = getLocalTimestamp(row);
    return compareIso(stamp, latest) > 0 ? stamp : latest;
  }, '');
}

function getCloudTimestamp(row) {
  return row?.updated_at || getLocalTimestamp(row?.payload || row);
}

function compareLocalToCloud(local, cloud) {
  const cloudPayload = cloud?.payload || cloud;
  const timestampCompare = compareIso(getLocalTimestamp(local), getCloudTimestamp(cloud));
  if (timestampCompare !== 0) return timestampCompare;
  return compareVersion(local, cloudPayload);
}

function compareVersion(left, right) {
  const leftVersion = Number(left?.Version || 0);
  const rightVersion = Number(right?.Version || 0);
  if (leftVersion === rightVersion) return 0;
  return leftVersion > rightVersion ? 1 : -1;
}

function compareIso(left, right) {
  const leftTime = Date.parse(left || '');
  const rightTime = Date.parse(right || '');
  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
  if (Number.isNaN(leftTime)) return -1;
  if (Number.isNaN(rightTime)) return 1;
  return leftTime === rightTime ? 0 : leftTime > rightTime ? 1 : -1;
}

async function safeUser() {
  try {
    return await getCurrentUser();
  } catch (_error) {
    return null;
  }
}

function setSyncState(patch) {
  Object.assign(state, patch);
  window.dispatchEvent(new CustomEvent('tm3-sync-state-change', { detail: getSyncState() }));
}

function getErrorMessage(error) {
  return String(error?.message || error || 'Error de sync');
}
