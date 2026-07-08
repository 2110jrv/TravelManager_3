export function renderDayCards(items, container) {
  container.innerHTML = '';
  const groups = groupItemsByDay(items);
  for (const day of groups) {
    const card = document.createElement('article');
    card.className = 'card';

    const title = document.createElement('div');
    title.className = 'card-title';
    title.innerHTML = `<div><strong>${day.label}</strong><div class="card-meta">${day.location} · Total: $${day.total.toFixed(2)}</div></div>`;

    const details = document.createElement('div');
    details.className = 'day-items hidden';
    details.innerHTML = day.items.map(item => `<div class="card card-item"><strong>${item.StartTime || 'Todo el día'}</strong> — ${item.Title} — $${item.AmountUSD.toFixed(2)}</div>`).join('');

    title.addEventListener('click', () => {
      details.classList.toggle('hidden');
    });

    card.append(title, details);
    container.append(card);
  }
}

function groupItemsByDay(items) {
  const map = new Map();
  items.sort((a,b) => (a.DayDate || '').localeCompare(b.DayDate || '') || (a.StartTime || '').localeCompare(b.StartTime || ''));
  for (const item of items) {
    const key = item.DayDate || 'Sin fecha';
    const row = map.get(key) || { date: key, items: [], total: 0, location: item.City || item.LocationLabel || '' };
    row.items.push(item);
    row.total += Number(item.AmountUSD || 0);
    map.set(key, row);
  }

  return Array.from(map.values()).map(row => ({
    label: formatDayLabel(row.date),
    location: row.location,
    items: row.items,
    total: row.total
  }));
}

function formatDayLabel(dateString) {
  if (!dateString) return 'Día sin fecha';
  const date = new Date(dateString);
  if (isNaN(date)) return dateString;
  return `Día · ${date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })}`;
}
