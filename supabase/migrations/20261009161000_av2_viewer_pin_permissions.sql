-- Add the agenda role gate without replacing existing actor/version/field checks.
do $$declare definition text;begin
 select pg_get_functiondef('public.av2_place_apply(uuid,uuid,text,jsonb)'::regprocedure) into definition;
 if position('AV2_AGENDA_READ_ONLY' in definition)=0 then
  definition=regexp_replace(definition,'begin',E'begin\n if not (public.av2_schedule_access(p_trip,p_device,p_token)->>''can_edit'')::boolean then raise exception ''AV2_AGENDA_READ_ONLY'';end if;','i');
  execute definition;
 end if;
end$$;
