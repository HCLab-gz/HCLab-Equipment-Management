-- Optional Supabase backend: new exams use v3. Keep all valid v2 proofs and
-- existing member records; record each new member's actually-read version.
begin;
alter table public.profiles alter column rules_version set default '2026-09-v3';
alter table private.exam_attempts alter column rules_version set default '2026-09-v3';
create or replace function private.verify_registration() returns trigger language plpgsql security definer set search_path='' as $$
 declare attempt private.exam_attempts;
 begin
 select * into attempt from private.exam_attempts where token::text=new.raw_user_meta_data->>'exam_token' for update;
 if attempt.id is null or not attempt.completed or attempt.score is distinct from 100 or attempt.consumed or attempt.expires_at<now() or attempt.email<>lower(btrim(new.email)) or attempt.rules_version not in ('2026-09-v2','2026-09-v3') then raise exception '请先阅读条例并通过准入考试；合格凭证只能使用一次';end if;
 if length(btrim(coalesce(new.raw_user_meta_data->>'name',''))) not between 1 and 80 or length(btrim(coalesce(new.raw_user_meta_data->>'student_id',''))) not between 1 and 80 then raise exception '请完整填写姓名和学号';end if;
 update private.exam_attempts set consumed=true where id=attempt.id;
 new.raw_user_meta_data:=(new.raw_user_meta_data-'role'-'exam_token')||jsonb_build_object('accepted_rules_version',attempt.rules_version);
 return new;
 end
$$;
create or replace function private.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 insert into public.profiles(id,name,email,student_id,project,role,rules_version)
 values(new.id,btrim(new.raw_user_meta_data->>'name'),lower(btrim(new.email)),btrim(new.raw_user_meta_data->>'student_id'),left(coalesce(new.raw_user_meta_data->>'project',''),120),'user',new.raw_user_meta_data->>'accepted_rules_version');
 perform private.notify(new.id,'准入考试通过','欢迎加入 HCLab，预约申请获批后方可使用设备。');
 return new;
 end
$$;
commit;
