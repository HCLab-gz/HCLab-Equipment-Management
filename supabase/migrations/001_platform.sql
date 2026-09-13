-- HCLab: apply once to a dedicated Supabase project using SQL Editor.
-- All writes go through validated RPCs. No client receives the service-role key.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 80), email text not null unique,
 student_id text not null, project text not null default '',
 role text not null default 'user' check(role in ('user','admin')),
 banned boolean not null default false, suspended_until timestamptz,
 violations_count integer not null default 0 check(violations_count>=0),
 rules_version text not null default '2026-09-v1', created_at timestamptz not null default now()
);
create table public.equipment (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 120),
 model text not null check(length(model) between 1 and 120), category text not null check(length(category) between 1 and 60),
 project text not null check(length(project) between 1 and 120), room text not null check(room in ('504','505')),
 location text not null check(length(location) between 1 and 150), manager_id uuid not null references public.profiles(id),
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
 user_id uuid not null references public.profiles(id), user_name text not null,
 starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
 purpose text not null check(length(purpose) between 2 and 500),
 status text not null default 'pending' check(status in ('pending','approved','in_use','returned','renewed','rejected','cancelled')),
 review_note text not null default '', reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
 return_note text not null default '', returned_at timestamptz, checked_out_at timestamptz,
 parent_id uuid references public.bookings(id), created_at timestamptz not null default now()
);
create index bookings_equipment_time on public.bookings(equipment_id,starts_at,ends_at) where status in ('pending','approved','in_use');
create index bookings_user on public.bookings(user_id,created_at desc);
create table public.notices (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 title text not null, body text not null, read boolean not null default false, created_at timestamptz not null default now()
);
create index notices_user on public.notices(user_id,created_at desc);
create table public.violations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 reason text not null check(length(reason) between 2 and 1000), penalty text not null,
 recorded_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table private.booking_events (
 id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id),
 actor_id uuid not null references public.profiles(id), action text not null, note text not null default '', created_at timestamptz not null default now()
);
create table private.questions(id integer primary key,question text not null,options jsonb not null,answer integer not null check(answer between 0 and 3),explanation text not null);
create table private.exam_attempts (
 id uuid primary key default gen_random_uuid(), email text not null, questions jsonb not null,
 completed boolean not null default false, score integer, token uuid unique, consumed boolean not null default false,
 rules_version text not null default '2026-09-v1', created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 minutes'
);
create index exams_email_created on private.exam_attempts(email,created_at desc);

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
 select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and not banned and (suspended_until is null or suspended_until<=now()))
$$;
create policy equipment_read on public.equipment for select to anon,authenticated using(true);
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy bookings_read on public.bookings for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy notices_read on public.notices for select to authenticated using(user_id=auth.uid());
create policy violations_read on public.violations for select to authenticated using(user_id=auth.uid() or public.is_admin());

create function private.require_user(p_admin boolean default false) returns public.profiles language plpgsql security definer set search_path='' as $$
 declare p public.profiles;
 begin
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
create function private.notify(p_user uuid,p_title text,p_body text) returns void language sql security definer set search_path='' as $$
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
 declare uid uuid:=auth.uid();adm boolean:=public.is_admin();
 begin
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
 select * into manager from public.profiles where id=(p_data->>'manager_id')::uuid and role='admin';
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
create function public.record_violation(p_user_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
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
 delete from private.exam_attempts where created_at<now()-interval '7 days';
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
 if attempt.id is null or attempt.completed or attempt.expires_at<now() then raise exception '本次考试已提交或已超时，请重新抽题';end if;
 if jsonb_typeof(p_answers) is distinct from 'object' then raise exception '请完成全部10道题';end if;
 if (select count(*) from jsonb_object_keys(p_answers))<>10 or exists(select 1 from jsonb_array_elements(attempt.questions) q where not (p_answers ? (q->>'id')) or (p_answers->>(q->>'id')) !~ '^[0-3]$' or p_answers->>(q->>'id') is null) then raise exception '请完成全部10道题';end if;
 select count(*) into correct_count from jsonb_array_elements(attempt.questions) q where (q->>'answer')::integer=(p_answers->>(q->>'id'))::integer;
 v_score:=correct_count*10;proof:=case when v_score>=80 then gen_random_uuid() else null end;
 select coalesce(jsonb_agg(jsonb_build_object('question',q->>'question','correct',q->'options'->>((q->>'answer')::integer),'explanation',q->>'explanation')),'[]'::jsonb) into review from jsonb_array_elements(attempt.questions) q where (q->>'answer')::integer<>(p_answers->>(q->>'id'))::integer;
 update private.exam_attempts set completed=true,score=v_score,token=proof,expires_at=now()+interval '30 minutes' where id=p_id;
 return jsonb_build_object('score',v_score,'passed',v_score>=80,'token',proof,'review',review);
 end
$$;
create function private.verify_registration() returns trigger language plpgsql security definer set search_path='' as $$
 declare attempt private.exam_attempts;
 begin
 select * into attempt from private.exam_attempts where token::text=new.raw_user_meta_data->>'exam_token' for update;
 if attempt.id is null or not attempt.completed or attempt.score<80 or attempt.consumed or attempt.expires_at<now() or attempt.email<>lower(btrim(new.email)) or attempt.rules_version<>'2026-09-v1' then raise exception '请先阅读条例并通过准入考试；合格凭证只能使用一次';end if;
 if length(btrim(coalesce(new.raw_user_meta_data->>'name',''))) not between 1 and 80 or length(btrim(coalesce(new.raw_user_meta_data->>'student_id',''))) not between 1 and 80 then raise exception '请完整填写姓名和学号';end if;
 update private.exam_attempts set consumed=true where id=attempt.id;
 new.raw_user_meta_data:=new.raw_user_meta_data-'role'-'exam_token';
 return new;
 end
$$;
create trigger hclab_verify_registration before insert on auth.users for each row execute function private.verify_registration();
create function private.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 insert into public.profiles(id,name,email,student_id,project,role) values(new.id,btrim(new.raw_user_meta_data->>'name'),lower(btrim(new.email)),btrim(new.raw_user_meta_data->>'student_id'),left(coalesce(new.raw_user_meta_data->>'project',''),120),'user');
 perform private.notify(new.id,'准入考试通过','欢迎加入 HCLab，预约申请获批后方可使用设备。');
 return new;
 end
$$;
create trigger hclab_create_profile after insert on auth.users for each row execute function private.create_profile();

revoke execute on all functions in schema private from public,anon,authenticated;
revoke execute on function public.is_admin(),public.get_snapshot(),public.save_equipment(jsonb),public.create_booking(jsonb),public.booking_action(uuid,text,text),public.mark_notices_read(),public.record_violation(uuid,text),public.start_exam(text),public.submit_exam(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.get_snapshot(),public.start_exam(text),public.submit_exam(uuid,jsonb) to anon,authenticated;
grant execute on function public.is_admin(),public.save_equipment(jsonb),public.create_booking(jsonb),public.booking_action(uuid,text,text),public.mark_notices_read(),public.record_violation(uuid,text) to authenticated;
commit;
