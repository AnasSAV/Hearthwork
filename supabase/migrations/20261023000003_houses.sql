-- Focus Town: houses, layouts, upgrades, friends and visiting (Phase 4).
--
-- Layout coordinates: each room is a grid of house_levels.width × height tiles. Row 0 is the
-- wall row (only `wall`-layer items go there); rows 1..height-1 are floor. The front door sits
-- below the floor tile (door_x, height-1) of room 0, with door_x = width / 2 (integer division).
-- Two-room houses connect room 0's east wall and room 1's west wall at row height / 2.
-- shared/src/house.ts implements the same rules for the client's green/red ghost.

alter table public.items add column study_spot boolean not null default false;

alter table public.houses
  add constraint houses_exterior_style_check check (exterior_style in ('cottage', 'brick'));

create table public.placed_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.houses on delete cascade,
  item_id text not null references public.items,
  room int not null default 0 check (room >= 0),
  x int not null check (x >= 0),
  y int not null check (y >= 0),
  rotation int not null default 0 check (rotation = 0)
);
create index placed_items_owner on public.placed_items (owner_id);

-- A row (A, B, 'pending') means A asked B. Accepting flips it to 'accepted'; one row per pair.
create table public.friendships (
  user_id uuid not null references public.profiles on delete cascade,
  friend_id uuid not null references public.profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
-- Only one row per unordered pair.
create unique index friendships_pair on public.friendships (least(user_id, friend_id), greatest(user_id, friend_id));

revoke all on public.placed_items, public.friendships from anon, authenticated, service_role;
grant select on public.placed_items, public.friendships to authenticated, service_role;
alter table public.placed_items enable row level security;
alter table public.friendships enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Visiting rules
-- ---------------------------------------------------------------------------------------------

create function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
     where status = 'accepted'
       and ((user_id = p_a and friend_id = p_b) or (user_id = p_b and friend_id = p_a))
  );
$$;

create function public.can_visit(p_visitor uuid, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_visitor is not null and exists (
    select 1 from public.houses h
     where h.owner_id = p_owner
       and (
         h.owner_id = p_visitor
         or h.visibility = 'public'
         or (h.visibility = 'friends' and public.are_friends(p_visitor, p_owner))
       )
  );
$$;

-- Players read houses (and their furniture) they may visit, not just their own.
drop policy "read own house" on public.houses;
create policy "read visitable houses" on public.houses
  for select to authenticated using (public.can_visit((select auth.uid()), owner_id));

create policy "read visitable layouts" on public.placed_items
  for select to authenticated using (public.can_visit((select auth.uid()), owner_id));

create policy "read own friendships" on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (user_id, friend_id));

-- ---------------------------------------------------------------------------------------------
-- Layout
-- ---------------------------------------------------------------------------------------------

-- p_layout: { "wallpaper": item id | null, "floor": item id | null,
--             "items": [{ "item_id", "room", "x", "y", "rotation" }] }
create function public.save_layout(p_layout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_house public.houses;
  v_dims public.house_levels;
  v_door_x int;
  v_link_y int;
  v_bad text;
  v_wallpaper text := nullif(p_layout ->> 'wallpaper', '');
  v_floor text := nullif(p_layout ->> 'floor', '');
  v_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  select * into v_house from public.houses where owner_id = v_uid for update;
  if not found then
    raise exception 'no house' using errcode = '22023';
  end if;
  select * into v_dims from public.house_levels where level = v_house.level;
  v_door_x := v_dims.width / 2;
  v_link_y := v_dims.height / 2;

  if jsonb_typeof(p_layout) is distinct from 'object'
     or jsonb_typeof(coalesce(p_layout -> 'items', '[]'::jsonb)) <> 'array' then
    raise exception 'layout must be an object with an items array' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_layout -> 'items', '[]'::jsonb)) > 200 then
    raise exception 'too many items (max 200)' using errcode = '22023';
  end if;

  drop table if exists pg_temp.layout_items;
  create temp table layout_items on commit drop as
  select r.ord, r.item_id, r.room, r.x, r.y, r.rotation,
         i.id as known, i.category, i.layer, i.footprint_w as w, i.footprint_h as h,
         i.surface_host, i.min_house_level
    from (
      select e.ord,
             e.elem ->> 'item_id' as item_id,
             (e.elem ->> 'room')::int as room,
             (e.elem ->> 'x')::int as x,
             (e.elem ->> 'y')::int as y,
             coalesce((e.elem ->> 'rotation')::int, 0) as rotation
        from jsonb_array_elements(coalesce(p_layout -> 'items', '[]'::jsonb))
               with ordinality as e(elem, ord)
    ) r
    left join public.items i on i.id = r.item_id;

  select item_id into v_bad from pg_temp.layout_items
   where item_id is null or room is null or x is null or y is null limit 1;
  if found then raise exception 'every item needs item_id, room, x and y' using errcode = '22023'; end if;

  select item_id into v_bad from pg_temp.layout_items where known is null limit 1;
  if found then raise exception 'unknown item %', v_bad using errcode = '22023'; end if;

  select item_id into v_bad from pg_temp.layout_items where rotation <> 0 limit 1;
  if found then raise exception 'rotation is not supported yet (%)', v_bad using errcode = '22023'; end if;

  select item_id into v_bad from pg_temp.layout_items where category in ('wall', 'floor') limit 1;
  if found then raise exception '% restyles the room and cannot be placed', v_bad using errcode = '22023'; end if;

  select item_id into v_bad from pg_temp.layout_items where min_house_level > v_house.level limit 1;
  if found then raise exception '% needs a bigger house', v_bad using errcode = '22023'; end if;

  select item_id into v_bad from pg_temp.layout_items where room < 0 or room >= v_dims.rooms limit 1;
  if found then raise exception '% is in a room this house does not have', v_bad using errcode = '22023'; end if;

  -- Bounds: wall items on row 0 only, everything else inside the floor rows.
  select item_id into v_bad from pg_temp.layout_items
   where x < 0 or x + w > v_dims.width
      or (layer = 'wall' and (y <> 0 or h <> 1))
      or (layer <> 'wall' and (y < 1 or y + h > v_dims.height))
   limit 1;
  if found then raise exception '% is outside the room or on the wrong layer', v_bad using errcode = '22023'; end if;

  -- Expand every item into the tiles it covers.
  drop table if exists pg_temp.layout_tiles;
  create temp table layout_tiles on commit drop as
  select l.ord, l.item_id, l.room, l.layer, l.surface_host, l.x + dx as tx, l.y + dy as ty
    from pg_temp.layout_items l
    cross join lateral generate_series(0, l.w - 1) dx
    cross join lateral generate_series(0, l.h - 1) dy;

  select item_id into v_bad from (
    select room, layer, tx, ty, min(item_id) as item_id
      from pg_temp.layout_tiles group by room, layer, tx, ty having count(*) > 1
  ) dupes limit 1;
  if found then raise exception 'items overlap (%)', v_bad using errcode = '22023'; end if;

  -- Surface items must sit entirely on a table/desk.
  select t.item_id into v_bad from pg_temp.layout_tiles t
   where t.layer = 'surface' and not exists (
     select 1 from pg_temp.layout_tiles f
      where f.layer = 'floor' and f.surface_host
        and f.room = t.room and f.tx = t.tx and f.ty = t.ty)
   limit 1;
  if found then raise exception '% must sit on a table or desk', v_bad using errcode = '22023'; end if;

  -- Keep the front door and the doorway between rooms clear.
  select item_id into v_bad from pg_temp.layout_tiles
   where layer = 'floor' and (
     (room = 0 and tx = v_door_x and ty = v_dims.height - 1)
     or (v_dims.rooms > 1 and room = 0 and tx = v_dims.width - 1 and ty = v_link_y)
     or (v_dims.rooms > 1 and room = 1 and tx = 0 and ty = v_link_y))
   limit 1;
  if found then raise exception '% blocks a doorway', v_bad using errcode = '22023'; end if;

  -- You can place at most as many as you own.
  select l.item_id into v_bad from (
    select item_id, count(*) as n from pg_temp.layout_items group by item_id
  ) l left join public.inventory inv on inv.user_id = v_uid and inv.item_id = l.item_id
   where coalesce(inv.qty, 0) < l.n
   limit 1;
  if found then raise exception 'you do not own enough of %', v_bad using errcode = '22023'; end if;

  if v_wallpaper is not null and not exists (
    select 1 from public.inventory inv join public.items i on i.id = inv.item_id
     where inv.user_id = v_uid and inv.item_id = v_wallpaper and inv.qty > 0 and i.category = 'wall') then
    raise exception 'you do not own wallpaper %', v_wallpaper using errcode = '22023';
  end if;
  if v_floor is not null and not exists (
    select 1 from public.inventory inv join public.items i on i.id = inv.item_id
     where inv.user_id = v_uid and inv.item_id = v_floor and inv.qty > 0 and i.category = 'floor') then
    raise exception 'you do not own floor %', v_floor using errcode = '22023';
  end if;

  delete from public.placed_items where owner_id = v_uid;
  insert into public.placed_items (owner_id, item_id, room, x, y, rotation)
  select v_uid, item_id, room, x, y, rotation from pg_temp.layout_items order by ord;
  get diagnostics v_count = row_count;
  update public.houses set wallpaper = v_wallpaper, floor = v_floor where owner_id = v_uid;

  return jsonb_build_object('items', v_count, 'wallpaper', v_wallpaper, 'floor', v_floor);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Upgrades and settings
-- ---------------------------------------------------------------------------------------------

create function public.upgrade_house()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_house public.houses;
  v_next public.house_levels;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_profile from public.profiles where id = v_uid for update;
  select * into v_house from public.houses where owner_id = v_uid for update;
  if not found then
    raise exception 'no house' using errcode = '22023';
  end if;
  select * into v_next from public.house_levels where level = v_house.level + 1;
  if not found then
    raise exception 'your house is already at the highest level' using errcode = '22023';
  end if;
  if v_profile.total_focus_min < v_next.min_total_focus_min then
    raise exception 'level % needs % hours of total focus', v_next.level, v_next.min_total_focus_min / 60
      using errcode = '22023';
  end if;
  if v_profile.coins < v_next.cost_coins then
    raise exception 'not enough coins (level % costs %)', v_next.level, v_next.cost_coins
      using errcode = '22023';
  end if;

  update public.profiles set coins = coins - v_next.cost_coins where id = v_uid
  returning * into v_profile;
  if v_next.cost_coins > 0 then
    insert into public.coin_ledger (user_id, delta, reason, ref_id)
    values (v_uid, -v_next.cost_coins, 'upgrade', 'house:level:' || v_next.level);
  end if;
  update public.houses set level = v_next.level where owner_id = v_uid;

  return jsonb_build_object(
    'level', v_next.level, 'coins', v_profile.coins,
    'width', v_next.width, 'height', v_next.height, 'rooms', v_next.rooms
  );
end;
$$;

create function public.update_house_settings(p_visibility text, p_exterior_style text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_visibility not in ('public', 'friends', 'private') then
    raise exception 'visibility must be public, friends or private' using errcode = '22023';
  end if;
  if p_exterior_style not in ('cottage', 'brick') then
    raise exception 'style must be cottage or brick' using errcode = '22023';
  end if;
  update public.houses set visibility = p_visibility, exterior_style = p_exterior_style
   where owner_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Friends
-- ---------------------------------------------------------------------------------------------

-- Sends a request, or accepts theirs if they already asked you.
create function public.send_friend_request(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_row public.friendships;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select id into v_target from public.profiles where lower(username) = lower(trim(p_username));
  if not found then
    raise exception 'no player called %', p_username using errcode = '22023';
  end if;
  if v_target = v_uid then
    raise exception 'you cannot befriend yourself' using errcode = '22023';
  end if;

  select * into v_row from public.friendships
   where (user_id = v_uid and friend_id = v_target) or (user_id = v_target and friend_id = v_uid);
  if found then
    if v_row.status = 'accepted' then
      return 'already friends';
    elsif v_row.user_id = v_target then
      update public.friendships set status = 'accepted'
       where user_id = v_target and friend_id = v_uid;
      return 'accepted';
    else
      return 'already requested';
    end if;
  end if;

  insert into public.friendships (user_id, friend_id) values (v_uid, v_target);
  return 'requested';
end;
$$;

create function public.respond_friend_request(p_from uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_accept then
    update public.friendships set status = 'accepted'
     where user_id = p_from and friend_id = auth.uid() and status = 'pending';
  else
    delete from public.friendships
     where user_id = p_from and friend_id = auth.uid() and status = 'pending';
  end if;
end;
$$;

create function public.remove_friend(p_other uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.friendships
   where (user_id = auth.uid() and friend_id = p_other)
      or (user_id = p_other and friend_id = auth.uid());
$$;

-- Friends and pending requests with what the friends panel needs (profiles are otherwise
-- private to their owner).
create function public.my_friends()
returns table (
  user_id uuid, username text, avatar jsonb, status text, incoming boolean,
  house_level int, can_visit boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.avatar, f.status, f.friend_id = auth.uid(),
         h.level, public.can_visit(auth.uid(), p.id)
    from public.friendships f
    join public.profiles p
      on p.id = case when f.user_id = auth.uid() then f.friend_id else f.user_id end
    left join public.houses h on h.owner_id = p.id
   where auth.uid() in (f.user_id, f.friend_id)
   order by f.status desc, p.username;
$$;

-- ---------------------------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------------------------

revoke all on function public.are_friends(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.can_visit(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.save_layout(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.upgrade_house() from public, anon, authenticated, service_role;
revoke all on function public.update_house_settings(text, text) from public, anon, authenticated, service_role;
revoke all on function public.send_friend_request(text) from public, anon, authenticated, service_role;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.remove_friend(uuid) from public, anon, authenticated, service_role;
revoke all on function public.my_friends() from public, anon, authenticated, service_role;

-- can_visit/are_friends run inside RLS policies, so the querying role needs EXECUTE.
grant execute on function public.are_friends(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_visit(uuid, uuid) to authenticated, service_role;
grant execute on function public.save_layout(jsonb) to authenticated;
grant execute on function public.upgrade_house() to authenticated;
grant execute on function public.update_house_settings(text, text) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.my_friends() to authenticated;
