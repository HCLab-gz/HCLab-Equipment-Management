-- Align the holiday question with the revised rules. Preserve all existing
-- exam snapshots, grades and registration proofs; new exams use this wording.
begin;
do $migration$
begin
  update private.questions
  set options = jsonb_set(options, '{1}', '"关闭设备并断电"'::jsonb),
      explanation = '公共节假日、小长假离开前关闭设备并断开电源。'
  where id = 5
    and question = '小长假离开实验室前应怎样处理设备？'
    and answer = 1;
  if not found then
    raise exception 'Holiday question does not match the expected question and answer';
  end if;
end
$migration$;
commit;
