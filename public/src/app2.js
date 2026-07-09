import { addItem, getAllItems, getSetting, openDatabase, replaceDatasetItems, replaceItemsByPredicate, setSetting, updateItem } from './db.js';
import { ITALY_DATASET_ID, ITALY_DATASET_MARK_KEY, ITALY_DAYS_KEY, getPlanningStatus, loadItalyItinerary } from './italyAdapter.js';

const state = {
  activeView: 'home',
  activeTab: 'CONFIRMED',
  days: [],
  items: [],
  openDayKey: null,
  openItemId: null,
  editingItem: null,
  editInitialValue: '',
  newInitialValue: '',
  pendingBackup: null
};

const els = {
  viewTitle: document.getElementById('viewTitle'),
  dayList: document.getElementById('dayList'),
  statusOnline: document.getElementById('statusOnline'),
  statusSync: document.getElementById('statusSync'),
  menuButton: document.getElementById('menuButton'),
  menuOverlay: document.getElementById('menuOverlay'),
  homeSection: document.getElementById('homeSection'),
  budgetSection: document.getElementById('budgetSection'),
  settingsSection: document.getElementById('settingsSection'),
  resetButton: document.getElementById('resetSeedButton'),
  refreshButton: document.getElementById('refreshButton'),
  tabs: [...document.querySelectorAll('.tab-button')]
};

const editModal = createItemModal('editItemModal', 'Editar item', saveEditForm);
const newItemModal = createItemModal('newItemModal', 'Nuevo item', saveNewItemForm);
const DATA_COLUMNS = ['ItemID', 'StartDate', 'EndDate', 'StartTime', 'EndTime', 'ItemType', 'Title', 'City', 'AmountUSD', 'PlanningStatus', 'PaymentStatus', 'IsPaid', 'GooglePlusCode', 'GoogleMapsUrl', 'Notes'];
const ITEM_TYPES = ['ACTIVITY', 'FLIGHT', 'FOOD', 'LODGING', 'TRANSPORT', 'OTHER'];
const PLANNING_STATUSES = ['CONFIRMED', 'PROPOSED'];
const PAYMENT_STATUSES = ['PAID', 'NOT_PAID', 'PARTIAL', 'RESERVED', 'ESTIMATED'];
const SNAPSHOT_KEY = 'tm3.dataSnapshots';
const BACKUP_SCHEMA_VERSION = 1;
const APP_VERSION = '0.1.0';

await initApp();

async function initApp() {
  await openDatabase();
  const itinerary = await loadItalyItinerary();
  state.days = itinerary.days;
  localStorage.setItem(ITALY_DAYS_KEY, JSON.stringify(state.days));
  await migrateToItalyItineraryIfNeeded(itinerary);
  await migratePlanningStatus();
  bindEvents();
  await loadState();
  updateOnlineStatus();
  await render();
}

function bindEvents() {
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  els.menuButton.addEventListener('click', () => els.menuOverlay.classList.remove('hidden'));
  els.menuOverlay.addEventListener('click', event => {
    if (event.target === els.menuOverlay) closeMenu();
  });
  els.menuOverlay.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      state.activeView = button.dataset.view;
      closeMenu();
      render();
    });
  });
  els.tabs.forEach(button => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      state.openItemId = null;
      render();
    });
  });
  els.refreshButton.addEventListener('click', async () => {
    await loadState();
    await render();
  });
  els.resetButton.addEventListener('click', restoreOriginalItinerary);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeMenu();
      requestCloseModal(editModal);
      requestCloseModal(newItemModal);
    }
  });
}

async function loadState() {
  state.items = await getAllItems();
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

function isSampleItem(item) {
  return item.TripID === 'trip-001' || /^item-00\d$/.test(item.ItemID || '');
}

async function render() {
  els.homeSection.classList.toggle('hidden', state.activeView !== 'home');
  els.budgetSection.classList.toggle('hidden', state.activeView !== 'budget');
  els.settingsSection.classList.toggle('hidden', state.activeView !== 'settings');
  els.viewTitle.textContent = state.activeView === 'budget' ? 'Presupuesto' : state.activeView === 'settings' ? 'Configuración' : 'Agenda de viaje';
  if (state.activeView === 'home') renderHome();
  if (state.activeView === 'budget') await renderBudget();
  if (state.activeView === 'settings') await renderSettings();
}

function renderHome() {
  els.tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === state.activeTab));
  const visibleItems = state.items.filter(item => getItemPlanningStatus(item) === state.activeTab);
  renderDays(visibleItems);
}

function renderDays(items) {
  els.dayList.innerHTML = '';
  for (const day of state.days) {
    const dayItems = items.filter(item => (item.DayDate || item.StartDate) === day.DayDate).sort(compareItems);
    const total = dayItems.reduce((sum, item) => sum + getFinancialAmount(item), 0);
    const isOpen = state.openDayKey === day.DayDate;
    const card = document.createElement('article');
    card.className = 'day-card';
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

function renderItem(item) {
  const isOpen = state.openItemId === item.ItemID;
  const itemEl = document.createElement('article');
  itemEl.className = 'agenda-item';
  const time = item.IsAllDay ? 'Todo el día' : (item.StartTime || '');
  itemEl.innerHTML = `
    <div class="item-summary" role="button" tabindex="0" aria-expanded="${isOpen}">
      <span class="item-time">${escapeHtml(time)}</span>
      <span class="item-title">${escapeHtml(getDisplayTitle(item))}</span>
      <span class="item-meta">
        <span class="category category-${escapeHtml((item.ItemType || 'OTHER').toLowerCase())}">${escapeHtml(getCategoryLabel(item.ItemType))}</span>
        <span class="item-price">${formatItemAmount(item)}</span>
        ${item.GoogleMapsUrl || item.GooglePlusCode ? `<a class="map-button" target="_blank" rel="noopener" href="${escapeHtml(getMapUrl(item))}">${escapeHtml(item.GooglePlusCode || 'Mapas')}</a>` : ''}
        <span class="planning-toggle" role="group" aria-label="Estado de planificación">
          <button type="button" data-status="CONFIRMED" aria-pressed="${getItemPlanningStatus(item) === 'CONFIRMED'}" class="${getItemPlanningStatus(item) === 'CONFIRMED' ? 'active' : ''}">Confirmado</button>
          <button type="button" data-status="PROPOSED" aria-pressed="${getItemPlanningStatus(item) === 'PROPOSED'}" class="${getItemPlanningStatus(item) === 'PROPOSED' ? 'active' : ''}">Propuesto</button>
        </span>
      </span>
    </div>
    <div class="item-details${isOpen ? '' : ' hidden'}">${renderDetails(item)}</div>
  `;

  const summary = itemEl.querySelector('.item-summary');
  let holdTimer = null;
  let ignoreClick = false;
  summary.addEventListener('pointerdown', event => {
    if (event.button && event.button !== 0) return;
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
    openEditModal(item);
  });
  summary.addEventListener('click', event => {
    if (ignoreClick) {
      event.preventDefault();
      ignoreClick = false;
      return;
    }
    if (event.target.closest('a, .planning-toggle')) return;
    state.openItemId = isOpen ? null : item.ItemID;
    renderHome();
  });
  summary.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('a, .planning-toggle')) return;
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
  itemEl.querySelectorAll('a').forEach(link => link.addEventListener('click', event => event.stopPropagation()));
  return itemEl;
}

async function updatePlanningStatus(item, PlanningStatus) {
  if (getItemPlanningStatus(item) === PlanningStatus) return;
  const updated = { ...item, PlanningStatus, SyncStatus: 'LOCAL_PENDING', LastUpdatedAt: new Date().toISOString() };
  await updateItem(updated);
  state.activeTab = PlanningStatus;
  state.openDayKey = updated.DayDate || updated.StartDate || null;
  state.openItemId = updated.ItemID;
  els.statusSync.textContent = 'Cambios locales pendientes';
  await loadState();
  await render();
}

async function renderBudget() {
  const confirmed = state.items.filter(item => getItemPlanningStatus(item) === 'CONFIRMED');
  const uniqueConfirmed = uniqueFinancialItems(confirmed);
  const proposed = uniqueFinancialItems(state.items.filter(item => getItemPlanningStatus(item) === 'PROPOSED'));
  const budget = Number(await getSetting('tripBudgetUSD', 6000) || 0);
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
  const budget = await getSetting('tripBudgetUSD', 6000);
  const rows = getLogicalRows();
  const snapshots = getSnapshots();
  els.settingsSection.innerHTML = `
    <div class="settings-panel">
      <label>Presupuesto total del viaje (USD)<input id="budgetInput" type="number" min="0" step="0.01" value="${Number(budget || 0)}" /></label>
      <div class="settings-actions">
        <button id="saveBudgetButton" class="primary-button" type="button">Guardar presupuesto</button>
        <button id="newItemButton" class="secondary-button" type="button">Nuevo item</button>
      </div>
      <p id="settingsMessage" class="settings-message"></p>
    </div>
    <section class="backup-panel">
      <header class="data-manager-header">
        <div>
          <h2>Backup y restauración</h2>
          <p>${snapshots.length} snapshots locales guardados</p>
        </div>
      </header>
      <div class="settings-actions">
        <button id="exportBackupButton" class="primary-button" type="button">Exportar backup completo</button>
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
  `;
  document.getElementById('saveBudgetButton').addEventListener('click', async () => {
    const value = Number(document.getElementById('budgetInput').value || 0);
    const message = document.getElementById('settingsMessage');
    if (Number.isNaN(value) || value < 0) {
      message.textContent = 'El presupuesto no puede ser negativo.';
      return;
    }
    await setSetting('tripBudgetUSD', value);
    message.textContent = 'Presupuesto guardado';
  });
  document.getElementById('newItemButton').addEventListener('click', openNewItemModal);
  bindBackupManager();
  bindDataManager();
}

function bindBackupManager() {
  document.getElementById('exportBackupButton').addEventListener('click', exportBackup);
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

async function buildBackupPayload() {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    datasetId: getActiveDatasetId(),
    trip: getTripMetadata(),
    items: getLogicalExportItems(),
    budget: { tripBudgetUSD: Number(await getSetting('tripBudgetUSD', 6000) || 0) },
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

function getLogicalExportItems() {
  return uniqueFinancialItems(state.items).map(item => ({ ...item, ItemID: getLogicalKey(item), SourceItemID: getLogicalKey(item) }));
}

function getTripMetadata() {
  return {
    tripId: 'TRIP_ITALY_2026',
    title: 'Italy 2026',
    dayCount: state.days.length,
    startDate: state.days[0]?.DayDate || '',
    endDate: state.days[state.days.length - 1]?.DayDate || ''
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
  const localKeys = new Set(getLogicalRows().map(row => row.ItemID));
  (data?.items || []).forEach((item, index) => {
    const key = getLogicalKey(item);
    if (!key) errors.push(`items[${index}]: ItemID requerido.`);
    if (seen.has(key)) errors.push(`items[${index}]: ItemID duplicado (${key}).`);
    seen.add(key);
    if (localKeys.has(key)) conflicts.push(key);
    if (!isValidDate(item.StartDate || item.DayDate)) errors.push(`items[${index}]: fecha inválida.`);
    if (item.EndDate && !isValidDate(item.EndDate)) errors.push(`items[${index}]: EndDate inválida.`);
    const amount = Number(item.AmountUSD || 0);
    if (Number.isNaN(amount) || amount < 0) errors.push(`items[${index}]: AmountUSD inválido.`);
    if (!PLANNING_STATUSES.includes(item.PlanningStatus || getPlanningStatus(item.Status))) errors.push(`items[${index}]: PlanningStatus inválido.`);
    if (item.PaymentStatus && !PAYMENT_STATUSES.includes(item.PaymentStatus)) errors.push(`items[${index}]: PaymentStatus inválido.`);
  });
  const budget = Number(data?.budget?.tripBudgetUSD ?? 0);
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
    budget: Number(data?.budget?.tripBudgetUSD || 0),
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
  setBackupMessage('Backup restaurado en modo reemplazar.');
}

async function applyBackupMerge(data) {
  if (!state.pendingBackup || !confirm('Combinar backup con la data actual? Se creará un snapshot antes.')) return;
  await createDataSnapshot('Antes de combinar backup');
  const choices = getConflictChoices();
  const localKeys = new Set(getLogicalRows().map(row => row.ItemID));
  for (const imported of data.items) {
    const key = getLogicalKey(imported);
    if (!localKeys.has(key) || choices.get(key) === 'imported') {
      await upsertLogicalRow(localKeys.has(key) ? key : '', normalizeImportedItem(imported));
      await loadState();
    }
  }
  await loadState();
  els.statusSync.textContent = 'Backup combinado';
  await render();
  setBackupMessage('Backup combinado. Los conflictos se resolvieron según tu selección.');
}

function getConflictChoices() {
  return new Map([...document.querySelectorAll('[data-conflict-key]')].map(select => [select.dataset.conflictKey, select.value]));
}

async function restoreDatasetPayload(payload) {
  const items = payload.items || [];
  const budget = payload.budget?.tripBudgetUSD;
  const restored = items.map(normalizeImportedItem).map(item => buildItemFromData(item, new Date().toISOString()));
  await replaceDatasetItems(restored, isActiveDatasetItem);
  if (budget !== undefined) await setSetting('tripBudgetUSD', Number(budget || 0));
  if (Array.isArray(payload.preferences?.days)) {
    state.days = payload.preferences.days;
    localStorage.setItem(ITALY_DAYS_KEY, JSON.stringify(state.days));
  }
  localStorage.setItem(ITALY_DATASET_MARK_KEY, payload.datasetId || getActiveDatasetId());
  await loadState();
  state.openDayKey = null;
  state.openItemId = null;
  els.statusSync.textContent = 'Data local restaurada';
  await render();
}

function normalizeImportedItem(item) {
  const key = getLogicalKey(item);
  return {
    ItemID: key,
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
    GooglePlusCode: item.GooglePlusCode || '',
    GoogleMapsUrl: item.GoogleMapsUrl || '',
    Notes: item.Notes || ''
  };
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
  if (column === 'IsPaid') return `<select data-field="${column}"><option value="false"${value ? '' : ' selected'}>false</option><option value="true"${value ? ' selected' : ''}>true</option></select>`;
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
    GooglePlusCode: item.GooglePlusCode || '',
    GoogleMapsUrl: item.GoogleMapsUrl || '',
    Notes: item.Notes || ''
  }));
}

function readDataRow(rowEl) {
  const data = {};
  DATA_COLUMNS.forEach(column => {
    const input = rowEl.querySelector(`[data-field="${column}"]`);
    data[column] = input ? input.value.trim() : '';
  });
  if (!data.ItemID) data.ItemID = `local-${crypto.randomUUID()}`;
  data.AmountUSD = Number(data.AmountUSD || 0);
  data.IsPaid = data.IsPaid === 'true';
  return data;
}

async function saveDataRow(rowEl) {
  const originalKey = rowEl.dataset.key;
  const data = readDataRow(rowEl);
  const error = validateDataRow(data, originalKey);
  if (error) return setDataMessage(error, true);
  await upsertLogicalRow(originalKey, data);
  await loadState();
  state.openDayKey = data.StartDate;
  state.openItemId = data.ItemID;
  setDataMessage('Fila guardada.');
  renderSettings();
}

async function addLogicalRow() {
  const date = state.days[0]?.DayDate || new Date().toISOString().slice(0, 10);
  const data = {
    ItemID: `local-${crypto.randomUUID()}`,
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
    GooglePlusCode: '',
    GoogleMapsUrl: '',
    Notes: ''
  };
  await upsertLogicalRow('', data);
  await loadState();
  setDataMessage('Nueva fila creada.');
  renderSettings();
}

async function duplicateDataRow(rowEl) {
  const data = readDataRow(rowEl);
  data.ItemID = `local-${crypto.randomUUID()}`;
  data.Title = `${data.Title} copia`;
  await upsertLogicalRow('', data);
  await loadState();
  setDataMessage('Fila duplicada.');
  renderSettings();
}

async function deleteDataRow(rowEl) {
  const key = rowEl.dataset.key;
  if (!confirm('Eliminar este ItemID lógico y sus apariciones visuales?')) return;
  await createDataSnapshot('Antes de eliminar ItemID lógico');
  await replaceItemsByPredicate([], item => getLogicalKey(item) === key);
  await loadState();
  setDataMessage('Fila eliminada.');
  renderSettings();
}

async function upsertLogicalRow(originalKey, data) {
  const now = new Date().toISOString();
  const related = state.items.filter(item => getLogicalKey(item) === originalKey);
  if (related.length === 0) {
    const item = buildItemFromData(data, now);
    await addItem(item);
    return;
  }
  for (const item of related) {
    const shouldMoveDay = related.length === 1 || isChargeOccurrence(item) || item.DayDate === item.StartDate;
    await updateItem({
      ...item,
      ...data,
      ItemID: item.ItemID,
      SourceItemID: data.ItemID,
      DayDate: shouldMoveDay ? data.StartDate : item.DayDate,
      StartDate: data.StartDate,
      EndDate: data.EndDate,
      Status: data.PlanningStatus === 'CONFIRMED' ? 'CONFIRMED' : 'PLANNED',
      LastUpdatedAt: now,
      SyncStatus: 'LOCAL_PENDING'
    });
  }
}

function buildItemFromData(data, now) {
  return {
    ...data,
    SourceItemID: data.ItemID,
    DatasetID: ITALY_DATASET_ID,
    TripID: 'TRIP_ITALY_2026',
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
  const rows = parseTsvRows(text);
  const errors = [];
  const seen = new Set();
  rows.forEach((row, index) => {
    if (row._columnCount !== DATA_COLUMNS.length) errors.push(`Fila ${index + 1}: columnas ${row._columnCount}/${DATA_COLUMNS.length}.`);
    if (seen.has(row.ItemID)) errors.push(`Fila ${index + 1}: ItemID duplicado en pegado.`);
    seen.add(row.ItemID);
    const error = validateDataRow(row, row.ItemID);
    if (error && !getLogicalRows().some(existing => existing.ItemID === row.ItemID)) errors.push(`Fila ${index + 1}: ${error}`);
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
  return lines.map(line => {
    const cells = line.split('\t');
    const row = {};
    DATA_COLUMNS.forEach((column, index) => {
      row[column] = (cells[index] || '').trim();
    });
    if (!row.ItemID) row.ItemID = `local-${crypto.randomUUID()}`;
    row.AmountUSD = Number(row.AmountUSD || 0);
    row.IsPaid = String(row.IsPaid).toLowerCase() === 'true';
    row._columnCount = cells.length;
    return row;
  });
}

async function importTsvRows(rows) {
  await createDataSnapshot('Antes de importar TSV');
  for (const row of rows) {
    await upsertLogicalRow(getLogicalRows().some(existing => existing.ItemID === row.ItemID) ? row.ItemID : '', row);
    await loadState();
  }
  await loadState();
  setDataMessage(`${rows.length} filas importadas.`);
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
    budget: { tripBudgetUSD: Number(await getSetting('tripBudgetUSD', 6000) || 0) },
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
  if (!confirm('Restaurar datos originales del viaje? Esto elimina modificaciones locales de los items de Italy 2026.')) return;
  const itinerary = await loadItalyItinerary();
  await createDataSnapshot('Antes de restaurar originales del viaje');
  state.days = itinerary.days;
  await replaceItemsByPredicate(itinerary.items, item => item.DatasetID === ITALY_DATASET_ID || item.TripID === 'TRIP_ITALY_2026');
  localStorage.setItem(ITALY_DATASET_MARK_KEY, ITALY_DATASET_ID);
  localStorage.setItem(ITALY_DAYS_KEY, JSON.stringify(state.days));
  state.openDayKey = null;
  state.openItemId = null;
  await loadState();
  els.statusSync.textContent = 'Datos originales del viaje restaurados';
  await render();
}

function openEditModal(item) {
  state.editingItem = item;
  fillForm(editModal.form, item);
  state.editInitialValue = getFormSnapshot(editModal.form);
  editModal.el.classList.remove('hidden');
  editModal.form.elements.Title.focus();
}

function openNewItemModal() {
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
  newItemModal.el.classList.remove('hidden');
  newItemModal.form.elements.Title.focus();
}

async function saveEditForm(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const error = validateItemForm(data);
  if (error) return setModalError(editModal, error);
  const updated = {
    ...state.editingItem,
    ...data,
    AmountUSD: Number(data.AmountUSD),
    IsAllDay: event.currentTarget.elements.IsAllDay.checked,
    IsPaid: event.currentTarget.elements.IsPaid.checked,
    LastUpdatedAt: new Date().toISOString(),
    SyncStatus: 'LOCAL_PENDING'
  };
  await updateItem(updated);
  state.openDayKey = updated.DayDate;
  state.openItemId = updated.ItemID;
  closeModal(editModal);
  await loadState();
  els.statusSync.textContent = 'Cambios locales pendientes';
  await render();
}

async function saveNewItemForm(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const error = validateItemForm(data);
  if (error) return setModalError(newItemModal, error);
  const item = {
    ...data,
    ItemID: `local-${crypto.randomUUID()}`,
    DatasetID: ITALY_DATASET_ID,
    TripID: 'TRIP_ITALY_2026',
    AmountUSD: Number(data.AmountUSD),
    Currency: 'USD',
    Status: data.PlanningStatus === 'CONFIRMED' ? 'CONFIRMED' : 'PLANNED',
    IsAllDay: event.currentTarget.elements.IsAllDay.checked,
    IsPaid: event.currentTarget.elements.IsPaid.checked,
    IsMultiDay: false,
    StartDate: data.DayDate,
    EndDate: data.DayDate,
    LodgingDisplayMode: 'NORMAL',
    SortOrder: Date.now(),
    LastUpdatedAt: new Date().toISOString(),
    SyncStatus: 'LOCAL_PENDING'
  };
  await addItem(item);
  state.activeTab = item.PlanningStatus;
  state.activeView = 'home';
  state.openDayKey = item.DayDate;
  state.openItemId = item.ItemID;
  closeModal(newItemModal);
  await loadState();
  els.statusSync.textContent = 'Nuevo item guardado';
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
        <footer class="edit-actions"><button type="button" class="secondary-button" data-cancel>Cancelar</button><button type="submit" class="primary-button">Guardar</button></footer>
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
  return { ACTIVITY: 'Actividad', FLIGHT: 'Vuelo', FOOD: 'Comida', LODGING: 'Hospedaje', TRANSPORT: 'Transporte' }[type] || 'Otro';
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
  return item.SourceItemID || item.ItemID;
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
}

function closeMenu() {
  els.menuOverlay.classList.add('hidden');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
