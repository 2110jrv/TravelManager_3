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
  const days = (trip.days || [])
    .map(day => ({
      DayID: day.id || day.raw?.TripDayID || `day-${day.date}`,
      TripID: trip.id || trip.raw?.TripID || 'TRIP_ITALY_2026',
      DayDate: day.date || day.raw?.Date || '',
      DayLabel: cleanText(day.raw?.DayLabel || day.label || ''),
      Title: cleanText(day.raw?.Title || day.title || ''),
      City: cleanText(day.raw?.PrimaryCity || day.city || ''),
      CountryCode: day.raw?.PrimaryCountryCode || '',
      Notes: cleanText(day.raw?.DayNotes || '')
    }))
    .sort((a, b) => a.DayDate.localeCompare(b.DayDate));

  const items = [];
  days.forEach((day, dayIndex) => {
    const sourceDay = (trip.days || []).find(row => (row.date || row.raw?.Date) === day.DayDate);
    (sourceDay?.items || []).forEach((entry, itemIndex) => {
      items.push(adaptItem(entry, day, dayIndex, itemIndex));
    });
  });

  return {
    datasetId: ITALY_DATASET_ID,
    trip: {
      TripID: trip.id || trip.raw?.TripID || 'TRIP_ITALY_2026',
      TripName: cleanText(trip.raw?.TripTitle || trip.name || 'Italy 2026')
    },
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
