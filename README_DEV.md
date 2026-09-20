# Agenda Viajera · desarrollo

Instalar dependencias con `npm install` y arrancar con `npm start`.

Validación rápida: `npm run test:smoke`.

Suite Chromium: `npm run test:e2e`. Playwright inicia un servidor local en el puerto 5003.

El core usa IndexedDB `agenda-viajera-core`, versión 3, con stores por dominio. Para resetear la demo, borrar la base desde DevTools → Application → IndexedDB; no se borran datos de Supabase.

El shell PWA se cachea mediante `agenda-viajera-shell-v1`. Documentos privados simulados permanecen en IndexedDB y no en Cache Storage.

## Estado local

LOCAL/OFFLINE PLATFORM: COMPLETE

PASS: Agenda, Ideas, Budget, Documents, Device security, Restore, Chat, Multi-device sync, Conflict resolution, Tombstones, Audit y offline workflows.

DEFERRED: Map implementation, Photos cloud implementation, Supabase production adapter, Recovery master import y final visual polish.

## Remote backend

`REMOTE_MODE` is controlled explicitly with `globalThis.__AGENDA_VIAJERA_REMOTE_MODE` or `localStorage['agenda-viajera.remoteMode']`. Supported modes are `none`, `mock` (the local default) and `supabase`.

The Supabase browser client uses only `SUPABASE_URL` and the publishable key. It never uses a `service_role` key. Apply `supabase/migrations/20260920090000_agenda_viajera_remote_v1.sql` through the Supabase SQL Editor or the Supabase CLI after reviewing the additive `av_*` namespace. The migration does not import or alter legacy `tm3_*` data.

Exact manual step when CLI credentials are unavailable: open Supabase Dashboard → SQL Editor for `cslludzuejkhsydqiabx.supabase.co`, paste the migration file, review it, and execute it. Until Auth users and active `av_trip_memberships` exist, publishable-key requests without a session are intentionally denied by RLS; the app does not fake remote security.
