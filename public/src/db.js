const DB_NAME = 'TravelManager3';
const DB_VERSION = 2;
const STORE_ITEMS = 'items';
const STORE_SETTINGS = 'settings';

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
