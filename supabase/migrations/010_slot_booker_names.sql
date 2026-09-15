-- Include only the booking name in occupied-slot summaries, for approved members only.
begin;
create or replace function public.get_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare uid public.profiles.id%type;adm boolean:=public.is_admin();sup boolean:=public.is_super_admin();admitted boolean:=public.is_member();
 begin
 if auth.jwt()->>'role'='authenticated' and exists(select 1 from public.profiles where id=auth.uid()) then uid:=auth.uid();end if;
 return jsonb_build_object(
 'equipment',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from public.equipment e),'[]'::jsonb),
 'profiles',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.profiles p where uid is not null and (p.id=uid or sup or (adm and p.membership_status='approved'))),'[]'::jsonb),
 'bookings',coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from public.bookings b where admitted and (adm or b.user_id=uid)),'[]'::jsonb),
 'notices',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc) from public.notices n where n.user_id=uid),'[]'::jsonb),
 'violations',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc) from public.violations v where admitted and (adm or v.user_id=uid)),'[]'::jsonb),
 'busy',coalesce((select jsonb_agg(jsonb_build_object('equipment_id',b.equipment_id,'user_name',b.user_name,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status)) from public.bookings b where admitted and b.status in ('pending','approved','in_use')),'[]'::jsonb),
 'applications',coalesce((select jsonb_agg(jsonb_build_object(
  'id',a.id,'user_id',p.id,'name',p.name,'email',p.email,'student_id',p.student_id,'project',p.project,
  'requested_role',a.requested_role,'status',p.membership_status,'score',a.score,'rules_version',a.rules_version,
  'created_at',a.created_at,'reviewed_at',a.reviewed_at,'reviewer_name',r.name,'review_note',a.review_note) order by a.created_at desc)
  from private.membership_applications a join public.profiles p on p.id=a.user_id left join public.profiles r on r.id=a.reviewed_by
  where uid is not null and (sup or p.id=uid)),'[]'::jsonb));
 end
$$;
commit;
