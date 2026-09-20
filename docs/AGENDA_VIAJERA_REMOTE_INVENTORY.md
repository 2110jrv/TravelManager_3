# Agenda Viajera remote inventory

The existing Supabase schema is legacy and remains untouched:

- `tm3_trips`
- `tm3_trip_days`
- `tm3_items`
- `tm3_settings`
- `tm3_deletion_queue`
- `tm3_touch_updated_at()` and `tm3_*` policies/triggers/indexes

The remote v1 migration must not reuse these names. New application objects use the `av_` namespace exclusively. No legacy rows are imported by the migration.
