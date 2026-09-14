-- Require super-administrator approval after the full-mark admission exam.
-- No real account is promoted by this migration. Bootstrap by verified identity separately.
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
  id uuid primary key default gen_random_uuid(), user_id text not null unique references public.profiles(id),
  requested_role text not null check(requested_role in ('user','admin')),
  exam_id uuid not null, score integer not null check(score=100), rules_version text not null,
  created_at timestamptz not null default now(), reviewed_at timestamptz,
  reviewed_by text references public.profiles(id), review_note text not null default '' check(length(review_note)<=1000)
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

alter table private.registration_intents add column requested_role text not null default 'user' check(requested_role in ('user','admin'));
create or replace function private.claim_registration(p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare
 attempt private.exam_attempts; reservation private.registration_intents;
 v_token uuid:=nullif(p_data->>'token','')::uuid;
 v_email text:=lower(btrim(p_data->>'email'));
 v_name text:=btrim(p_data->>'name');v_student text:=btrim(p_data->>'student_id');v_project text:=btrim(p_data->>'project');
 v_username text:=p_data->>'username';
 v_requested text:=coalesce(p_data->>'requested_role','user');
 begin
 perform pg_advisory_xact_lock(504507);
 if v_requested not in ('user','admin') then raise exception '申请身份只能选择普通成员或管理员';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or exists(
 select 1 from unnest(array['token','email','name','student_id','project','username']) k where jsonb_typeof(p_data->k) is distinct from 'string'
 ) then raise exception '请完整填写有效注册资料';end if;
 if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception '请输入有效邮箱';end if;
 if length(v_name) not between 1 and 80 or length(v_student) not between 1 and 80 or length(v_project) not between 1 and 120
 or v_name ~ '[[:cntrl:]]' or v_student ~ '[[:cntrl:]]' or v_project ~ '[[:cntrl:]]' then raise exception '请完整填写有效姓名、学号和项目';end if;
 if v_username !~ '^hclab_[0-9a-f]{40}$' then raise exception '注册账号标识无效';end if;
 select * into attempt from private.exam_attempts where token=v_token for update;
 if attempt.id is null or not attempt.completed or attempt.score is distinct from 100 or attempt.rules_version not in ('2026-09-v2','2026-09-v3') or attempt.email<>v_email then
 raise exception '请先阅读条例并通过满分准入考试；凭证须与邮箱一致';end if;
 select * into reservation from private.registration_intents where token=v_token for update;
 if reservation.token is not null then
 if (reservation.email,reservation.username,reservation.name,reservation.student_id,reservation.project,reservation.requested_role) is distinct from (v_email,v_username,v_name,v_student,v_project,v_requested) then
 raise exception '考试凭证已绑定其他注册资料，重试资料必须一致';end if;
 -- A pre-existing different native identity must never be adopted or have its password reset.
 if exists(select 1 from auth.users u where u.project='hclab-equipments-d0ehkkk05991a35' and (u.sub=reservation.uid or u.username=reservation.username or lower(btrim(u.email))=v_email)
 and (u.sub is distinct from reservation.uid or u.username is distinct from reservation.username)) then raise exception '原生账号与注册绑定不一致，请联系管理员';end if;
 if reservation.completed then
 if not attempt.consumed or not exists(select 1 from public.profiles p where p.id=reservation.uid and p.email=reservation.email)
 or not exists(select 1 from auth.users u where u.project='hclab-equipments-d0ehkkk05991a35' and u.sub=reservation.uid and u.username=reservation.username) then raise exception '注册账号状态不一致，请联系管理员';end if;
 return jsonb_build_object('uid',reservation.uid,'username',reservation.username,'completed',true);
 end if;
 end if;
 if attempt.consumed or attempt.expires_at<=now() then raise exception '考试凭证已使用或已过期，请重新完成考试';end if;
 if reservation.token is null then
 -- A fresh proof can resume an interrupted registration, even when the original
 -- proof expired. Preserve its identity and all bound personal fields. Retire the
 -- previous proof atomically so a delayed old invocation cannot consume it.
 select * into reservation from private.registration_intents where email=v_email or username=v_username for update;
 if reservation.token is not null then
 if reservation.completed then raise exception '此邮箱已注册，请直接登录';end if;
 if (reservation.email,reservation.username,reservation.name,reservation.student_id,reservation.project,reservation.requested_role) is distinct from (v_email,v_username,v_name,v_student,v_project,v_requested) then
 raise exception '考试凭证已绑定其他注册资料，重试资料必须一致';end if;
 if exists(select 1 from public.profiles where id=reservation.uid or email=v_email)
 or exists(select 1 from auth.users u where u.project='hclab-equipments-d0ehkkk05991a35' and (u.sub=reservation.uid or u.username=reservation.username or lower(btrim(u.email))=v_email)
 and (u.sub is distinct from reservation.uid or u.username is distinct from reservation.username)) then raise exception '原生账号与注册绑定不一致，请联系管理员';end if;
 update private.exam_attempts set consumed=true where token=reservation.token;
 update private.registration_intents set token=v_token where token=reservation.token returning * into reservation;
 return jsonb_build_object('uid',reservation.uid,'username',reservation.username,'completed',false);
 end if;
 if exists(select 1 from public.profiles where email=v_email)
 or exists(select 1 from auth.users u where u.project='hclab-equipments-d0ehkkk05991a35' and (u.username=v_username or lower(btrim(u.email))=v_email)) then raise exception '此邮箱已注册或已绑定账号，请登录或联系管理员';end if;
 insert into private.registration_intents(token,email,username,name,student_id,project,requested_role) values(v_token,v_email,v_username,v_name,v_student,v_project,v_requested) returning * into reservation;
 end if;
 return jsonb_build_object('uid',reservation.uid,'username',reservation.username,'completed',false);
 end
$$;

create or replace function private.finish_registration(p_token uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare attempt private.exam_attempts;reservation private.registration_intents;applicant public.profiles;
 begin
 perform pg_advisory_xact_lock(504507);
 select * into attempt from private.exam_attempts where token=p_token for update;
 select * into reservation from private.registration_intents where token=p_token for update;
 if reservation.token is null or attempt.id is null or not attempt.completed or attempt.score is distinct from 100 or attempt.rules_version not in ('2026-09-v2','2026-09-v3') or attempt.email<>reservation.email then raise exception '考试凭证或注册绑定无效';end if;
 if not exists(select 1 from auth.users u where u.project='hclab-equipments-d0ehkkk05991a35' and u.sub=reservation.uid and u.username=reservation.username)
 or exists(select 1 from auth.users u where u.project='hclab-equipments-d0ehkkk05991a35' and (u.sub=reservation.uid or u.username=reservation.username or lower(btrim(u.email))=reservation.email)
 and (u.sub is distinct from reservation.uid or u.username is distinct from reservation.username)) then raise exception '原生账号尚未创建或与注册绑定不一致';end if;
 if reservation.completed then
 if not attempt.consumed or not exists(select 1 from public.profiles p where p.id=reservation.uid and p.email=reservation.email) then raise exception '注册账号状态不一致，请联系管理员';end if;
 return jsonb_build_object('uid',reservation.uid,'username',reservation.username,'completed',true);
 end if;
 if attempt.consumed or attempt.expires_at<=now() then raise exception '考试凭证已使用或已过期，请重新完成考试';end if;
 -- Role is fixed here; no user-supplied role or native metadata is consulted.
 insert into public.profiles(id,name,email,student_id,project,role,rules_version,membership_status)
 values(reservation.uid,reservation.name,reservation.email,reservation.student_id,reservation.project,'user',attempt.rules_version,'pending') returning * into applicant;
 update private.exam_attempts set consumed=true where token=p_token;
 update private.registration_intents set completed=true,completed_at=now() where token=p_token;
 perform private.queue_membership(applicant,reservation.requested_role,attempt.id,attempt.score,attempt.rules_version);
 return jsonb_build_object('uid',reservation.uid,'username',reservation.username,'completed',true);
 end
$$;

revoke execute on all functions in schema private from public,anon,authenticated;
commit;
