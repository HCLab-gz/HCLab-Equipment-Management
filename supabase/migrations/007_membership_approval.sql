-- Optional Supabase backend: same membership review policy, with native UUID identities.
-- Promote the verified initial super administrator separately as database owner.
begin;
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('user','admin','super_admin'));
-- Existing members retain admission; only subsequently created profiles default to pending.
alter table public.profiles add column membership_status text not null default 'approved'
  check(membership_status in ('pending','approved','rejected'));
alter table public.profiles alter column membership_status set default 'pending';
alter table public.profiles add constraint unapproved_profile_has_no_privileges
  check(membership_status='approved' or role='user');
create unique index one_super_administrator on public.profiles(role) where role='super_admin';
create table private.membership_applications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references public.profiles(id),
  requested_role text not null check(requested_role in ('user','admin')),
  exam_id uuid not null, score integer not null check(score=100), rules_version text not null,
  created_at timestamptz not null default now(), reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id), review_note text not null default '' check(length(review_note)<=1000)
);
revoke all on private.membership_applications from public,anon,authenticated;

create or replace function public.is_member() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'role'='authenticated',false) and exists(
 select 1 from public.profiles where id=auth.uid() and membership_status='approved')
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'role'='authenticated',false) and exists(
 select 1 from public.profiles where id=auth.uid() and membership_status='approved' and role in ('admin','super_admin')
 and not banned and (suspended_until is null or suspended_until<=now()))
$$;
create function public.is_super_admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'role'='authenticated',false) and exists(
 select 1 from public.profiles where id=auth.uid() and membership_status='approved' and role='super_admin'
 and not banned and (suspended_until is null or suspended_until<=now()))
$$;
create function private.require_identity() returns public.profiles language plpgsql security definer set search_path='' as $$
 declare p public.profiles;
 begin
 if coalesce(auth.jwt()->>'role','')<>'authenticated' then raise exception '请先登录';end if;
 select * into p from public.profiles where id=auth.uid();
 if p.id is null then raise exception '请先登录';end if;
 return p;
 end
$$;
create or replace function private.require_user(p_admin boolean default false) returns public.profiles language plpgsql security definer set search_path='' as $$
 declare p public.profiles;
 begin
 p:=private.require_identity();
 if p.membership_status<>'approved' then raise exception '注册申请尚未通过审核，暂不能使用设备功能';end if;
 if p_admin and not public.is_admin() then raise exception '仅管理员可以执行此操作';end if;
 return p;
 end
$$;
create or replace function private.check_access(p public.profiles) returns void language plpgsql set search_path='' as $$
 begin
 if p.membership_status<>'approved' then raise exception '注册申请尚未通过审核';end if;
 if p.banned or p.suspended_until>now() then raise exception '准入权限已停用，请联系管理员';end if;
 end
$$;
create or replace function public.mark_notices_read() returns void language plpgsql security definer set search_path='' as $$
 begin perform private.require_identity();update public.notices set read=true where user_id=auth.uid();end
$$;

drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using(
 auth.jwt()->>'role'='authenticated' and (id=auth.uid() or public.is_super_admin() or (public.is_admin() and membership_status='approved')));
drop policy bookings_read on public.bookings;
create policy bookings_read on public.bookings for select to authenticated using(public.is_member() and (user_id=auth.uid() or public.is_admin()));
drop policy violations_read on public.violations;
create policy violations_read on public.violations for select to authenticated using(public.is_member() and (user_id=auth.uid() or public.is_admin()));

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
 'busy',coalesce((select jsonb_agg(jsonb_build_object('equipment_id',b.equipment_id,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status)) from public.bookings b where admitted and b.status in ('pending','approved','in_use')),'[]'::jsonb),
 'applications',coalesce((select jsonb_agg(jsonb_build_object(
  'id',a.id,'user_id',p.id,'name',p.name,'email',p.email,'student_id',p.student_id,'project',p.project,
  'requested_role',a.requested_role,'status',p.membership_status,'score',a.score,'rules_version',a.rules_version,
  'created_at',a.created_at,'reviewed_at',a.reviewed_at,'reviewer_name',r.name,'review_note',a.review_note) order by a.created_at desc)
  from private.membership_applications a join public.profiles p on p.id=a.user_id left join public.profiles r on r.id=a.reviewed_by
  where uid is not null and (sup or p.id=uid)),'[]'::jsonb));
 end
$$;

create function private.queue_membership(p public.profiles,p_requested text,p_exam_id uuid,p_score integer,p_version text) returns void language plpgsql security definer set search_path='' as $$
 declare reviewer public.profiles;
 begin
 select * into reviewer from public.profiles where role='super_admin' and membership_status='approved' and not banned and (suspended_until is null or suspended_until<=now());
 if reviewer.id is null then raise exception '尚未配置可用的超级管理员，请稍后再提交申请';end if;
 insert into private.membership_applications(user_id,requested_role,exam_id,score,rules_version)
 values(p.id,p_requested,p_exam_id,p_score,p_version);
 perform private.notify(p.id,'注册申请已提交','满分考试已通过，正在等待超级管理员核实实验室成员身份。审核通过前不能预约或管理设备。');
 perform private.notify(reviewer.id,'新的注册申请',p.name||' 申请成为'||case when p_requested='admin' then '管理员' else '普通成员' end||'，请前往管理后台的注册审核核实身份。');
 end
$$;
create function public.review_membership(p_id uuid,p_action text,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
 declare actor public.profiles;app private.membership_applications;target public.profiles;new_status text;
 begin
 perform pg_advisory_xact_lock(504505);
 actor:=private.require_identity();
 if not public.is_super_admin() then raise exception '仅超级管理员可以审核注册申请';end if;
 if p_action is null or p_action not in ('approve','reject') then raise exception '请选择同意或拒绝';end if;
 if p_note is null or length(p_note)>1000 then raise exception '审核说明不符合要求';end if;
 if p_action='reject' and length(btrim(p_note))<2 then raise exception '请填写拒绝原因';end if;
 select * into app from private.membership_applications where id=p_id for update;
 if app.id is null then raise exception '注册申请不存在';end if;
 select * into target from public.profiles where id=app.user_id for update;
 if target.id=actor.id or target.role='super_admin' then raise exception '不能审核自己的身份或修改超级管理员';end if;
 new_status:=case when p_action='approve' then 'approved' else 'rejected' end;
 if target.membership_status<>'pending' then
   if target.membership_status=new_status then return jsonb_build_object('id',app.id,'status',new_status);end if;
   raise exception '该申请已审核，请刷新后查看结果';
 end if;
 if app.score<>100 then raise exception '须通过满分考试才可审核';end if;
 update public.profiles set membership_status=new_status,role=case when p_action='approve' then app.requested_role else 'user' end where id=target.id;
 update private.membership_applications set reviewed_at=now(),reviewed_by=actor.id,review_note=btrim(p_note) where id=app.id;
 perform private.notify(target.id,case when p_action='approve' then '注册申请已通过' else '注册申请未通过' end,
 case when p_action='approve' then '成员身份已核实，你已获准以'||case when app.requested_role='admin' then '管理员' else '普通成员' end||'身份使用平台。'
 else '原因：'||btrim(p_note)||'。如需复核，请联系超级管理员。' end);
 return jsonb_build_object('id',app.id,'status',new_status);
 end
$$;

-- Keep the existing asset and violation logic; extend approved administrator roles only.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.save_equipment(jsonb)'::regprocedure);
 if position('and role=''admin''' in definition)=0 then raise exception 'Unexpected manager check';end if;
 definition:=replace(definition,'and role=''admin''','and role in (''admin'',''super_admin'') and membership_status=''approved'' and not banned and (suspended_until is null or suspended_until<=now())');
 execute definition;
end
$migration$;
revoke execute on all functions in schema private from public,anon,authenticated;
revoke execute on function public.is_member(),public.is_super_admin(),public.review_membership(uuid,text,text) from public,anon,authenticated;
grant execute on function public.is_member(),public.is_super_admin(),public.review_membership(uuid,text,text) to authenticated;
create or replace function private.verify_registration() returns trigger language plpgsql security definer set search_path='' as $$
 declare attempt private.exam_attempts;requested text:=coalesce(new.raw_user_meta_data->>'requested_role','user');
 begin
 if requested not in ('user','admin') then raise exception '申请身份只能选择普通成员或管理员';end if;
 select * into attempt from private.exam_attempts where token::text=new.raw_user_meta_data->>'exam_token' for update;
 if attempt.id is null or not attempt.completed or attempt.score is distinct from 100 or attempt.consumed or attempt.expires_at<now() or attempt.email<>lower(btrim(new.email)) or attempt.rules_version not in ('2026-09-v2','2026-09-v3') then raise exception '请先阅读条例并通过准入考试；合格凭证只能使用一次';end if;
 if length(btrim(coalesce(new.raw_user_meta_data->>'name',''))) not between 1 and 80 or length(btrim(coalesce(new.raw_user_meta_data->>'student_id',''))) not between 1 and 80 then raise exception '请完整填写姓名和学号';end if;
 update private.exam_attempts set consumed=true where id=attempt.id;
 new.raw_user_meta_data:=(new.raw_user_meta_data-'role'-'exam_token')||jsonb_build_object('accepted_rules_version',attempt.rules_version,'accepted_exam_id',attempt.id,'accepted_exam_score',attempt.score,'requested_role',requested);
 return new;
 end
$$;
create or replace function private.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
 declare applicant public.profiles;
 begin
 insert into public.profiles(id,name,email,student_id,project,role,rules_version,membership_status)
 values(new.id,btrim(new.raw_user_meta_data->>'name'),lower(btrim(new.email)),btrim(new.raw_user_meta_data->>'student_id'),left(coalesce(new.raw_user_meta_data->>'project',''),120),'user',new.raw_user_meta_data->>'accepted_rules_version','pending') returning * into applicant;
 perform private.queue_membership(applicant,new.raw_user_meta_data->>'requested_role',(new.raw_user_meta_data->>'accepted_exam_id')::uuid,(new.raw_user_meta_data->>'accepted_exam_score')::integer,new.raw_user_meta_data->>'accepted_rules_version');
 return new;
 end
$$;
revoke execute on all functions in schema private from public,anon,authenticated;
commit;
