-- Continuous multi-day bookings retain the existing atomic conflict, access and approval checks.
begin;
create or replace function private.validate_time(e public.equipment,s timestamptz,t timestamptz)
returns void language plpgsql set search_path='' as $$
declare
  ls timestamp:=s at time zone 'Asia/Shanghai';
  le timestamp:=t at time zone 'Asia/Shanghai';
  last_day date;
  occupied_days integer;
  end_time time;
  i integer;
begin
  if s is null or t is null or not isfinite(s) or not isfinite(t) or t<=s then
    raise exception '请选择有效的起止时间';
  end if;
  if e.status<>'available' then raise exception '设备当前不可预约';end if;
  if s<=now() then raise exception '预约开始时间必须晚于当前时间';end if;
  -- End-exclusive interval: midnight does not require the following day to be open.
  last_day:=(le-interval '1 microsecond')::date;
  occupied_days:=last_day-ls::date+1;
  -- Checking a full week is enough even for long date ranges.
  for i in 0..least(occupied_days,7)-1 loop
    if not (extract(dow from ls::date+i)::integer=any(e.weekdays)) then
      raise exception '所选日期不在设备开放日内';
    end if;
  end loop;
  if occupied_days>1 and (e.open_time<>time '00:00' or e.close_time<>time '24:00') then
    raise exception '跨天预约期间包含设备不开放的时段';
  end if;
  end_time:=case when le::date<>last_day then time '24:00' else le::time end;
  if ls::time<e.open_time or end_time>e.close_time then
    raise exception '所选时间超出设备开放时段';
  end if;
  if t-s<interval '30 minutes' or extract(minute from ls)::integer%30<>0
     or extract(minute from le)::integer%30<>0 or extract(second from ls)<>0
     or extract(second from le)<>0 then
    raise exception '请按半小时选择，至少预约30分钟';
  end if;
end
$$;
commit;
