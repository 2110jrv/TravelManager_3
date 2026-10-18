create function public.av2_trip_configuration(p_trip uuid,p_device uuid,p_token text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if not av2_authenticate_device(p_trip,p_device,p_token) or p_trip<>'7c0801ee-07b1-4d86-95d7-202610200001'::uuid then raise exception 'AV2_DEVICE_NOT_AUTHORIZED';end if;
 return '{"id":"7c0801ee-07b1-4d86-95d7-202610200001","name":"Italia 2026","start":"2026-10-20","end":"2026-11-05","timezone":"Europe/Rome","travelers":["Jonathan","Jenny"],"currency":"USD","calendarId":"eee85f5d7c0e07fc9a8174d8a3bc640a9b0327901c9f09059d196c1058f5d346@group.calendar.google.com","drive":{"root":"1jY6BLvJDy4PqWQ6iRqztcT-vOmUvBkKI","trip":"1uoM3Fti_Cr8nvrPGs_pU7ojs6DJowL98","documents":"1B3k8rHiBy4DhVSU3f9Ik3e4sXbWWazXv","receipts":"1O2d0I_ynIFOMCgFCnJPU0zCpt1KEQyiT","app":"1gqsdkC5i7a_ytGvBwYwMOEDM5NJ_fMHz","exports":"1itHjXNdzdO3ap4AfP0WgJbxZIgQotyTb"}}'::jsonb;
end $$;
revoke all on function public.av2_trip_configuration(uuid,uuid,text) from public,anon;
grant execute on function public.av2_trip_configuration(uuid,uuid,text) to authenticated;
