const DB_NAME = 'TravelManager3';
const DB_VERSION = 4;
const STORE_ITEMS = 'items';
const STORE_SETTINGS = 'settings';
const STORE_TRIPS = 'trips';
const STORE_TRIP_DAYS = 'tripDays';
const STORE_DELETION_QUEUE = 'deletionQueue';

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        const store = db.createObjectStore(STORE_ITEMS, { keyPath: 'ItemID' });
        store.createIndex('TripID', 'TripID', { unique: false });
        store.createIndex('DayDate', 'DayDate', { unique: false });
        store.createIndex('SyncStatus', 'SyncStatus', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_TRIPS)) {
        db.createObjectStore(STORE_TRIPS, { keyPath: 'TripID' });
      }
      if (!db.objectStoreNames.contains(STORE_TRIP_DAYS)) {
        const store = db.createObjectStore(STORE_TRIP_DAYS, { keyPath: 'TripDayID' });
        store.createIndex('TripID', 'TripID', { unique: false });
        store.createIndex('Date', 'Date', { unique: false });
        store.createIndex('TripID_Date', ['TripID', 'Date'], { unique: true });
      }
      if (!db.objectStoreNames.contains(STORE_DELETION_QUEUE)) {
        const store = db.createObjectStore(STORE_DELETION_QUEUE, { keyPath: 'DeletionID' });
        store.createIndex('EntityType', 'EntityType', { unique: false });
        store.createIndex('EntityId', 'EntityId', { unique: false });
        store.createIndex('TripID', 'TripID', { unique: false });
        store.createIndex('SyncStatus', 'SyncStatus', { unique: false });
        store.createIndex('DeletedAt', 'DeletedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllItems() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_ITEMS, 'readonly');
    const store = transaction.objectStore(STORE_ITEMS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function addItemsIfMissing(items) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_ITEMS, 'readwrite');
    const store = transaction.objectStore(STORE_ITEMS);
    let pending = items.length;
    if (pending === 0) {
      resolve(0);
      return;
    }

    let added = 0;
    items.forEach(item => {
      const getRequest = store.get(item.ItemID);
      getRequest.onsuccess = () => {
        if (!getRequest.result) {
          const addRequest = store.add(item);
          addRequest.onsuccess = () => {
            added += 1;
            if (--pending === 0) resolve(added);
          };
          addRequest.onerror = () => {
            if (--pending === 0) resolve(added);
          };
        } else {
          if (--pending === 0) resolve(added);
        }
      };
      getRequest.onerror = () => {
        if (--pending === 0) resolve(added);
      };
    });
  });
}

export async function countItems() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_ITEMS, 'readonly');
    const store = transaction.objectStore(STORE_ITEMS);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function clearItems() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_ITEMS, 'readwrite');
    const store = transaction.objectStore(STORE_ITEMS);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function updateItem(item) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_ITEMS, 'readwrite');
    const store = transaction.objectStore(STORE_ITEMS);
    const request = store.put(item);
    request.onsuccess = () => resolve(item);
    request.onerror = () => reject(request.error);
  });
}

export async function addItem(item) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_ITEMS, 'readwrite');
    const store = transaction.objectStore(STORE_ITEMS);
    const request = store.add(item);
    request.onsuccess = () => resolve(item);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteItem(ItemID) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_ITEMS, 'readwrite');
    const store = transaction.objectStore(STORE_ITEMS);
    const request = store.delete(ItemID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function replaceItemsByPredicate(items, predicate) {
  const db = await openDatabase();
  const existing = await getAllItems();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_ITEMS, 'readwrite');
    const store = transaction.objectStore(STORE_ITEMS);
    existing.filter(predicate).forEach(item => store.delete(item.ItemID));
    items.forEach(item => store.put(item));
    transaction.oncomplete = () => resolve(items.length);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function replaceDatasetItems(items, predicate) {
  const db = await openDatabase();
  const existing = await getAllItems();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_ITEMS, 'readwrite');
    const store = transaction.objectStore(STORE_ITEMS);
    existing.filter(predicate).forEach(item => store.delete(item.ItemID));
    items.forEach(item => store.put(item));
    transaction.oncomplete = () => resolve(items.length);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getSetting(key, fallback = null) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_SETTINGS, 'readonly');
    const store = transaction.objectStore(STORE_SETTINGS);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ? request.result.value : fallback);
    request.onerror = () => reject(request.error);
  });
}

export async function setSetting(key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_SETTINGS, 'readwrite');
    const store = transaction.objectStore(STORE_SETTINGS);
    const request = store.put({ key, value });
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllSettings() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_SETTINGS, 'readonly');
    const store = transaction.objectStore(STORE_SETTINGS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSettingRecord(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_SETTINGS, 'readwrite');
    const store = transaction.objectStore(STORE_SETTINGS);
    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

export async function getOrCreateDeviceId() {
  const existing = await getSetting('deviceId', '');
  if (existing) return existing;
  const random = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deviceId = `device-${random}`;
  await setSetting('deviceId', deviceId);
  return deviceId;
}

export async function enqueueDeletion(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_DELETION_QUEUE, 'readwrite');
    const store = transaction.objectStore(STORE_DELETION_QUEUE);
    const request = store.get(record.DeletionID);
    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result);
        return;
      }
      const addRequest = store.add(record);
      addRequest.onsuccess = () => resolve(record);
      addRequest.onerror = () => reject(addRequest.error);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveDeletionRecord(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_DELETION_QUEUE, 'readwrite');
    const store = transaction.objectStore(STORE_DELETION_QUEUE);
    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

export async function getDeletionQueue() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_DELETION_QUEUE, 'readonly');
    const store = transaction.objectStore(STORE_DELETION_QUEUE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllTrips() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_TRIPS, 'readonly');
    const store = transaction.objectStore(STORE_TRIPS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getTrip(TripID) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_TRIPS, 'readonly');
    const store = transaction.objectStore(STORE_TRIPS);
    const request = store.get(TripID);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveTrip(trip) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_TRIPS, 'readwrite');
    const store = transaction.objectStore(STORE_TRIPS);
    const request = store.put(trip);
    request.onsuccess = () => resolve(trip);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteTrip(TripID) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_TRIPS, 'readwrite');
    const store = transaction.objectStore(STORE_TRIPS);
    const request = store.delete(TripID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getTripDays(TripID) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_TRIP_DAYS, 'readonly');
    const store = transaction.objectStore(STORE_TRIP_DAYS);
    const request = TripID ? store.index('TripID').getAll(TripID) : store.getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => (a.Date || '').localeCompare(b.Date || '') || Number(a.DayOrder || 0) - Number(b.DayOrder || 0)));
    request.onerror = () => reject(request.error);
  });
}

export async function saveTripDay(day) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_TRIP_DAYS, 'readwrite');
    const store = transaction.objectStore(STORE_TRIP_DAYS);
    const request = store.put(day);
    request.onsuccess = () => resolve(day);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteTripDay(TripDayID) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_TRIP_DAYS, 'readwrite');
    const store = transaction.objectStore(STORE_TRIP_DAYS);
    const request = store.delete(TripDayID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getActiveTripId() {
  return getSetting('activeTripId', null);
}

export async function setActiveTripId(TripID) {
  return setSetting('activeTripId', TripID);
}

export function selectDefaultTrip(trips, today = new Date()) {
  const list = [...(trips || [])].filter(trip => trip.TripID);
  if (list.length === 0) return null;
  const todayKey = today.toISOString().slice(0, 10);
  const current = list
    .filter(trip => (trip.StartDate || '') <= todayKey && todayKey <= (trip.EndDate || ''))
    .sort((a, b) => (a.StartDate || '').localeCompare(b.StartDate || ''))[0];
  if (current) return current.TripID;
  const future = list
    .filter(trip => (trip.StartDate || '') > todayKey)
    .sort((a, b) => (a.StartDate || '').localeCompare(b.StartDate || ''))[0];
  if (future) return future.TripID;
  return list
    .filter(trip => (trip.EndDate || '') < todayKey)
    .sort((a, b) => (b.EndDate || '').localeCompare(a.EndDate || ''))[0]?.TripID || list[0].TripID;
}

export async function migrateLegacyTravelData(seed) {
  const now = new Date().toISOString();
  const existingTrip = await getTrip(seed.trip.TripID);
  const legacyBudget = await getSetting('tripBudgetUSD', null);
  const budget = Number(existingTrip?.BudgetAmountUSD ?? seed.trip.BudgetAmountUSD ?? legacyBudget ?? 0);
  await saveTrip({
    ...seed.trip,
    BudgetAmount: budget,
    BudgetCurrencyCode: seed.trip.BudgetCurrencyCode || 'USD',
    BudgetAmountUSD: budget,
    CreatedAt: existingTrip?.CreatedAt || now,
    LastUpdatedAt: now,
    IsActive: true
  });
  const existingDays = await getTripDays(seed.trip.TripID);
  const existingCreatedAt = new Map(existingDays.map(day => [day.TripDayID, day.CreatedAt]));
  for (const day of seed.tripDays) {
    await saveTripDay({
      ...day,
      CreatedAt: existingCreatedAt.get(day.TripDayID) || now,
      LastUpdatedAt: now
    });
  }
  const trips = await getAllTrips();
  const activeTripId = await getActiveTripId();
  const selected = trips.some(trip => trip.TripID === activeTripId) ? activeTripId : (selectDefaultTrip(trips) || seed.trip.TripID);
  await setActiveTripId(selected);
  return selected;
}
