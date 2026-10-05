import { TRIP } from './config.js';
export function normalizeEvent(raw, colors = {}, labels = {}) {
  const block = /\[AGENDA_VIAJERA\]([\s\S]*?)\[\/AGENDA_VIAJERA\]/.exec(raw.description || '');
  const fields = Object.fromEntries([...(block?.[1] || '').matchAll(/\b(COST|CURRENCY|COST_STATUS)\s*=\s*([^\s]+)/g)].map(match => [match[1], match[2]]));
  const cost = fields.COST !== undefined && /^\d+(\.\d+)?$/.test(fields.COST) ? Number(fields.COST) : null;
  const currency = /^[A-Z]{3}$/.test(fields.CURRENCY || '') ? fields.CURRENCY : null;
  const status = ['PAID', 'ESTIMATED'].includes(fields.COST_STATUS) ? fields.COST_STATUS : null;
  const labelId = raw.eventLabelId || raw.event_label_id || raw.extendedProperties?.shared?.LABEL_ID || raw.extendedProperties?.private?.LABEL_ID || null;
  return { id: raw.id, title: raw.summary || 'Sin título', description: raw.description || '',
    start: raw.start?.dateTime || raw.start?.date, end: raw.end?.dateTime || raw.end?.date,
    allDay: !!raw.start?.date, timezone: raw.start?.timeZone || TRIP.timezone, location: raw.location || '',
    label: labelId ? { id: labelId, name: labels[labelId]?.name || (typeof labels[labelId] === 'string' ? labels[labelId] : null) || raw.extendedProperties?.shared?.LABEL_NAME || null, color: labels[labelId]?.background_color || null } : null,
    color_id: raw.colorId || raw.color_id || null, color: colors[raw.colorId || raw.color_id]?.background || null,
    cost, currency, cost_status: status, purchase_status: /^✅/.test(raw.summary || '') ? 'PAID' : /^☐/.test(raw.summary || '') ? 'PENDING' : null,
    recurring_event_id: raw.recurringEventId || null, original_start: raw.originalStartTime || null,
    deleted_at: raw.status === 'cancelled' ? raw.updated || new Date().toISOString() : null, updated_at: raw.updated, html_link: raw.htmlLink || null };
}
export function dateKey(now = new Date(), timezone = TRIP.timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function occursOn(event, day) {
  if (event.deleted_at || !event.start || !event.end) return false;
  if (event.allDay) return event.start <= day && day < event.end;
  const first = dateKey(new Date(event.start), event.timezone);
  const last = dateKey(new Date(new Date(event.end).getTime() - 1), event.timezone);
  return first <= day && day <= last;
}
export function days() {
  const result = [];
  for (let time = Date.parse(`${TRIP.start}T12:00:00Z`); time <= Date.parse(`${TRIP.end}T12:00:00Z`); time += 86400000) result.push(new Date(time).toISOString().slice(0, 10));
  return result;
}
export function finance(events, expenses, budget = null) {
  let paid = 0, estimated = 0; const missing = [];
  const unique = [...new Map(events.filter(x => !x.deleted_at).map(x => [x.id, x])).values()];
  for (const item of [...unique.map(x => ({ ...x, amount: x.cost })), ...expenses.filter(x => !x.deleted_at).map(x => ({ id: x.id, ...x.data }))]) {
    if (item.amount == null || !item.cost_status) continue;
    const equivalent = item.currency === TRIP.currency ? item.amount : item.base_amount ?? (item.exchange_rate != null ? item.amount * item.exchange_rate : null);
    if (equivalent == null) { missing.push(item); continue; }
    if (item.cost_status === 'PAID') paid += Number(equivalent); else if (item.cost_status === 'ESTIMATED') estimated += Number(equivalent);
  }
  return { paid, estimated, projected: paid + estimated, budget, difference: budget == null ? null : budget - paid - estimated, missing };
}
export function mergeFields(current, operation) {
  if (current?.deleted_at) return { record: current, conflicts: operation.deleted_at ? [] : [{ field: 'deleted_at', current: current.deleted_at, incoming: operation.changes }] };
  const data = { ...(current?.data || {}) }, conflicts = [];
  for (const [field, value] of Object.entries(operation.changes)) {
    const remote = data[field] ?? null, base = operation.base[field] ?? null;
    if (JSON.stringify(remote) !== JSON.stringify(base) && JSON.stringify(remote) !== JSON.stringify(value)) conflicts.push({ field, base, current: remote, incoming: value });
    else data[field] = value;
  }
  if (operation.deleted_at && current && current.version !== operation.base_version) conflicts.push({ field: 'deleted_at', current: current.data, incoming: operation.deleted_at });
  return { record: { ...current, data }, conflicts };
}
