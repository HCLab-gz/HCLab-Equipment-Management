-- Equipment opening hours are minute-precise; reservations remain on half-hour boundaries.
begin;
alter table public.equipment drop constraint equipment_open_time_check;
alter table public.equipment drop constraint equipment_close_time_check;
alter table public.equipment add constraint equipment_open_time_check check(extract(second from open_time)=0);
alter table public.equipment add constraint equipment_close_time_check check(extract(second from close_time)=0);
alter table public.equipment add constraint equipment_booking_window_check
  check(ceil(extract(epoch from open_time)/1800)+1 <= floor(extract(epoch from close_time)/1800));
commit;
