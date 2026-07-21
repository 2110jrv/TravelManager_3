import {
  deleteItem,
  deleteTrip,
  deleteTripDay,
  getAllItems,
  getAllSettings,
  getAllTrips,
  getDeletionQueue,
  getOrCreateDeviceId,
  getTripDays,
  saveDeletionRecord,
  saveSettingRecord,
  saveTrip,
  saveTripDay,
  updateItem
} from './db.js';
import { getCurrentUser, getSupabaseClient } from './supabaseClient.js';

const SYNC_INTERVAL_MS = 60000;
const SYNC_DEBOUNCE_MS = 1200;
const DIRTY_PROTECTION_MS = 5 * 60000;
const SYNC_TABLES = ['tm3_trips', 'tm3_trip_days', 'tm3_items', 'tm3_settings', 'tm3_deletion_queue'];

const state = {
  status: 'signed_out',
  lastSyncAt: '',
  lastError: '',
  pendingReason: '',
  running: false,
  started: false,
  applyingRemote: false
};

let intervalId = null;
let debounceId = null;
let realtimeChannel = null;
let onAppliedRemoteChanges = null;
const localRecentlyChanged = new Map();

export function getSyncState() {
  return { ...state };
}

export function recordLocalChange(entityType, entityId, changedAt = new Date().toISOString()) {
  if (!entityType || !entityId) return;
  localRecentlyChanged.set(entityKey(entityType, entityId), changedAt);
  pruneRecentChanges();
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
  if (!state.started) {
    state.started = true;
    await subscribeToCloudChanges();
  }
  if (!intervalId) intervalId = window.setInterval(() => queueCloudSync('interval'), SYNC_INTERVAL_MS);
  queueCloudSync('start');
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
  if (state.running) {
    setSyncState({ status: 'pending', pendingReason: reason });
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

  state.running = true;
  setSyncState({ status: 'syncing', pendingReason: reason, lastError: '' });
  try {
    const pushed = await pushLocalToCloud();
    const pulled = await pullCloudToLocal();
    state.lastSyncAt = new Date().toISOString();
    setSyncState({ status: pushed > 0 || pulled > 0 ? 'synced' : 'idle', pendingReason: '', lastError: '' });
    if (pulled > 0 && onAppliedRemoteChanges) await onAppliedRemoteChanges({ pulled, reason });
  } catch (error) {
    setSyncState({ status: 'error', lastError: getErrorMessage(error), pendingReason: reason });
  } finally {
    state.running = false;
  }
  return getSyncState();
}

export function queueCloudSync(reason = 'change') {
  if (state.applyingRemote) return;
  if (!navigator.onLine) {
    setSyncState({ status: 'offline', pendingReason: reason });
    return;
  }
  setSyncState({ status: 'pending', pendingReason: reason });
  if (debounceId) window.clearTimeout(debounceId);
  debounceId = window.setTimeout(() => {
    debounceId = null;
    runCloudSyncNow(reason);
  }, SYNC_DEBOUNCE_MS);
}

export async function pushLocalToCloud() {
  const user = await safeUser();
  if (!user || !navigator.onLine) return 0;
  const client = await getSupabaseClient();
  const deviceId = await getOrCreateDeviceId();
  const cloud = await loadCloudSnapshot(client);
  const deletions = await getDeletionQueue();
  const tombstones = buildTombstoneMap([...deletions, ...cloud.tm3_deletion_queue.map(row => row.payload || row)]);
  let count = 0;

  count += await pushCollection(client, 'tm3_trips', await getAllTrips(), cloud.tm3_trips, {
    idField: 'TripID',
    cloudId: 'trip_id',
    row: item => ({ trip_id: item.TripID }),
    user,
    deviceId,
    tombstones,
    entityType: 'TRIP'
  });
  count += await pushCollection(client, 'tm3_trip_days', await getTripDays(), cloud.tm3_trip_days, {
    idField: 'TripDayID',
    cloudId: 'day_id',
    row: item => ({ day_id: item.TripDayID, trip_id: item.TripID || '' }),
    user,
    deviceId,
    tombstones,
    entityType: 'TRIP_DAY'
  });
  count += await pushCollection(client, 'tm3_items', await getAllItems(), cloud.tm3_items, {
    idField: 'ItemID',
    cloudId: 'item_id',
    row: item => ({ item_id: item.ItemID, trip_id: item.TripID || '', source_item_id: item.SourceItemID || null, day_date: item.DayDate || null }),
    user,
    deviceId,
    tombstones,
    entityType: 'ITEM'
  });
  count += await pushCollection(client, 'tm3_settings', await getAllSettings(), cloud.tm3_settings, {
    idField: 'key',
    cloudId: 'setting_key',
    row: item => ({ setting_key: item.key }),
    user,
    deviceId,
    tombstones: new Map(),
    entityType: 'SETTING',
    onConflict: 'user_id,setting_key'
  });
  count += await pushCollection(client, 'tm3_deletion_queue', deletions, cloud.tm3_deletion_queue, {
    idField: 'DeletionID',
    cloudId: 'deletion_id',
    row: item => ({
      deletion_id: item.DeletionID,
      entity_type: item.EntityType || '',
      entity_id: item.EntityId || item.EntityID || '',
      trip_id: item.TripID || null,
      deleted_at: item.DeletedAt || getLocalTimestamp(item)
    }),
    user,
    deviceId,
    tombstones: new Map(),
    entityType: 'DELETION'
  });
  return count;
}

export async function pullCloudToLocal() {
  const user = await safeUser();
  if (!user || !navigator.onLine) return 0;
  const client = await getSupabaseClient();
  const cloud = await loadCloudSnapshot(client);
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
  let applied = 0;
  state.applyingRemote = true;
  try {
    applied += await pullDeletions(cloud.tm3_deletion_queue, local.tm3_deletion_queue);
    applied += await applyTombstones(tombstones, local);
    applied += await pullCollection(cloud.tm3_trips, local.tm3_trips, { cloudId: 'trip_id', save: saveTrip, entityType: 'TRIP', tombstones });
    applied += await pullCollection(cloud.tm3_trip_days, local.tm3_trip_days, { cloudId: 'day_id', save: saveTripDay, entityType: 'TRIP_DAY', tombstones });
    applied += await pullCollection(cloud.tm3_items, local.tm3_items, { cloudId: 'item_id', save: updateItem, entityType: 'ITEM', tombstones });
    applied += await pullCollection(cloud.tm3_settings, local.tm3_settings, { cloudId: 'setting_key', save: saveSettingRecord, entityType: 'SETTING', tombstones: new Map() });
  } finally {
    state.applyingRemote = false;
  }
  return applied;
}

export async function subscribeToCloudChanges() {
  const user = await safeUser();
  if (!user || realtimeChannel) return;
  try {
    const client = await getSupabaseClient();
    realtimeChannel = client.channel(`tm3-sync-${user.id}`);
    SYNC_TABLES.forEach(table => {
      realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${user.id}` }, () => queueCloudSync('realtime'));
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
    const tombstone = options.tombstones.get(tombstoneKey(options.entityType, id));
    if (tombstone && compareIso(getLocalTimestamp(tombstone), localTimestamp) >= 0) continue;
    const cloud = cloudById.get(id);
    if (cloud?.deleted_at) continue;
    if (cloud && compareIso(cloud.updated_at, localTimestamp) >= 0) continue;
    const payload = { ...row, UpdatedAt: row.UpdatedAt || localTimestamp };
    const upsertRow = {
      ...options.row(payload),
      user_id: options.user.id,
      payload,
      updated_at: localTimestamp,
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
    const tombstone = options.tombstones.get(tombstoneKey(options.entityType, id));
    if (tombstone && compareIso(getLocalTimestamp(tombstone), row.updated_at) >= 0) continue;
    const local = localById.get(id);
    if (isRecentlyChanged(options.entityType, id, row.updated_at)) continue;
    if (local && compareIso(getLocalTimestamp(local), row.updated_at) >= 0) continue;
    await options.save({ ...payload, UpdatedAt: payload.UpdatedAt || row.updated_at, SyncStatus: 'SYNCED' });
    count += 1;
  }
  return count;
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
  for (const tombstone of tombstones.values()) {
    const type = tombstone.EntityType || tombstone.entity_type;
    const id = tombstone.EntityId || tombstone.EntityID || tombstone.entity_id;
    const ts = getLocalTimestamp(tombstone);
    if (type === 'ITEM') {
      const items = [...local.tm3_items.values()].filter(item => item.ItemID === id || item.SourceItemID === id);
      for (const item of items) {
        if (compareIso(ts, getLocalTimestamp(item)) >= 0) {
          await deleteItem(item.ItemID);
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
    const id = row.EntityId || row.EntityID || row.entity_id;
    if (!type || !id) continue;
    const key = tombstoneKey(type, id);
    const existing = map.get(key);
    if (!existing || compareIso(getLocalTimestamp(row), getLocalTimestamp(existing)) > 0) map.set(key, row);
  }
  return map;
}

function tombstoneKey(type, id) {
  return `${type}:${id}`;
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
  const cutoff = Date.now() - DIRTY_PROTECTION_MS;
  localRecentlyChanged.forEach((timestamp, key) => {
    const time = Date.parse(timestamp || '');
    if (Number.isNaN(time) || time < cutoff) localRecentlyChanged.delete(key);
  });
}

function indexBy(rows, field) {
  return new Map((rows || []).filter(row => row?.[field]).map(row => [row[field], row]));
}

function indexCloud(rows, field) {
  return new Map((rows || []).filter(row => row?.[field]).map(row => [row[field], row]));
}

function getLocalTimestamp(row) {
  return row?.UpdatedAt || row?.updatedAt || row?.UpdatedOn || row?.ModifiedAt || row?.LastUpdatedAt || row?.DeletedAt || row?.updated_at || new Date().toISOString();
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
