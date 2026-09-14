-- CloudBase JS SDK 3.9.3 parses scalar UUID RPC responses as JSON and throws
-- after the write has committed. Return an object so successful writes can be
-- acknowledged correctly. Keep the original RPCs and their permissions intact.
begin;

create function public.create_booking_result(p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('id',public.create_booking(p_data))
$$;

create function public.save_equipment_result(p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('id',public.save_equipment(p_data))
$$;

revoke execute on function public.create_booking_result(jsonb),public.save_equipment_result(jsonb)
from public,anon,authenticated;
grant execute on function public.create_booking_result(jsonb),public.save_equipment_result(jsonb)
to authenticated;
commit;
