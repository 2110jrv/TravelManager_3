# Supabase Sync Plan

TravelManager 3 uses Supabase Auth, row level security, Supabase cloud tables, and IndexedDB so the public GitHub Pages app can sync safely across PC, phone, and tablet browsers.

## Auth and RLS

The GitHub Pages app is public static code, so every browser-visible key must be treated as public. Browser code may use the Supabase project URL and a publishable key, but it must never expose a `service_role` key, database password, or any other secret.

Supabase Auth is required so each browser signs in as a real user. Every synced row has `user_id uuid references auth.users(id)`, and RLS policies enforce `auth.uid() = user_id` for select, insert, update, and delete. This prevents public browser clients from reading or writing another user's sync rows.

## Tables

`public.tm3_trips` stores one row per trip. `trip_id` is the app-level primary key, and the trip document is stored in `payload`.

`public.tm3_trip_days` stores one row per trip day. `day_id` is the app-level primary key, `trip_id` links the day to a trip, and `payload` stores the day details.

`public.tm3_items` stores itinerary, packing, planning, and other trip items. `item_id` is the app-level primary key, `trip_id` links the item to a trip, `source_item_id` can preserve a source relationship, `day_date` supports day-based queries, and `payload` stores the item body.

`public.tm3_settings` stores per-user settings. The primary key is `(user_id, setting_key)` so each user owns an independent value for each setting.

`public.tm3_deletion_queue` stores deletion events for sync reconciliation. It records `entity_type`, `entity_id`, optional `trip_id`, metadata in `payload`, and the same sync metadata used by the other tables.

## JSON payloads

The first sync schema uses `payload jsonb` so the static app can evolve local object shapes without a database migration for every UI field. Stable sync metadata remains in typed columns: ownership, ids, timestamps, deletion state, version, device id, and practical query fields.

## Conflict rule

For the first version, conflicts are resolved by last write wins using `updated_at`. When two devices edit the same entity, the row with the newest `updated_at` is authoritative. The update trigger also increments `version` on every update so later sync versions can add stronger conflict handling.

## Offline rule

IndexedDB keeps the app usable while the browser is offline. Users can keep viewing and editing cached data without a network connection. When the browser is online again and the user is authenticated, sync resumes by pushing local pending changes and pulling newer Supabase rows.

## Supabase SQL Editor

Open the Supabase Dashboard for `https://cslludzuejkhsydqiabx.supabase.co`, go to SQL Editor, and run `supabase/schema.sql`.

The SQL creates the sync tables, indexes, authenticated table grants, RLS policies, update trigger function, per-table triggers, and safe realtime publication additions when the `supabase_realtime` publication exists.

## Secret handling

Do not put a `service_role` key, database password, or secret key in GitHub Pages, JavaScript bundles, IndexedDB, localStorage, or documentation. Browser code should only use the Supabase project URL and a publishable browser-safe key with Auth and RLS enabled.

## Auth client phase

The auth client phase is complete. The static app now has `public/src/supabaseClient.js`, which creates the browser Supabase client with the project URL and publishable key only. It exposes helpers for session lookup, current user lookup, email/password sign up, email/password sign in, sign out, and auth state changes.

Configuracion includes a "Sincronizacion en la nube" section. Signed-out users see local-only status, email/password fields, "Crear cuenta", and "Iniciar sesion". Signed-in users see their email, "Cerrar sesion", and the placeholder "Sync automatico se activara en el proximo paso."

Local-only mode remains the default when no user is signed in or the network is unavailable. IndexedDB continues to hold the active trip, itinerary edits, backup/restore data, and Data Manager changes. Signing out only ends the Supabase session; it does not delete local IndexedDB data.

Signed-in mode currently confirms identity and preserves the existing local IndexedDB behavior. This phase does not upload, download, merge, or delete Supabase sync rows.

The next phase will implement actual data sync: mapping IndexedDB records into the Supabase sync tables, pulling newer rows, pushing local pending changes, honoring deletion records, and resolving first-version conflicts with last `updated_at` wins.

## Automatic sync v1

Automatic sync v1 is implemented in `public/src/syncSupabase.js`. IndexedDB remains the immediate local source for the UI, and Supabase stores the signed-in user's cloud copy. The app starts sync after sign in, on app load when a session exists, when the browser returns online, after local edits/imports/deletions, every 60 seconds while signed in and online, and when best-effort Realtime events arrive.

The sync mapping is:

- IndexedDB `trips` to `public.tm3_trips`
- IndexedDB `tripDays` to `public.tm3_trip_days`
- IndexedDB `items` to `public.tm3_items`
- IndexedDB `settings` to `public.tm3_settings`
- IndexedDB `deletionQueue` to `public.tm3_deletion_queue`

Every pushed cloud row includes the authenticated `user_id`, the local record as `payload`, a browser `device_id` when available, and the best available timestamp from the local record. If a local record has no known timestamp, sync generates a current timestamp before pushing.

Conflict handling is last-write-wins. Cloud `updated_at` is authoritative for cloud rows. Local records use `UpdatedAt`, `updatedAt`, `UpdatedOn`, `ModifiedAt`, `LastUpdatedAt`, or deletion timestamps where available. If cloud is newer, the cloud payload is written into IndexedDB. If local is newer or the cloud row is missing, the local record is pushed. If timestamps are equal, sync does nothing.

Local edit protection is active for status toggles, item edits, trip/day edits, deletion tombstones, Data Manager saves, imports, and backup restores. Local mutation paths stamp `UpdatedAt`, `ModifiedAt`, and `updatedAt`, increment `Version`, and register the changed entity in memory for a short protection window. A queued sync pushes local changes before pulling, and pull/realtime-triggered sync skips older cloud rows when the local timestamp or recent-change marker is newer. This prevents stale Supabase payloads from reverting a fresh browser edit.

Deletion handling is conservative. Local deletion queue rows are pushed to Supabase, cloud deletion queue rows are pulled locally, and tombstones can prevent older entities from being resurrected. Sync v1 does not perform destructive bulk deletes and does not clear IndexedDB.

When offline, local edits continue and sync state becomes offline or pending. When the browser returns online, sync resumes automatically. Signing out stops cloud sync but does not delete IndexedDB data.

Configuracion now shows signed-in user, sync state, last sync time, "Sincronizar ahora", and the local-first explanation. Manual sync is available for debugging, but normal operation is automatic.

## Sync v1 limitations

- Last-write-wins only; no per-field conflict UI yet.
- Realtime is best-effort; 60-second polling is the fallback.
- Tombstone handling is intentionally conservative and avoids destructive bulk cleanup.
- Manual backup/export is still recommended before travel or before large imports.

## Public GitHub Pages deployment

Production target: `https://2110jrv.github.io/TravelManager_3/`.

GitHub Pages should use Source: GitHub Actions. The workflow at `.github/workflows/deploy-pages.yml` publishes the `public` folder directly, so Jonathan's PC does not need to stay on after the commit is pushed and GitHub Pages finishes deploying.

The app is path-safe for both local development at `http://127.0.0.1:5003/` and GitHub Pages under `/TravelManager_3/`. Static assets, the manifest, Leaflet files, itinerary data, and service worker registration use relative URLs or runtime scope detection.

Add these Supabase Auth redirect URLs in the Supabase Dashboard:

- `http://127.0.0.1:5003/**`
- `https://2110jrv.github.io/TravelManager_3/**`

Sync remains local-first and automatic. IndexedDB is still the immediate source for the UI, local edits continue offline, and cloud sync resumes when the browser is online and signed in. Manual backup/export is still recommended before travel or before large imports.

## Access modes, completion, and PDF report

The app now opens behind a local PIN screen before trip data, navigation, agenda, map, budget, or settings are shown. The PIN selects a local UI role stored in `localStorage`: family, traveler, or admin. Switching the app role only clears the local UI role; it does not sign out of Supabase and does not delete IndexedDB data.

These PIN roles are a convenience layer for shared device use, not strong security. Supabase Auth and RLS remain the real data protection model for cloud rows.

Role behavior:

- Family sees Inicio and Mapa only, confirmed items only, no proposed items, no budget/prices/payment summaries, and no edit/configuration controls.
- Traveler sees Inicio, Calendario, and Mapa, with confirmed and proposed items, but no editing, Data Manager, dangerous actions, or Supabase settings.
- Admin keeps the full app, including editing, planning status changes, backup/restore, Data Manager, completion controls, and report export.

Item completion is stored directly on item payloads as `Completed`, `CompletedAt`, and `CompletedByRole`. Admin completion toggles stamp `UpdatedAt`, `ModifiedAt`, and `updatedAt`, increment `Version`, mark the item as locally changed, and queue cloud sync immediately. Because `tm3_items.payload` syncs the full item object, these completion fields travel across signed-in devices through the existing local-first sync flow.

Completed items keep their planned `StartDate`, `StartTime`, `EndDate`, and `EndTime`. For visible agenda ordering only, a completed item uses `CompletedAt` as its effective date/time. Budget calculations continue to use planning/payment fields, not completion state.

Configuracion now includes an admin-only "Descargar reporte PDF completo" action. It opens a print-ready Letter portrait HTML report for the active trip, grouped by day and ordered by the same effective agenda time rule. The browser print dialog can save the report as PDF without a server or extra dependency.

Agenda detail expansion is also local-first. Inicio keeps collapsed item cards as level 0, opens a readable summary as level 1, and can expand "Datos completos" as level 2 for meaningful payload fields. Day headers open the item list first; when already open, they toggle "Detalles del dia" if day-level notes or context fields exist. Family mode still hides every money, price, payment, paid/pending, budget, total, fee, USD, and currency field in collapsed and expanded agenda UI.

## Visible time and role clocks

Visible itinerary times are formatted for users in 12-hour AM/PM style. Stored values such as `StartTime` and `EndTime` may remain as internal `HH:mm` values for validation, sorting, forms, imports, IndexedDB, and Supabase payload sync, but normal UI rendering converts them for display. Examples: `08:00` shows as `8:00 AM`, `13:30` as `1:30 PM`, `00:05` as `12:05 AM`, and `12:00` as `12:00 PM`.

After PIN access, the app shows a compact role-based clock header. Family access shows two clocks: device local time and a destination clock resolved from the current itinerary context. The resolver works offline using an internal known-location map and checks explicit timezone fields before city/country text matching.

Timezone priority is: open item explicit fields, open day explicit fields, active trip explicit fields, open item text, open day text, active trip text, Italy 2026 fallback, browser timezone, then UTC. Future trips should define explicit `Timezone`, `TimeZone`, `IanaTimezone`, `TripTimezone`, `LocationTimezone`, or `DestinationTimezone` fields on trip, day, or item records when possible.

Italy 2026 remains a supported fallback using `Europe/Rome`. Known city context can label the Family destination clock as `Hora en Roma`, `Hora en Venecia`, `Hora en Santo Domingo`, `Hora en New York`, `Hora en Japón`, or another supported destination. If the destination is uncertain, the app uses `Hora en destino`.

Admin and traveler access show one compact local device clock labeled `Hora actual`. The PIN screen does not show the app clock, agenda, menu, map, budget, or settings before access is granted.

## Item start and end date-time editing

Admin item create/edit now treats `StartDate`, `StartTime`, `EndDate`, and `EndTime` as the complete scheduling fields for an item. New items created from an open day default both dates to that selected day, while existing items load `StartDate` first and fall back to `DayDate` when older data does not have a separate start date.

On save, `EndDate` defaults to `StartDate` when left blank, `DayDate` is derived from `StartDate`, and multiday state is calculated from the start/end date range. Invalid ranges are blocked before local save: the start date is required, the end date cannot be earlier than the start date, and same-day end times cannot be earlier than start times.

The sync payload continues to store the full item object in `tm3_items.payload`, so these fields travel through the existing local-first IndexedDB and Supabase sync path without a schema change. Visible itinerary rendering continues to format user-facing times as AM/PM, while internal form and sync values remain compatible with the existing `HH:mm` validation and sorting behavior.
