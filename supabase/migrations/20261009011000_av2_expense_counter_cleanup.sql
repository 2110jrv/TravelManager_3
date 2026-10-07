-- Deleting an explicitly removed trip cleans only its counter; expense tombstones never reset it.
alter table av2_expense_counters drop constraint av2_expense_counters_trip_id_fkey;
alter table av2_expense_counters add constraint av2_expense_counters_trip_id_fkey foreign key(trip_id) references av2_trips on delete cascade;
