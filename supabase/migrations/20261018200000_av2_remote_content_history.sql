-- Prepared only: apply after 20261018190000 with explicit owner authorization.
-- Return audit metadata, never stored patches/snapshots or device credentials.
create function public.av2_remote_content_history(
 p_trip uuid,p_device uuid,p_token text,p_place uuid,p_after uuid default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare access jsonb; oauth_client text; items jsonb; next_id uuid;
begin
 access=av2_schedule_access(p_trip,p_device,p_token);
 oauth_client=nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'client_id';
 if oauth_client is not null and not exists(
  select 1 from av2_remote_grants g where g.auth_user_id=auth.uid() and g.client_id::text=oauth_client
   and g.trip_id=p_trip and g.actor_user=(access->>'user_id')::uuid and g.device_id=p_device
   and g.revoked_at is null and g.expires_at>now()
 ) then raise exception 'REMOTE_OAUTH_GRANT_REVOKED';end if;
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'REMOTE_INVALID_LIMIT';end if;
 if p_place is null or not exists(select 1 from av2_places_of_interest where trip_id=p_trip and id=p_place and deleted_at is null)
  or av2_remote_is_private(p_trip,p_place) then raise exception 'REMOTE_NOT_FOUND';end if;
 select coalesce(jsonb_agg(row order by id),'[]'::jsonb) into items from (
  select h.id,jsonb_build_object('history_id',h.id,'place_id',p_place,'tool',h.request->>'tool',
   'changed_fields',h.changed_fields,'record_id',h.result->'record'->>'id',
   'result_version',h.result->'record'->'version','created_at',h.created_at) row
  from av2_remote_history h where h.trip_id=p_trip and h.request->>'tool' in ('update_place_notes','update_place_description','update_audio_guide','update_place_guide','rollback_content')
   and h.changed_fields <@ array['notes','description','audio_guide','experience','affinity','prices','sources_say','safety','questions','dairy','limitations','sources','reviewed_at']::text[]
   and (p_after is null or h.id>p_after)
   and (h.result->'record'->>'id'=p_place::text or h.result->'record'->'data'->>'place_id'=p_place::text)
  order by h.id limit p_limit+1
 ) page;
 if jsonb_array_length(items)>p_limit then
  items=items-(jsonb_array_length(items)-1);next_id=(items->(p_limit-1)->>'history_id')::uuid;
 end if;
 return jsonb_build_object('items',items,'next_after',next_id);
end $$;
revoke all on function public.av2_remote_content_history(uuid,uuid,text,uuid,uuid,integer) from public,anon;
grant execute on function public.av2_remote_content_history(uuid,uuid,text,uuid,uuid,integer) to authenticated;
