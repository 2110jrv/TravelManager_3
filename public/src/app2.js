import { addItem, getAllItems, getSetting, openDatabase, replaceItemsByPredicate, setSetting, updateItem } from './db.js';
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
  newInitialValue: ''
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
  render();
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
    render();
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

function render() {
  els.homeSection.classList.toggle('hidden', state.activeView !== 'home');
  els.budgetSection.classList.toggle('hidden', state.activeView !== 'budget');
  els.settingsSection.classList.toggle('hidden', state.activeView !== 'settings');
  els.viewTitle.textContent = state.activeView === 'budget' ? 'Presupuesto' : state.activeView === 'settings' ? 'Configuración' : 'Agenda de viaje';
  if (state.activeView === 'home') renderHome();
  if (state.activeView === 'budget') renderBudget();
  if (state.activeView === 'settings') renderSettings();
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
  render();
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
  els.settingsSection.innerHTML = `
    <div class="settings-panel">
      <label>Presupuesto total del viaje (USD)<input id="budgetInput" type="number" min="0" step="0.01" value="${Number(budget || 0)}" /></label>
      <div class="settings-actions">
        <button id="saveBudgetButton" class="primary-button" type="button">Guardar presupuesto</button>
        <button id="newItemButton" class="secondary-button" type="button">Nuevo item</button>
      </div>
      <p id="settingsMessage" class="settings-message"></p>
    </div>
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
}

async function restoreOriginalItinerary() {
  if (!confirm('Restaurar datos originales del viaje? Esto elimina modificaciones locales de los items de Italy 2026.')) return;
  const itinerary = await loadItalyItinerary();
  state.days = itinerary.days;
  await replaceItemsByPredicate(itinerary.items, item => item.DatasetID === ITALY_DATASET_ID || item.TripID === 'TRIP_ITALY_2026');
  localStorage.setItem(ITALY_DATASET_MARK_KEY, ITALY_DATASET_ID);
  localStorage.setItem(ITALY_DAYS_KEY, JSON.stringify(state.days));
  state.openDayKey = null;
  state.openItemId = null;
  await loadState();
  els.statusSync.textContent = 'Datos originales del viaje restaurados';
  render();
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
  render();
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
  render();
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
          <label>PaymentStatus<select name="PaymentStatus"><option value="NOT_PAID">NOT_PAID</option><option value="RESERVED">RESERVED</option><option value="PAID">PAID</option><option value="PARTIAL">PARTIAL</option></select></label>
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

function updateOnlineStatus() {
  els.statusOnline.textContent = navigator.onLine ? 'Online' : 'Offline';
}

function closeMenu() {
  els.menuOverlay.classList.add('hidden');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
