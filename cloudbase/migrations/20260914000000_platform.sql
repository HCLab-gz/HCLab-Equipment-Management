-- HCLab CloudBase PostgreSQL: apply once as the database owner to
-- hclab-equipments-d0ehkkk05991a35. Expose only public through PostgREST.
-- CloudBase auth.users.id is bigint, but JWT sub/auth.uid() is text.
-- No auth triggers, user metadata, demo equipment, or administrator seed.
-- Native accounts are provisioned by the trusted hclab-register cloud function.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table public.profiles (
 id text primary key check(length(id) between 1 and 255 and id<>'anon'),
 name text not null check(length(name) between 1 and 80), email text not null unique,
 student_id text not null, project text not null default '',
 role text not null default 'user' check(role in ('user','admin')),
 banned boolean not null default false, suspended_until timestamptz,
 violations_count integer not null default 0 check(violations_count>=0),
 rules_version text not null default '2026-09-v2', created_at timestamptz not null default now()
);
create table public.equipment (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 120),
 model text not null check(length(model) between 1 and 120), category text not null check(length(category) between 1 and 60),
 project text not null check(length(project) between 1 and 120), room text not null check(room in ('504','505')),
 location text not null check(length(location) between 1 and 150), manager_id text not null references public.profiles(id),
 manager_name text not null, status text not null check(status in ('available','maintenance','offline')),
 open_time time not null, close_time time not null, weekdays integer[] not null,
 description text not null default '' check(length(description)<=2000), precautions text not null default '' check(length(precautions)<=5000),
 image_url text not null default '', asset_code text not null unique check(length(asset_code) between 1 and 120),
 created_at timestamptz not null default now(),
 check(open_time<close_time), check(cardinality(weekdays)>0 and weekdays <@ array[0,1,2,3,4,5,6]),
 check(extract(minute from open_time)::integer%30=0 and extract(second from open_time)=0),
 check(extract(minute from close_time)::integer%30=0 and extract(second from close_time)=0)
);
create table public.bookings (
 id uuid primary key default gen_random_uuid(), equipment_id uuid not null references public.equipment(id),
 user_id text not null references public.profiles(id), user_name text not null,
 starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
 purpose text not null check(length(purpose) between 2 and 500),
 status text not null default 'pending' check(status in ('pending','approved','in_use','returned','renewed','rejected','cancelled')),
 review_note text not null default '', reviewed_by text references public.profiles(id), reviewed_at timestamptz,
 return_note text not null default '', returned_at timestamptz, checked_out_at timestamptz,
 parent_id uuid references public.bookings(id), created_at timestamptz not null default now()
);
create index bookings_equipment_time on public.bookings(equipment_id,starts_at,ends_at) where status in ('pending','approved','in_use');
create index bookings_user on public.bookings(user_id,created_at desc);
create table public.notices (
 id uuid primary key default gen_random_uuid(), user_id text not null references public.profiles(id) on delete cascade,
 title text not null, body text not null, read boolean not null default false, created_at timestamptz not null default now()
);
create index notices_user on public.notices(user_id,created_at desc);
create table public.violations (
 id uuid primary key default gen_random_uuid(), user_id text not null references public.profiles(id),
 reason text not null check(length(reason) between 2 and 1000), penalty text not null,
 recorded_by text not null references public.profiles(id), created_at timestamptz not null default now()
);
create table private.booking_events (
 id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id),
 actor_id text not null references public.profiles(id), action text not null, note text not null default '', created_at timestamptz not null default now()
);
create table private.questions(id integer primary key,question text not null,options jsonb not null,answer integer not null check(answer between 0 and 3),explanation text not null);
create table private.exam_attempts (
 id uuid primary key default gen_random_uuid(), email text not null, questions jsonb not null,
 completed boolean not null default false, score integer, token uuid unique, consumed boolean not null default false,
 rules_version text not null default '2026-09-v2', created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 minutes'
);
create index exams_email_created on private.exam_attempts(email,created_at desc);

create table private.registration_intents (
 token uuid primary key references private.exam_attempts(token),
 uid text not null unique default gen_random_uuid()::text,
 username varchar(64) not null unique check(username ~ '^hclab_[0-9a-f]{48}$'),
 email text not null unique, name text not null, student_id text not null, project text not null,
 completed boolean not null default false, created_at timestamptz not null default now(), completed_at timestamptz
);

alter table public.profiles enable row level security;
alter table public.equipment enable row level security;
alter table public.bookings enable row level security;
alter table public.notices enable row level security;
alter table public.violations enable row level security;
revoke all on public.profiles, public.equipment, public.bookings, public.notices, public.violations from anon,authenticated;
revoke all on all tables in schema private from public,anon,authenticated;

grant select on public.equipment to anon,authenticated;
grant select on public.profiles,public.bookings,public.notices,public.violations to authenticated;
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'role'='authenticated',false) and exists(select 1 from public.profiles where id=auth.uid() and role='admin' and not banned and (suspended_until is null or suspended_until<=now()))
$$;
create policy equipment_read on public.equipment for select to anon,authenticated using(true);
create policy profiles_read on public.profiles for select to authenticated using(auth.jwt()->>'role'='authenticated' and (id=auth.uid() or public.is_admin()));
create policy bookings_read on public.bookings for select to authenticated using(auth.jwt()->>'role'='authenticated' and (user_id=auth.uid() or public.is_admin()));
create policy notices_read on public.notices for select to authenticated using(auth.jwt()->>'role'='authenticated' and user_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid()));
create policy violations_read on public.violations for select to authenticated using(auth.jwt()->>'role'='authenticated' and (user_id=auth.uid() or public.is_admin()));

create function private.require_user(p_admin boolean default false) returns public.profiles language plpgsql security definer set search_path='' as $$
 declare p public.profiles;
 begin
 if coalesce(auth.jwt()->>'role','')<>'authenticated' then raise exception '请先登录'; end if;
 select * into p from public.profiles where id=auth.uid();
 if p.id is null then raise exception '请先登录'; end if;
 if p_admin and not public.is_admin() then raise exception '仅管理员可以执行此操作'; end if;
 return p;
 end
$$;
create function private.check_access(p public.profiles) returns void language plpgsql set search_path='' as $$
 begin
 if p.banned or p.suspended_until>now() then raise exception '准入权限已停用，请联系管理员'; end if;
 end
$$;
create function private.notify(p_user text,p_title text,p_body text) returns void language sql security definer set search_path='' as $$
 insert into public.notices(user_id,title,body) values(p_user,p_title,p_body)
$$;
create function private.validate_time(e public.equipment,s timestamptz,t timestamptz) returns void language plpgsql set search_path='' as $$
 declare ls timestamp:=s at time zone 'Asia/Shanghai';le timestamp:=t at time zone 'Asia/Shanghai';
 begin
 if s is null or t is null or not isfinite(s) or not isfinite(t) or t<=s then raise exception '请选择有效的起止时间';end if;
 if e.status<>'available' then raise exception '设备当前不可预约';end if;
 if s<=now() then raise exception '预约开始时间必须晚于当前时间';end if;
 if ls::date<>le::date then raise exception '每次预约限同一天，跨日请分别申请';end if;
 if not (extract(dow from ls)::integer=any(e.weekdays)) then raise exception '所选日期不在设备开放日内';end if;
 if ls::time<e.open_time or le::time>e.close_time then raise exception '所选时间超出设备开放时段';end if;
 if t-s<interval '30 minutes' or extract(minute from ls)::integer%30<>0 or extract(minute from le)::integer%30<>0 or extract(second from ls)<>0 or extract(second from le)<>0 then raise exception '请按半小时选择，至少预约30分钟';end if;
 end
$$;

create function public.get_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare uid text;adm boolean:=public.is_admin();
 begin
 if auth.jwt()->>'role'='authenticated' and exists(select 1 from public.profiles where id=auth.uid()) then uid:=auth.uid();end if;
 return jsonb_build_object(
 'equipment',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from public.equipment e),'[]'::jsonb),
 'profiles',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.profiles p where uid is not null and (adm or p.id=uid)),'[]'::jsonb),
 'bookings',coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from public.bookings b where uid is not null and (adm or b.user_id=uid)),'[]'::jsonb),
 'notices',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc) from public.notices n where n.user_id=uid),'[]'::jsonb),
 'violations',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc) from public.violations v where uid is not null and (adm or v.user_id=uid)),'[]'::jsonb),
 'busy',coalesce((select jsonb_agg(jsonb_build_object('equipment_id',b.equipment_id,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status)) from public.bookings b where uid is not null and b.status in ('pending','approved','in_use')),'[]'::jsonb));
 end
$$;
create function public.save_equipment(p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
 declare actor public.profiles;manager public.profiles;eid uuid:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());image text:=coalesce(p_data->>'image_url','');
 begin
 perform pg_advisory_xact_lock(504505);
 actor:=private.require_user(true);
 select * into manager from public.profiles where id=p_data->>'manager_id' and role='admin';
 if manager.id is null then raise exception '请选择有效的负责管理员';end if;
 if p_data ? 'id' and not exists(select 1 from public.equipment where id=eid) then raise exception '设备不存在';end if;
 if image<>'' and image !~ '^https://' then raise exception '图片地址必须使用HTTPS';end if;
 insert into public.equipment(id,name,model,category,project,room,location,manager_id,manager_name,status,open_time,close_time,weekdays,description,precautions,image_url,asset_code)
 values(eid,btrim(p_data->>'name'),btrim(p_data->>'model'),btrim(p_data->>'category'),btrim(p_data->>'project'),p_data->>'room',btrim(p_data->>'location'),manager.id,manager.name,p_data->>'status',(p_data->>'open_time')::time,(p_data->>'close_time')::time,array(select jsonb_array_elements_text(p_data->'weekdays')::integer),coalesce(p_data->>'description',''),coalesce(p_data->>'precautions',''),image,btrim(p_data->>'asset_code'))
 on conflict(id) do update set name=excluded.name,model=excluded.model,category=excluded.category,project=excluded.project,room=excluded.room,location=excluded.location,manager_id=excluded.manager_id,manager_name=excluded.manager_name,status=excluded.status,open_time=excluded.open_time,close_time=excluded.close_time,weekdays=excluded.weekdays,description=excluded.description,precautions=excluded.precautions,image_url=excluded.image_url,asset_code=excluded.asset_code;
 return eid;
 end
$$;
create function public.create_booking(p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
 declare p public.profiles;e public.equipment;old public.bookings;bid uuid;s timestamptz:=(p_data->>'starts_at')::timestamptz;t timestamptz:=(p_data->>'ends_at')::timestamptz;parent uuid:=nullif(p_data->>'parent_id','')::uuid;
 begin
 -- All booking/asset/access mutations share this transaction lock. Checks and inserts are atomic.
 perform pg_advisory_xact_lock(504505);
 p:=private.require_user();perform private.check_access(p);
 select * into e from public.equipment where id=(p_data->>'equipment_id')::uuid;
 if e.id is null then raise exception '设备不存在';end if;
 perform private.validate_time(e,s,t);
 if exists(select 1 from public.bookings b where b.equipment_id=e.id and b.status in ('pending','approved','in_use') and b.starts_at<t and b.ends_at>s) then raise exception '该时段已有预约，请选择其他时间';end if;
 if parent is not null then
 select * into old from public.bookings where id=parent;
 if old.id is null or old.user_id<>p.id or old.equipment_id<>e.id or old.status not in ('approved','in_use') or old.ends_at<>s then raise exception '续约需紧接本人已批准预约的结束时间';end if;
 end if;
 insert into public.bookings(equipment_id,user_id,user_name,starts_at,ends_at,purpose,parent_id) values(e.id,p.id,p.name,s,t,btrim(p_data->>'purpose'),parent) returning id into bid;
 insert into private.booking_events(booking_id,actor_id,action) values(bid,p.id,'request');
 perform private.notify(e.manager_id,'有新的预约申请',p.name||' 申请了 '||e.name||'，请前往管理后台审批。');
 return bid;
 end
$$;
create function public.booking_action(p_id uuid,p_action text,p_note text default '') returns void language plpgsql security definer set search_path='' as $$
 declare p public.profiles;owner public.profiles;b public.bookings;e public.equipment;ns text;
 begin
 perform pg_advisory_xact_lock(504505);p:=private.require_user();
 if length(p_note)>1000 then raise exception '说明过长';end if;
 select * into b from public.bookings where id=p_id;
 if b.id is null then raise exception '预约不存在';end if;
 select * into e from public.equipment where id=b.equipment_id;
 if p_action in ('approve','reject') then
 perform private.require_user(true);
 if b.status<>'pending' then raise exception '仅能审批待审批记录';end if;
 if p_action='approve' then
 select * into owner from public.profiles where id=b.user_id;perform private.check_access(owner);perform private.validate_time(e,b.starts_at,b.ends_at);ns:='approved';
 else
 if length(btrim(p_note))<2 then raise exception '请填写驳回原因';end if;ns:='rejected';
 end if;
 update public.bookings set status=ns,review_note=p_note,reviewed_by=p.id,reviewed_at=now() where id=p_id;
 perform private.notify(b.user_id,case when p_action='approve' then '预约已批准' else '预约已驳回' end,e.name||case when p_note='' then '' else '：'||p_note end);
 elsif p_action in ('cancel','checkout','return') then
 if b.user_id<>p.id then raise exception '仅申请人可以执行此操作';end if;
 if p_action='cancel' then
 if b.status not in ('pending','approved') then raise exception '当前状态无法取消';end if;
 update public.bookings set status='cancelled' where id=p_id;
 elsif p_action='checkout' then
 perform private.check_access(p);
 if b.status<>'approved' or now()<b.starts_at or now()>=b.ends_at or e.status<>'available' then raise exception '仅能在批准时段内且设备正常时开始使用';end if;
 if exists(select 1 from public.bookings x where x.equipment_id=e.id and x.status='in_use' and x.id<>b.id and not (x.id=coalesce(b.parent_id,b.id) and x.user_id=p.id and x.ends_at=b.starts_at)) then raise exception '上一位使用者尚未归还，请联系管理员';end if;
 if b.parent_id is not null then
 update public.bookings set status='renewed',return_note='已衔接批准的续约，设备由同一使用者继续使用，未作物理归还' where id=b.parent_id and status='in_use' and user_id=p.id and equipment_id=e.id and ends_at=b.starts_at;
 if found then insert into private.booking_events(booking_id,actor_id,action,note) values(b.parent_id,p.id,'renew_handover','衔接续约 '||b.id);end if;
 end if;
 update public.bookings set status='in_use',checked_out_at=now() where id=p_id;
 else
 if b.status<>'in_use' or length(btrim(p_note))<2 then raise exception '使用中的设备须填写归还情况';end if;
 update public.bookings set status='returned',returned_at=now(),return_note=p_note where id=p_id;
 end if;
 perform private.notify(e.manager_id,'预约状态更新',p.name||' 的 '||e.name||' 预约已更新。');
 else raise exception '不支持此操作';end if;
 insert into private.booking_events(booking_id,actor_id,action,note) values(p_id,p.id,p_action,p_note);
 end
$$;
create function public.mark_notices_read() returns void language plpgsql security definer set search_path='' as $$
 begin perform private.require_user();update public.notices set read=true where user_id=auth.uid();end
$$;
create function public.record_violation(p_user_id text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
 declare actor public.profiles;p public.profiles;n integer;penalty text;until timestamptz;
 begin
 perform pg_advisory_xact_lock(504505);actor:=private.require_user(true);
 if length(btrim(p_reason)) not between 2 and 1000 then raise exception '请填写经核实的违规事实';end if;
 select * into p from public.profiles where id=p_user_id and role='user';
 if p.id is null then raise exception '请选择普通用户';end if;
 n:=p.violations_count+1;penalty:=case when n=1 then '首次警告' when n=2 then '停用准入 1 周' when n=3 then '停用准入 1 个月' else '永久停止准入' end;
 until:=case when n=2 then now()+interval '7 days' when n=3 then now()+interval '1 month' else null end;
 update public.profiles set violations_count=n,suspended_until=until,banned=(n>=4) where id=p.id;
 insert into public.violations(user_id,reason,penalty,recorded_by) values(p.id,btrim(p_reason),penalty,actor.id);
 perform private.notify(p.id,'准入状态更新',penalty||'。记录：'||p_reason);
 end
$$;

create function public.start_exam(p_email text) returns jsonb language plpgsql security definer set search_path='' as $$
 declare v_email text:=lower(btrim(p_email));qs jsonb;eid uuid;
 begin
 if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception '请输入有效邮箱';end if;
 perform pg_advisory_xact_lock(504506);
 delete from private.exam_attempts a where a.created_at<now()-interval '7 days' and not exists(select 1 from private.registration_intents r where r.token=a.token);
 if (select count(*) from private.exam_attempts where private.exam_attempts.email=v_email and created_at>now()-interval '1 hour')>=10 then raise exception '本邮箱考试请求较多，请1小时后再试';end if;
 select jsonb_agg(to_jsonb(q)) into qs from (select * from private.questions order by random() limit 10) q;
 if jsonb_array_length(qs)<>10 or qs is null then raise exception '题库尚未初始化，请联系管理员';end if;
 insert into private.exam_attempts(email,questions) values(v_email,qs) returning id into eid;
 return jsonb_build_object('id',eid,'questions',(select jsonb_agg(q-'answer'-'explanation') from jsonb_array_elements(qs) q));
 end
$$;
create function public.submit_exam(p_id uuid,p_answers jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
 declare attempt private.exam_attempts;correct_count integer;v_score integer;proof uuid;review jsonb;
 begin
 select * into attempt from private.exam_attempts where id=p_id for update;
 if attempt.id is null or attempt.completed or attempt.expires_at<=now() or attempt.rules_version<>'2026-09-v2' then raise exception '本次考试已提交或已超时，请重新抽题';end if;
 if jsonb_typeof(p_answers) is distinct from 'object' then raise exception '请完成全部10道题';end if;
 if (select count(*) from jsonb_object_keys(p_answers))<>10 or exists(select 1 from jsonb_array_elements(attempt.questions) q where not (p_answers ? (q->>'id')) or (p_answers->>(q->>'id')) !~ '^[0-3]$' or p_answers->>(q->>'id') is null) then raise exception '请完成全部10道题';end if;
 select count(*) into correct_count from jsonb_array_elements(attempt.questions) q where (q->>'answer')::integer=(p_answers->>(q->>'id'))::integer;
 v_score:=correct_count*10;proof:=case when v_score=100 then gen_random_uuid() else null end;
 select coalesce(jsonb_agg(jsonb_build_object('question',q->>'question','correct',q->'options'->>((q->>'answer')::integer),'explanation',q->>'explanation')),'[]'::jsonb) into review from jsonb_array_elements(attempt.questions) q where (q->>'answer')::integer<>(p_answers->>(q->>'id'))::integer;
 update private.exam_attempts set completed=true,score=v_score,token=proof,expires_at=now()+interval '30 minutes' where id=p_id;
 return jsonb_build_object('score',v_score,'passed',v_score=100,'token',proof,'review',review);
 end
$$;
-- These functions are SECURITY INVOKER, intentionally unavailable to web roles.
-- The owner/admin SQL connection used by hclab-register is the only caller.
-- username is computed from normalized email by that trusted function (SHA-256,
-- first 48 hex characters); no pgcrypto extension is required in PostgreSQL.
create function private.claim_registration(p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare
 attempt private.exam_attempts; reservation private.registration_intents;
 v_token uuid:=nullif(p_data->>'token','')::uuid;
 v_email text:=lower(btrim(p_data->>'email'));
 v_name text:=btrim(p_data->>'name');v_student text:=btrim(p_data->>'student_id');v_project text:=btrim(p_data->>'project');
 v_username text:=p_data->>'username';
 begin
 perform pg_advisory_xact_lock(504507);
 if jsonb_typeof(p_data) is distinct from 'object' or exists(
 select 1 from unnest(array['token','email','name','student_id','project','username']) k where jsonb_typeof(p_data->k) is distinct from 'string'
 ) then raise exception '请完整填写有效注册资料';end if;
 if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception '请输入有效邮箱';end if;
 if length(v_name) not between 1 and 80 or length(v_student) not between 1 and 80 or length(v_project) not between 1 and 120
 or v_name ~ '[[:cntrl:]]' or v_student ~ '[[:cntrl:]]' or v_project ~ '[[:cntrl:]]' then raise exception '请完整填写有效姓名、学号和项目';end if;
 if v_username !~ '^hclab_[0-9a-f]{48}$' then raise exception '注册账号标识无效';end if;
 select * into attempt from private.exam_attempts where token=v_token for update;
 if attempt.id is null or not attempt.completed or attempt.score is distinct from 100 or attempt.rules_version<>'2026-09-v2' or attempt.email<>v_email then
 raise exception '请先阅读条例并通过满分准入考试；凭证须与邮箱一致';end if;
 select * into reservation from private.registration_intents where token=v_token for update;
 if reservation.token is not null then
 if (reservation.email,reservation.username,reservation.name,reservation.student_id,reservation.project) is distinct from (v_email,v_username,v_name,v_student,v_project) then
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
 if (reservation.email,reservation.username,reservation.name,reservation.student_id,reservation.project) is distinct from (v_email,v_username,v_name,v_student,v_project) then
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
 insert into private.registration_intents(token,email,username,name,student_id,project) values(v_token,v_email,v_username,v_name,v_student,v_project) returning * into reservation;
 end if;
 return jsonb_build_object('uid',reservation.uid,'username',reservation.username,'completed',false);
 end
$$;

create function private.finish_registration(p_token uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare attempt private.exam_attempts;reservation private.registration_intents;
 begin
 perform pg_advisory_xact_lock(504507);
 select * into attempt from private.exam_attempts where token=p_token for update;
 select * into reservation from private.registration_intents where token=p_token for update;
 if reservation.token is null or attempt.id is null or not attempt.completed or attempt.score is distinct from 100 or attempt.rules_version<>'2026-09-v2' or attempt.email<>reservation.email then raise exception '考试凭证或注册绑定无效';end if;
 if not exists(select 1 from auth.users u where u.project='hclab-equipments-d0ehkkk05991a35' and u.sub=reservation.uid and u.username=reservation.username)
 or exists(select 1 from auth.users u where u.project='hclab-equipments-d0ehkkk05991a35' and (u.sub=reservation.uid or u.username=reservation.username or lower(btrim(u.email))=reservation.email)
 and (u.sub is distinct from reservation.uid or u.username is distinct from reservation.username)) then raise exception '原生账号尚未创建或与注册绑定不一致';end if;
 if reservation.completed then
 if not attempt.consumed or not exists(select 1 from public.profiles p where p.id=reservation.uid and p.email=reservation.email) then raise exception '注册账号状态不一致，请联系管理员';end if;
 return jsonb_build_object('uid',reservation.uid,'username',reservation.username,'completed',true);
 end if;
 if attempt.consumed or attempt.expires_at<=now() then raise exception '考试凭证已使用或已过期，请重新完成考试';end if;
 -- Role is fixed here; no user-supplied role or native metadata is consulted.
 insert into public.profiles(id,name,email,student_id,project,role,rules_version)
 values(reservation.uid,reservation.name,reservation.email,reservation.student_id,reservation.project,'user','2026-09-v2');
 update private.exam_attempts set consumed=true where token=p_token;
 update private.registration_intents set completed=true,completed_at=now() where token=p_token;
 perform private.notify(reservation.uid,'准入考试通过','欢迎加入 HCLab，预约申请获批后方可使用设备。');
 return jsonb_build_object('uid',reservation.uid,'username',reservation.username,'completed',true);
 end
$$;

revoke execute on all functions in schema private from public,anon,authenticated;
revoke execute on function public.is_admin(),public.get_snapshot(),public.save_equipment(jsonb),public.create_booking(jsonb),public.booking_action(uuid,text,text),public.mark_notices_read(),public.record_violation(text,text),public.start_exam(text),public.submit_exam(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.get_snapshot(),public.start_exam(text),public.submit_exam(uuid,jsonb) to anon,authenticated;
grant execute on function public.is_admin(),public.save_equipment(jsonb),public.create_booking(jsonb),public.booking_action(uuid,text,text),public.mark_notices_read(),public.record_violation(text,text) to authenticated;
-- Verified CloudBase storage schema uses text owner_id, compatible with these policies.
-- Storage is managed by the native service; this migration never creates or alters its tables.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('equipment-images','equipment-images',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=2097152,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create policy hclab_admin_upload on storage.objects for insert to authenticated
with check(bucket_id='equipment-images' and public.is_admin());
create policy hclab_admin_delete on storage.objects for delete to authenticated
using(bucket_id='equipment-images' and public.is_admin());
create policy hclab_image_read on storage.objects for select to anon,authenticated
using(bucket_id='equipment-images');


insert into private.questions(id,question,options,answer,explanation) values
(1,'锂电池不用时应存放在哪里？','["普通纸箱","锂电池防爆箱","地毯旁","随身背包"]'::jsonb,1,'锂电池须存放在指定锂电池防爆箱中。'),
(2,'电池与充电器应远离哪类物品？','["设备说明书架","地毯等易燃物","防爆箱","管理标识"]'::jsonb,1,'禁止在地毯等易燃物附近存放电池或充电。'),
(3,'发现电池鼓包时应该怎么做？','["继续低速使用","自行刺破放气","停止使用并报告管理员","换个充电器继续充"]'::jsonb,2,'异常电池须停用，禁止拆解和刺穿。'),
(4,'充电时正确的行为是？','["整夜无人值守","使用任意接口匹配的充电器","用匹配充电器并有人监护","覆盖衣物保温"]'::jsonb,2,'按制造商要求，使用匹配的充电器并有人监护。'),
(5,'小长假离开实验室前应怎样处理设备？','["待机即可","关闭设备并断电，连续运行须提前获批并安排值守","全部继续运行","只关闭显示器"]'::jsonb,1,'放假前应断电，特殊连续实验必须审批并值守。'),
(6,'最后离开实验室的人必须检查什么？','["仅检查灯光","电磁门确已关闭锁死以及电源、门窗","只确认微信通知","只带好钥匙"]'::jsonb,1,'最后离开者须检查电源、门窗并确认电磁门关闭锁死。'),
(7,'使用课题组机器人前需要？','["口头告诉同学即可","提交后直接使用","在平台申请并获批","只登记姓名"]'::jsonb,2,'提交不等于批准，必须先申请并获批。'),
(8,'批准使用时间为 14:00–16:00，16:00 后应？','["无人催促就继续","先继续再补申请","停止并归还；继续使用须提前续约获批","换账号继续"]'::jsonb,2,'续约获批前，原预约结束时间仍有效。'),
(9,'505 的螺丝刀、扳手用完后放在哪里？','["最近的桌面","铁皮置物架对应分类格","个人抽屉","机器人旁"]'::jsonb,1,'505 工具应归还铁皮置物架对应分类格。'),
(10,'504 工具使用后应放哪里？','["绿色工作台指定位置","505 任意空位","地面","自己的工位"]'::jsonb,0,'504 工具应归还绿色工作台指定位置。'),
(11,'个人项目传感器应怎样标识？','["无需标识","只贴项目二维码","器材名称、负责人及非课题组公有财产标记","只写价格"]'::jsonb,2,'个人器材必须标清名称、负责人及非公有属性。'),
(12,'课题组统一采购的传感器如何领用？','["先借后登记","平台申请获批后领用","联系上一位直接转借","谁先拿到谁使用"]'::jsonb,1,'公共传感器统一入平台，先申请获批再领用。'),
(13,'下一位使用者找不到设备，应追溯谁的记录？','["第一位申请人","上一位使用者","所有同学平均负责","无需追溯"]'::jsonb,1,'按最近一次领用和归还记录追溯上一位使用者。'),
(14,'累计第二次违规会受到什么处理？','["只有提醒","停止准入 1 周","停止准入 1 个月","永久停止准入"]'::jsonb,1,'第二次违规停止准入权限 1 周。'),
(15,'累计第三次违规会受到什么处理？','["警告","停止准入 1 周","停止准入 1 个月","不再处理"]'::jsonb,2,'第三次违规停止准入权限 1 个月。'),
(16,'累计第四次违规会受到什么处理？','["重新累计","暂停一天","永久停止准入权限","仅罚抄条例"]'::jsonb,2,'第四次及以上永久停止准入权限。'),
(17,'第一次违规时如何处理？','["警告并记录，立即停止违规操作","无需记录","永久停止准入","仅口头私下协商"]'::jsonb,0,'首次警告并留存记录，发现违规先停止相关操作。'),
(18,'预约获批是否代表已通过机器人专项培训？','["是","否，仍须接受专项培训并按操作规程执行","仅大型机器人需要","考试满分就不需要"]'::jsonb,1,'通用考试与预约不能替代设备专项培训。'),
(19,'机器人首次运行前应怎样验证？','["最高速运行","低速、小范围验证并保持急停可达","站在运动轨迹上","关闭限位以扩大范围"]'::jsonb,1,'运行前检查安全条件，初次运行用低速小范围。'),
(20,'机械臂断电前如何处理末端负载？','["直接断电","确认负载可靠支撑，防止掉落","用手伸到负载下","无需处理"]'::jsonb,1,'断电可能使负载掉落，必须先可靠支撑。'),
(21,'发现设备碰撞或异常噪声，应？','["继续观察一小时","停机报告并保留现场日志","私自拆开检修","清空日志"]'::jsonb,1,'异常时停机报告，未经确认不得再次运行或私自拆修。'),
(22,'能否把自己的账号和门禁权限借给他人？','["可以借给同组同学","管理员不在即可","不得转借","预约少时可以"]'::jsonb,2,'账号和门禁仅限本人使用。'),
(23,'申请状态为“待审批”时可以使用吗？','["可以","不可以，须等管理员批准","只用五分钟可以","拍照登记即可"]'::jsonb,1,'提交申请不代表批准。'),
(24,'预约结束后系统是否自动确认设备已经归还？','["会自动确认","不会，需实际归位并登记归还情况","仅工具自动确认","由下一位自动代为确认"]'::jsonb,1,'预约到期不等于实际归还。'),
(25,'续约申请尚未批准，原时段已经结束，应？','["继续使用直到批准","停止使用并按原约定归还","取消后继续使用","请其他同学代申请"]'::jsonb,1,'未批准的续约不能改变原预约时限。'),
(26,'实验室通道和急停按钮周围应？','["临时堆放即可","保持畅通","放闲置机器人","放工具箱"]'::jsonb,1,'通道、消防设施和急停周围须畅通。'),
(27,'插线板使用要求是？','["可以多级串联","禁止串联、超负荷或擅改电路","发热时加风扇即可","只要插得下就可以"]'::jsonb,1,'禁止插线板串联及超负荷用电。'),
(28,'焊接完成后应？','["立刻把热焊枪塞进工具箱","断电、确认冷却再按指定位置归还","保持通电方便下次","放在地毯上冷却"]'::jsonb,1,'焊台关闭并确认焊枪冷却后再归位。'),
(29,'冒烟、火情或人员受伤时应优先？','["抢救电脑数据","示警、撤离危险区域并按应急预案报告救援","拍视频发群后继续","自行搬走燃烧电池"]'::jsonb,1,'安全优先，停止实验、示警、撤离并按预案求助。'),
(30,'因违规导致设备损坏，使用者应？','["隐瞒后归还","如实报告，配合核查并承担经核定的相应责任","删除记录","让下一位承担"]'::jsonb,1,'不得隐瞒事故，依制度核实责任和费用。')
on conflict(id) do update set question=excluded.question,options=excluded.options,answer=excluded.answer,explanation=excluded.explanation;


commit;
