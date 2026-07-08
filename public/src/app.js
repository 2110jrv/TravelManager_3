import { openDatabase, getAllItems, updateItem, replaceItemsByPredicate } from './db.js';
import { renderDayCards, renderEmptyState } from './ui.js';
import { ITALY_DATASET_ID, ITALY_DATASET_MARK_KEY, ITALY_DAYS_KEY, loadItalyItinerary } from './italyAdapter.js';

const dayList = document.getElementById('dayList');
const statusOnline = document.getElementById('statusOnline');
const statusSync = document.getElementById('statusSync');
const openSpreadsheetButton = document.getElementById('openSpreadsheetButton');
const refreshButton = document.getElementById('refreshButton');
const resetSeedButton = document.getElementById('resetSeedButton');
const openDayKeys = new Set();
let currentItems = [];
let itineraryDays = [];
let editingItem = null;
let editInitialValue = '';
const editModal = createEditModal();

async function initApp() {
  await openDatabase();
  const itinerary = await loadItalyItinerary();
  itineraryDays = itinerary.days;
  localStorage.setItem(ITALY_DAYS_KEY, JSON.stringify(itineraryDays));
  await migrateToItalyItineraryIfNeeded(itinerary);

  const loadedItems = await getAllItems();
  if (loadedItems.length === 0) {
    renderEmptyState(dayList, 'No hay datos disponibles. Por favor recarga la página o revisa la fuente de datos.');
  } else {
    renderAgenda(loadedItems);
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

async function migrateToItalyItineraryIfNeeded(itinerary) {
  const existingItems = await getAllItems();
  const datasetMark = localStorage.getItem(ITALY_DATASET_MARK_KEY);
  const isEmpty = existingItems.length === 0;
  const isSampleOnly = existingItems.length > 0 && existingItems.every(isSampleItem);

  if (datasetMark === ITALY_DATASET_ID && !isSampleOnly) return;
  if (!isEmpty && !isSampleOnly) return;

  await replaceItemsByPredicate(itinerary.items, item => isSampleItem(item) || item.DatasetID === ITALY_DATASET_ID);
  localStorage.setItem(ITALY_DATASET_MARK_KEY, ITALY_DATASET_ID);
  statusSync.textContent = 'Itinerario Italy 2026 cargado';
}

function isSampleItem(item) {
  return item.TripID === 'trip-001' || /^item-00\d$/.test(item.ItemID || '');
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
  if (!confirm('Restaurar datos originales del viaje? Esto elimina modificaciones locales de los items de Italy 2026.')) return;
  try {
    const itinerary = await loadItalyItinerary();
    itineraryDays = itinerary.days;
    localStorage.setItem(ITALY_DAYS_KEY, JSON.stringify(itineraryDays));
    await replaceItemsByPredicate(itinerary.items, item => item.DatasetID === ITALY_DATASET_ID || item.TripID === 'TRIP_ITALY_2026');
    localStorage.setItem(ITALY_DATASET_MARK_KEY, ITALY_DATASET_ID);
    const reloaded = await getAllItems();
    if (reloaded.length === 0) {
      renderEmptyState(dayList, 'No hay datos después de reseed');
    } else {
      renderAgenda(reloaded);
    }
    alert('Datos originales del viaje restaurados');
  } catch (e) {
    console.error(e);
    alert('Error al restaurar datos');
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./pwa/sw.js', { scope: './' }).catch(() => {
    console.warn('Service Worker registration falló');
  });
}

initApp();

function renderAgenda(items) {
  currentItems = items;
  if (openDayKeys.size === 0 && itineraryDays.length > 0) {
    openDayKeys.add(itineraryDays[0].DayDate);
  }

  if (items.length === 0 && itineraryDays.length === 0) {
    renderEmptyState(dayList, 'No hay datos después de restablecer.');
  } else {
    renderDayCards(items, dayList, {
      days: itineraryDays,
      openDayKeys,
      onDayToggle: (dayKey, isOpen) => {
        if (isOpen) openDayKeys.add(dayKey);
        else openDayKeys.delete(dayKey);
      },
      onEditItem: openEditModal
    });
  }
}

function createEditModal() {
  const modal = document.createElement('div');
  modal.className = 'edit-modal hidden';
  modal.innerHTML = `
    <div class="edit-modal-panel" role="dialog" aria-modal="true" aria-labelledby="editTitle">
      <header class="edit-modal-header">
        <h2 id="editTitle">Editar item</h2>
        <button type="button" class="icon-button" data-edit-cancel aria-label="Cerrar">×</button>
      </header>
      <form id="editItemForm" class="edit-form" novalidate>
        <div class="edit-error" role="alert"></div>
        <label>Title<input name="Title" required /></label>
        <div class="edit-grid">
          <label>StartTime<input name="StartTime" placeholder="09:30" /></label>
          <label>EndTime<input name="EndTime" placeholder="10:30" /></label>
        </div>
        <div class="edit-grid">
          <label>ItemType
            <select name="ItemType">
              <option value="ACTIVITY">Actividad</option>
              <option value="FLIGHT">Vuelo</option>
              <option value="FOOD">Comida</option>
              <option value="LODGING">Hospedaje</option>
              <option value="TRANSPORT">Transporte</option>
              <option value="OTHER">Otro</option>
            </select>
          </label>
          <label>AmountUSD<input name="AmountUSD" type="number" min="0" step="0.01" /></label>
        </div>
        <label>GooglePlusCode<input name="GooglePlusCode" /></label>
        <label>GoogleMapsUrl<input name="GoogleMapsUrl" type="url" /></label>
        <div class="edit-grid">
          <label>City<input name="City" /></label>
          <label>LocationLabel<input name="LocationLabel" /></label>
        </div>
        <label>Notes<textarea name="Notes" rows="3"></textarea></label>
        <div class="edit-grid">
          <label>PaymentStatus
            <select name="PaymentStatus">
              <option value="NOT_PAID">NOT_PAID</option>
              <option value="RESERVED">RESERVED</option>
              <option value="PAID">PAID</option>
              <option value="PARTIAL">PARTIAL</option>
            </select>
          </label>
          <div class="edit-checks">
            <label><input name="IsAllDay" type="checkbox" /> IsAllDay</label>
            <label><input name="IsPaid" type="checkbox" /> IsPaid</label>
          </div>
        </div>
        <footer class="edit-actions">
          <button type="button" class="secondary-button" data-edit-cancel>Cancelar</button>
          <button type="submit" class="primary-button">Guardar</button>
        </footer>
      </form>
    </div>
  `;

  document.body.append(modal);
  modal.addEventListener('click', event => {
    if (event.target === modal) requestCloseEditModal();
  });
  modal.querySelectorAll('[data-edit-cancel]').forEach(button => {
    button.addEventListener('click', requestCloseEditModal);
  });
  modal.querySelector('form').addEventListener('submit', saveEditForm);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) requestCloseEditModal();
  });
  return modal;
}

function openEditModal(item) {
  editingItem = item;
  const form = editModal.querySelector('form');
  setEditError('');
  for (const field of ['StartTime', 'EndTime', 'Title', 'ItemType', 'AmountUSD', 'GooglePlusCode', 'GoogleMapsUrl', 'City', 'LocationLabel', 'Notes', 'PaymentStatus']) {
    form.elements[field].value = item[field] ?? '';
  }
  form.elements.IsAllDay.checked = item.IsAllDay === true;
  form.elements.IsPaid.checked = item.IsPaid === true;
  editInitialValue = getFormSnapshot(form);
  editModal.classList.remove('hidden');
  form.elements.Title.focus();
}

function requestCloseEditModal() {
  const form = editModal.querySelector('form');
  if (editingItem && getFormSnapshot(form) !== editInitialValue) {
    if (!confirm('Descartar cambios sin guardar?')) return;
  }
  closeEditModal();
}

function closeEditModal() {
  editModal.classList.add('hidden');
  editingItem = null;
  editInitialValue = '';
  setEditError('');
}

async function saveEditForm(event) {
  event.preventDefault();
  if (!editingItem) return;

  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const error = validateEditData(data);
  if (error) {
    setEditError(error);
    return;
  }

  const updatedItem = {
    ...editingItem,
    StartTime: data.StartTime.trim(),
    EndTime: data.EndTime.trim(),
    Title: data.Title.trim(),
    ItemType: data.ItemType,
    AmountUSD: Number(data.AmountUSD || 0),
    GooglePlusCode: data.GooglePlusCode.trim(),
    GoogleMapsUrl: data.GoogleMapsUrl.trim(),
    City: data.City.trim(),
    LocationLabel: data.LocationLabel.trim(),
    Notes: data.Notes.trim(),
    IsAllDay: form.elements.IsAllDay.checked,
    PaymentStatus: data.PaymentStatus,
    IsPaid: form.elements.IsPaid.checked,
    LastUpdatedAt: new Date().toISOString(),
    SyncStatus: 'LOCAL_PENDING'
  };

  await updateItem(updatedItem);
  const dayKey = updatedItem.DayDate || updatedItem.StartDate || 'Sin fecha';
  openDayKeys.add(dayKey);
  closeEditModal();
  renderAgenda(await getAllItems());
  statusSync.textContent = 'Cambios locales pendientes';
}

function validateEditData(data) {
  if (!data.Title.trim()) return 'Title es requerido.';
  const amount = Number(data.AmountUSD);
  if (data.AmountUSD === '' || Number.isNaN(amount) || amount < 0) return 'AmountUSD debe ser numérico y mayor o igual a 0.';
  if (!isValidTime(data.StartTime)) return 'StartTime debe usar formato HH:mm.';
  if (!isValidTime(data.EndTime)) return 'EndTime debe usar formato HH:mm.';
  return '';
}

function isValidTime(value) {
  if (!value.trim()) return true;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

function getFormSnapshot(form) {
  return JSON.stringify({
    StartTime: form.elements.StartTime.value,
    EndTime: form.elements.EndTime.value,
    Title: form.elements.Title.value,
    ItemType: form.elements.ItemType.value,
    AmountUSD: form.elements.AmountUSD.value,
    GooglePlusCode: form.elements.GooglePlusCode.value,
    GoogleMapsUrl: form.elements.GoogleMapsUrl.value,
    City: form.elements.City.value,
    LocationLabel: form.elements.LocationLabel.value,
    Notes: form.elements.Notes.value,
    IsAllDay: form.elements.IsAllDay.checked,
    PaymentStatus: form.elements.PaymentStatus.value,
    IsPaid: form.elements.IsPaid.checked
  });
}

function setEditError(message) {
  editModal.querySelector('.edit-error').textContent = message;
}
