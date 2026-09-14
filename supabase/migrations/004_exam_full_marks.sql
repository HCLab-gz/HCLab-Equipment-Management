-- 准入规则 v2：随机十题必须全部答对；已注册用户不强制重考。
-- 作为增量迁移执行，保留既有账号、设备、预约和原始考试记录。
begin;
alter table public.profiles alter column rules_version set default '2026-09-v2';
alter table private.exam_attempts alter column rules_version set default '2026-09-v2';
-- 旧版本未消费的考试凭证和进行中的考试需要重新获取。
update private.exam_attempts set expires_at=least(expires_at,now())
where rules_version<>'2026-09-v2' and not consumed;

create or replace function public.submit_exam(p_id uuid,p_answers jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
 declare attempt private.exam_attempts;correct_count integer;v_score integer;proof uuid;review jsonb;
 begin
 select * into attempt from private.exam_attempts where id=p_id for update;
 if attempt.id is null or attempt.completed or attempt.expires_at<now() then raise exception '本次考试已提交或已超时，请重新抽题';end if;
 if jsonb_typeof(p_answers) is distinct from 'object' then raise exception '请完成全部10道题';end if;
 if (select count(*) from jsonb_object_keys(p_answers))<>10 or exists(select 1 from jsonb_array_elements(attempt.questions) q where not (p_answers ? (q->>'id')) or (p_answers->>(q->>'id')) !~ '^[0-3]$' or p_answers->>(q->>'id') is null) then raise exception '请完成全部10道题';end if;
 select count(*) into correct_count from jsonb_array_elements(attempt.questions) q where (q->>'answer')::integer=(p_answers->>(q->>'id'))::integer;
 v_score:=correct_count*10;proof:=case when v_score=100 then gen_random_uuid() else null end;
 select coalesce(jsonb_agg(jsonb_build_object('question',q->>'question','correct',q->'options'->>((q->>'answer')::integer),'explanation',q->>'explanation')),'[]'::jsonb) into review from jsonb_array_elements(attempt.questions) q where (q->>'answer')::integer<>(p_answers->>(q->>'id'))::integer;
 update private.exam_attempts set completed=true,score=v_score,token=proof,expires_at=now()+interval '30 minutes' where id=p_id;
 return jsonb_build_object('score',v_score,'passed',v_score=100,'token',proof,'review',review);
 end
$$;
create or replace function private.verify_registration() returns trigger language plpgsql security definer set search_path='' as $$
 declare attempt private.exam_attempts;
 begin
 select * into attempt from private.exam_attempts where token::text=new.raw_user_meta_data->>'exam_token' for update;
 if attempt.id is null or not attempt.completed or attempt.score is distinct from 100 or attempt.consumed or attempt.expires_at<now() or attempt.email<>lower(btrim(new.email)) or attempt.rules_version<>'2026-09-v2' then raise exception '请先阅读条例并通过准入考试；合格凭证只能使用一次';end if;
 if length(btrim(coalesce(new.raw_user_meta_data->>'name',''))) not between 1 and 80 or length(btrim(coalesce(new.raw_user_meta_data->>'student_id',''))) not between 1 and 80 then raise exception '请完整填写姓名和学号';end if;
 update private.exam_attempts set consumed=true where id=attempt.id;
 new.raw_user_meta_data:=new.raw_user_meta_data-'role'-'exam_token';
 return new;
 end
$$;
commit;
