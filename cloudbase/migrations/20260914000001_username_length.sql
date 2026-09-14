-- Native account creation allows 64-character usernames, but password sign-in
-- accepts at most 48. New usernames use hclab_ + the first 40 SHA-256 hex digits
-- (46 characters). Keep legacy reservations valid while the operator renames
-- their native accounts through ModifyUser and updates their bound username.
-- This migration never writes to auth.users or changes any existing identity.
begin;
alter table private.registration_intents drop constraint registration_intents_username_check;
alter table private.registration_intents add constraint registration_intents_username_check
 check(username ~ '^hclab_([0-9a-f]{40}|[0-9a-f]{48})$');

create or replace function private.claim_registration(p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
 if v_username !~ '^hclab_[0-9a-f]{40}$' then raise exception '注册账号标识无效';end if;
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

-- CREATE OR REPLACE preserves the existing ACL; reinforce the private boundary.
revoke execute on function private.claim_registration(jsonb) from public,anon,authenticated;
commit;
