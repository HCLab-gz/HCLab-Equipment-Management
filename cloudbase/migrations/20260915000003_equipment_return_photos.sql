-- Ordered equipment gallery and a private photographic record for physical returns.
begin;
alter table public.equipment add column image_urls text[] not null default '{}';
update public.equipment set image_urls=array[image_url] where image_url<>'';
alter table public.equipment add constraint equipment_cover_first check(image_url=coalesce(image_urls[1],''));
-- Existing historical returns remain unchanged; new returns must carry a stored object path.
alter table public.bookings add column return_photo_path text not null default '';

create function public.can_upload_return_photo(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.is_member() and coalesce(p_path ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|png|webp)$',false)
 and exists(select 1 from public.bookings b where b.id::text=split_part(p_path,'/',1)
   and b.user_id=auth.uid() and b.status='in_use')
$$;
create function public.can_read_return_photo(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.is_member() and exists(select 1 from public.bookings b
   where b.id::text=split_part(p_path,'/',1) and (b.user_id=auth.uid() or public.is_admin()))
$$;
revoke execute on function public.can_upload_return_photo(text),public.can_read_return_photo(text) from public,anon;
grant execute on function public.can_upload_return_photo(text),public.can_read_return_photo(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('return-photos','return-photos',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create policy hclab_return_photo_upload on storage.objects for insert to authenticated
with check(bucket_id='return-photos' and public.can_upload_return_photo(name));
create policy hclab_return_photo_read on storage.objects for select to authenticated
using(bucket_id='return-photos' and public.can_read_return_photo(name));
-- No UPDATE/DELETE policy for this bucket: submitted evidence cannot be replaced or removed by clients.

create or replace function public.save_equipment(p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
 declare actor public.profiles;manager public.profiles;eid uuid:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());image text:=coalesce(p_data->>'image_url','');images text[];
 begin
 perform pg_advisory_xact_lock(504505);
 actor:=private.require_user(true);
 select * into manager from public.profiles where id=p_data->>'manager_id' and role in ('admin','super_admin') and membership_status='approved' and not banned and (suspended_until is null or suspended_until<=now());
 if manager.id is null then raise exception '请选择有效的负责管理员';end if;
 if p_data ? 'id' and not exists(select 1 from public.equipment where id=eid) then raise exception '设备不存在';end if;
 if p_data ? 'image_urls' then
   if jsonb_typeof(p_data->'image_urls')<>'array' then raise exception '请上传有效的设备图片列表';end if;
   images:=array(select jsonb_array_elements_text(p_data->'image_urls'));
 elsif exists(select 1 from public.equipment x where x.id=eid and x.image_url=image) then
   select x.image_urls into images from public.equipment x where x.id=eid;
 else images:=case when image='' then array[]::text[] else array[image] end;
 end if;
 if exists(select 1 from unnest(images) u where u is null or u !~ '^https://' or length(u)>2048) then
   raise exception '设备图片必须使用有效的HTTPS地址';
 end if;
 image:=coalesce(images[1],'');
 insert into public.equipment(id,name,model,category,project,room,location,manager_id,manager_name,status,open_time,close_time,weekdays,description,precautions,image_url,image_urls,asset_code)
 values(eid,btrim(p_data->>'name'),btrim(p_data->>'model'),btrim(p_data->>'category'),btrim(p_data->>'project'),p_data->>'room',btrim(p_data->>'location'),manager.id,manager.name,p_data->>'status',(p_data->>'open_time')::time,(p_data->>'close_time')::time,array(select jsonb_array_elements_text(p_data->'weekdays')::integer),coalesce(p_data->>'description',''),coalesce(p_data->>'precautions',''),image,images,btrim(p_data->>'asset_code'))
 on conflict(id) do update set name=excluded.name,model=excluded.model,category=excluded.category,project=excluded.project,room=excluded.room,location=excluded.location,manager_id=excluded.manager_id,manager_name=excluded.manager_name,status=excluded.status,open_time=excluded.open_time,close_time=excluded.close_time,weekdays=excluded.weekdays,description=excluded.description,precautions=excluded.precautions,image_url=excluded.image_url,image_urls=excluded.image_urls,asset_code=excluded.asset_code;
 return eid;
 end
$$;

-- Remove the old signature so older clients cannot bypass the photograph requirement.
drop function public.booking_action(uuid,text,text);
create function public.booking_action(p_id uuid,p_action text,p_note text default '',p_return_photo text default '') returns void language plpgsql security definer set search_path='' as $$
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
 if not public.can_upload_return_photo(p_return_photo) or split_part(p_return_photo,'/',1)<>p_id::text
    or not exists(select 1 from storage.objects o where o.bucket_id='return-photos' and o.name=p_return_photo) then
   raise exception '请上传设备及放置位置的照片后再归还';
 end if;
 update public.bookings set status='returned',returned_at=now(),return_note=p_note,return_photo_path=p_return_photo where id=p_id;
 end if;
 perform private.notify(e.manager_id,'预约状态更新',p.name||' 的 '||e.name||' 预约已更新。');
 else raise exception '不支持此操作';end if;
 insert into private.booking_events(booking_id,actor_id,action,note) values(p_id,p.id,p_action,p_note);
 end
$$;

revoke execute on function public.booking_action(uuid,text,text,text) from public,anon;
grant execute on function public.booking_action(uuid,text,text,text) to authenticated;
commit;
