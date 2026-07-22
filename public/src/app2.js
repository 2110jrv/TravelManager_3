import { addItem, deleteTrip, deleteTripDay, enqueueDeletion, getActiveTripId, getAllItems, getAllTrips, getOrCreateDeviceId, getSetting, getTrip, getTripDays, migrateLegacyTravelData, openDatabase, replaceDatasetItems, replaceItemsByPredicate, saveTrip, saveTripDay, selectDefaultTrip, setActiveTripId, setSetting, updateItem } from './db.js';
import { ITALY_DATASET_ID, ITALY_DATASET_MARK_KEY, ITALY_DAYS_KEY, getPlanningStatus, loadItalyItinerary, rebuildMultidayOccurrences } from './italyAdapter.js';
import { getCurrentSession, onAuthStateChange, signInWithEmailPassword, signOut, signUpWithEmailPassword } from './supabaseClient.js';
import { getSyncState, queueCloudSync, recordLocalChange, runCloudSyncNow, startCloudSync, stopCloudSync } from './syncSupabase.js';

const state = {
  activeView: 'home',
  activeTab: 'CONFIRMED',
  activeTripId: '',
  trips: [],
  days: [],
  allItems: [],
  items: [],
  openDayKey: null,
  openItemId: null,
  editingItem: null,
  editInitialValue: '',
  newInitialValue: '',
  pendingBackup: null,
  daysPanelOpen: false,
  auditPanelOpen: false,
  calendarMonth: '',
  calendarMessage: '',
  mapFilters: { planning: 'ALL', type: 'ALL', city: 'ALL', date: 'ALL' },
  map: null,
  mapLayer: null,
  tileLayer: null,
  authUser: null,
  authLoading: true,
  authMessage: '',
  authError: '',
  sync: getSyncState(),
  accessRole: ''
};

const els = {
  viewTitle: document.getElementById('viewTitle'),
  dayList: document.getElementById('dayList'),
  statusRow: document.getElementById('statusRow'),
  statusOnline: document.getElementById('statusOnline'),
  statusSync: document.getElementById('statusSync'),
  menuButton: document.getElementById('menuButton'),
  menuOverlay: document.getElementById('menuOverlay'),
  homeSection: document.getElementById('homeSection'),
  calendarSection: document.getElementById('calendarSection'),
  mapSection: document.getElementById('mapSection'),
  budgetSection: document.getElementById('budgetSection'),
  settingsSection: document.getElementById('settingsSection'),
  resetButton: document.getElementById('resetSeedButton'),
  refreshButton: document.getElementById('refreshButton'),
  tabs: [...document.querySelectorAll('.tab-button')]
};

const editModal = createItemModal('editItemModal', 'Editar item', saveEditForm);
const newItemModal = createItemModal('newItemModal', 'Nuevo item', saveNewItemForm);
const DATA_COLUMNS = ['ItemID', 'StartDate', 'EndDate', 'StartTime', 'EndTime', 'ItemType', 'Title', 'City', 'AmountUSD', 'PlanningStatus', 'PaymentStatus', 'IsPaid', 'Completed', 'CompletedAt', 'CompletedByRole', 'GooglePlusCode', 'GoogleMapsUrl', 'Notes'];
const ITEM_TYPES = ['ACTIVITY', 'FLIGHT', 'FOOD', 'LODGING', 'TRANSPORT', 'OTHER'];
const PLANNING_STATUSES = ['CONFIRMED', 'PROPOSED'];
const PAYMENT_STATUSES = ['PAID', 'NOT_PAID', 'PARTIAL', 'RESERVED', 'ESTIMATED'];
const SNAPSHOT_KEY = 'tm3.dataSnapshots';
const VIEW_STATE_KEY = 'tm3.activeView';
const CALENDAR_MONTH_KEY = 'tm3.calendarMonth';
const ACCESS_ROLE_KEY = 'tm3.accessRole';
const BACKUP_SCHEMA_VERSION = 1;
const APP_VERSION = '0.1.0';
const MULTIDAY_OCCURRENCE_MIGRATION_VERSION = '2026-07-10-v3-legacy-derived-cleanup';
const ITEM_ID_PATTERN = /^ITEM_\d{3}$/;
const ALLOWED_LEGACY_ITEM_IDS = new Set(['ITEM_121_B']);
const ACCESS_PINS = {
  family: '0000',
  traveler: '1991',
  admin: '1891'
};
const ACCESS_ROLES = {
  family: { label: 'Familia', views: ['home', 'map'], confirmedOnly: true, prices: false, edit: false, complete: false, settings: false },
  traveler: { label: 'Viajero', views: ['home', 'calendar', 'map'], confirmedOnly: false, prices: true, edit: false, complete: false, settings: false },
  admin: { label: 'Admin', views: ['home', 'calendar', 'map', 'budget', 'settings'], confirmedOnly: false, prices: true, edit: true, complete: true, settings: true }
};

await initApp();

async function initApp() {
  registerServiceWorker();
  bindEvents();
  state.accessRole = getStoredAccessRole();
  if (!state.accessRole) {
    renderAccessGate();
    updateOnlineStatus();
    return;
  }
  await bootAppData();
}

async function bootAppData() {
  if (state.booted) {
    await loadState();
    await render();
    return;
  }
  state.booted = true;
  await openDatabase();
  await getOrCreateDeviceId();
  state.activeView = getStoredView();
  state.calendarMonth = localStorage.getItem(CALENDAR_MONTH_KEY) || '';
  const itinerary = await loadItalyItinerary();
  await migrateLegacyTravelData(itinerary);
  await refreshTripsAndDays(itinerary.days);
  localStorage.setItem(ITALY_DAYS_KEY, JSON.stringify(state.days));
  await migrateToItalyItineraryIfNeeded(itinerary);
  await migratePlanningStatus();
  await migrateLocalMultidayOccurrences();
  await initAuth();
  await loadState();
  updateOnlineStatus();
  await render();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const swUrl = new URL('../pwa/sw.js', import.meta.url);
  const scope = new URL('../', import.meta.url);
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl, { scope }).catch(() => {
      // Offline support is best-effort; IndexedDB still works without the service worker.
    });
  });
}

async function initAuth() {
  try {
    const session = await getCurrentSession();
    state.authUser = session?.user || null;
    state.authError = '';
    state.authMessage = state.authUser ? 'Los cambios se guardan localmente y se sincronizan automáticamente cuando hay internet.' : '';
    window.addEventListener('tm3-sync-state-change', event => {
      state.sync = event.detail || getSyncState();
      updateSyncStatus();
      if (state.activeView === 'settings') renderSettings();
    });
    if (state.authUser) await startCloudSync({ onAppliedRemoteChanges: refreshAfterCloudPull });
    await onAuthStateChange(async (_event, session) => {
      state.authUser = session?.user || null;
      state.authLoading = false;
      state.authError = '';
      state.authMessage = state.authUser ? 'Los cambios se guardan localmente y se sincronizan automáticamente cuando hay internet.' : 'Modo local activo. La nube requiere iniciar sesión.';
      if (state.authUser) {
        await startCloudSync({ onAppliedRemoteChanges: refreshAfterCloudPull });
      } else {
        stopCloudSync();
      }
      updateSyncStatus();
      if (state.activeView === 'settings') renderSettings();
    });
  } catch (error) {
    state.authError = getAuthErrorMessage(error);
    state.authMessage = 'Modo local activo. La nube requiere iniciar sesión.';
  } finally {
    state.authLoading = false;
    updateSyncStatus();
  }
}

async function refreshAfterCloudPull() {
  await refreshTripsAndDays();
  await loadState();
  await render();
}

function notifyLocalChange(reason) {
  if (!state.authUser) {
    updateSyncStatus();
    return;
  }
  queueCloudSync(reason);
}

function stampLocalChange(record, timestamp = new Date().toISOString()) {
  return {
    ...record,
    UpdatedAt: timestamp,
    ModifiedAt: timestamp,
    updatedAt: timestamp,
    LastUpdatedAt: timestamp,
    Version: Number(record?.Version || 0) + 1,
    SyncStatus: 'LOCAL_PENDING'
  };
}

function markLocalEntity(entityType, entityId) {
  if (entityType && entityId) recordLocalChange(entityType, entityId);
}

function getStoredAccessRole() {
  const role = localStorage.getItem(ACCESS_ROLE_KEY);
  return ACCESS_ROLES[role] ? role : '';
}

function getAccessConfig() {
  return ACCESS_ROLES[state.accessRole] || ACCESS_ROLES.family;
}

function getAccessLabel() {
  return state.accessRole ? getAccessConfig().label : 'Sin acceso';
}

function canView(view) {
  return Boolean(state.accessRole && getAccessConfig().views.includes(view));
}

function canEditApp() {
  return Boolean(getAccessConfig().edit);
}

function canToggleCompletion() {
  return Boolean(getAccessConfig().complete);
}

function canSeePrices() {
  return Boolean(getAccessConfig().prices);
}

function shouldShowOnlyConfirmed() {
  return Boolean(getAccessConfig().confirmedOnly);
}

function requireAdminAction() {
  return canEditApp();
}

function normalizeAccessView(view) {
  return canView(view) ? view : 'home';
}

// PIN roles are a UI convenience for the shared travel app, not strong security.
function resolveAccessRole(pin) {
  return Object.entries(ACCESS_PINS).find(([, value]) => value === pin)?.[0] || '';
}

function bindEvents() {
  window.addEventListener('online', () => {
    updateOnlineStatus();
    if (state.authUser) queueCloudSync('online');
  });
  window.addEventListener('offline', updateOnlineStatus);
  els.menuButton.addEventListener('click', () => els.menuOverlay.classList.remove('hidden'));
  els.menuOverlay.addEventListener('click', event => {
    if (event.target === els.menuOverlay) closeMenu();
  });
  els.menuOverlay.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      if (!canView(button.dataset.view)) return;
      state.activeView = button.dataset.view;
      if (state.activeView === 'calendar') ensureCalendarMonth();
      persistViewState();
      closeMenu();
      render();
    });
  });
  els.tabs.forEach(button => {
    button.addEventListener('click', () => {
      if (!state.accessRole) return;
      if (button.dataset.action === 'new-item') {
        if (!canEditApp()) return;
        openNewItemModal();
        return;
      }
      if (shouldShowOnlyConfirmed() && button.dataset.tab !== 'CONFIRMED') return;
      state.activeTab = button.dataset.tab;
      state.openItemId = null;
      render();
    });
  });
  els.refreshButton.addEventListener('click', async () => {
    await loadState();
    await render();
  });
  els.resetButton.addEventListener('click', () => {
    if (requireAdminAction()) restoreOriginalItinerary();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeMenu();
      requestCloseModal(editModal);
      requestCloseModal(newItemModal);
    }
  });
}

function renderAccessGate(message = '') {
  document.documentElement.dataset.accessRole = '';
  document.documentElement.classList.add('app-readonly');
  state.activeView = 'home';
  closeMenu();
  els.menuButton.classList.add('hidden');
  els.menuOverlay.classList.add('hidden');
  els.statusRow?.classList.add('hidden');
  els.calendarSection.classList.add('hidden');
  els.mapSection.classList.add('hidden');
  els.budgetSection.classList.add('hidden');
  els.settingsSection.classList.add('hidden');
  els.homeSection.classList.remove('hidden');
  els.viewTitle.textContent = 'Acceso';
  const header = els.homeSection.querySelector('.section-header');
  const tabs = els.homeSection.querySelector('.tabs');
  header?.classList.add('hidden');
  tabs?.classList.add('hidden');
  els.dayList.innerHTML = `
    <section class="access-gate" aria-labelledby="accessGateTitle">
      <h2 id="accessGateTitle">TravelManager 3</h2>
      <p>Ingresa el PIN de acceso para abrir el viaje.</p>
      <form id="accessPinForm" class="access-form" novalidate>
        <label>PIN<input id="accessPinInput" type="password" inputmode="numeric" autocomplete="current-password" maxlength="4" /></label>
        <button class="primary-button" type="submit">Entrar</button>
      </form>
      <p id="accessMessage" class="settings-message${message ? ' data-error' : ''}">${escapeHtml(message)}</p>
    </section>
  `;
  document.getElementById('accessPinForm')?.addEventListener('submit', handleAccessSubmit);
  document.getElementById('accessPinInput')?.focus();
}

async function handleAccessSubmit(event) {
  event.preventDefault();
  const pin = document.getElementById('accessPinInput')?.value.trim() || '';
  const role = resolveAccessRole(pin);
  if (!role) {
    renderAccessGate('PIN invalido.');
    return;
  }
  localStorage.setItem(ACCESS_ROLE_KEY, role);
  state.accessRole = role;
  state.activeView = normalizeAccessView(getStoredView());
  els.menuButton.classList.remove('hidden');
  els.statusRow?.classList.remove('hidden');
  els.homeSection.querySelector('.section-header')?.classList.remove('hidden');
  els.homeSection.querySelector('.tabs')?.classList.remove('hidden');
  await bootAppData();
}

async function switchAccessRole() {
  localStorage.removeItem(ACCESS_ROLE_KEY);
  state.accessRole = '';
  state.openDayKey = null;
  state.openItemId = null;
  renderAccessGate();
  updateOnlineStatus();
}

async function loadState() {
  state.allItems = await getAllItems();
  state.items = state.allItems
    .filter(item => !state.activeTripId || item.TripID === state.activeTripId)
    .filter(item => !shouldShowOnlyConfirmed() || getItemPlanningStatus(item) === 'CONFIRMED');
}

async function refreshTripsAndDays(fallbackDays = []) {
  state.trips = await getAllTrips();
  state.activeTripId = await getActiveTripId();
  if (!state.trips.some(trip => trip.TripID === state.activeTripId)) {
    state.activeTripId = selectDefaultTrip(state.trips) || 'TRIP_ITALY_2026';
    await setActiveTripId(state.activeTripId);
  }
  state.days = toAppDays(await getTripDays(state.activeTripId), fallbackDays);
  localStorage.setItem(ITALY_DAYS_KEY, JSON.stringify(state.days));
}

function toAppDays(tripDays, fallback = []) {
  const rows = tripDays.length ? tripDays : fallback;
  return rows.map(day => ({
    DayID: day.DayID || day.TripDayID,
    TripDayID: day.TripDayID || day.DayID,
    TripID: day.TripID || 'TRIP_ITALY_2026',
    DayOrder: day.DayOrder || 0,
    DayDate: day.DayDate || day.Date,
    Date: day.Date || day.DayDate,
    DayLabel: day.DayLabel || '',
    Title: day.Title || '',
    City: day.City || day.PrimaryCity || '',
    PrimaryCity: day.PrimaryCity || day.City || '',
    CountryCode: day.CountryCode || day.PrimaryCountryCode || '',
    PrimaryCountryCode: day.PrimaryCountryCode || day.CountryCode || '',
    Notes: day.Notes || day.DayNotes || '',
    DayNotes: day.DayNotes || day.Notes || '',
    DayImageUrl: day.DayImageUrl || ''
  }));
}

async function getActiveTripBudget() {
  const activeTripId = await getActiveTripId();
  const trip = activeTripId ? await getTrip(activeTripId) : null;
  if (trip && trip.BudgetAmountUSD !== undefined) return Number(trip.BudgetAmountUSD || 0);
  return Number(await getSetting('tripBudgetUSD', 6000) || 0);
}

async function setActiveTripBudget(value) {
  const activeTripId = await getActiveTripId();
  const trip = activeTripId ? await getTrip(activeTripId) : null;
  if (!trip) {
    await setSetting('tripBudgetUSD', value);
    notifyLocalChange('budget-setting');
    return;
  }
  const now = new Date().toISOString();
  await saveTrip(stampLocalChange({
    ...trip,
    BudgetAmount: value,
    BudgetAmountUSD: value,
    BudgetCurrencyCode: trip.BudgetCurrencyCode || 'USD'
  }, now));
  markLocalEntity('TRIP', trip.TripID);
  notifyLocalChange('budget-trip');
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
  els.statusSync.textContent = 'Itinerario Italy 2026 cargado';
}

async function migratePlanningStatus() {
  const items = await getAllItems();
  const missing = items.filter(item => !item.PlanningStatus);
  for (const item of missing) {
    await updateItem({ ...item, PlanningStatus: getPlanningStatus(item.Status), LastUpdatedAt: item.LastUpdatedAt || new Date().toISOString() });
  }
}

async function migrateLocalMultidayOccurrences() {
  const datasetId = getActiveDatasetId();
  const settingKey = `tm3.migration.legacyDerivedOccurrenceCleanup.${datasetId}`;
  if (await getSetting(settingKey, '') === MULTIDAY_OCCURRENCE_MIGRATION_VERSION) return;

  const allItems = await getAllItems();
  const candidates = allItems.filter(item => isActiveDatasetItem(item));
  const relatedKeys = getStaleMultidayMigrationKeys(candidates);
  if (relatedKeys.size === 0) {
    await setSetting(settingKey, MULTIDAY_OCCURRENCE_MIGRATION_VERSION);
    return;
  }

  const rebuilt = rebuildMultidayOccurrences(
    candidates.filter(item => relatedKeys.has(getLogicalKey(item))).map(normalizeMigrationSourceItem),
    state.days,
    { datasetId }
  );
  await replaceItemsByPredicate(rebuilt, item => isActiveDatasetItem(item) && relatedKeys.has(getLogicalKey(item)));
  await setSetting(settingKey, MULTIDAY_OCCURRENCE_MIGRATION_VERSION);
}

function getStaleMultidayMigrationKeys(items) {
  const groups = new Map();
  items.forEach(item => {
    const key = getLogicalKey(item);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const keys = new Set();
  groups.forEach((group, key) => {
    if (group.some(item => (item.EndDate || item.StartDate || item.DayDate || '') > (item.StartDate || item.DayDate || ''))) keys.add(key);
  });
  return keys;
}

function normalizeMigrationSourceItem(item) {
  const start = item.StartDate || item.DayDate || '';
  const end = item.EndDate || start;
  return {
    ...item,
    SourceItemID: getLogicalKey(item),
    StartDate: start,
    EndDate: end,
    IsMultiDay: end > start
  };
}

function isSampleItem(item) {
  return item.TripID === 'trip-001' || /^item-00\d$/.test(item.ItemID || '');
}

function getStoredView() {
  const view = localStorage.getItem(VIEW_STATE_KEY);
  if (!['home', 'calendar', 'map', 'budget', 'settings'].includes(view)) return 'home';
  return normalizeAccessView(view);
}

function persistViewState() {
  localStorage.setItem(VIEW_STATE_KEY, state.activeView);
  if (state.calendarMonth) localStorage.setItem(CALENDAR_MONTH_KEY, state.calendarMonth);
}

async function render() {
  if (!state.accessRole) {
    renderAccessGate();
    return;
  }
  state.activeView = normalizeAccessView(state.activeView);
  if (shouldShowOnlyConfirmed()) state.activeTab = 'CONFIRMED';
  syncAccessUi();
  els.homeSection.classList.toggle('hidden', state.activeView !== 'home');
  els.calendarSection.classList.toggle('hidden', state.activeView !== 'calendar');
  els.mapSection.classList.toggle('hidden', state.activeView !== 'map');
  els.budgetSection.classList.toggle('hidden', state.activeView !== 'budget');
  els.settingsSection.classList.toggle('hidden', state.activeView !== 'settings');
  els.viewTitle.textContent = state.activeView === 'budget' ? 'Presupuesto' : state.activeView === 'settings' ? 'Configuración' : 'Inicio';
  if (state.activeView === 'calendar') els.viewTitle.textContent = 'Calendario';
  if (state.activeView === 'map') els.viewTitle.textContent = 'Mapa';
  if (state.activeView === 'home') renderHome();
  if (state.activeView === 'calendar') renderCalendar();
  if (state.activeView === 'map') renderMapView();
  if (state.activeView === 'budget') await renderBudget();
  if (state.activeView === 'settings') await renderSettings();
}

function syncAccessUi() {
  document.documentElement.dataset.accessRole = state.accessRole;
  document.documentElement.classList.toggle('app-readonly', !canEditApp());
  els.menuButton.classList.remove('hidden');
  els.statusRow?.classList.remove('hidden');
  els.homeSection.querySelector('.section-header')?.classList.remove('hidden');
  els.homeSection.querySelector('.tabs')?.classList.remove('hidden');
  els.menuOverlay.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('hidden', !canView(button.dataset.view));
  });
  els.tabs.forEach(button => {
    const hide = (button.dataset.action === 'new-item' && !canEditApp())
      || (button.dataset.tab === 'PROPOSED' && shouldShowOnlyConfirmed());
    button.classList.toggle('hidden', hide);
  });
  els.resetButton.classList.toggle('hidden', !canEditApp());
  let roleButton = document.getElementById('accessSwitchButton');
  if (!roleButton) {
    roleButton = document.createElement('button');
    roleButton.id = 'accessSwitchButton';
    roleButton.className = 'access-switch-button';
    roleButton.type = 'button';
    roleButton.addEventListener('click', switchAccessRole);
    els.statusRow?.append(roleButton);
  }
  roleButton.textContent = `${getAccessLabel()} - cambiar PIN`;
}

function renderHome() {
  els.tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === state.activeTab && !tab.dataset.action));
  const visibleItems = state.items.filter(item => getItemPlanningStatus(item) === state.activeTab);
  renderDays(visibleItems);
}

function renderDays(items) {
  els.dayList.innerHTML = '';
  for (const day of state.days) {
    const dayItems = getHomeDayItems(items, day.DayDate).sort(compareItems);
    const total = dayItems.reduce((sum, item) => sum + getFinancialAmount(item), 0);
    const summaryText = canSeePrices()
      ? `${state.activeTab === 'CONFIRMED' ? 'Total confirmado' : 'Total propuesto'}: ${formatMoney(total)}`
      : `${dayItems.length} items confirmados`;
    const isOpen = state.openDayKey === day.DayDate;
    const card = document.createElement('article');
    card.className = 'day-card';
    card.dataset.dayDate = day.DayDate;
    card.innerHTML = `
      <button class="day-summary" type="button" aria-expanded="${isOpen}">
        <span class="day-summary-text">
          <strong>${escapeHtml(formatDayTitle(day))}</strong>
          <span>${escapeHtml(day.City || 'Sin ciudad')} • ${state.activeTab === 'CONFIRMED' ? 'Total confirmado' : 'Total propuesto'}: ${formatMoney(total)}</span>
        </span>
        <span class="expand-indicator">${isOpen ? '▾' : '▸'}</span>
      </button>
      <div class="day-items${isOpen ? '' : ' hidden'}"></div>
    `;
    if (!canSeePrices()) {
      card.querySelector('.day-summary-text span').textContent = `${day.City || 'Sin ciudad'} - ${summaryText}`;
    }
    card.querySelector('.day-summary').addEventListener('click', () => {
      state.openDayKey = isOpen ? null : day.DayDate;
      state.openItemId = null;
      renderHome();
    });
    const details = card.querySelector('.day-items');
    if (dayItems.length === 0) {
      details.innerHTML = '<div class="empty-day">Sin items programados</div>';
    } else {
      dayItems.forEach(item => details.append(renderItem(item)));
    }
    els.dayList.append(card);
  }
}

function getHomeDayItems(items, dayDate) {
  const groups = new Map();
  items.filter(item => itemBelongsOnAgendaDate(item, dayDate)).forEach(item => {
    const key = getCanonicalLogicalItemId(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  return [...groups.values()]
    .map(group => normalizeHomeDayOccurrence(group, dayDate))
    .filter(Boolean);
}

function normalizeHomeDayOccurrence(group, dayDate) {
  const representative = chooseHomeDayRepresentative(group, dayDate);
  if (!representative) return null;

  if (isItemCompleted(representative)) {
    const completedTime = getCompletedTime(representative);
    return {
      ...representative,
      SourceItemID: getCanonicalLogicalItemId(representative),
      DayDate: dayDate,
      StartTime: completedTime,
      EndTime: '',
      IsAllDay: false,
      CompletedAgendaDate: dayDate,
      CompletedAgendaTime: completedTime,
      SortOrder: Number(representative.SortOrder || 0)
    };
  }

  const start = representative.StartDate || representative.DayDate || '';
  const end = representative.EndDate || start;
  if (!start || !end || end < start || dayDate < start || dayDate > end) return null;

  const amount = Number(group.find(item => Number(item.AmountUSD || 0) > 0)?.AmountUSD || representative.AmountUSD || 0);
  const meta = getHomeOccurrenceMeta({ ...representative, AmountUSD: amount }, dayDate);
  if (!meta) return null;

  return {
    ...representative,
    SourceItemID: getCanonicalLogicalItemId(representative),
    DayDate: dayDate,
    StartDate: start,
    EndDate: end,
    StartTime: meta.startTime,
    EndTime: meta.endTime,
    AmountUSD: meta.amount,
    IsAllDay: meta.isAllDay,
    LodgingDisplayMode: meta.lodgingMode,
    OccurrenceRole: meta.role,
    IncludedLabel: meta.includedLabel,
    SortOrder: Number(representative.SortOrder || 0) + meta.sortOffset
  };
}

function chooseHomeDayRepresentative(group, dayDate) {
  const sorted = [...group].sort((a, b) => Number(a.SortOrder || 0) - Number(b.SortOrder || 0));
  return sorted.find(item => item.DayDate === dayDate && Number(item.AmountUSD || 0) > 0)
    || sorted.find(item => item.DayDate === dayDate)
    || sorted.find(item => (item.StartDate || item.DayDate) === dayDate)
    || sorted.find(item => Number(item.AmountUSD || 0) > 0)
    || sorted[0];
}

function getHomeOccurrenceMeta(item, dayDate) {
  const start = item.StartDate || item.DayDate || '';
  const end = item.EndDate || start;
  const isLodging = item.ItemType === 'LODGING';
  const isMultiDay = end > start;
  const isStart = dayDate === start;
  const isEnd = dayDate === end;
  const amount = isStart ? Number(item.AmountUSD || 0) : 0;

  if (!isMultiDay) {
    return {
      role: 'SINGLE',
      lodgingMode: isLodging ? 'NORMAL' : item.LodgingDisplayMode || 'NORMAL',
      startTime: item.StartTime || '',
      endTime: item.EndTime || '',
      amount,
      isAllDay: item.IsAllDay === true,
      includedLabel: '',
      sortOffset: 0
    };
  }

  if (isLodging) {
    if (isStart) return { role: 'CHECK_IN', lodgingMode: 'CHECK_IN', startTime: item.StartTime || '', endTime: '', amount, isAllDay: false, includedLabel: '', sortOffset: 0 };
    if (isEnd) return { role: 'CHECK_OUT', lodgingMode: 'CHECK_OUT', startTime: item.EndTime || '', endTime: '', amount, isAllDay: false, includedLabel: 'Incluido en reserva', sortOffset: 900 };
    return { role: 'FULL_DAY', lodgingMode: 'FULL_DAY', startTime: '', endTime: '', amount, isAllDay: true, includedLabel: 'Incluido en reserva', sortOffset: 800 };
  }

  if (isStart) return { role: 'START', lodgingMode: 'NORMAL', startTime: item.StartTime || '', endTime: '', amount, isAllDay: false, includedLabel: '', sortOffset: 0 };
  if (isEnd) return { role: 'END', lodgingMode: 'NORMAL', startTime: item.EndTime || '', endTime: '', amount, isAllDay: false, includedLabel: 'Incluido en item', sortOffset: 900 };
  return { role: 'FULL_DAY', lodgingMode: 'NORMAL', startTime: '', endTime: '', amount, isAllDay: true, includedLabel: 'Incluido en item', sortOffset: 800 };
}

function ensureCalendarMonth() {
  if (state.calendarMonth) return;
  state.calendarMonth = getInitialCalendarMonth();
}

function getInitialCalendarMonth() {
  const trip = state.trips.find(row => row.TripID === state.activeTripId);
  const today = new Date().toISOString().slice(0, 10);
  if (trip && isTripCurrent(trip)) return today.slice(0, 7);
  return (trip?.StartDate || state.days[0]?.DayDate || today).slice(0, 7);
}

function renderCalendar() {
  ensureCalendarMonth();
  const monthStart = `${state.calendarMonth}-01`;
  const monthDate = new Date(`${monthStart}T00:00:00`);
  const monthLabel = monthDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const trip = state.trips.find(row => row.TripID === state.activeTripId);
  els.calendarSection.innerHTML = `
    <div class="calendar-toolbar">
      <button class="secondary-button" type="button" data-calendar-prev>Anterior</button>
      <div>
        <h2>${escapeHtml(monthLabel)}</h2>
        <p>${escapeHtml(trip?.TripTitle || trip?.TripName || state.activeTripId || 'Viaje activo')}</p>
      </div>
      <button class="secondary-button" type="button" data-calendar-next>Siguiente</button>
    </div>
    <div class="calendar-actions">
      <button class="primary-button" type="button" data-calendar-start>Mes inicio del viaje</button>
    </div>
    <p class="settings-message${state.calendarMessage ? '' : ' hidden'}">${escapeHtml(state.calendarMessage)}</p>
    <div class="calendar-weekdays">${['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'].map(day => `<span>${day}</span>`).join('')}</div>
    <div class="calendar-grid">
      ${buildCalendarDates(state.calendarMonth).map(date => renderCalendarDay(date)).join('')}
    </div>
  `;
  els.calendarSection.querySelector('[data-calendar-prev]').addEventListener('click', () => changeCalendarMonth(-1));
  els.calendarSection.querySelector('[data-calendar-next]').addEventListener('click', () => changeCalendarMonth(1));
  els.calendarSection.querySelector('[data-calendar-start]').addEventListener('click', () => {
    state.calendarMonth = getInitialCalendarMonth();
    state.calendarMessage = '';
    persistViewState();
    renderCalendar();
  });
  els.calendarSection.querySelectorAll('[data-calendar-date]').forEach(button => {
    button.addEventListener('click', () => openCalendarDate(button.dataset.calendarDate));
  });
}

function renderCalendarDay(date) {
  const counts = getCalendarCounts(date);
  const inMonth = date.slice(0, 7) === state.calendarMonth;
  const hasTripDay = state.days.some(day => day.DayDate === date);
  const hasItems = counts.total > 0;
  return `
    <button class="calendar-day${inMonth ? '' : ' muted'}${hasTripDay ? '' : ' no-trip-day'}${inMonth && !hasItems ? ' empty' : ''}${inMonth && hasItems ? ' populated' : ''}" type="button" data-calendar-date="${escapeHtml(date)}">
      <span class="calendar-number">${Number(date.slice(8, 10))}</span>
      ${hasItems ? `<span class="calendar-confirmed-count">${counts.confirmed}</span>` : ''}
    </button>
  `;
}

function renderMapView() {
  if (state.map) {
    state.map.remove();
    state.map = null;
    state.mapLayer = null;
    state.tileLayer = null;
  }
  const stats = getMapLocationStats();
  const pins = getFilteredMapItems();
  const planningOptions = shouldShowOnlyConfirmed()
    ? [['CONFIRMED', 'Confirmado']]
    : [['ALL', 'Todos'], ['CONFIRMED', 'Confirmado'], ['PROPOSED', 'Propuesto']];
  if (shouldShowOnlyConfirmed()) state.mapFilters.planning = 'CONFIRMED';
  els.mapSection.innerHTML = `
    <div class="map-panel">
      <div class="map-filter-grid">
        <label>Estado<select data-map-filter="planning">${renderMapOptions(planningOptions, state.mapFilters.planning)}</select></label>
        <label>Categoría<select data-map-filter="type">${renderMapOptions([['ALL', 'Todos'], ...getMapItemTypes().map(value => [value, getCategoryLabel(value)])], state.mapFilters.type)}</select></label>
        <label>Ciudad<select data-map-filter="city">${renderMapOptions([['ALL', 'Todas'], ...getMapCities().map(value => [value, value])], state.mapFilters.city)}</select></label>
        <label>Día<select data-map-filter="date">${renderMapOptions([['ALL', 'Todos'], ...state.days.map(day => [day.DayDate, `${day.DayDate} ${day.City || day.Title || ''}`.trim()])], state.mapFilters.date)}</select></label>
      </div>
      <div class="map-status">
        <span>${pins.length} pins visibles</span>
        <span>${stats.withLocation} de ${stats.total} items tienen ubicación</span>
      </div>
      <div id="tripMap" class="trip-map" aria-label="Mapa del viaje"></div>
      <p class="placeholder-note${pins.length ? ' hidden' : ''}">No hay ubicaciones para los filtros seleccionados.</p>
      <div class="map-legend">${getMapItemTypes().map(type => `<span><i style="background:${getMarkerColor(type)}"></i>${escapeHtml(getCategoryLabel(type))}</span>`).join('')}</div>
    </div>
  `;
  els.mapSection.querySelectorAll('[data-map-filter]').forEach(select => {
    select.addEventListener('change', () => {
      state.mapFilters[select.dataset.mapFilter] = select.value;
      renderMapView();
    });
  });
  window.setTimeout(() => updateLeafletMap(pins), 0);
}

function renderMapOptions(options, selected) {
  return options.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function getMapSourceItems() {
  return uniqueFinancialItems(state.items).filter(item => item.TripID === state.activeTripId);
}

function getMapLocationStats() {
  const items = getMapSourceItems();
  return { total: items.length, withLocation: items.filter(hasValidCoordinates).length };
}

function getMapItemTypes() {
  return [...new Set(getMapSourceItems().map(item => item.ItemType || 'OTHER'))].sort();
}

function getMapCities() {
  return [...new Set(getMapSourceItems().map(item => item.City || '').filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function getFilteredMapItems() {
  return getMapSourceItems().filter(item => {
    if (!hasValidCoordinates(item)) return false;
    if (state.mapFilters.planning !== 'ALL' && getItemPlanningStatus(item) !== state.mapFilters.planning) return false;
    if (state.mapFilters.type !== 'ALL' && (item.ItemType || 'OTHER') !== state.mapFilters.type) return false;
    if (state.mapFilters.city !== 'ALL' && (item.City || '') !== state.mapFilters.city) return false;
    if (state.mapFilters.date !== 'ALL' && !dateInItemRange(state.mapFilters.date, item)) return false;
    return true;
  });
}

function hasValidCoordinates(item) {
  const latitude = Number(item.Latitude);
  const longitude = Number(item.Longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0);
}

function updateLeafletMap(items) {
  if (!window.L) {
    els.mapSection.querySelector('#tripMap').innerHTML = '<div class="map-empty">Mapa no disponible.</div>';
    return;
  }
  state.map = L.map('tripMap', { scrollWheelZoom: true, dragging: true, touchZoom: true });
  state.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(state.map);
  state.mapLayer = L.layerGroup().addTo(state.map);
  state.mapLayer.clearLayers();
  const bounds = [];
  items.forEach(item => {
    const point = [Number(item.Latitude), Number(item.Longitude)];
    bounds.push(point);
    const marker = L.marker(point, { icon: createMapIcon(item.ItemType) }).addTo(state.mapLayer);
    marker.bindPopup(renderMapPopup(item));
    marker.on('popupopen', event => {
      event.popup.getElement()?.querySelector('[data-map-open-item]')?.addEventListener('click', () => openMapItemInHome(item));
    });
  });
  state.map.invalidateSize();
  if (bounds.length > 1) state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
  if (bounds.length === 1) state.map.setView(bounds[0], 15);
  if (bounds.length === 0) state.map.setView([41.9028, 12.4964], 6);
}

function createMapIcon(type) {
  return L.divIcon({
    className: 'map-marker',
    html: `<span style="background:${getMarkerColor(type)}"></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
}

function getMarkerColor(type = 'OTHER') {
  return {
    ACTIVITY: '#15803d',
    FOOD: '#c2410c',
    LODGING: '#6d28d9',
    TRANSPORT: '#0e7490',
    FLIGHT: '#1d4ed8',
    SHOPPING: '#be123c',
    OTHER: '#64748b'
  }[type] || '#64748b';
}

function renderMapPopup(item) {
  return `
    <div class="map-popup">
      <strong>${escapeHtml(getDisplayTitle(item))}</strong>
      <span>${escapeHtml(getCategoryLabel(item.ItemType))} · ${escapeHtml(item.City || 'Sin ciudad')}</span>
      <span>${escapeHtml(getItemDateTimeSummary(item))}</span>
      <span>${escapeHtml(getItemPlanningStatus(item))}</span>
      <button class="primary-button" type="button" data-map-open-item="${escapeHtml(getLogicalKey(item))}">Ver en Inicio</button>
    </div>
  `;
}

function getItemDateTimeSummary(item) {
  const start = item.StartDate || item.DayDate || '';
  const end = item.EndDate && item.EndDate !== start ? ` / ${item.EndDate}` : '';
  const time = [item.StartTime, item.EndTime].filter(Boolean).join(' - ');
  return `${start}${end}${time ? ` · ${time}` : ''}`;
}

async function openMapItemInHome(item) {
  const key = getLogicalKey(item);
  const targetDate = item.DayDate || item.StartDate || '';
  const target = state.items.find(row => getLogicalKey(row) === key && row.TripID === state.activeTripId && (row.DayDate || row.StartDate) === targetDate)
    || state.items.find(row => getLogicalKey(row) === key && row.TripID === state.activeTripId && dateInItemRange(targetDate, row))
    || item;
  state.activeTab = getItemPlanningStatus(target);
  state.openDayKey = target.DayDate || target.StartDate || targetDate;
  state.openItemId = target.ItemID;
  state.activeView = 'home';
  persistViewState();
  await render();
  window.setTimeout(() => {
    document.querySelector(`[data-item-id="${CSS.escape(target.ItemID)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 0);
}

function buildCalendarDates(monthKey) {
  const first = new Date(`${monthKey}-01T00:00:00`);
  const start = new Date(first);
  const mondayOffset = (first.getDay() + 6) % 7;
  start.setDate(first.getDate() - mondayOffset);
  const dates = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function changeCalendarMonth(delta) {
  const date = new Date(`${state.calendarMonth}-01T00:00:00`);
  date.setMonth(date.getMonth() + delta);
  state.calendarMonth = date.toISOString().slice(0, 7);
  state.calendarMessage = '';
  persistViewState();
  renderCalendar();
}

function getCalendarCounts(date) {
  const dayItems = state.items.filter(item => itemBelongsOnAgendaDate(item, date));
  const confirmed = dayItems.filter(item => getItemPlanningStatus(item) === 'CONFIRMED').length;
  const proposed = dayItems.filter(item => getItemPlanningStatus(item) === 'PROPOSED').length;
  return { total: dayItems.length, confirmed, proposed };
}

async function openCalendarDate(date) {
  const day = state.days.find(row => row.DayDate === date);
  if (!day) {
    state.calendarMessage = `No existe un dÃ­a del viaje para ${date}.`;
    renderCalendar();
    return;
  }
  const counts = getCalendarCounts(date);
  state.activeTab = counts.confirmed > 0 ? 'CONFIRMED' : 'PROPOSED';
  state.openDayKey = date;
  state.openItemId = null;
  state.activeView = 'home';
  state.calendarMessage = '';
  persistViewState();
  await render();
  window.setTimeout(() => {
    document.querySelector(`[data-day-date="${CSS.escape(date)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 0);
}

function renderItem(item) {
  const isOpen = state.openItemId === item.ItemID;
  const completed = isItemCompleted(item);
  const itemEl = document.createElement('article');
  const categoryVisual = getHomeCategoryVisual(item);
  itemEl.className = `agenda-item agenda-item-${categoryVisual.family}${completed ? ' agenda-item-completed' : ''}`;
  itemEl.dataset.itemId = item.ItemID;
  const time = item.IsAllDay ? 'Todo el día' : (item.StartTime || '');
  const categoryChip = renderCategoryChip(categoryVisual);
  const categoryIcon = renderCategoryCardIcon(categoryVisual);
  const displayTime = completed && item.CompletedAgendaTime ? item.CompletedAgendaTime : time;
  const priceChip = canSeePrices() ? `<span class="item-price">${formatItemAmount(item)}</span>` : '';
  const planningToggle = canEditApp() ? `
        <span class="planning-toggle" role="group" aria-label="Estado de planificaciÃ³n">
          <button type="button" data-status="CONFIRMED" aria-pressed="${getItemPlanningStatus(item) === 'CONFIRMED'}" class="${getItemPlanningStatus(item) === 'CONFIRMED' ? 'active' : ''}">Confirmado</button>
          <button type="button" data-status="PROPOSED" aria-pressed="${getItemPlanningStatus(item) === 'PROPOSED'}" class="${getItemPlanningStatus(item) === 'PROPOSED' ? 'active' : ''}">Propuesto</button>
        </span>` : '';
  const completionButton = canToggleCompletion() ? `
        <button type="button" class="completion-toggle${completed ? ' active' : ''}" data-complete-item aria-pressed="${completed}" aria-label="${completed ? 'Quitar completado' : 'Marcar completado'}">${completed ? 'Completado' : 'Completar'}</button>` : '';
  const completedBadge = completed ? '<span class="completed-badge">Completado</span>' : '';
  itemEl.innerHTML = `
    <div class="item-summary" role="button" tabindex="0" aria-expanded="${isOpen}">
      <span class="item-time">${escapeHtml(displayTime)}</span>
      <span class="item-title">${escapeHtml(getDisplayTitle(item))}</span>
      <span class="item-meta">
        ${categoryChip}
        ${completedBadge}
        ${priceChip}
        ${item.GoogleMapsUrl || item.GooglePlusCode ? `<a class="map-button" target="_blank" rel="noopener" href="${escapeHtml(getMapUrl(item))}">${escapeHtml(item.GooglePlusCode || 'Mapas')}</a>` : ''}
        <span class="planning-toggle" role="group" aria-label="Estado de planificación">
          <button type="button" data-status="CONFIRMED" aria-pressed="${getItemPlanningStatus(item) === 'CONFIRMED'}" class="${getItemPlanningStatus(item) === 'CONFIRMED' ? 'active' : ''}">Confirmado</button>
          <button type="button" data-status="PROPOSED" aria-pressed="${getItemPlanningStatus(item) === 'PROPOSED'}" class="${getItemPlanningStatus(item) === 'PROPOSED' ? 'active' : ''}">Propuesto</button>
        </span>
        ${completionButton}
      </span>
      ${categoryIcon}
      ${completed ? '<span class="completed-watermark" aria-hidden="true">✓</span>' : ''}
    </div>
    <div class="item-details${isOpen ? '' : ' hidden'}">${renderDetails(item)}</div>
  `;

  const summary = itemEl.querySelector('.item-summary');
  let holdTimer = null;
  let ignoreClick = false;
  summary.addEventListener('pointerdown', event => {
    if (event.button && event.button !== 0) return;
    if (!canEditApp()) return;
    holdTimer = window.setTimeout(() => {
      ignoreClick = true;
      openEditModal(item);
    }, 600);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(type => {
    summary.addEventListener(type, () => window.clearTimeout(holdTimer));
  });
  summary.addEventListener('contextmenu', event => {
    event.preventDefault();
    window.clearTimeout(holdTimer);
    if (canEditApp()) openEditModal(item);
  });
  summary.addEventListener('click', event => {
    if (ignoreClick) {
      event.preventDefault();
      ignoreClick = false;
      return;
    }
    if (event.target.closest('a, .planning-toggle, .completion-toggle')) return;
    state.openItemId = isOpen ? null : item.ItemID;
    renderHome();
  });
  summary.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('a, .planning-toggle, .completion-toggle')) return;
    event.preventDefault();
    state.openItemId = isOpen ? null : item.ItemID;
    renderHome();
  });
  itemEl.querySelectorAll('.planning-toggle button').forEach(button => {
    ['pointerdown', 'pointerup', 'click', 'keydown', 'contextmenu'].forEach(type => {
      button.addEventListener(type, event => {
        event.stopPropagation();
        if (type === 'contextmenu') event.preventDefault();
      });
    });
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      updatePlanningStatus(item, button.dataset.status);
    });
  });
  itemEl.querySelector('[data-complete-item]')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    toggleItemCompletion(item);
  });
  itemEl.querySelectorAll('a').forEach(link => link.addEventListener('click', event => event.stopPropagation()));
  return itemEl;
}

async function updatePlanningStatus(item, PlanningStatus) {
  if (!canEditApp()) return;
  if (getItemPlanningStatus(item) === PlanningStatus) return;
  const updated = stampLocalChange({ ...item, PlanningStatus });
  await updateItem(updated);
  markLocalEntity('ITEM', updated.ItemID);
  state.activeTab = PlanningStatus;
  state.openDayKey = updated.DayDate || updated.StartDate || null;
  state.openItemId = updated.ItemID;
  els.statusSync.textContent = 'Cambios locales pendientes';
  notifyLocalChange('planning-status');
  await loadState();
  await render();
}

async function toggleItemCompletion(item) {
  if (!canToggleCompletion()) return;
  const completed = isItemCompleted(item);
  const message = completed ? '¿Quitar completado de este item?' : '¿Marcar este item como completado ahora?';
  if (!confirm(message)) return;
  const now = new Date().toISOString();
  const updated = stampLocalChange({
    ...item,
    Completed: !completed,
    CompletedAt: completed ? null : now,
    CompletedByRole: completed ? null : state.accessRole
  }, now);
  await updateItem(updated);
  markLocalEntity('ITEM', updated.ItemID);
  state.openDayKey = getEffectiveAgendaDate(updated) || updated.DayDate || updated.StartDate || null;
  state.openItemId = updated.ItemID;
  els.statusSync.textContent = 'Cambios locales pendientes';
  notifyLocalChange('item-completion');
  await loadState();
  await render();
}

async function renderBudget() {
  const confirmed = state.items.filter(item => getItemPlanningStatus(item) === 'CONFIRMED');
  const uniqueConfirmed = uniqueFinancialItems(confirmed);
  const proposed = uniqueFinancialItems(state.items.filter(item => getItemPlanningStatus(item) === 'PROPOSED'));
  const budget = await getActiveTripBudget();
  const total = sumAmount(uniqueConfirmed);
  const paid = sumAmount(uniqueConfirmed.filter(isPaidFinancial));
  const pending = total - paid;
  const available = budget - total;
  const percentUsed = budget > 0 ? (total / budget) * 100 : 0;
  const categoryRows = getCategoryRows(uniqueConfirmed, total);
  const dayRows = getBudgetDayRows(uniqueConfirmed);
  const proposedTotal = sumAmount(proposed);
  els.budgetSection.innerHTML = `
    ${budget > 0 ? '' : '<div class="budget-alert">No hay presupuesto configurado. <button class="link-button" type="button" data-go-settings>Ir a Configuración</button></div>'}
    ${available < 0 ? `<div class="budget-alert danger">Presupuesto excedido por ${formatMoney(Math.abs(available))}</div>` : ''}
    <div class="summary-grid">
      <div class="summary-card"><span>Presupuesto reservado</span><strong>${formatMoney(budget)}</strong></div>
      <div class="summary-card"><span>Total confirmado</span><strong>${formatMoney(total)}</strong></div>
      <div class="summary-card"><span>Total pagado</span><strong>${formatMoney(paid)}</strong></div>
      <div class="summary-card"><span>Total pendiente</span><strong>${formatMoney(pending)}</strong></div>
      <div class="summary-card ${available < 0 ? 'over-budget' : ''}"><span>Disponible restante</span><strong>${formatMoney(available)}</strong></div>
      <div class="summary-card"><span>Porcentaje utilizado</span><strong>${formatPercent(percentUsed)}</strong></div>
      <div class="summary-card"><span>Items confirmados únicos</span><strong>${uniqueConfirmed.length}</strong></div>
    </div>
    <section class="budget-panel">
      <h2>Pagado vs pendiente</h2>
      ${renderPaidPendingChart(paid, pending, total)}
    </section>
    <section class="budget-panel">
      <h2>Desglose por categoría</h2>
      ${renderCategoryBreakdown(categoryRows)}
    </section>
    <section class="budget-panel">
      <h2>Desglose por día</h2>
      ${renderDayBreakdown(dayRows)}
    </section>
    <section class="budget-panel">
      <h2>Desglose de gastos</h2>
      <div class="expense-toolbar">
        <button class="filter-button active" type="button" data-expense-filter="all">Todos</button>
        <button class="filter-button" type="button" data-expense-filter="paid">Pagados</button>
        <button class="filter-button" type="button" data-expense-filter="pending">Pendientes</button>
        <select id="expenseCategoryFilter" aria-label="Categoría">
          <option value="">Categoría</option>
          ${categoryRows.map(row => `<option value="${escapeHtml(row.type)}">${escapeHtml(getCategoryLabel(row.type))}</option>`).join('')}
        </select>
      </div>
      <div id="expenseList"></div>
    </section>
    <section class="budget-panel muted-panel">
      <h2>Impacto potencial de propuestas</h2>
      <div class="proposal-impact">
        <span>${proposed.length} items propuestos únicos</span>
        <strong>${formatMoney(proposedTotal)}</strong>
      </div>
    </section>
  `;
  els.budgetSection.querySelector('[data-go-settings]')?.addEventListener('click', () => {
    state.activeView = 'settings';
    render();
  });
  setupExpenseFilters(uniqueConfirmed);
}

async function renderSettings() {
  const rows = getLogicalRows();
  const snapshots = getSnapshots();
  const trip = state.trips.find(row => row.TripID === state.activeTripId) || null;
  const audit = buildTripAudit();
  const auditCount = audit.errors.length + audit.warnings.length + audit.info.length;
  els.settingsSection.innerHTML = `
    <section class="settings-panel cloud-sync-panel">
      <h2>Sincronización en la nube</h2>
      <div class="cloud-status">
        <span>Supabase</span>
        <strong>${escapeHtml(getAuthStatusLabel())}</strong>
      </div>
      ${renderAuthPanel()}
      <p id="authMessage" class="settings-message${state.authError ? ' data-error' : ''}">${escapeHtml(state.authError || state.authMessage || getAuthDefaultMessage())}</p>
    </section>
    <section class="settings-panel">
      <h2>Viaje activo</h2>
      <label>Seleccionar viaje<select id="activeTripSelect">${state.trips.map(row => `<option value="${escapeHtml(row.TripID)}"${row.TripID === state.activeTripId ? ' selected' : ''}>${escapeHtml(getTripOptionLabel(row))}</option>`).join('')}</select></label>
      <div class="settings-actions">
        <button id="newTripButton" class="secondary-button" type="button">Nuevo viaje</button>
        <button id="editTripButton" class="secondary-button" type="button">Editar viaje</button>
      </div>
      <div id="tripEditor" class="inline-editor hidden"></div>
      <p id="tripMessage" class="settings-message"></p>
    </section>
    <section class="data-manager">
      <header class="data-manager-header">
        <div>
          <h2>Días del viaje</h2>
          <p>${state.days.length} días en ${escapeHtml(trip?.TripTitle || trip?.TripName || state.activeTripId)}</p>
        </div>
        <button id="toggleDaysPanel" class="secondary-button" type="button">${state.daysPanelOpen ? 'Ocultar' : 'Mostrar'}</button>
      </header>
      <div id="daysPanelBody" class="${state.daysPanelOpen ? '' : 'hidden'}">
        <div class="settings-actions"><button id="addTripDayButton" class="secondary-button" type="button">Añadir día</button></div>
        <div id="dayMessage" class="settings-message"></div>
        <div id="dayEditor" class="inline-editor hidden"></div>
        <div class="day-admin-list">${renderTripDayAdminList()}</div>
      </div>
    </section>
    <section class="data-manager">
      <header class="data-manager-header">
        <div>
          <h2>Administrar itinerario</h2>
          <p>${rows.length} filas lógicas únicas</p>
        </div>
        <div class="data-actions">
          <input id="dataSearch" type="search" placeholder="Buscar título, ciudad o ItemID" />
          <button id="addDataRow" class="secondary-button" type="button">Añadir fila</button>
          <button id="pasteDataRows" class="secondary-button" type="button">Pegar TSV</button>
        </div>
      </header>
      <div id="dataMessage" class="settings-message"></div>
      <div id="dataManagerTable">${renderDataTable(rows)}</div>
      <div id="pastePreview" class="paste-preview hidden"></div>
    </section>
    <section class="backup-panel">
      <header class="data-manager-header">
        <div>
          <h2>Backup y restauración</h2>
          <p>${snapshots.length} snapshots locales guardados</p>
        </div>
      </header>
      <div class="settings-actions">
        <button id="exportBackupButton" class="primary-button" type="button">Exportar backup completo</button>
        <button id="exportActiveTripBackupButton" class="secondary-button" type="button">Exportar viaje activo</button>
        <button id="importBackupButton" class="secondary-button" type="button">Importar backup</button>
        <button id="showSnapshotsButton" class="secondary-button" type="button">Ver snapshots locales</button>
        <button id="restoreSnapshotButton" class="secondary-button danger-button" type="button">Restaurar snapshot</button>
        <input id="backupFileInput" class="hidden" type="file" accept="application/json,.json" />
      </div>
      <div id="backupMessage" class="settings-message"></div>
      <div id="backupPreview" class="backup-preview hidden"></div>
    </section>
    <section class="data-manager">
      <header class="data-manager-header">
        <div>
          <h2>Auditoría del viaje</h2>
          <p>${auditCount === 0 ? 'Sin problemas' : `${auditCount} asuntos por revisar`}</p>
        </div>
        <button id="toggleAuditPanel" class="secondary-button" type="button">${state.auditPanelOpen ? 'Ocultar' : 'Mostrar'}</button>
      </header>
      <div id="auditPanelBody" class="${state.auditPanelOpen ? '' : 'hidden'}">
        <div class="settings-actions"><button id="refreshAuditButton" class="secondary-button" type="button">Volver a auditar</button></div>
        ${renderAudit(audit)}
      </div>
    </section>
    <section class="settings-panel pdf-report-panel">
      <h2>Reporte completo</h2>
      <p class="placeholder-note">Genera una vista imprimible del viaje activo con todos los detalles disponibles.</p>
      <div class="settings-actions">
        <button id="downloadPdfReportButton" class="primary-button" type="button">Descargar reporte PDF completo</button>
      </div>
    </section>
  `;
  bindTripManager();
  bindDayManager();
  bindAuthManager();
  bindBackupManager();
  bindDataManager();
  bindAuditManager();
  bindPdfReportManager();
}

function renderAuthPanel() {
  if (state.authLoading) {
    return '<p class="placeholder-note">Revisando sesión...</p>';
  }
  if (state.authUser) {
    return `
      <div class="signed-in-panel">
        <span>Usuario</span>
        <strong>${escapeHtml(state.authUser.email || 'Sesión activa')}</strong>
        <div class="sync-detail-row"><span>Estado</span><strong>${escapeHtml(getSyncStatusLabel())}</strong></div>
        <div class="sync-detail-row"><span>Última sync</span><strong>${escapeHtml(state.sync.lastSyncAt ? formatDateTime(state.sync.lastSyncAt) : 'Pendiente')}</strong></div>
        ${state.sync.lastError ? `<p class="data-error">${escapeHtml(state.sync.lastError)}</p>` : ''}
        <p>Los cambios se guardan localmente y se sincronizan automáticamente cuando hay internet.</p>
        <div class="settings-actions">
          <button id="syncNowButton" class="primary-button" type="button">Sincronizar ahora</button>
          <button id="authSignOutButton" class="secondary-button" type="button">Cerrar sesión</button>
        </div>
      </div>
    `;
  }
  return `
    <form id="authForm" class="auth-form" novalidate>
      <label>Email<input id="authEmail" name="email" type="email" autocomplete="email" required /></label>
      <label>Contraseña<input id="authPassword" name="password" type="password" autocomplete="current-password" required /></label>
      <div class="settings-actions">
        <button id="authSignUpButton" class="secondary-button" type="button">Crear cuenta</button>
        <button id="authSignInButton" class="primary-button" type="submit">Iniciar sesión</button>
      </div>
    </form>
  `;
}

function getAuthStatusLabel() {
  if (state.authLoading) return 'Revisando sesión';
  if (state.authUser) return 'Conectado';
  if (state.authError) return 'Modo local';
  return 'Modo local';
}

function getAuthDefaultMessage() {
  if (state.authUser) return 'Los cambios se guardan localmente y se sincronizan automáticamente cuando hay internet.';
  return 'La app sigue funcionando en modo local. La sincronización en la nube requiere iniciar sesión.';
}

function bindAuthManager() {
  document.getElementById('authForm')?.addEventListener('submit', event => handleAuthSubmit(event, 'sign-in'));
  document.getElementById('authSignUpButton')?.addEventListener('click', event => handleAuthSubmit(event, 'sign-up'));
  document.getElementById('authSignOutButton')?.addEventListener('click', handleSignOut);
  document.getElementById('syncNowButton')?.addEventListener('click', () => runCloudSyncNow('manual'));
}

function bindPdfReportManager() {
  document.getElementById('downloadPdfReportButton')?.addEventListener('click', exportFullPdfReport);
}

function exportFullPdfReport() {
  if (!canEditApp()) return;
  const popup = window.open('', '_blank');
  if (!popup) {
    alert('Permite ventanas emergentes para generar el reporte PDF.');
    return;
  }
  popup.document.open();
  popup.document.write(buildPdfReportHtml());
  popup.document.close();
  popup.focus();
  popup.setTimeout(() => popup.print(), 350);
}

function buildPdfReportHtml() {
  const trip = state.trips.find(row => row.TripID === state.activeTripId) || {};
  const items = state.allItems
    .filter(item => item.TripID === state.activeTripId)
    .sort(compareReportItems);
  const byDay = groupReportItemsByDay(items);
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(trip.TripTitle || trip.TripName || state.activeTripId)} - reporte</title>
  <style>
    @page { size: Letter portrait; margin: 0.55in; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111; font: 10.5pt/1.35 Arial, sans-serif; }
    h1 { margin: 0 0 6px; font-size: 20pt; }
    .meta { margin: 0 0 18px; color: #444; }
    .day-header { margin: 18px 0 0; padding: 10px 12px; background: #000; color: #fff; page-break-after: avoid; }
    .day-header h2 { margin: 0; font-size: 13pt; }
    .report-item { border-top: 2px solid #111; padding: 10px 0 12px; page-break-inside: avoid; }
    .report-item.confirmed { font-weight: 700; }
    .item-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; }
    .status { border: 1px solid #111; padding: 3px 7px; font-size: 9pt; letter-spacing: .04em; }
    .fields { display: grid; grid-template-columns: 1.15in minmax(0, 1fr); gap: 3px 10px; margin-top: 7px; }
    .label { color: #555; font-weight: 700; }
    a { color: #0645ad; text-decoration: underline; overflow-wrap: anywhere; }
    .notes { white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>${escapeHtml(trip.TripTitle || trip.TripName || state.activeTripId || 'TravelManager 3')}</h1>
  <p class="meta">${escapeHtml([trip.StartDate, trip.EndDate].filter(Boolean).join(' / '))} - Generado ${escapeHtml(formatDateTime(new Date().toISOString()))}</p>
  ${byDay.map(group => renderReportDay(group)).join('')}
</body>
</html>`;
}

function groupReportItemsByDay(items) {
  const dayMap = new Map(state.days.map(day => [day.DayDate || day.Date, day]));
  const groups = new Map();
  for (const item of items) {
    const date = getEffectiveAgendaDate(item) || 'Sin fecha';
    if (!groups.has(date)) groups.set(date, { date, day: dayMap.get(date) || null, items: [] });
    groups.get(date).items.push(item);
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function renderReportDay(group) {
  const day = group.day || {};
  const title = [
    day.DayLabel || day.Title || '',
    group.date,
    day.City || day.PrimaryCity || '',
    day.Notes || day.DayNotes || ''
  ].filter(Boolean).join(' - ');
  return `
    <section>
      <header class="day-header"><h2>${escapeHtml(title || group.date)}</h2></header>
      ${group.items.sort(compareReportItems).map(renderReportItem).join('')}
    </section>
  `;
}

function renderReportItem(item) {
  const status = getItemPlanningStatus(item);
  const fields = getReportFields(item);
  return `
    <article class="report-item ${status === 'CONFIRMED' ? 'confirmed' : 'proposed'}">
      <div class="item-head">
        <h3>${escapeHtml(item.Title || 'Sin titulo')}</h3>
        <span class="status">${escapeHtml(status)}</span>
      </div>
      <div class="fields">
        ${fields.map(([label, value]) => `<div class="label">${escapeHtml(label)}</div><div>${value}</div>`).join('')}
      </div>
    </article>
  `;
}

function getReportFields(item) {
  const fields = [
    ['ItemID', textValue(item.ItemID)],
    ['SourceItemID', item.SourceItemID && item.SourceItemID !== item.ItemID ? textValue(item.SourceItemID) : ''],
    ['Categoria', textValue(item.ItemType || item.Category)],
    ['Start', textValue([item.StartDate, item.StartTime].filter(Boolean).join(' '))],
    ['End', textValue([item.EndDate, item.EndTime].filter(Boolean).join(' '))],
    ['DayDate', textValue(item.DayDate)],
    ['Ciudad', textValue(item.City)],
    ['Direccion', mapSearchLink(item.Address || item.LocationAddress || item.LocationLabel)],
    ['Coordenadas', coordinateLink(item)],
    ['Plus Code', mapSearchLink(item.GooglePlusCode)],
    ['Notas', noteValue(item.Notes || item.Description)],
    ['Proveedor', textValue(item.Provider)],
    ['Website', urlLink(item.Website || item.Url || item.URL || item.GoogleMapsUrl)],
    ['Telefono', phoneLink(item.Phone || item.PhoneNumber)],
    ['Email', emailLink(item.Email)],
    ['AmountUSD', textValue(item.AmountUSD === undefined ? '' : formatMoney(item.AmountUSD))],
    ['Pago', textValue([item.PaymentStatus, isPaidFinancial(item) ? 'Paid' : 'Pending'].filter(Boolean).join(' / '))],
    ['PlanningStatus', textValue(getItemPlanningStatus(item))],
    ['Completed', textValue(isItemCompleted(item) ? 'true' : 'false')],
    ['CompletedAt', textValue(item.CompletedAt ? formatDateTime(item.CompletedAt) : '')],
    ['CompletedByRole', textValue(item.CompletedByRole)]
  ];
  const known = new Set(['ItemID', 'SourceItemID', 'TripID', 'DatasetID', 'Title', 'ItemType', 'Category', 'StartDate', 'StartTime', 'EndDate', 'EndTime', 'DayDate', 'City', 'Address', 'LocationAddress', 'LocationLabel', 'Latitude', 'Longitude', 'GooglePlusCode', 'GoogleMapsUrl', 'Notes', 'Description', 'Provider', 'Website', 'Url', 'URL', 'Phone', 'PhoneNumber', 'Email', 'AmountUSD', 'PaymentStatus', 'IsPaid', 'PlanningStatus', 'Status', 'Completed', 'CompletedAt', 'CompletedByRole']);
  Object.keys(item).sort().forEach(key => {
    if (known.has(key) || item[key] === undefined || item[key] === null || item[key] === '') return;
    if (typeof item[key] === 'object') return;
    fields.push([key, textValue(item[key])]);
  });
  return fields.filter(([, value]) => value !== '');
}

function compareReportItems(a, b) {
  const dateCompare = getEffectiveAgendaDate(a).localeCompare(getEffectiveAgendaDate(b));
  if (dateCompare !== 0) return dateCompare;
  if (isItemCompleted(a) || isItemCompleted(b)) {
    const completedCompare = String(a.CompletedAt || '').localeCompare(String(b.CompletedAt || ''));
    if (completedCompare !== 0) return completedCompare;
  }
  const timeCompare = (a.StartTime || '').localeCompare(b.StartTime || '');
  if (timeCompare !== 0) return timeCompare;
  return Number(a.SortOrder || 0) - Number(b.SortOrder || 0);
}

function textValue(value) {
  return value === undefined || value === null || value === '' ? '' : escapeHtml(value);
}

function noteValue(value) {
  return value ? `<span class="notes">${escapeHtml(value)}</span>` : '';
}

function urlLink(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return `<a href="${escapeHtml(href)}">${escapeHtml(url)}</a>`;
}

function emailLink(value) {
  const email = String(value || '').trim();
  return email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : '';
}

function phoneLink(value) {
  const phone = String(value || '').trim();
  return phone ? `<a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>` : '';
}

function mapSearchLink(value) {
  const text = String(value || '').trim();
  return text ? `<a href="https://maps.google.com/?q=${encodeURIComponent(text)}">${escapeHtml(text)}</a>` : '';
}

function coordinateLink(item) {
  if (!hasValidCoordinates(item)) return '';
  const text = `${item.Latitude}, ${item.Longitude}`;
  return `<a href="https://maps.google.com/?q=${encodeURIComponent(text)}">${escapeHtml(text)}</a>`;
}

async function handleAuthSubmit(event, mode) {
  event.preventDefault();
  const form = document.getElementById('authForm');
  const email = form?.elements.email.value.trim();
  const password = form?.elements.password.value;
  if (!email || !password) return setAuthMessage('Ingresa email y contraseña.', true);
  if (password.length < 6) return setAuthMessage('La contraseña debe tener al menos 6 caracteres.', true);
  setAuthMessage(mode === 'sign-up' ? 'Creando cuenta...' : 'Iniciando sesión...');
  try {
    const result = mode === 'sign-up'
      ? await signUpWithEmailPassword(email, password)
      : await signInWithEmailPassword(email, password);
    if (result.error) throw result.error;
    state.authUser = result.data.session?.user || (mode === 'sign-in' ? result.data.user : null) || state.authUser;
    state.authError = '';
    state.authMessage = mode === 'sign-up'
      ? 'Cuenta creada. Revisa tu email si Supabase solicita confirmación.'
      : 'Sesión iniciada. Sincronizando datos locales y nube.';
    if (state.authUser) await startCloudSync({ onAppliedRemoteChanges: refreshAfterCloudPull });
    updateSyncStatus();
    await renderSettings();
  } catch (error) {
    setAuthMessage(getAuthErrorMessage(error), true);
  }
}

async function handleSignOut() {
  setAuthMessage('Cerrando sesión...');
  try {
    const result = await signOut();
    if (result.error) throw result.error;
    stopCloudSync();
    state.authUser = null;
    state.authError = '';
    state.authMessage = 'Sesión cerrada. Tus datos locales de IndexedDB se conservan.';
    updateSyncStatus();
    await renderSettings();
  } catch (error) {
    setAuthMessage(getAuthErrorMessage(error), true);
  }
}

function setAuthMessage(message, isError = false) {
  state.authError = isError ? message : '';
  state.authMessage = isError ? '' : message;
  const el = document.getElementById('authMessage');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('data-error', isError);
}

function getAuthErrorMessage(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('failed to fetch') || message.includes('network')) return 'No se pudo conectar con Supabase. La app sigue en modo local.';
  if (message.includes('invalid login') || message.includes('invalid credentials')) return 'Email o contraseña incorrectos.';
  if (message.includes('email not confirmed')) return 'Confirma tu email antes de iniciar sesión.';
  if (message.includes('already registered') || message.includes('already exists')) return 'Ese email ya tiene una cuenta. Intenta iniciar sesión.';
  if (message.includes('password')) return 'Revisa la contraseña e intenta de nuevo.';
  return 'No se pudo completar la autenticación. Intenta de nuevo.';
}

function getTripOptionLabel(trip) {
  const current = isTripCurrent(trip) ? ' · en curso' : '';
  return `${trip.TripTitle || trip.TripName || trip.TripID} · ${trip.StartDate || '?'} / ${trip.EndDate || '?'}${current}`;
}

function isTripCurrent(trip) {
  const today = new Date().toISOString().slice(0, 10);
  return (trip.StartDate || '') <= today && today <= (trip.EndDate || '');
}

function bindTripManager() {
  document.getElementById('activeTripSelect').addEventListener('change', async event => {
    await setActiveTripId(event.target.value);
    await refreshTripsAndDays();
    await loadState();
    state.openDayKey = null;
    state.openItemId = null;
    state.calendarMonth = getInitialCalendarMonth();
    state.calendarMessage = '';
    state.mapFilters = { planning: 'ALL', type: 'ALL', city: 'ALL', date: 'ALL' };
    persistViewState();
    notifyLocalChange('active-trip');
    await render();
  });
  document.getElementById('newTripButton').addEventListener('click', () => openTripEditor());
  document.getElementById('editTripButton').addEventListener('click', () => openTripEditor(state.trips.find(trip => trip.TripID === state.activeTripId)));
}

function openTripEditor(trip = null) {
  if (!canEditApp()) return;
  const editor = document.getElementById('tripEditor');
  const today = new Date().toISOString().slice(0, 10);
  const draft = trip || { TripID: suggestTripId('Nuevo viaje', today), TripName: '', TripTitle: '', StartDate: today, EndDate: today, BudgetAmountUSD: 0, BudgetCurrencyCode: 'USD', Notes: '', IsActive: true };
  const hasRelated = trip && (state.allItems.some(item => item.TripID === trip.TripID) || state.days.some(day => day.TripID === trip.TripID));
  editor.classList.remove('hidden');
  editor.innerHTML = `
    <div class="edit-grid">
      <label>TripID<input id="tripIdInput" value="${escapeHtml(draft.TripID)}"${hasRelated ? ' readonly' : ''} /></label>
      <label>TripName<input id="tripNameInput" value="${escapeHtml(draft.TripName || '')}" /></label>
    </div>
    <label>TripTitle<input id="tripTitleInput" value="${escapeHtml(draft.TripTitle || '')}" /></label>
    <div class="edit-grid">
      <label>StartDate<input id="tripStartInput" type="date" value="${escapeHtml(draft.StartDate || '')}" /></label>
      <label>EndDate<input id="tripEndInput" type="date" value="${escapeHtml(draft.EndDate || '')}" /></label>
    </div>
    <div class="edit-grid">
      <label>BudgetAmountUSD<input id="tripBudgetInput" type="number" min="0" step="0.01" value="${Number(draft.BudgetAmountUSD || 0)}" /></label>
      <label>BudgetCurrencyCode<input id="tripCurrencyInput" value="${escapeHtml(draft.BudgetCurrencyCode || 'USD')}" /></label>
    </div>
    <label>Notes<textarea id="tripNotesInput" rows="2">${escapeHtml(draft.Notes || '')}</textarea></label>
    <label class="inline-check"><input id="tripActiveInput" type="checkbox"${draft.IsActive !== false ? ' checked' : ''} /> IsActive</label>
    <div class="settings-actions"><button id="saveTripButton" class="primary-button" type="button">Guardar viaje</button>${trip ? '<button id="deleteTripFromEditor" class="secondary-button danger-button" type="button">Eliminar viaje</button>' : ''}<button id="cancelTripEdit" class="secondary-button" type="button">Cancelar</button></div>
  `;
  document.getElementById('cancelTripEdit').addEventListener('click', () => editor.classList.add('hidden'));
  document.getElementById('saveTripButton').addEventListener('click', () => saveTripEditor(trip?.TripID || ''));
  document.getElementById('deleteTripFromEditor')?.addEventListener('click', deleteActiveTrip);
}

async function saveTripEditor(originalTripId = '') {
  if (!canEditApp()) return;
  const TripID = document.getElementById('tripIdInput').value.trim();
  const TripName = document.getElementById('tripNameInput').value.trim();
  const TripTitle = document.getElementById('tripTitleInput').value.trim();
  const StartDate = document.getElementById('tripStartInput').value;
  const EndDate = document.getElementById('tripEndInput').value;
  const BudgetAmountUSD = Number(document.getElementById('tripBudgetInput').value || 0);
  const message = document.getElementById('tripMessage');
  const existing = state.trips.find(trip => trip.TripID === TripID);
  if (!TripID) return setInlineMessage(message, 'TripID requerido.', true);
  if (!TripName && !TripTitle) return setInlineMessage(message, 'Nombre requerido.', true);
  if (existing && TripID !== originalTripId) return setInlineMessage(message, 'TripID duplicado.', true);
  if (!isValidDate(StartDate)) return setInlineMessage(message, 'StartDate inválida.', true);
  if (!isValidDate(EndDate) || EndDate < StartDate) return setInlineMessage(message, 'EndDate inválida.', true);
  if (Number.isNaN(BudgetAmountUSD) || BudgetAmountUSD < 0) return setInlineMessage(message, 'Presupuesto inválido.', true);
  const now = new Date().toISOString();
  await saveTrip(stampLocalChange({ ...(existing || {}), TripID, TripName, TripTitle, StartDate, EndDate, BudgetAmount: BudgetAmountUSD, BudgetAmountUSD, BudgetCurrencyCode: document.getElementById('tripCurrencyInput').value.trim() || 'USD', Notes: document.getElementById('tripNotesInput').value.trim(), IsActive: document.getElementById('tripActiveInput').checked, CreatedAt: existing?.CreatedAt || now }, now));
  markLocalEntity('TRIP', TripID);
  await setActiveTripId(TripID);
  await refreshTripsAndDays();
  await loadState();
  notifyLocalChange('trip-save');
  await render();
}

function suggestTripId(name, date) {
  const clean = String(name || 'VIAJE').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase() || 'VIAJE';
  return `TRIP_${clean}_${String(date || new Date().toISOString()).slice(0, 4)}`;
}

async function deleteActiveTrip() {
  if (!canEditApp()) return;
  const trip = state.trips.find(row => row.TripID === state.activeTripId);
  if (!trip) return;
  const itemCount = state.allItems.filter(item => item.TripID === trip.TripID).length;
  const days = await getTripDays(trip.TripID);
  const message = document.getElementById('tripMessage');
  if (itemCount > 0) return setInlineMessage(message, `Este viaje todavía tiene ${itemCount} items. Debe borrarlos primero.`, true);
  if (days.length > 0) return setInlineMessage(message, `Este viaje todavía tiene ${days.length} días. Debe borrarlos primero.`, true);
  if (!confirm(`Eliminar viaje ${trip.TripID}? Esta acción no se puede deshacer.`)) return;
  await createDataSnapshot('Antes de eliminar viaje');
  await recordDeletion('TRIP', trip.TripID, trip.TripID, trip);
  await deleteTrip(trip.TripID);
  markLocalEntity('TRIP', trip.TripID);
  state.trips = await getAllTrips();
  await setActiveTripId(selectDefaultTrip(state.trips) || '');
  await refreshTripsAndDays();
  await loadState();
  notifyLocalChange('trip-delete');
  await render();
}

function setInlineMessage(el, message, isError = false) {
  el.textContent = message;
  el.classList.toggle('data-error', isError);
}

function renderTripDayAdminList() {
  if (!state.days.length) return '<p class="placeholder-note">Este viaje no tiene días todavía.</p>';
  return state.days.map(day => `
    <article class="admin-row">
      <div><strong>${escapeHtml(day.Date || day.DayDate)}</strong><span>${escapeHtml(day.DayLabel || 'Día')} · ${escapeHtml(day.Title || '')} · ${escapeHtml(day.PrimaryCity || day.City || '')}</span></div>
      <div class="settings-actions"><button type="button" data-edit-day="${escapeHtml(day.TripDayID)}">Editar</button><button class="danger-button" type="button" data-delete-day="${escapeHtml(day.TripDayID)}">Eliminar</button></div>
    </article>
  `).join('');
}

function bindDayManager() {
  document.getElementById('toggleDaysPanel').addEventListener('click', async () => {
    state.daysPanelOpen = !state.daysPanelOpen;
    await renderSettings();
  });
  document.getElementById('addTripDayButton')?.addEventListener('click', () => openDayEditor());
  document.querySelectorAll('[data-edit-day]').forEach(button => button.addEventListener('click', () => openDayEditor(state.days.find(day => day.TripDayID === button.dataset.editDay))));
  document.querySelectorAll('[data-delete-day]').forEach(button => button.addEventListener('click', () => deleteDay(button.dataset.deleteDay)));
}

function openDayEditor(day = null) {
  if (!canEditApp()) return;
  const editor = document.getElementById('dayEditor');
  const trip = state.trips.find(row => row.TripID === state.activeTripId);
  const nextDate = day?.Date || day?.DayDate || trip?.StartDate || new Date().toISOString().slice(0, 10);
  const draft = day || { TripDayID: makeTripDayId(state.activeTripId, nextDate), TripID: state.activeTripId, DayOrder: state.days.length + 1, Date: nextDate, DayLabel: `Día ${state.days.length + 1}`, Title: '', PrimaryCity: '', PrimaryCountryCode: '', DayNotes: '', DayImageUrl: '' };
  editor.classList.remove('hidden');
  editor.innerHTML = `
    <label>TripDayID<input id="dayIdInput" value="${escapeHtml(draft.TripDayID)}" readonly /></label>
    <div class="edit-grid">
      <label>DayOrder<input id="dayOrderInput" type="number" min="0" value="${Number(draft.DayOrder || 0)}" /></label>
      <label>Date<input id="dayDateInput" type="date" value="${escapeHtml(draft.Date || draft.DayDate || '')}" /></label>
    </div>
    <div class="edit-grid">
      <label>DayLabel<input id="dayLabelInput" value="${escapeHtml(draft.DayLabel || '')}" /></label>
      <label>Title<input id="dayTitleInput" value="${escapeHtml(draft.Title || '')}" /></label>
    </div>
    <div class="edit-grid">
      <label>PrimaryCity<input id="dayCityInput" value="${escapeHtml(draft.PrimaryCity || draft.City || '')}" /></label>
      <label>PrimaryCountryCode<input id="dayCountryInput" value="${escapeHtml(draft.PrimaryCountryCode || draft.CountryCode || '')}" /></label>
    </div>
    <label>DayNotes<textarea id="dayNotesInput" rows="2">${escapeHtml(draft.DayNotes || draft.Notes || '')}</textarea></label>
    <label>DayImageUrl<input id="dayImageInput" value="${escapeHtml(draft.DayImageUrl || '')}" /></label>
    <div class="settings-actions"><button id="saveDayButton" class="primary-button" type="button">Guardar día</button><button id="cancelDayEdit" class="secondary-button" type="button">Cancelar</button></div>
  `;
  document.getElementById('cancelDayEdit').addEventListener('click', () => editor.classList.add('hidden'));
  document.getElementById('saveDayButton').addEventListener('click', () => saveDayEditor(day?.TripDayID || ''));
}

async function saveDayEditor(originalDayId = '') {
  if (!canEditApp()) return;
  const DateValue = document.getElementById('dayDateInput').value;
  const message = document.getElementById('dayMessage');
  if (!isValidDate(DateValue)) return setInlineMessage(message, 'Fecha inválida.', true);
  const TripDayID = originalDayId || makeTripDayId(state.activeTripId, DateValue);
  if (!originalDayId && state.days.some(day => day.TripDayID === TripDayID)) return setInlineMessage(message, 'TripDayID duplicado.', true);
  const now = new Date().toISOString();
  await saveTripDay(stampLocalChange({ TripDayID, TripID: state.activeTripId, DayOrder: Number(document.getElementById('dayOrderInput').value || 0), Date: DateValue, DayLabel: document.getElementById('dayLabelInput').value.trim(), Title: document.getElementById('dayTitleInput').value.trim(), PrimaryCity: document.getElementById('dayCityInput').value.trim(), PrimaryCountryCode: document.getElementById('dayCountryInput').value.trim(), DayNotes: document.getElementById('dayNotesInput').value.trim(), DayImageUrl: document.getElementById('dayImageInput').value.trim(), CreatedAt: state.days.find(day => day.TripDayID === originalDayId)?.CreatedAt || now }, now));
  markLocalEntity('TRIP_DAY', TripDayID);
  await refreshTripsAndDays();
  notifyLocalChange('day-save');
  await render();
}

async function deleteDay(TripDayID) {
  if (!canEditApp()) return;
  const day = state.days.find(row => row.TripDayID === TripDayID);
  if (!day) return;
  const date = day.Date || day.DayDate;
  const assigned = getItemsAssignedToDate(date);
  const message = document.getElementById('dayMessage');
  if (assigned.length) {
    return setInlineMessage(message, `Primero debe borrar o mover todos los items asignados a este día. (${assigned.length}: ${assigned.map(item => `${getLogicalKey(item)} ${item.Title || ''}`).join(', ')})`, true);
  }
  if (!confirm(`Eliminar día ${date}?`)) return;
  await createDataSnapshot('Antes de eliminar día');
  await recordDeletion('TRIP_DAY', TripDayID, day.TripID || state.activeTripId, day);
  await deleteTripDay(TripDayID);
  markLocalEntity('TRIP_DAY', TripDayID);
  await refreshTripsAndDays();
  await loadState();
  notifyLocalChange('day-delete');
  await render();
}

function getItemsAssignedToDate(date) {
  return uniqueFinancialItems(state.items).filter(item => dateInItemRange(date, item));
}

function dateInItemRange(date, item) {
  const start = item.StartDate || item.DayDate || '';
  const end = item.EndDate || start;
  if (!start || !end || end < start) return false;
  return start <= date && date <= end;
}

function itemBelongsOnAgendaDate(item, date) {
  if (isItemCompleted(item)) return getEffectiveAgendaDate(item) === date;
  return dateInItemRange(date, item);
}

function isItemCompleted(item) {
  const value = item?.Completed;
  return value === true || String(value || '').toLowerCase() === 'true';
}

function getEffectiveAgendaDate(item) {
  if (isItemCompleted(item) && item.CompletedAt) return isoDatePart(item.CompletedAt);
  return item.DayDate || item.StartDate || '';
}

function getCompletedTime(item) {
  if (!item.CompletedAt) return '';
  const date = new Date(item.CompletedAt);
  if (Number.isNaN(date.getTime())) return String(item.CompletedAt).slice(11, 16);
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function isoDatePart(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '').slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function makeTripDayId(tripId, date) {
  return `TD_${tripId}_${String(date || '').replaceAll('-', '_')}`;
}

function buildTripAudit() {
  const errors = [];
  const warnings = [];
  const info = [];
  const dayDates = new Set(state.days.map(day => day.Date || day.DayDate));
  const dayIds = new Set();
  const seenDayDates = new Set();
  for (const day of state.days) {
    const date = day.Date || day.DayDate;
    if (dayIds.has(day.TripDayID)) warnings.push(dayIssue(day, 'TripDayID duplicado.'));
    dayIds.add(day.TripDayID);
    if (seenDayDates.has(date)) warnings.push(dayIssue(day, 'Fecha duplicada en TripDays.'));
    seenDayDates.add(date);
    if (getItemsAssignedToDate(date).length === 0) info.push(dayIssue(day, 'Día sin items.'));
  }
  const physicalIds = new Set();
  for (const item of state.items) {
    const key = getLogicalKey(item);
    if (!item.ItemID) errors.push(itemIssue(item, 'ItemID faltante.'));
    if (physicalIds.has(item.ItemID)) errors.push(itemIssue(item, 'ItemID físico duplicado.'));
    physicalIds.add(item.ItemID);
    if (item.TripID !== state.activeTripId) errors.push(itemIssue(item, 'TripID inconsistente.'));
    ['TripID', 'Title', 'StartDate', 'ItemType'].forEach(field => {
      if (!item[field]) errors.push(itemIssue(item, `${field} faltante.`));
    });
    const start = item.StartDate || item.DayDate || '';
    const end = item.EndDate || start;
    if (end && start && end < start) errors.push(itemIssue(item, 'EndDate anterior a StartDate.'));
    if (start && !dayDates.has(start)) errors.push(itemIssue(item, 'StartDate sin TripDay válido.'));
    for (const date of enumerateDates(start, end)) {
      if (!dayDates.has(date)) errors.push(itemIssue(item, `Rango multiday con fecha faltante: ${date}.`));
    }
    if (item.AmountUSD === '' || item.AmountUSD === null || item.AmountUSD === undefined || Number.isNaN(Number(item.AmountUSD)) || Number(item.AmountUSD) < 0) errors.push(itemIssue(item, 'AmountUSD inválido.'));
    if (Number(item.AmountUSD) === 0) warnings.push(itemIssue(item, 'Precio $0.00 — confirmar si es gratuito.'));
    if (!PLANNING_STATUSES.includes(getItemPlanningStatus(item))) errors.push(itemIssue(item, 'PlanningStatus inválido.'));
    if (!isAllowedItemId(key)) errors.push(itemIssue(item, 'Formato ItemID inválido.'));
    if (ALLOWED_LEGACY_ITEM_IDS.has(key)) warnings.push(itemIssue(item, 'ItemID legacy permitido; no modificar automáticamente.'));
    const trip = state.trips.find(row => row.TripID === state.activeTripId);
    if (trip && start && (start < trip.StartDate || start > trip.EndDate)) warnings.push(itemIssue(item, 'Item fuera del rango del Trip.'));
  }
  return { errors, warnings, info };
}

function itemIssue(item, problem) {
  return { type: 'item', id: getLogicalKey(item), title: item.Title || 'Sin título', problem, detail: `${item.StartDate || item.DayDate || 'Sin fecha'} · ${item.ItemType || 'Sin tipo'}` };
}

function dayIssue(day, problem) {
  return { type: 'day', id: day.TripDayID, date: day.Date || day.DayDate, title: day.Title || day.DayLabel || 'Día', problem, detail: day.PrimaryCity || day.City || '' };
}

function enumerateDates(start, end) {
  if (!isValidDate(start) || !isValidDate(end) || end < start) return [];
  const dates = [];
  const cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function renderAudit(audit) {
  return ['errors', 'warnings', 'info'].map(group => renderAuditGroup(group, audit[group])).join('');
}

function renderAuditGroup(group, issues) {
  const label = { errors: 'Errores', warnings: 'Advertencias', info: 'Informativos' }[group];
  if (!issues.length) return `<section class="audit-group"><h3>${label}</h3><p class="placeholder-note">Sin registros.</p></section>`;
  return `<section class="audit-group"><h3>${label}</h3>${issues.map(issue => `
    <details class="audit-issue" data-issue-type="${issue.type}" data-issue-id="${escapeHtml(issue.id)}">
      <summary><strong>${escapeHtml(issue.id || issue.date)}</strong><span>${escapeHtml(issue.title)} · ${escapeHtml(issue.problem)}</span></summary>
      <div class="breakdown-meta"><span>${escapeHtml(issue.detail || '')}</span></div>
      <div class="settings-actions">
        ${issue.type === 'item' ? `<button type="button" data-audit-edit-item="${escapeHtml(issue.id)}">Editar</button><button class="danger-button" type="button" data-audit-delete-item="${escapeHtml(issue.id)}">Eliminar item</button>` : ''}
        ${issue.type === 'day' ? `<button type="button" data-audit-edit-day="${escapeHtml(issue.id)}">Editar día</button><button class="danger-button" type="button" data-audit-delete-day="${escapeHtml(issue.id)}">Eliminar día</button>` : ''}
      </div>
    </details>`).join('')}</section>`;
}

function bindAuditManager() {
  document.getElementById('toggleAuditPanel').addEventListener('click', async () => {
    state.auditPanelOpen = !state.auditPanelOpen;
    await renderSettings();
  });
  document.getElementById('refreshAuditButton')?.addEventListener('click', () => renderSettings());
  document.querySelectorAll('[data-audit-edit-item]').forEach(button => button.addEventListener('click', () => {
    const item = state.items.find(row => getLogicalKey(row) === button.dataset.auditEditItem);
    if (item) openEditModal(item);
  }));
  document.querySelectorAll('[data-audit-delete-item]').forEach(button => button.addEventListener('click', () => {
    const item = state.items.find(row => getLogicalKey(row) === button.dataset.auditDeleteItem);
    if (item) deleteLogicalItem(item);
  }));
  document.querySelectorAll('[data-audit-edit-day]').forEach(button => button.addEventListener('click', () => {
    state.daysPanelOpen = true;
    document.getElementById('daysPanelBody')?.classList.remove('hidden');
    const day = state.days.find(row => row.TripDayID === button.dataset.auditEditDay);
    if (day) openDayEditor(day);
  }));
  document.querySelectorAll('[data-audit-delete-day]').forEach(button => button.addEventListener('click', () => deleteDay(button.dataset.auditDeleteDay)));
  document.querySelectorAll('.audit-issue[data-issue-type="item"]').forEach(el => {
    let timer = null;
    const open = () => {
      const item = state.items.find(row => getLogicalKey(row) === el.dataset.issueId);
      if (item) openEditModal(item);
    };
    el.addEventListener('contextmenu', event => {
      event.preventDefault();
      open();
    });
    el.addEventListener('pointerdown', () => {
      timer = window.setTimeout(open, 600);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(type => el.addEventListener(type, () => window.clearTimeout(timer)));
  });
}

function bindBackupManager() {
  document.getElementById('exportBackupButton').addEventListener('click', exportBackup);
  document.getElementById('exportActiveTripBackupButton').addEventListener('click', exportActiveTripBackup);
  document.getElementById('importBackupButton').addEventListener('click', () => document.getElementById('backupFileInput').click());
  document.getElementById('backupFileInput').addEventListener('change', readBackupFile);
  document.getElementById('showSnapshotsButton').addEventListener('click', renderSnapshotList);
  document.getElementById('restoreSnapshotButton').addEventListener('click', renderSnapshotList);
}

async function exportBackup() {
  const backup = await buildBackupPayload();
  downloadJson(backup, `travelmanager3-backup-${formatBackupStamp(new Date())}.json`);
  setBackupMessage('Backup completo exportado.');
}

async function exportActiveTripBackup() {
  const backup = await buildBackupPayload(true);
  downloadJson(backup, `travelmanager3-${state.activeTripId}-backup-${formatBackupStamp(new Date())}.json`);
  setBackupMessage('Backup del viaje activo exportado.');
}

async function buildBackupPayload(activeOnly = false) {
  const activeTripId = await getActiveTripId();
  const allTrips = await getAllTrips();
  const trips = activeOnly ? allTrips.filter(trip => trip.TripID === activeTripId) : allTrips;
  const tripDays = (await Promise.all(trips.map(trip => getTripDays(trip.TripID)))).flat();
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    datasetId: getActiveDatasetId(),
    activeTripId,
    trips,
    tripDays,
    trip: await getTripMetadata(),
    items: getLogicalExportItems(activeOnly ? state.items : state.allItems),
    budget: { tripBudgetUSD: await getActiveTripBudget() },
    preferences: {
      activeDatasetMark: localStorage.getItem(ITALY_DATASET_MARK_KEY) || '',
      days: state.days
    },
    snapshots: getSnapshots().map(snapshot => ({
      id: snapshot.id,
      timestamp: snapshot.timestamp,
      reason: snapshot.reason,
      itemCount: snapshot.items?.length || 0,
      datasetId: snapshot.datasetId
    }))
  };
}

function getLogicalExportItems(items = state.items) {
  const unique = new Map();
  for (const item of items) {
    const key = getLogicalKey(item);
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].map(item => ({ ...item, ItemID: getLogicalKey(item), SourceItemID: getLogicalKey(item) }));
}

async function getTripMetadata() {
  const activeTripId = await getActiveTripId();
  const trip = activeTripId ? await getTrip(activeTripId) : null;
  return trip || {
    TripID: 'TRIP_ITALY_2026',
    TripTitle: 'Italy 2026',
    dayCount: state.days.length,
    StartDate: state.days[0]?.DayDate || '',
    EndDate: state.days[state.days.length - 1]?.DayDate || ''
  };
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function readBackupFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  state.pendingBackup = null;
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const validation = validateBackupPayload(data);
    state.pendingBackup = validation.errors.length ? null : data;
    renderBackupPreview(data, validation);
  } catch (error) {
    renderBackupPreview(null, { errors: ['JSON corrupto o ilegible.'], warnings: [], summary: null, conflicts: [] });
  }
}

function validateBackupPayload(data) {
  const errors = [];
  const warnings = [];
  const conflicts = [];
  if (!data || typeof data !== 'object') errors.push('El archivo no contiene un objeto JSON válido.');
  if (data?.schemaVersion !== BACKUP_SCHEMA_VERSION) errors.push(`schemaVersion inválido. Esperado: ${BACKUP_SCHEMA_VERSION}.`);
  if (!Array.isArray(data?.items)) errors.push('items debe ser una lista.');
  if (data?.exportedAt && Number.isNaN(new Date(data.exportedAt).getTime())) errors.push('exportedAt inválido.');
  const seen = new Set();
  const reservedIds = new Set();
  const localKeys = new Set(getLogicalRows().map(row => row.ItemID));
  (data?.items || []).forEach((item, index) => {
    const key = getLogicalKey(item);
    if (!key) {
      try {
        reservedIds.add(getNextItemId(reservedIds));
      } catch (error) {
        errors.push(`items[${index}]: ${error.message}`);
      }
    } else {
      if (!isAllowedItemId(key)) errors.push(`items[${index}]: ItemID debe usar formato ITEM_XXX.`);
      if (seen.has(key)) errors.push(`items[${index}]: ItemID duplicado (${key}).`);
      seen.add(key);
      if (localKeys.has(key)) conflicts.push(key);
    }
    if (!isValidDate(item.StartDate || item.DayDate)) errors.push(`items[${index}]: fecha inválida.`);
    if (item.EndDate && !isValidDate(item.EndDate)) errors.push(`items[${index}]: EndDate inválida.`);
    const amount = Number(item.AmountUSD || 0);
    if (Number.isNaN(amount) || amount < 0) errors.push(`items[${index}]: AmountUSD inválido.`);
    if (!PLANNING_STATUSES.includes(item.PlanningStatus || getPlanningStatus(item.Status))) errors.push(`items[${index}]: PlanningStatus inválido.`);
    if (item.PaymentStatus && !PAYMENT_STATUSES.includes(item.PaymentStatus)) errors.push(`items[${index}]: PaymentStatus inválido.`);
  });
  const budget = Number(data?.budget?.tripBudgetUSD ?? data?.trips?.[0]?.BudgetAmountUSD ?? 0);
  if (Number.isNaN(budget) || budget < 0) errors.push('Presupuesto inválido.');
  if (!data?.datasetId) warnings.push('datasetId no incluido.');
  return { errors, warnings, conflicts: [...new Set(conflicts)], summary: getBackupSummary(data) };
}

function getBackupSummary(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    items: items.length,
    confirmed: items.filter(item => (item.PlanningStatus || getPlanningStatus(item.Status)) === 'CONFIRMED').length,
    proposed: items.filter(item => (item.PlanningStatus || getPlanningStatus(item.Status)) === 'PROPOSED').length,
    budget: Number(data?.budget?.tripBudgetUSD ?? data?.trips?.[0]?.BudgetAmountUSD ?? 0),
    exportedAt: data?.exportedAt || '',
    datasetId: data?.datasetId || ''
  };
}

function renderBackupPreview(data, validation) {
  const preview = document.getElementById('backupPreview');
  preview.classList.remove('hidden');
  const summary = validation.summary;
  preview.innerHTML = `
    <h3>Resumen previo</h3>
    ${summary ? `<div class="backup-summary">
      <span>Items: <strong>${summary.items}</strong></span>
      <span>Confirmados: <strong>${summary.confirmed}</strong></span>
      <span>Propuestos: <strong>${summary.proposed}</strong></span>
      <span>Presupuesto: <strong>${formatMoney(summary.budget)}</strong></span>
      <span>Fecha backup: <strong>${escapeHtml(formatDateTime(summary.exportedAt))}</strong></span>
      <span>datasetId: <strong>${escapeHtml(summary.datasetId || 'Sin dato')}</strong></span>
    </div>` : ''}
    ${renderIssueList('Errores', validation.errors)}
    ${renderIssueList('Advertencias', validation.warnings)}
    ${renderIssueList('Conflictos ItemID', validation.conflicts)}
    ${validation.errors.length ? '' : renderImportActions(validation.conflicts)}
  `;
  preview.querySelector('[data-import-replace]')?.addEventListener('click', () => applyBackupReplace(data));
  preview.querySelector('[data-import-merge]')?.addEventListener('click', () => applyBackupMerge(data));
}

function renderIssueList(title, items) {
  if (!items.length) return '';
  return `<div class="${title === 'Errores' ? 'data-error' : 'backup-warn'}"><strong>${title}</strong><ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;
}

function renderImportActions(conflicts) {
  return `
    <div class="import-actions">
      <button class="primary-button danger-button" type="button" data-import-replace>Reemplazar data actual</button>
      <button class="secondary-button" type="button" data-import-merge>Combinar</button>
    </div>
    ${conflicts.length ? `<div class="conflict-list">${conflicts.map(key => `
      <label><span>${escapeHtml(key)}</span><select data-conflict-key="${escapeHtml(key)}"><option value="local">Conservar local</option><option value="imported">Usar importado</option></select></label>
    `).join('')}</div>` : ''}
  `;
}

async function applyBackupReplace(data) {
  if (!state.pendingBackup || !confirm('Reemplazar data actual con este backup? Se creará un snapshot antes.')) return;
  await createDataSnapshot('Antes de reemplazar por backup');
  await restoreDatasetPayload(data);
  notifyLocalChange('backup-replace');
  setBackupMessage('Backup restaurado en modo reemplazar.');
}

async function applyBackupMerge(data) {
  if (!state.pendingBackup || !confirm('Combinar backup con la data actual? Se creará un snapshot antes.')) return;
  await createDataSnapshot('Antes de combinar backup');
  await restoreTripMetadata(data);
  const choices = getConflictChoices();
  const localKeys = new Set(getLogicalRows().map(row => row.ItemID));
  const reservedIds = new Set();
  for (const imported of data.items) {
    const key = getLogicalKey(imported);
    if (!localKeys.has(key) || choices.get(key) === 'imported') {
      const normalized = normalizeImportedItem(imported, reservedIds);
      reservedIds.add(normalized.ItemID);
      await upsertLogicalRow(localKeys.has(normalized.ItemID) ? normalized.ItemID : '', normalized);
      await loadState();
    }
  }
  await loadState();
  els.statusSync.textContent = 'Backup combinado';
  notifyLocalChange('backup-merge');
  await render();
  setBackupMessage('Backup combinado. Los conflictos se resolvieron según tu selección.');
}

function getConflictChoices() {
  return new Map([...document.querySelectorAll('[data-conflict-key]')].map(select => [select.dataset.conflictKey, select.value]));
}

async function restoreDatasetPayload(payload) {
  const items = payload.items || [];
  await restoreTripMetadata(payload);
  const reservedIds = new Set();
  const restored = items.map(item => {
    const normalized = normalizeImportedItem(item, reservedIds);
    reservedIds.add(normalized.ItemID);
    const now = new Date().toISOString();
    return stampLocalChange(buildItemFromData(normalized, now), now);
  });
  await replaceDatasetItems(restored, isActiveDatasetItem);
  restored.forEach(item => markLocalEntity('ITEM', item.ItemID));
  if (Array.isArray(payload.preferences?.days)) {
    state.days = payload.preferences.days;
    localStorage.setItem(ITALY_DAYS_KEY, JSON.stringify(state.days));
  }
  state.days = toAppDays(await getTripDays(await getActiveTripId()), state.days);
  localStorage.setItem(ITALY_DAYS_KEY, JSON.stringify(state.days));
  localStorage.setItem(ITALY_DATASET_MARK_KEY, payload.datasetId || getActiveDatasetId());
  await loadState();
  state.openDayKey = null;
  state.openItemId = null;
  els.statusSync.textContent = 'Data local restaurada';
  notifyLocalChange('backup-restore');
  await render();
}

function normalizeImportedItem(item, reservedIds = new Set()) {
  const key = getLogicalKey(item) || getNextItemId(reservedIds);
  return {
    ItemID: key,
    TripID: item.TripID || state.activeTripId || 'TRIP_ITALY_2026',
    StartDate: item.StartDate || item.DayDate,
    EndDate: item.EndDate || item.StartDate || item.DayDate,
    StartTime: item.StartTime || '',
    EndTime: item.EndTime || '',
    ItemType: ITEM_TYPES.includes(item.ItemType) ? item.ItemType : 'OTHER',
    Title: item.Title || 'Sin título',
    City: item.City || '',
    AmountUSD: Number(item.AmountUSD || 0),
    PlanningStatus: item.PlanningStatus || getPlanningStatus(item.Status),
    PaymentStatus: item.PaymentStatus || 'NOT_PAID',
    IsPaid: item.IsPaid === true || item.PaymentStatus === 'PAID',
    Completed: isItemCompleted(item),
    CompletedAt: item.CompletedAt || '',
    CompletedByRole: item.CompletedByRole || '',
    GooglePlusCode: item.GooglePlusCode || '',
    GoogleMapsUrl: item.GoogleMapsUrl || '',
    Notes: item.Notes || ''
  };
}

async function restoreTripMetadata(payload) {
  const trips = getBackupTrips(payload);
  const tripDays = getBackupTripDays(payload, trips[0]?.TripID || 'TRIP_ITALY_2026');
  for (const trip of trips) {
    const existing = await getTrip(trip.TripID);
    const now = new Date().toISOString();
    await saveTrip(stampLocalChange({
      ...existing,
      ...trip,
      CreatedAt: existing?.CreatedAt || trip.CreatedAt || new Date().toISOString(),
      IsActive: trip.IsActive !== false
    }, now));
    markLocalEntity('TRIP', trip.TripID);
  }
  for (const day of tripDays) {
    const now = new Date().toISOString();
    await saveTripDay(stampLocalChange({
      ...day,
      CreatedAt: day.CreatedAt || now
    }, now));
    markLocalEntity('TRIP_DAY', day.TripDayID || day.DayID);
  }
  await setActiveTripId(payload.activeTripId || trips[0]?.TripID || 'TRIP_ITALY_2026');
}

function getBackupTrips(payload) {
  if (Array.isArray(payload.trips) && payload.trips.length) return payload.trips;
  const budget = Number(payload.budget?.tripBudgetUSD ?? payload.trip?.BudgetAmountUSD ?? payload.trip?.BudgetAmount ?? 6000);
  return [{
    TripID: payload.trip?.TripID || payload.trip?.tripId || 'TRIP_ITALY_2026',
    TripName: payload.trip?.TripName || 'Italy_2026',
    TripTitle: payload.trip?.TripTitle || payload.trip?.title || 'Italy 2026',
    StartDate: payload.trip?.StartDate || payload.trip?.startDate || state.days[0]?.DayDate || '',
    EndDate: payload.trip?.EndDate || payload.trip?.endDate || state.days[state.days.length - 1]?.DayDate || '',
    BudgetAmount: budget,
    BudgetCurrencyCode: payload.trip?.BudgetCurrencyCode || 'USD',
    BudgetAmountUSD: budget,
    Notes: payload.trip?.Notes || '',
    IsActive: true
  }];
}

function getBackupTripDays(payload, tripId) {
  if (Array.isArray(payload.tripDays) && payload.tripDays.length) return payload.tripDays;
  const sourceDays = Array.isArray(payload.preferences?.days) ? payload.preferences.days : state.days;
  return sourceDays.map((day, index) => ({
    TripDayID: day.TripDayID || day.DayID || `TD_${tripId}_${day.DayDate || day.Date}`,
    TripID: day.TripID || tripId,
    DayOrder: day.DayOrder || index + 1,
    Date: day.Date || day.DayDate,
    DayLabel: day.DayLabel || '',
    Title: day.Title || '',
    PrimaryCity: day.PrimaryCity || day.City || '',
    PrimaryCountryCode: day.PrimaryCountryCode || day.CountryCode || '',
    DayNotes: day.DayNotes || day.Notes || '',
    DayImageUrl: day.DayImageUrl || ''
  }));
}

function bindDataManager() {
  const table = document.getElementById('dataManagerTable');
  const search = document.getElementById('dataSearch');
  document.getElementById('addDataRow').addEventListener('click', () => addLogicalRow());
  document.getElementById('pasteDataRows').addEventListener('click', openPastePreview);
  search.addEventListener('input', () => {
    table.innerHTML = renderDataTable(getFilteredLogicalRows(search.value));
  });
  table.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('[data-field]')) {
      event.preventDefault();
      saveDataRow(event.target.closest('[data-key]'));
    }
  });
  table.addEventListener('click', event => {
    const row = event.target.closest('[data-key]');
    if (!row) return;
    if (event.target.matches('[data-save-row]')) saveDataRow(row);
    if (event.target.matches('[data-duplicate-row]')) duplicateDataRow(row);
    if (event.target.matches('[data-delete-row]')) deleteDataRow(row);
  });
}

function renderDataTable(rows) {
  const sorted = [...rows].sort((a, b) => (a.StartDate || '').localeCompare(b.StartDate || '') || (a.StartTime || '').localeCompare(b.StartTime || '') || a.ItemID.localeCompare(b.ItemID));
  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr>${DATA_COLUMNS.map(column => `<th>${column}</th>`).join('')}<th>Acciones</th></tr></thead>
        <tbody>
          ${sorted.map(row => renderDataRow(row)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderDataRow(row) {
  return `
    <tr data-key="${escapeHtml(row._key)}" data-original-item-id="${escapeHtml(row.ItemID)}">
      ${DATA_COLUMNS.map(column => `<td data-label="${column}">${renderDataCell(column, row[column])}</td>`).join('')}
      <td class="row-actions"><button type="button" data-save-row>Guardar</button><button type="button" data-duplicate-row>Duplicar</button><button type="button" data-delete-row>Eliminar</button></td>
    </tr>
  `;
}

function renderDataCell(column, value) {
  if (column === 'ItemType') return `<select data-field="${column}">${ITEM_TYPES.map(option => `<option value="${option}"${value === option ? ' selected' : ''}>${option}</option>`).join('')}</select>`;
  if (column === 'PlanningStatus') return `<select data-field="${column}">${PLANNING_STATUSES.map(option => `<option value="${option}"${value === option ? ' selected' : ''}>${option}</option>`).join('')}</select>`;
  if (column === 'PaymentStatus') return `<select data-field="${column}">${PAYMENT_STATUSES.map(option => `<option value="${option}"${value === option ? ' selected' : ''}>${option}</option>`).join('')}</select>`;
  if (column === 'IsPaid' || column === 'Completed') return `<select data-field="${column}"><option value="false"${value ? '' : ' selected'}>false</option><option value="true"${value ? ' selected' : ''}>true</option></select>`;
  const type = column === 'AmountUSD' ? 'number' : column.endsWith('Date') ? 'date' : 'text';
  const step = column === 'AmountUSD' ? ' step="0.01" min="0"' : '';
  return `<input data-field="${column}" type="${type}"${step} value="${escapeHtml(value ?? '')}" />`;
}

function getFilteredLogicalRows(query) {
  const text = String(query || '').trim().toLowerCase();
  const rows = getLogicalRows();
  if (!text) return rows;
  return rows.filter(row => [row.ItemID, row.Title, row.City].some(value => String(value || '').toLowerCase().includes(text)));
}

function getLogicalRows() {
  return uniqueFinancialItems(state.items).map(item => ({
    _key: getLogicalKey(item),
    ItemID: getLogicalKey(item),
    StartDate: item.StartDate || item.DayDate || '',
    EndDate: item.EndDate || item.StartDate || item.DayDate || '',
    StartTime: item.StartTime || '',
    EndTime: item.EndTime || '',
    ItemType: item.ItemType || 'OTHER',
    Title: item.Title || '',
    City: item.City || '',
    AmountUSD: Number(item.AmountUSD || 0),
    PlanningStatus: getItemPlanningStatus(item),
    PaymentStatus: item.PaymentStatus || 'NOT_PAID',
    IsPaid: item.IsPaid === true,
    Completed: isItemCompleted(item),
    CompletedAt: item.CompletedAt || '',
    CompletedByRole: item.CompletedByRole || '',
    GooglePlusCode: item.GooglePlusCode || '',
    GoogleMapsUrl: item.GoogleMapsUrl || '',
    Notes: item.Notes || ''
  }));
}

function getUsedItemNumbers(extraIds = new Set()) {
  const numbers = new Set();
  [...state.allItems.map(item => getLogicalKey(item)), ...extraIds].forEach(id => {
    if (!ITEM_ID_PATTERN.test(id || '')) return;
    numbers.add(Number(id.slice(5)));
  });
  return numbers;
}

function isAllowedItemId(id) {
  return ITEM_ID_PATTERN.test(id || '') || ALLOWED_LEGACY_ITEM_IDS.has(id);
}

function getNextItemId(extraIds = new Set()) {
  const used = getUsedItemNumbers(extraIds);
  for (let number = 1; number <= 999; number += 1) {
    if (!used.has(number)) return `ITEM_${String(number).padStart(3, '0')}`;
  }
  throw new Error('Se superó ITEM_999; se requiere decisión de CHATGPT+.');
}

function getItemIdGapSummary() {
  const used = [...getUsedItemNumbers()].sort((a, b) => a - b);
  if (used.length === 0) return [];
  const gaps = [];
  for (let number = 1; number < used[used.length - 1]; number += 1) {
    if (!used.includes(number)) gaps.push(`ITEM_${String(number).padStart(3, '0')}`);
  }
  return gaps;
}

function readDataRow(rowEl) {
  const data = {};
  DATA_COLUMNS.forEach(column => {
    const input = rowEl.querySelector(`[data-field="${column}"]`);
    data[column] = input ? input.value.trim() : '';
  });
  if (!data.ItemID) data.ItemID = getNextItemId();
  data.AmountUSD = Number(data.AmountUSD || 0);
  data.IsPaid = data.IsPaid === 'true';
  data.Completed = data.Completed === 'true';
  data.CompletedAt = data.Completed ? data.CompletedAt : '';
  data.CompletedByRole = data.Completed ? data.CompletedByRole : '';
  return data;
}

async function saveDataRow(rowEl) {
  if (!canEditApp()) return;
  const originalKey = rowEl.dataset.key;
  let data;
  try {
    data = readDataRow(rowEl);
  } catch (error) {
    return setDataMessage(error.message, true);
  }
  const error = validateDataRow(data, originalKey);
  if (error) return setDataMessage(error, true);
  await upsertLogicalRow(originalKey, data);
  await loadState();
  state.openDayKey = data.StartDate;
  state.openItemId = data.ItemID;
  setDataMessage('Fila guardada.');
  notifyLocalChange('data-row-save');
  renderSettings();
}

async function addLogicalRow() {
  if (!canEditApp()) return;
  const date = state.days[0]?.DayDate || new Date().toISOString().slice(0, 10);
  let itemId = '';
  try {
    itemId = getNextItemId();
  } catch (error) {
    return setDataMessage(error.message, true);
  }
  const data = {
    ItemID: itemId,
    TripID: state.activeTripId,
    StartDate: date,
    EndDate: date,
    StartTime: '',
    EndTime: '',
    ItemType: 'ACTIVITY',
    Title: 'Nuevo item',
    City: state.days.find(day => day.DayDate === date)?.City || '',
    AmountUSD: 0,
    PlanningStatus: 'PROPOSED',
    PaymentStatus: 'NOT_PAID',
    IsPaid: false,
    Completed: false,
    CompletedAt: '',
    CompletedByRole: '',
    GooglePlusCode: '',
    GoogleMapsUrl: '',
    Notes: ''
  };
  await upsertLogicalRow('', data);
  await loadState();
  setDataMessage('Nueva fila creada.');
  notifyLocalChange('data-row-add');
  renderSettings();
}

async function duplicateDataRow(rowEl) {
  if (!canEditApp()) return;
  let data;
  try {
    data = readDataRow(rowEl);
    data.TripID = state.activeTripId;
    data.ItemID = getNextItemId();
  } catch (error) {
    return setDataMessage(error.message, true);
  }
  data.Title = `${data.Title} copia`;
  await upsertLogicalRow('', data);
  await loadState();
  setDataMessage('Fila duplicada.');
  notifyLocalChange('data-row-duplicate');
  renderSettings();
}

async function deleteDataRow(rowEl) {
  if (!canEditApp()) return;
  const key = rowEl.dataset.key;
  const item = state.items.find(row => getLogicalKey(row) === key) || { ItemID: key, Title: key };
  await deleteLogicalItem(item);
}

async function recordDeletion(EntityType, EntityId, TripID, entity = {}) {
  const now = new Date().toISOString();
  const Version = String(Number(entity.Version || 0) + 1);
  const DeviceId = await getOrCreateDeviceId();
  await enqueueDeletion(stampLocalChange({
    DeletionID: [EntityType, TripID || '', EntityId, Version].map(value => encodeURIComponent(String(value))).join(':'),
    EntityType,
    EntityId,
    TripID: TripID || '',
    DeletedAt: now,
    Version,
    DeviceId
  }, now));
  markLocalEntity(EntityType, EntityId);
}

async function deleteLogicalItem(item, modal = null) {
  if (!canEditApp()) return;
  const key = getLogicalKey(item);
  const title = item.Title || 'Sin título';
  if (!confirm(`Eliminar item ${key} - ${title}? Se borrarán todas sus apariciones.`)) return;
  await createDataSnapshot('Antes de eliminar item');
  await recordDeletion('ITEM', key, item.TripID || state.activeTripId, item);
  await replaceItemsByPredicate([], row => row.TripID === state.activeTripId && getLogicalKey(row) === key);
  if (modal) closeModal(modal);
  await loadState();
  state.openItemId = null;
  els.statusSync.textContent = 'Item eliminado';
  notifyLocalChange('item-delete');
  await render();
}

async function upsertLogicalRow(originalKey, data) {
  const now = new Date().toISOString();
  const related = state.items.filter(item => getLogicalKey(item) === originalKey);
  if (related.length === 0) {
    const item = stampLocalChange(buildItemFromData(data, now), now);
    await addItem(item);
    markLocalEntity('ITEM', item.ItemID);
    return;
  }
  for (const item of related) {
    const shouldMoveDay = related.length === 1 || isChargeOccurrence(item) || item.DayDate === item.StartDate;
    const updated = stampLocalChange({
      ...item,
      ...data,
      ItemID: item.ItemID,
      SourceItemID: data.ItemID,
      DayDate: shouldMoveDay ? data.StartDate : item.DayDate,
      StartDate: data.StartDate,
      EndDate: data.EndDate,
      Status: data.PlanningStatus === 'CONFIRMED' ? 'CONFIRMED' : 'PLANNED'
    }, now);
    await updateItem(updated);
    markLocalEntity('ITEM', updated.ItemID);
  }
}

function buildItemFromData(data, now) {
  return {
    ...data,
    SourceItemID: data.ItemID,
    DatasetID: ITALY_DATASET_ID,
    TripID: data.TripID || 'TRIP_ITALY_2026',
    DayDate: data.StartDate,
    Currency: 'USD',
    Status: data.PlanningStatus === 'CONFIRMED' ? 'CONFIRMED' : 'PLANNED',
    IsAllDay: !data.StartTime,
    IsMultiDay: data.EndDate > data.StartDate,
    LodgingDisplayMode: 'NORMAL',
    SortOrder: Date.now(),
    LastUpdatedAt: now,
    SyncStatus: 'LOCAL_PENDING'
  };
}

function validateDataRow(data, originalKey = '') {
  const keys = getLogicalRows().map(row => row.ItemID);
  if (!data.ItemID) return 'ItemID requerido.';
  if (!ITEM_ID_PATTERN.test(data.ItemID) && data.ItemID !== originalKey) return 'ItemID debe usar formato ITEM_XXX.';
  if (keys.includes(data.ItemID) && data.ItemID !== originalKey) return 'ItemID duplicado.';
  if (!isValidDate(data.StartDate)) return 'StartDate inválida.';
  if (!isValidDate(data.EndDate)) return 'EndDate inválida.';
  if (data.EndDate < data.StartDate) return 'EndDate debe ser mayor o igual a StartDate.';
  if (!data.Title) return 'Title requerido.';
  if (Number.isNaN(data.AmountUSD) || data.AmountUSD < 0) return 'AmountUSD debe ser numérico y mayor o igual a 0.';
  if (!isValidTime(data.StartTime)) return 'StartTime debe usar HH:mm.';
  if (!isValidTime(data.EndTime)) return 'EndTime debe usar HH:mm.';
  if (!PLANNING_STATUSES.includes(data.PlanningStatus)) return 'PlanningStatus inválido.';
  if (!PAYMENT_STATUSES.includes(data.PaymentStatus)) return 'PaymentStatus inválido.';
  return '';
}

function openPastePreview() {
  if (!canEditApp()) return;
  const preview = document.getElementById('pastePreview');
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <h3>Pegar TSV</h3>
    <textarea id="tsvInput" rows="7" placeholder="${DATA_COLUMNS.join('\t')}"></textarea>
    <div class="settings-actions">
      <button id="previewTsv" class="secondary-button" type="button">Previsualizar</button>
      <button id="cancelTsv" class="secondary-button" type="button">Cancelar</button>
    </div>
    <div id="tsvResult"></div>
  `;
  document.getElementById('cancelTsv').addEventListener('click', () => preview.classList.add('hidden'));
  document.getElementById('previewTsv').addEventListener('click', previewTsvImport);
}

function previewTsvImport() {
  const text = document.getElementById('tsvInput').value.trim();
  let rows = [];
  const errors = [];
  try {
    rows = parseTsvRows(text);
  } catch (error) {
    errors.push(error.message);
  }
  const seen = new Set();
  rows.forEach((row, index) => {
    if (row._columnCount !== DATA_COLUMNS.length) errors.push(`Fila ${index + 1}: columnas ${row._columnCount}/${DATA_COLUMNS.length}.`);
    if (seen.has(row.ItemID)) errors.push(`Fila ${index + 1}: ItemID duplicado en pegado.`);
    seen.add(row.ItemID);
    if (getLogicalRows().some(existing => existing.ItemID === row.ItemID)) errors.push(`Fila ${index + 1}: ItemID existente; resolver como conflicto fuera del TSV.`);
    const error = validateDataRow(row, row.ItemID);
    if (error) errors.push(`Fila ${index + 1}: ${error}`);
  });
  const result = document.getElementById('tsvResult');
  if (errors.length) {
    result.innerHTML = `<div class="data-error">${errors.map(escapeHtml).join('<br>')}</div>`;
    return;
  }
  result.innerHTML = `<p>${rows.length} filas listas para importar.</p><button id="confirmTsv" class="primary-button" type="button">Confirmar importación</button>`;
  document.getElementById('confirmTsv').addEventListener('click', () => importTsvRows(rows));
}

function parseTsvRows(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines[0]?.split('\t').map(cell => cell.trim()).join('|') === DATA_COLUMNS.join('|')) lines.shift();
  const reservedIds = new Set();
  return lines.map(line => {
    const cells = line.split('\t');
    const row = {};
    DATA_COLUMNS.forEach((column, index) => {
      row[column] = (cells[index] || '').trim();
    });
    if (!row.ItemID) row.ItemID = getNextItemId(reservedIds);
    reservedIds.add(row.ItemID);
    row.AmountUSD = Number(row.AmountUSD || 0);
    row.IsPaid = String(row.IsPaid).toLowerCase() === 'true';
    row.Completed = String(row.Completed).toLowerCase() === 'true';
    row.CompletedAt = row.Completed ? row.CompletedAt : '';
    row.CompletedByRole = row.Completed ? row.CompletedByRole : '';
    row._columnCount = cells.length;
    return row;
  });
}

async function importTsvRows(rows) {
  if (!canEditApp()) return;
  await createDataSnapshot('Antes de importar TSV');
  for (const row of rows) {
    row.TripID = row.TripID || state.activeTripId;
    if (getLogicalRows().some(existing => existing.ItemID === row.ItemID)) {
      setDataMessage(`Conflicto: ${row.ItemID} ya existe. No se importó TSV.`, true);
      return;
    }
    await upsertLogicalRow('', row);
    await loadState();
  }
  await loadState();
  setDataMessage(`${rows.length} filas importadas.`);
  notifyLocalChange('data-tsv-import');
  renderSettings();
}

async function createDataSnapshot(reason = 'Snapshot automático') {
  const snapshots = getSnapshots();
  snapshots.unshift({
    id: `snapshot-${Date.now()}`,
    timestamp: new Date().toISOString(),
    reason,
    datasetId: getActiveDatasetId(),
    items: getLogicalExportItems(),
    budget: { tripBudgetUSD: await getActiveTripBudget() },
    preferences: { days: state.days }
  });
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots.slice(0, 5)));
}

function getSnapshots() {
  try {
    const raw = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]');
    return Array.isArray(raw) ? raw.map(normalizeSnapshot).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.items)) return null;
  return {
    id: snapshot.id || `snapshot-${snapshot.createdAt || snapshot.timestamp || Date.now()}`,
    timestamp: snapshot.timestamp || snapshot.createdAt || new Date().toISOString(),
    reason: snapshot.reason || 'Snapshot local',
    datasetId: snapshot.datasetId || getActiveDatasetId(),
    items: snapshot.items,
    budget: snapshot.budget || { tripBudgetUSD: 6000 },
    preferences: snapshot.preferences || null
  };
}

function renderSnapshotList() {
  const preview = document.getElementById('backupPreview');
  const snapshots = getSnapshots();
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <h3>Snapshots locales</h3>
    ${snapshots.length ? `<div class="snapshot-list">${snapshots.map(snapshot => `
      <article class="snapshot-card">
        <div>
          <strong>${escapeHtml(formatDateTime(snapshot.timestamp))}</strong>
          <span>${escapeHtml(snapshot.reason)} · ${snapshot.items.length} items · ${escapeHtml(snapshot.datasetId)}</span>
        </div>
        <button class="secondary-button danger-button" type="button" data-restore-snapshot="${escapeHtml(snapshot.id)}">Restaurar</button>
      </article>
    `).join('')}</div>` : '<p class="placeholder-note">No hay snapshots locales todavía.</p>'}
  `;
  preview.querySelectorAll('[data-restore-snapshot]').forEach(button => {
    button.addEventListener('click', () => restoreSnapshot(button.dataset.restoreSnapshot));
  });
}

async function restoreSnapshot(id) {
  const snapshot = getSnapshots().find(row => row.id === id);
  if (!snapshot) return setBackupMessage('Snapshot no encontrado.', true);
  if (!confirm('Restaurar este snapshot? Se creará un snapshot del estado actual antes.')) return;
  await createDataSnapshot('Antes de restaurar snapshot');
  await restoreDatasetPayload(snapshot);
  setBackupMessage('Snapshot restaurado.');
}

function setDataMessage(message, isError = false) {
  const el = document.getElementById('dataMessage');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('data-error', isError);
}

function setBackupMessage(message, isError = false) {
  const el = document.getElementById('backupMessage');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('data-error', isError);
}

function getActiveDatasetId() {
  return localStorage.getItem(ITALY_DATASET_MARK_KEY) || ITALY_DATASET_ID;
}

function isActiveDatasetItem(item) {
  return item.DatasetID === getActiveDatasetId() || item.TripID === 'TRIP_ITALY_2026';
}

function formatBackupStamp(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || 'Sin fecha';
  return date.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

async function restoreOriginalItinerary() {
  if (!canEditApp()) return;
  if (!confirm('Restaurar datos originales del viaje? Esto elimina modificaciones locales de los items de Italy 2026.')) return;
  const itinerary = await loadItalyItinerary();
  await createDataSnapshot('Antes de restaurar originales del viaje');
  await migrateLegacyTravelData(itinerary);
  await setActiveTripId('TRIP_ITALY_2026');
  await refreshTripsAndDays(itinerary.days);
  const now = new Date().toISOString();
  const restoredItems = itinerary.items.map(item => stampLocalChange(item, now));
  await replaceItemsByPredicate(restoredItems, item => item.DatasetID === ITALY_DATASET_ID || item.TripID === 'TRIP_ITALY_2026');
  restoredItems.forEach(item => markLocalEntity('ITEM', item.ItemID));
  localStorage.setItem(ITALY_DATASET_MARK_KEY, ITALY_DATASET_ID);
  localStorage.setItem(ITALY_DAYS_KEY, JSON.stringify(state.days));
  state.openDayKey = null;
  state.openItemId = null;
  await loadState();
  els.statusSync.textContent = 'Datos originales del viaje restaurados';
  notifyLocalChange('restore-original');
  await render();
}

function openEditModal(item) {
  if (!canEditApp()) return;
  state.editingItem = item;
  fillForm(editModal.form, item);
  state.editInitialValue = getFormSnapshot(editModal.form);
  editModal.el.querySelector('[data-delete-item]')?.classList.remove('hidden');
  editModal.el.classList.remove('hidden');
  editModal.form.elements.Title.focus();
}

function openNewItemModal() {
  if (!canEditApp()) return;
  const today = state.openDayKey || state.days[0]?.DayDate || '';
  fillForm(newItemModal.form, {
    DayDate: today,
    StartTime: '',
    EndTime: '',
    ItemType: 'ACTIVITY',
    Title: '',
    AmountUSD: 0,
    PlanningStatus: state.activeTab,
    PaymentStatus: 'NOT_PAID',
    City: state.days.find(day => day.DayDate === today)?.City || '',
    GooglePlusCode: '',
    GoogleMapsUrl: '',
    Notes: '',
    IsAllDay: false,
    IsPaid: false
  });
  state.newInitialValue = getFormSnapshot(newItemModal.form);
  newItemModal.el.querySelector('[data-delete-item]')?.classList.add('hidden');
  newItemModal.el.classList.remove('hidden');
  newItemModal.form.elements.Title.focus();
}

async function saveEditForm(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const error = validateItemForm(data);
  if (error) return setModalError(editModal, error);
  const now = new Date().toISOString();
  const updated = stampLocalChange({
    ...state.editingItem,
    ...data,
    AmountUSD: Number(data.AmountUSD),
    IsAllDay: event.currentTarget.elements.IsAllDay.checked,
    IsPaid: event.currentTarget.elements.IsPaid.checked
  }, now);
  await updateItem(updated);
  markLocalEntity('ITEM', updated.ItemID);
  state.openDayKey = updated.DayDate;
  state.openItemId = updated.ItemID;
  closeModal(editModal);
  await loadState();
  els.statusSync.textContent = 'Cambios locales pendientes';
  notifyLocalChange('item-edit');
  await render();
}

async function saveNewItemForm(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const error = validateItemForm(data);
  if (error) return setModalError(newItemModal, error);
  let itemId = '';
  try {
    itemId = getNextItemId();
  } catch (idError) {
    return setModalError(newItemModal, idError.message);
  }
  const now = new Date().toISOString();
  const item = stampLocalChange({
    ...data,
    ItemID: itemId,
    DatasetID: ITALY_DATASET_ID,
    TripID: state.activeTripId,
    AmountUSD: Number(data.AmountUSD),
    Currency: 'USD',
    Status: data.PlanningStatus === 'CONFIRMED' ? 'CONFIRMED' : 'PLANNED',
    IsAllDay: event.currentTarget.elements.IsAllDay.checked,
    IsPaid: event.currentTarget.elements.IsPaid.checked,
    IsMultiDay: false,
    StartDate: data.DayDate,
    EndDate: data.DayDate,
    LodgingDisplayMode: 'NORMAL',
    SortOrder: Date.now()
  }, now);
  await addItem(item);
  markLocalEntity('ITEM', item.ItemID);
  state.activeTab = item.PlanningStatus;
  state.activeView = 'home';
  state.openDayKey = item.DayDate;
  state.openItemId = item.ItemID;
  closeModal(newItemModal);
  await loadState();
  els.statusSync.textContent = 'Nuevo item guardado';
  notifyLocalChange('item-new');
  await render();
}

function createItemModal(id, title, submitHandler) {
  const modal = document.createElement('div');
  modal.id = id;
  modal.className = 'edit-modal hidden';
  modal.innerHTML = `
    <div class="edit-modal-panel" role="dialog" aria-modal="true" aria-labelledby="${id}Title">
      <header class="edit-modal-header">
        <h2 id="${id}Title">${title}</h2>
        <button type="button" class="icon-button" data-cancel aria-label="Cerrar">×</button>
      </header>
      <form class="edit-form" novalidate>
        <div class="edit-error" role="alert"></div>
        <label>Fecha<input name="DayDate" type="date" required /></label>
        <label>Title<input name="Title" required /></label>
        <div class="edit-grid">
          <label>StartTime<input name="StartTime" placeholder="09:30" /></label>
          <label>EndTime<input name="EndTime" placeholder="10:30" /></label>
        </div>
        <div class="edit-grid">
          <label>ItemType<select name="ItemType"><option value="ACTIVITY">Actividad</option><option value="FLIGHT">Vuelo</option><option value="FOOD">Comida</option><option value="LODGING">Hospedaje</option><option value="TRANSPORT">Transporte</option><option value="OTHER">Otro</option></select></label>
          <label>AmountUSD<input name="AmountUSD" type="number" min="0" step="0.01" /></label>
        </div>
        <div class="edit-grid">
          <label>PlanningStatus<select name="PlanningStatus"><option value="CONFIRMED">CONFIRMED</option><option value="PROPOSED">PROPOSED</option></select></label>
          <label>PaymentStatus<select name="PaymentStatus"><option value="NOT_PAID">NOT_PAID</option><option value="RESERVED">RESERVED</option><option value="PAID">PAID</option><option value="PARTIAL">PARTIAL</option><option value="ESTIMATED">ESTIMATED</option></select></label>
        </div>
        <label>City<input name="City" /></label>
        <label>GooglePlusCode<input name="GooglePlusCode" /></label>
        <label>GoogleMapsUrl<input name="GoogleMapsUrl" type="url" /></label>
        <label>Notes<textarea name="Notes" rows="3"></textarea></label>
        <div class="edit-checks"><label><input name="IsAllDay" type="checkbox" /> IsAllDay</label><label><input name="IsPaid" type="checkbox" /> IsPaid</label></div>
        <footer class="edit-actions"><button type="button" class="secondary-button danger-button hidden" data-delete-item>Eliminar item</button><button type="button" class="secondary-button" data-cancel>Cancelar</button><button type="submit" class="primary-button">Guardar</button></footer>
      </form>
    </div>
  `;
  document.body.append(modal);
  const form = modal.querySelector('form');
  const api = { el: modal, form };
  modal.addEventListener('click', event => {
    if (event.target === modal) requestCloseModal(api);
  });
  modal.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => requestCloseModal(api)));
  modal.querySelector('[data-delete-item]').addEventListener('click', () => {
    if (state.editingItem) deleteLogicalItem(state.editingItem, api);
  });
  form.addEventListener('submit', submitHandler);
  return api;
}

function requestCloseModal(modal) {
  if (modal.el.classList.contains('hidden')) return;
  const initialValue = modal === editModal ? state.editInitialValue : state.newInitialValue;
  if (getFormSnapshot(modal.form) !== initialValue) {
    if (!confirm('Descartar cambios sin guardar?')) return;
  }
  closeModal(modal);
}

function closeModal(modal) {
  modal.el.classList.add('hidden');
  setModalError(modal, '');
  if (modal === editModal) state.editingItem = null;
  if (modal === newItemModal) state.newInitialValue = '';
}

function fillForm(form, item) {
  setModalError({ form }, '');
  const fields = ['DayDate', 'StartTime', 'EndTime', 'Title', 'ItemType', 'AmountUSD', 'PlanningStatus', 'PaymentStatus', 'City', 'GooglePlusCode', 'GoogleMapsUrl', 'Notes'];
  fields.forEach(field => {
    if (form.elements[field]) form.elements[field].value = item[field] ?? '';
  });
  form.elements.IsAllDay.checked = item.IsAllDay === true;
  form.elements.IsPaid.checked = item.IsPaid === true;
}

function formData(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  data.Title = data.Title.trim();
  data.StartTime = data.StartTime.trim();
  data.EndTime = data.EndTime.trim();
  data.City = data.City.trim();
  data.GooglePlusCode = data.GooglePlusCode.trim();
  data.GoogleMapsUrl = data.GoogleMapsUrl.trim();
  data.Notes = data.Notes.trim();
  return data;
}

function validateItemForm(data) {
  if (!data.DayDate) return 'Fecha requerida.';
  if (!data.Title) return 'Title es requerido.';
  const amount = Number(data.AmountUSD);
  if (data.AmountUSD === '' || Number.isNaN(amount) || amount < 0) return 'AmountUSD debe ser numérico y mayor o igual a 0.';
  if (!isValidTime(data.StartTime)) return 'StartTime debe usar formato HH:mm.';
  if (!isValidTime(data.EndTime)) return 'EndTime debe usar formato HH:mm.';
  return '';
}

function setModalError(modal, message) {
  modal.form.querySelector('.edit-error').textContent = message;
}

function getFormSnapshot(form) {
  return JSON.stringify([...new FormData(form).entries()].concat([
    ['IsAllDay', form.elements.IsAllDay.checked],
    ['IsPaid', form.elements.IsPaid.checked]
  ]));
}

function getItemPlanningStatus(item) {
  return item.PlanningStatus || getPlanningStatus(item.Status);
}

function compareItems(a, b) {
  const completedCompare = Number(isItemCompleted(a)) - Number(isItemCompleted(b));
  if (completedCompare !== 0) return completedCompare;
  if (isItemCompleted(a) && isItemCompleted(b)) {
    const dateCompare = String(a.CompletedAt || '').localeCompare(String(b.CompletedAt || ''));
    if (dateCompare !== 0) return dateCompare;
  }
  const allDayCompare = Number(Boolean(a.IsAllDay)) - Number(Boolean(b.IsAllDay));
  if (allDayCompare !== 0) return allDayCompare;
  const lodgingStayCompare = Number(a.LodgingDisplayMode === 'FULL_DAY') - Number(b.LodgingDisplayMode === 'FULL_DAY');
  if (lodgingStayCompare !== 0) return lodgingStayCompare;
  const timeCompare = (a.StartTime || '').localeCompare(b.StartTime || '');
  if (timeCompare !== 0) return timeCompare;
  return Number(a.SortOrder || 0) - Number(b.SortOrder || 0);
}

function formatDayTitle(day) {
  const date = new Date(`${day.DayDate}T00:00:00`);
  const formatted = Number.isNaN(date.getTime()) ? day.DayDate : date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
  return [day.DayLabel || 'Día', formatted, day.Title].filter(Boolean).join(' • ');
}

function getDisplayTitle(item) {
  if (item.OccurrenceRole === 'FULL_DAY' && item.ItemType === 'LODGING') return `Todo el día — Hospedaje: ${item.Title}`;
  if (item.OccurrenceRole === 'FULL_DAY') return `Todo el día — ${item.Title || 'Sin título'}`;
  if (item.OccurrenceRole === 'END') return `Finaliza: ${item.Title || 'Sin título'}`;
  if (item.ItemType !== 'LODGING') return item.Title || 'Sin título';
  if (item.LodgingDisplayMode === 'CHECK_IN') return `Check-in: ${item.Title}`;
  if (item.LodgingDisplayMode === 'CHECK_OUT') return `Check-out: ${item.Title}`;
  if (item.LodgingDisplayMode === 'FULL_DAY') return `Hospedaje: ${item.Title}`;
  return item.Title || 'Hospedaje';
}

function renderDetails(item) {
  return [item.Description, item.Notes, item.GooglePlusCode ? `Plus Code: ${item.GooglePlusCode}` : '']
    .filter(Boolean)
    .map(value => `<p>${escapeHtml(value)}</p>`)
    .join('');
}

function getCategoryLabel(type = 'OTHER') {
  return { ACTIVITY: 'Actividad', FLIGHT: 'Vuelo', FOOD: 'Comida', LODGING: 'Hospedaje', TRANSPORT: 'Transporte', SHOPPING: 'Compras' }[type] || 'Otro';
}

function renderCategoryChip(visual) {
  return `<span class="category">${escapeHtml(visual.label)}</span>`;
}

function renderCategoryCardIcon(visual) {
  if (!visual.icon) return '';
  const iconClass = visual.iconClass ? ` ${escapeHtml(visual.iconClass)}` : '';
  return `<span class="item-card-icon${iconClass}" aria-hidden="true">${visual.icon}</span>`;
}

function getHomeCategoryVisual(item) {
  const type = item.ItemType || 'OTHER';
  const text = getItemSearchText(item);

  if (type === 'LODGING') {
    if (matchesAny(text, ['house', 'home', 'airbnb', 'abb', 'apartment', 'apt', 'casa', 'room', 'flat'])) {
      return { family: 'lodging', label: getCategoryLabel(type), icon: '&#8962;' };
    }
    return { family: 'lodging', label: getCategoryLabel(type), icon: '&#127970;' };
  }

  if (type === 'TRANSPORT' || type === 'FLIGHT') {
    if (matchesAny(text, ['train', 'tren'])) return { family: 'transportation', label: getCategoryLabel(type), icon: '&#128646;' };
    if (matchesAny(text, ['bus', 'flixbus', 'coach'])) return { family: 'transportation', label: getCategoryLabel(type), icon: '&#128652;' };
    if (type === 'FLIGHT' || matchesAny(text, ['flight', 'vuelo', 'airline', 'airport'])) return { family: 'transportation', label: getCategoryLabel(type), icon: '&#9992;' };
    if (matchesAny(text, ['taxi'])) return { family: 'transportation', label: getCategoryLabel(type), icon: '&#128661;' };
    if (matchesAny(text, ['rental car', 'car rental', 'alquiler de vehiculo', 'alquiler de vehículo', 'vehicle rental'])) return { family: 'transportation', label: getCategoryLabel(type), icon: '&#128663;', iconClass: 'category-icon-car' };
    return { family: 'transportation', label: getCategoryLabel(type), icon: '&#128652;' };
  }

  if (type === 'FOOD') return { family: 'food', label: getCategoryLabel(type), icon: '&#127860;' };
  if (isTripPurchaseItem(item, text)) return { family: 'trip-purchase', label: 'Compra viaje', icon: '&#128188;' };
  if (type === 'SHOPPING' || matchesAny(text, ['store', 'shopping', 'shop', 'compras', 'tienda'])) return { family: 'shopping', label: getCategoryLabel('SHOPPING'), icon: '&#128722;' };
  if (isTourItem(item, text)) return { family: 'tour', label: 'Tour', icon: '&#128227;' };
  if (type === 'ACTIVITY') return { family: 'tour', label: getCategoryLabel(type), icon: '&#128227;' };
  return { family: 'other', label: getCategoryLabel(type), icon: '' };
}

function getItemSearchText(item) {
  return [item.Title, item.Subtitle, item.Provider, item.ItemType, item.Description, item.Notes, item.LocationLabel]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function matchesAny(text, terms) {
  return terms.some(term => text.includes(term.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
}

function isTourItem(item, text = getItemSearchText(item)) {
  return matchesAny(text, ['tour', 'guided', 'guia', 'visita', 'excursion']);
}

function isTripPurchaseItem(item, text = getItemSearchText(item)) {
  return matchesAny(text, ['adapter', 'adaptador', 'poncho', 'ponchos', 'storage bag', 'storage bags', 'packing cube', 'travel prep', 'pre-trip', 'prep shopping', 'travel purchase']);
}

function getMapUrl(item) {
  return item.GoogleMapsUrl || `https://maps.google.com/?q=${encodeURIComponent(item.GooglePlusCode)}`;
}

function getCategoryRows(items, total) {
  const groups = new Map();
  for (const item of items) {
    const type = item.ItemType || 'OTHER';
    const row = groups.get(type) || { type, amount: 0, count: 0 };
    row.amount += Number(item.AmountUSD || 0);
    row.count += 1;
    groups.set(type, row);
  }
  return [...groups.values()]
    .map(row => ({ ...row, percent: total > 0 ? (row.amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

function getBudgetDayRows(items) {
  return state.days.map(day => {
    const dayItems = items.filter(item => getBudgetDate(item) === day.DayDate);
    const paid = sumAmount(dayItems.filter(isPaidFinancial));
    const total = sumAmount(dayItems);
    return {
      ...day,
      count: dayItems.length,
      total,
      paid,
      pending: total - paid
    };
  });
}

function renderPaidPendingChart(paid, pending, total) {
  const paidPercent = total > 0 ? (paid / total) * 100 : 0;
  const pendingPercent = total > 0 ? (pending / total) * 100 : 0;
  return `
    <div class="stacked-chart" aria-label="Pagado ${formatPercent(paidPercent)}, pendiente ${formatPercent(pendingPercent)}">
      <span class="stack-paid" style="width:${paidPercent}%"></span>
      <span class="stack-pending" style="width:${pendingPercent}%"></span>
    </div>
    <div class="chart-legend">
      <span><i class="legend-paid"></i>Pagado ${formatMoney(paid)}</span>
      <span><i class="legend-pending"></i>Pendiente ${formatMoney(pending)}</span>
    </div>
  `;
}

function renderCategoryBreakdown(rows) {
  if (rows.length === 0) return '<p class="placeholder-note">Sin gastos confirmados.</p>';
  return `
    <div class="bar-list">
      ${rows.map(row => `
        <div class="bar-row">
          <div class="bar-label">
            <strong>${escapeHtml(getCategoryLabel(row.type))}</strong>
            <span>${formatMoney(row.amount)} · ${formatPercent(row.percent)} · ${row.count} items</span>
          </div>
          <div class="bar-track"><span style="width:${Math.max(1, row.percent)}%"></span></div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderDayBreakdown(rows) {
  return `
    <div class="breakdown-list">
      ${rows.map(row => `
        <details class="breakdown-card">
          <summary>
            <span><strong>${escapeHtml(formatDayTitle(row))}</strong><small>${escapeHtml(row.City || 'Sin ciudad')}</small></span>
            <b>${formatMoney(row.total)}</b>
          </summary>
          <div class="breakdown-meta">
            <span>Pagado: ${formatMoney(row.paid)}</span>
            <span>Pendiente: ${formatMoney(row.pending)}</span>
            <span>Items: ${row.count}</span>
          </div>
        </details>
      `).join('')}
    </div>
  `;
}

function setupExpenseFilters(items) {
  const list = els.budgetSection.querySelector('#expenseList');
  const buttons = [...els.budgetSection.querySelectorAll('[data-expense-filter]')];
  const category = els.budgetSection.querySelector('#expenseCategoryFilter');
  const renderFiltered = () => {
    const active = buttons.find(button => button.classList.contains('active'))?.dataset.expenseFilter || 'all';
    const type = category.value;
    let filtered = [...items];
    if (active === 'paid') filtered = filtered.filter(isPaidFinancial);
    if (active === 'pending') filtered = filtered.filter(item => !isPaidFinancial(item));
    if (type) filtered = filtered.filter(item => (item.ItemType || 'OTHER') === type);
    list.innerHTML = renderExpenseList(filtered);
  };
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      buttons.forEach(other => other.classList.toggle('active', other === button));
      renderFiltered();
    });
  });
  category.addEventListener('change', renderFiltered);
  renderFiltered();
}

function renderExpenseList(items) {
  const sorted = [...items].sort((a, b) => getBudgetDate(a).localeCompare(getBudgetDate(b)) || (a.StartTime || '').localeCompare(b.StartTime || ''));
  if (sorted.length === 0) return '<p class="placeholder-note">Sin gastos para este filtro.</p>';
  return `
    <div class="expense-list">
      ${sorted.map(item => `
        <details class="expense-card">
          <summary>
            <span>
              <strong>${escapeHtml(item.Title || 'Sin título')}</strong>
              <small>${escapeHtml(getCategoryLabel(item.ItemType))} · ${escapeHtml(getBudgetDate(item))}${item.StartTime ? ` · ${escapeHtml(item.StartTime)}` : ''}</small>
            </span>
            <b>${formatMoney(item.AmountUSD || 0)}</b>
          </summary>
          <div class="breakdown-meta">
            <span>${isPaidFinancial(item) ? 'Pagado' : 'Pendiente'}</span>
            ${item.Provider ? `<span>Proveedor: ${escapeHtml(item.Provider)}</span>` : ''}
            ${item.City ? `<span>Ciudad: ${escapeHtml(item.City)}</span>` : ''}
          </div>
        </details>
      `).join('')}
    </div>
  `;
}

function uniqueFinancialItems(items) {
  const unique = new Map();
  for (const item of items) {
    const key = getLogicalKey(item);
    if (!unique.has(key) || isChargeOccurrence(item)) {
      unique.set(key, item);
    }
  }
  return [...unique.values()];
}

function getLogicalKey(item) {
  return getCanonicalLogicalItemId(item);
}

function getCanonicalLogicalItemId(item, datasetId = getActiveDatasetId()) {
  if (item.SourceItemID) return item.SourceItemID;
  const itemId = String(item.ItemID || '');
  const legacyMatch = itemId.match(/^([^:]+):(\d{4}-\d{2}-\d{2}):(.+)$/);
  if (legacyMatch && (!datasetId || legacyMatch[1] === datasetId)) return legacyMatch[3];
  return item.ItemID;
}

function getFinancialAmount(item) {
  return isChargeOccurrence(item) ? Number(item.AmountUSD || 0) : 0;
}

function isChargeOccurrence(item) {
  const key = getLogicalKey(item);
  const related = state.items.filter(row => getLogicalKey(row) === key);
  if (related.length <= 1) return true;
  const startDate = item.StartDate || item.DayDate;
  if (related.some(row => row.DayDate === startDate)) {
    return item.DayDate === startDate;
  }
  const firstDate = related.map(row => row.DayDate || row.StartDate || '').sort()[0];
  return (item.DayDate || item.StartDate || '') === firstDate;
}

function formatItemAmount(item) {
  if (item.IncludedLabel) return item.IncludedLabel;
  return isChargeOccurrence(item) ? formatMoney(item.AmountUSD || 0) : 'Incluido en reserva';
}

function sumAmount(items) {
  return items.reduce((sum, item) => sum + Number(item.AmountUSD || 0), 0);
}

function isPaidFinancial(item) {
  return item.IsPaid === true || item.PaymentStatus === 'PAID';
}

function getBudgetDate(item) {
  return item.StartDate || item.DayDate || '';
}

function formatMoney(amount) {
  return new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(amount || 0));
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function isValidTime(value) {
  return !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function updateOnlineStatus() {
  els.statusOnline.textContent = navigator.onLine ? 'Online' : 'Offline';
  updateSyncStatus();
}

function updateSyncStatus() {
  if (!els.statusSync) return;
  els.statusSync.textContent = getSyncStatusLabel();
}

function getSyncStatusLabel() {
  if (!state.authUser) return 'Modo local; inicia sesión para nube';
  if (!navigator.onLine || state.sync.status === 'offline') return 'Sin internet; guardando localmente';
  if (state.sync.status === 'syncing') return 'Sincronizando...';
  if (state.sync.status === 'pending') return 'Pendiente de sincronizar';
  if (state.sync.status === 'error') return 'Error de sync';
  if (state.sync.status === 'synced' || state.sync.status === 'idle') return 'Sincronizado';
  return 'Nube conectada';
}

function closeMenu() {
  els.menuOverlay.classList.add('hidden');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
