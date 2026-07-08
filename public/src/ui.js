export function renderDayCards(items, container, options = {}) {
  container.innerHTML = '';
  if (!Array.isArray(items) || items.length === 0) {
    renderEmptyState(container, 'No hay items cargados.');
    return;
  }

  for (const day of groupAgendaItemsByDay(items)) {
    const isDayOpen = options.openDayKeys?.has(day.key) === true;
    const card = document.createElement('article');
    card.className = 'day-card';

    const button = document.createElement('button');
    button.className = 'day-summary';
    button.type = 'button';
    button.setAttribute('aria-expanded', String(isDayOpen));

    const summaryText = document.createElement('span');
    summaryText.className = 'day-summary-text';
    summaryText.innerHTML = `
      <strong>${escapeHtml(day.label)}</strong>
      <span>${escapeHtml(day.location || 'Sin ciudad')} • Total: ${formatMoney(day.total, day.currency)}</span>
    `;

    const indicator = document.createElement('span');
    indicator.className = 'expand-indicator';
    indicator.textContent = isDayOpen ? '▾' : '▸';

    const details = document.createElement('div');
    details.className = `day-items${isDayOpen ? '' : ' hidden'}`;

    for (const item of day.items) {
      details.append(renderAgendaItem(item, options));
    }

    button.append(summaryText, indicator);
    button.addEventListener('click', () => {
      const isClosed = details.classList.toggle('hidden');
      button.setAttribute('aria-expanded', String(!isClosed));
      indicator.textContent = isClosed ? '▸' : '▾';
      options.onDayToggle?.(day.key, !isClosed);
    });

    card.append(button, details);
    container.append(card);
  }
}

export function renderEmptyState(container, message) {
  container.innerHTML = `<div class="day-card empty-state"><p>${escapeHtml(message)}</p></div>`;
}

function renderAgendaItem(item, options = {}) {
  const itemEl = document.createElement('article');
  itemEl.className = 'agenda-item';

  const button = document.createElement('button');
  button.className = 'item-summary';
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  let holdTimer = null;
  let ignoreClick = false;

  const timeLabel = document.createElement('span');
  timeLabel.className = 'item-time';
  timeLabel.textContent = item.IsAllDay ? 'Todo el día' : (item.StartTime || '');

  const titleLabel = document.createElement('span');
  titleLabel.className = 'item-title';
  titleLabel.textContent = getDisplayTitle(item);

  const meta = document.createElement('span');
  meta.className = 'item-meta';

  const category = document.createElement('span');
  category.className = `category category-${(item.ItemType || 'OTHER').toLowerCase()}`;
  category.textContent = getCategoryLabel(item.ItemType);

  const price = document.createElement('span');
  price.className = 'item-price';
  price.textContent = formatMoney(Number(item.AmountUSD || 0), item.Currency || 'USD');

  meta.append(category, price);
  const mapAction = createMapAction(item);
  if (mapAction) meta.append(mapAction);

  const editButton = document.createElement('span');
  editButton.className = 'edit-chip';
  editButton.textContent = 'Editar';
  editButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    options.onEditItem?.(item);
  });
  meta.append(editButton);

  const details = document.createElement('div');
  details.className = 'item-details hidden';
  details.innerHTML = [
    item.Description,
    item.Notes,
    item.Address,
    item.GooglePlusCode ? `Plus Code: ${item.GooglePlusCode}` : ''
  ].filter(Boolean).map(value => `<p>${escapeHtml(value)}</p>`).join('');

  button.append(timeLabel, titleLabel, meta);
  button.addEventListener('pointerdown', event => {
    if (event.button && event.button !== 0) return;
    holdTimer = window.setTimeout(() => {
      ignoreClick = true;
      options.onEditItem?.(item);
    }, 600);
  });

  button.addEventListener('pointerup', () => {
    window.clearTimeout(holdTimer);
  });

  button.addEventListener('pointerleave', () => {
    window.clearTimeout(holdTimer);
  });

  button.addEventListener('pointercancel', () => {
    window.clearTimeout(holdTimer);
  });

  button.addEventListener('contextmenu', event => {
    event.preventDefault();
    window.clearTimeout(holdTimer);
    options.onEditItem?.(item);
  });

  button.addEventListener('click', event => {
    if (ignoreClick) {
      event.preventDefault();
      ignoreClick = false;
      return;
    }
    const isClosed = details.classList.toggle('hidden');
    button.setAttribute('aria-expanded', String(!isClosed));
  });

  itemEl.append(button, details);
  return itemEl;
}

function groupAgendaItemsByDay(items) {
  const map = new Map();
  for (const item of [...items].sort(compareAgendaItems)) {
    const key = item.DayDate || item.StartDate || 'Sin fecha';
    const row = map.get(key) || {
      date: key,
      items: [],
      total: 0,
      location: item.City || item.LocationLabel || '',
      currency: item.Currency || 'USD'
    };
    row.items.push(item);
    row.total += Number(item.AmountUSD || 0);
    if (!row.location && (item.City || item.LocationLabel)) row.location = item.City || item.LocationLabel;
    map.set(key, row);
  }

  return Array.from(map.values()).map(row => ({
    key: row.date,
    label: formatAgendaDayLabel(row.date),
    location: row.location,
    items: row.items,
    total: row.total,
    currency: row.currency
  }));
}

function compareAgendaItems(a, b) {
  const dateCompare = (a.DayDate || a.StartDate || '').localeCompare(b.DayDate || b.StartDate || '');
  if (dateCompare !== 0) return dateCompare;
  const allDayCompare = Number(Boolean(a.IsAllDay)) - Number(Boolean(b.IsAllDay));
  if (allDayCompare !== 0) return allDayCompare;
  const timeCompare = (a.StartTime || '').localeCompare(b.StartTime || '');
  if (timeCompare !== 0) return timeCompare;
  return Number(a.SortOrder || 0) - Number(b.SortOrder || 0);
}

function getDisplayTitle(item) {
  if (item.ItemType !== 'LODGING') return item.Title || 'Sin título';
  if (item.LodgingDisplayMode === 'CHECK_IN') return `Check-in: ${item.Title}`;
  if (item.LodgingDisplayMode === 'CHECK_OUT') return `Check-out: ${item.Title}`;
  if (item.LodgingDisplayMode === 'FULL_DAY') return `Hospedaje: ${item.Title}`;
  return item.Title || 'Hospedaje';
}

function createMapAction(item) {
  if (!item.GoogleMapsUrl && !item.GooglePlusCode) return null;
  const link = document.createElement('a');
  link.className = 'map-button';
  link.href = item.GoogleMapsUrl || `https://maps.google.com/?q=${encodeURIComponent(item.GooglePlusCode)}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = item.GooglePlusCode || 'Mapas';
  link.addEventListener('click', event => event.stopPropagation());
  return link;
}

function getCategoryLabel(type = 'OTHER') {
  const labels = {
    ACTIVITY: 'Actividad',
    FLIGHT: 'Vuelo',
    FOOD: 'Comida',
    LODGING: 'Hospedaje',
    TRANSPORT: 'Transporte'
  };
  return labels[type] || 'Otro';
}

function formatAgendaDayLabel(dateString) {
  if (!dateString) return 'Día sin fecha';
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return `Día • ${date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })}`;
}

function formatMoney(amount, currency = 'USD') {
  return new Intl.NumberFormat('es-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(amount || 0);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}
