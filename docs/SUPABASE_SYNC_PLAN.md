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
