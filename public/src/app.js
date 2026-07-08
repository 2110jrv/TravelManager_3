import { openDatabase, getAllItems, addItemsIfMissing, clearItems } from './db.js';
import { renderDayCards, renderEmptyState } from './ui.js';

const dayList = document.getElementById('dayList');
const statusOnline = document.getElementById('statusOnline');
const statusSync = document.getElementById('statusSync');
const openSpreadsheetButton = document.getElementById('openSpreadsheetButton');
const refreshButton = document.getElementById('refreshButton');
const resetSeedButton = document.getElementById('resetSeedButton');

async function initApp() {
  await openDatabase();
  const items = await getAllItems();
  if (items.length === 0) {
    await seedSampleData();
  }

  const loadedItems = await getAllItems();
  if (loadedItems.length === 0) {
    renderEmptyState(dayList, 'No hay datos disponibles. Por favor recarga la página o revisa la fuente de datos.');
  } else {
    renderDayCards(loadedItems, dayList);
  }
  updateStatus();
}

function normalizeItem(item) {
  return {
    ItemID: item.ItemID || `item-${crypto.randomUUID()}`,
    TripID: item.TripID || 'trip-001',
    DayDate: item.DayDate || item.StartDate || item.EndDate || '',
    ItemType: item.ItemType || 'OTHER',
    Title: item.Title || 'Sin título',
    Subtitle: item.Subtitle || '',
    StartTime: item.StartTime || '',
    EndTime: item.EndTime || '',
    Description: item.Description || '',
    Provider: item.Provider || '',
    Status: item.Status || 'PLANNED',
    IsPaid: item.IsPaid === true,
    PaymentStatus: item.PaymentStatus || 'NOT_PAID',
    AmountUSD: Number(item.AmountUSD ?? 0),
    Currency: item.Currency || 'USD',
    CountryCode: item.CountryCode || '',
    City: item.City || '',
    Address: item.Address || '',
    LocationLabel: item.LocationLabel || '',
    GoogleMapsUrl: item.GoogleMapsUrl || '',
    GooglePlusCode: item.GooglePlusCode || '',
    Latitude: item.Latitude ?? null,
    Longitude: item.Longitude ?? null,
    WebsiteUrl: item.WebsiteUrl || '',
    BookingReference: item.BookingReference || '',
    Notes: item.Notes || '',
    ItemImageUrl: item.ItemImageUrl || '',
    ItemImageCaption: item.ItemImageCaption || '',
    IsAllDay: item.IsAllDay === true,
    IsMultiDay: item.IsMultiDay === true,
    StartDate: item.StartDate || item.DayDate || '',
    EndDate: item.EndDate || item.DayDate || '',
    LodgingDisplayMode: item.LodgingDisplayMode || 'NORMAL',
    SortOrder: Number(item.SortOrder ?? 0),
    LastUpdatedAt: item.LastUpdatedAt || new Date().toISOString(),
    SyncStatus: item.SyncStatus || 'SYNCED'
  };
}

async function seedSampleData() {
  try {
    const response = await fetch('./data/sample.json');
    if (!response.ok) {
      throw new Error('No se pudo cargar sample.json');
    }
    const rawItems = await response.json();
    const items = Array.isArray(rawItems) ? rawItems.map(normalizeItem) : [];
    await addItemsIfMissing(items);
    statusSync.textContent = 'Datos iniciales cargados';
  } catch (error) {
    const existingItems = await getAllItems();
    if (existingItems.length > 0) {
      statusSync.textContent = 'Fallo fetch, usando datos locales';
    } else {
      statusSync.textContent = 'Error de carga inicial';
    }
    console.warn(error);
  }
}

function updateStatus() {
  const online = navigator.onLine;
  statusOnline.textContent = online ? 'Online' : 'Offline';
  if (!statusSync.textContent || statusSync.textContent === 'Local-first') {
    statusSync.textContent = 'Local-first';
  }
}

window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);

openSpreadsheetButton?.addEventListener('click', () => {
  document.getElementById('sheetModal')?.classList.remove('hidden');
});

document.getElementById('closeSheetButton')?.addEventListener('click', () => {
  document.getElementById('sheetModal')?.classList.add('hidden');
});

refreshButton?.addEventListener('click', async () => {
  renderAgenda(await getAllItems());
});

resetSeedButton?.addEventListener('click', async () => {
  if (!confirm('Restablecer datos de prueba: borrar solo los items locales y recargar sample.json?')) return;
  try {
    await clearItems();
    await seedSampleData();
    const reloaded = await getAllItems();
    if (reloaded.length === 0) {
      renderEmptyState(dayList, 'No hay datos después de reseed');
    } else {
      renderAgenda(reloaded);
    }
    alert('Datos de prueba restablecidos');
  } catch (e) {
    console.error(e);
    alert('Error al restablecer datos');
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./pwa/sw.js', { scope: './' }).catch(() => {
    console.warn('Service Worker registration falló');
  });
}

initApp();

function renderAgenda(items) {
  if (items.length === 0) {
    renderEmptyState(dayList, 'No hay datos después de restablecer.');
  } else {
    renderDayCards(items, dayList);
  }
}
