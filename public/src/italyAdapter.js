export const ITALY_DATASET_ID = 'italy-2026';
export const ITALY_DATASET_MARK_KEY = 'tm3.dataset';
export const ITALY_DAYS_KEY = 'tm3.days.italy-2026';

export async function loadItalyItinerary() {
  const response = await fetch('./data/italy-2026.json');
  if (!response.ok) throw new Error('No se pudo cargar italy-2026.json');
  return adaptItalyItinerary(await response.json());
}

export function adaptItalyItinerary(source) {
  const trip = source?.trips?.[0] || {};
  const tripId = trip.id || trip.raw?.TripID || 'TRIP_ITALY_2026';
  const days = (trip.days || [])
    .map((day, index) => ({
      DayID: day.id || day.raw?.TripDayID || `day-${day.date}`,
      TripDayID: day.id || day.raw?.TripDayID || `TD_${tripId}_${day.date}`,
      TripID: tripId,
      DayOrder: index + 1,
      DayDate: day.date || day.raw?.Date || '',
      Date: day.date || day.raw?.Date || '',
      DayLabel: cleanText(day.raw?.DayLabel || day.label || ''),
      Title: cleanText(day.raw?.Title || day.title || ''),
      City: cleanText(day.raw?.PrimaryCity || day.city || ''),
      PrimaryCity: cleanText(day.raw?.PrimaryCity || day.city || ''),
      CountryCode: day.raw?.PrimaryCountryCode || '',
      PrimaryCountryCode: day.raw?.PrimaryCountryCode || '',
      Notes: cleanText(day.raw?.DayNotes || ''),
      DayNotes: cleanText(day.raw?.DayNotes || ''),
      DayImageUrl: day.raw?.DayImageUrl || ''
    }))
    .sort((a, b) => a.DayDate.localeCompare(b.DayDate));

  const sourceItems = [];
  days.forEach((day, dayIndex) => {
    const sourceDay = (trip.days || []).find(row => (row.date || row.raw?.Date) === day.DayDate);
    (sourceDay?.items || []).forEach((entry, itemIndex) => {
      sourceItems.push(adaptItem(entry, day, dayIndex, itemIndex));
    });
  });
  const items = expandItemOccurrences(sourceItems, days);

  return {
    datasetId: ITALY_DATASET_ID,
    trip: {
      TripID: tripId,
      TripName: cleanText(trip.raw?.TripName || trip.name || 'Italy_2026'),
      TripTitle: cleanText(trip.raw?.TripTitle || trip.name || 'Italy 2026'),
      StartDate: trip.startDate || '',
      EndDate: trip.endDate || '',
      BudgetAmount: Number(trip.raw?.BudgetAmount ?? trip.raw?.BudgetAmountUSD ?? 6000),
      BudgetCurrencyCode: trip.raw?.BudgetCurrencyCode || 'USD',
      BudgetAmountUSD: Number(trip.raw?.BudgetAmountUSD ?? trip.raw?.BudgetAmount ?? 6000),
      Notes: cleanText(trip.raw?.Notes || '')
    },
    tripDays: days.map(day => ({
      TripDayID: day.TripDayID,
      TripID: day.TripID,
      DayOrder: day.DayOrder,
      Date: day.Date,
      DayLabel: day.DayLabel,
      Title: day.Title,
      PrimaryCity: day.PrimaryCity,
      PrimaryCountryCode: day.PrimaryCountryCode,
      DayNotes: day.DayNotes,
      DayImageUrl: day.DayImageUrl
    })),
    days,
    items
  };
}

function adaptItem(entry, day, dayIndex, itemIndex) {
  const raw = entry.raw || {};
  const sourceId = raw.ItemID || entry.id || `ITEM_${dayIndex}_${itemIndex}`;
  const appearance = entry.appearance || {};
  const type = normalizeType(raw.ItemType || entry.category || 'OTHER');
  const lodgingMode = getLodgingMode(type, appearance.label);
  const isFullDayLodging = lodgingMode === 'FULL_DAY';

  return {
    ItemID: `${ITALY_DATASET_ID}:${day.DayDate}:${sourceId}:${itemIndex}`,
    SourceItemID: sourceId,
    DatasetID: ITALY_DATASET_ID,
    TripID: raw.TripID || day.TripID,
    DayID: day.DayID,
    DayDate: day.DayDate,
    ItemType: type,
    Title: cleanText(raw.Title || entry.title || 'Sin título'),
    Subtitle: cleanText(raw.Subtitle || ''),
    StartTime: isFullDayLodging ? '' : cleanTime(raw.StartTime || entry.time || ''),
    EndTime: isFullDayLodging ? '' : cleanTime(raw.EndTime || ''),
    Description: cleanText(entry.summary || raw.Subtitle || ''),
    Provider: cleanText(raw.Provider || ''),
    Status: raw.Status || entry.visibility?.status || 'PLANNED',
    PlanningStatus: getPlanningStatus(raw.Status || entry.visibility?.status),
    IsPaid: raw.IsPaid === true,
    PaymentStatus: raw.PaymentStatus || 'NOT_PAID',
    AmountUSD: Number(raw.AmountUSD ?? 0),
    Currency: 'USD',
    CountryCode: raw.CountryCode || day.CountryCode || '',
    City: cleanText(raw.City || day.City || ''),
    Address: '',
    LocationLabel: cleanText(raw.LocationLabel || entry.locationName || ''),
    GoogleMapsUrl: raw.GoogleMapsUrl || entry.googleMapsUrl || '',
    GooglePlusCode: raw.GooglePlusCode || '',
    Latitude: raw.Latitude ?? null,
    Longitude: raw.Longitude ?? null,
    WebsiteUrl: raw.WebsiteUrl || entry.documentLinks?.[0]?.url || '',
    BookingReference: raw.BookingReference || entry.bookingReference || '',
    Notes: cleanText(raw.Notes || entry.notes || ''),
    ItemImageUrl: raw.ItemImageUrl || '',
    ItemImageCaption: cleanText(raw.ItemImageCaption || ''),
    IsAllDay: raw.IsAllDay === true || isFullDayLodging || !cleanTime(raw.StartTime || entry.time || ''),
    IsMultiDay: raw.IsMultiDay === true,
    StartDate: raw.StartDate || day.DayDate,
    EndDate: raw.EndDate || day.DayDate,
    LodgingDisplayMode: lodgingMode,
    SortOrder: dayIndex * 1000 + itemIndex,
    LastUpdatedAt: new Date().toISOString(),
    SyncStatus: 'SYNCED'
  };
}

function expandItemOccurrences(sourceItems, days) {
  const daysByDate = new Map(days.map(day => [day.DayDate, day]));
  const groups = new Map();
  sourceItems.forEach(item => {
    const key = item.SourceItemID || item.ItemID;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  const occurrences = [];
  groups.forEach(group => {
    const first = pickSourceRow(group);
    const start = first.StartDate || first.DayDate;
    const end = first.EndDate || start;
    const dates = getDateRange(start, end).filter(date => daysByDate.has(date));
    const occurrenceDates = dates.length ? dates : [first.DayDate || start];

    occurrenceDates.forEach(date => {
      const day = daysByDate.get(date) || daysByDate.get(first.DayDate) || {};
      const sourceForDate = group.find(item => item.DayDate === date) || first;
      const meta = getOccurrenceMeta(first, date);
      occurrences.push({
        ...first,
        ...sourceForDate,
        ItemID: `${ITALY_DATASET_ID}:${date}:${first.SourceItemID}`,
        DayID: day.DayID || sourceForDate.DayID,
        DayDate: date,
        City: sourceForDate.City || day.City || first.City,
        CountryCode: sourceForDate.CountryCode || day.CountryCode || first.CountryCode,
        StartTime: meta.startTime,
        EndTime: meta.endTime,
        AmountUSD: meta.amount,
        IsAllDay: meta.isAllDay,
        LodgingDisplayMode: meta.lodgingMode,
        OccurrenceRole: meta.role,
        IncludedLabel: meta.includedLabel,
        SortOrder: Number(first.SortOrder || 0) + meta.sortOffset
      });
    });
  });

  const unique = new Map();
  occurrences.forEach(item => {
    const key = `${item.SourceItemID || item.ItemID}:${item.DayDate}`;
    if (!unique.has(key)) unique.set(key, item);
  });
  return [...unique.values()].sort((a, b) => (a.DayDate || '').localeCompare(b.DayDate || '') || Number(a.SortOrder || 0) - Number(b.SortOrder || 0));
}

function pickSourceRow(group) {
  const sorted = [...group].sort((a, b) => Number(a.SortOrder || 0) - Number(b.SortOrder || 0));
  const start = sorted[0]?.StartDate || sorted[0]?.DayDate;
  return sorted.find(item => item.DayDate === start) || sorted[0];
}

function getOccurrenceMeta(item, date) {
  const start = item.StartDate || item.DayDate;
  const end = item.EndDate || start;
  const isMultiDay = end > start;
  const isLodging = item.ItemType === 'LODGING';
  const isStart = date === start;
  const isEnd = date === end;
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

function getDateRange(start, end) {
  if (!start || !end || end < start) return start ? [start] : [];
  const dates = [];
  const current = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function normalizeType(type) {
  const normalized = String(type || 'OTHER').toUpperCase();
  const allowed = new Set(['ACTIVITY', 'FLIGHT', 'FOOD', 'LODGING', 'TRANSPORT']);
  if (allowed.has(normalized)) return normalized;
  if (normalized === 'SHOPPING') return 'OTHER';
  if (normalized === 'LOGISTICS') return 'OTHER';
  if (normalized === 'TOUR') return 'ACTIVITY';
  return 'OTHER';
}

export function getPlanningStatus(status) {
  if (String(status || '').toUpperCase() === 'CONFIRMED') return 'CONFIRMED';
  return 'PROPOSED';
}

function getLodgingMode(type, label = '') {
  if (type !== 'LODGING') return 'NORMAL';
  if (label === 'check-in') return 'CHECK_IN';
  if (label === 'check-out') return 'CHECK_OUT';
  if (label === 'stay' || label === 'stayover') return 'FULL_DAY';
  return 'NORMAL';
}

function cleanTime(value) {
  const text = String(value || '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : '';
}

function cleanText(value) {
  return String(value ?? '')
    .replaceAll('\u00c3\u00b3', 'ó')
    .replaceAll('\u00c3\u00a9', 'é')
    .replaceAll('\u00c3\u00ad', 'í')
    .replaceAll('\u00c3\u00a1', 'á')
    .replaceAll('\u00c3\u00ba', 'ú')
    .replaceAll('\u00c3\u00b1', 'ñ')
    .replaceAll('\u00c3\u00bc', 'ü')
    .replaceAll('\u00e2\u0086\u0092', '→')
    .replaceAll('\u00e2\u0080\u00a2', '•')
    .replaceAll('\u00e2\u0082\u00ac', '€')
    .replaceAll('\u00c3\u009a', 'Ú')
    .replaceAll('\u00c5\u00a1', '')
    .trim();
}
