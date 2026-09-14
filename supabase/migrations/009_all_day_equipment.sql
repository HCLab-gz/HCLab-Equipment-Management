-- Allow a reservation to end at the next midnight; retain opening-day, time-grid and access checks.
begin;
create or replace function private.validate_time(e public.equipment,s timestamptz,t timestamptz) returns void language plpgsql set search_path='' as $$
 declare ls timestamp:=s at time zone 'Asia/Shanghai';le timestamp:=t at time zone 'Asia/Shanghai';end_time time;
 begin
 if s is null or t is null or not isfinite(s) or not isfinite(t) or t<=s then raise exception '请选择有效的起止时间';end if;
 if e.status<>'available' then raise exception '设备当前不可预约';end if;
 if s<=now() then raise exception '预约开始时间必须晚于当前时间';end if;
 end_time:=le::time;
 if ls::date<>le::date then
   if le=ls::date+interval '1 day' then end_time:=time '24:00';
   else raise exception '每次预约最晚到次日零点，跨日请分别申请';end if;
 end if;
 if not (extract(dow from ls)::integer=any(e.weekdays)) then raise exception '所选日期不在设备开放日内';end if;
 if ls::time<e.open_time or end_time>e.close_time then raise exception '所选时间超出设备开放时段';end if;
 if t-s<interval '30 minutes' or extract(minute from ls)::integer%30<>0 or extract(minute from le)::integer%30<>0 or extract(second from ls)<>0 or extract(second from le)<>0 then raise exception '请按半小时选择，至少预约30分钟';end if;
 end
$$;

commit;
