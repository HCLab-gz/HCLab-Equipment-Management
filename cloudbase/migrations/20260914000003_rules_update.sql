-- The reader now includes the full source. Only NEW exams default to v3.
-- Existing users, in-flight exams and valid v2 proofs remain unchanged.
begin;
alter table public.profiles alter column rules_version set default '2026-09-v3';
alter table private.exam_attempts alter column rules_version set default '2026-09-v3';

-- Extend the version check in the three existing implementations while keeping
-- their 100-point, expiry, identity and one-time-use checks, ownership and ACLs.
do $migration$
declare target regprocedure; definition text;
begin
 foreach target in array array[
  'public.submit_exam(uuid,jsonb)'::regprocedure,
  'private.claim_registration(jsonb)'::regprocedure,
  'private.finish_registration(uuid)'::regprocedure
 ] loop
  definition := pg_get_functiondef(target);
  if position('attempt.rules_version<>''2026-09-v2''' in definition)=0 then
   raise exception 'Unexpected rules check in %; review before migrating',target;
  end if;
  definition := replace(definition,
   'attempt.rules_version<>''2026-09-v2''',
   'attempt.rules_version not in (''2026-09-v2'',''2026-09-v3'')');
  if target='private.finish_registration(uuid)'::regprocedure then
   -- Record the version actually attached to the validated exam, including v2
   -- when a member completes an already-started registration after this update.
   if position('''user'',''2026-09-v2''' in definition)=0 then
    raise exception 'Unexpected profile version assignment; review before migrating';
   end if;
   definition := replace(definition,'''user'',''2026-09-v2''','''user'',attempt.rules_version');
  end if;
  execute definition;
 end loop;
end
$migration$;
commit;
