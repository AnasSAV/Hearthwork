-- =============================================================================================
-- Homes: housemates, yards and garden items, and the world map.
--
-- * Everyone owns a house (created at signup). profiles.home_owner says where they live: null
--   means their own house, otherwise the owner of the house they moved into. Members of a
--   house are its owner (if they live there) and everyone whose home_owner points at it.
--   Coins and inventories stay personal; any member can decorate, upgrade and change settings.
-- * A player's placed items only ever exist in their current home: moving in or out removes
--   them (they go back to the inventory, which counts owned items, not unplaced ones).
-- * The yard is room -1 of the layout: a 20×14 garden in front of the house. Only `garden`
--   items go there and only other items go inside. Reserved yard tiles (house, paths,
--   signpost) mirror YARD_RESERVED in shared/src/house.ts.
-- =============================================================================================

-- Garden items, the yard room and who placed each item --------------------------------------

alter table public.items drop constraint items_category_check;
alter table public.items add constraint items_category_check
  check (category in ('furniture', 'wall', 'floor', 'decor', 'plant', 'garden'));

alter table public.placed_items drop constraint placed_items_room_check;
alter table public.placed_items add constraint placed_items_room_check check (room >= -1);
alter table public.placed_items add column placed_by uuid references public.profiles on delete cascade;
update public.placed_items set placed_by = owner_id;
alter table public.placed_items alter column placed_by set not null;
create index placed_items_placed_by on public.placed_items (placed_by);

-- Housemates ----------------------------------------------------------------------------------

alter table public.profiles
  add column home_owner uuid references public.houses (owner_id) on delete set null,
  add constraint profiles_home_not_self check (home_owner is distinct from id);

-- (owner_id, user_id, true): the household invited the user.
-- (owner_id, user_id, false): the user asked to move in.
create table public.house_invites (
  owner_id uuid not null references public.houses on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  from_owner boolean not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, user_id),
  check (owner_id <> user_id)
);
revoke all on public.house_invites from anon, authenticated, service_role;
grant select on public.house_invites to service_role;
alter table public.house_invites enable row level security;

create function public.home_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(home_owner, id) from public.profiles where id = p_user;
$$;

create function public.is_member(p_user uuid, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and public.home_of(p_user) = p_owner;
$$;

-- Visiting: members always; public houses; friends-only houses for friends of any member.
create or replace function public.can_visit(p_visitor uuid, p_owner uuid)
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
         or public.is_member(p_visitor, p_owner)
         or h.visibility = 'public'
         or (h.visibility = 'friends' and exists (
               select 1 from public.profiles m
                where coalesce(m.home_owner, m.id) = p_owner
                  and public.are_friends(p_visitor, m.id)))
       )
  );
$$;

-- Layout ----------------------------------------------------------------------------------

-- p_layout: { "wallpaper": item id | null, "floor": item id | null,
--             "items": [{ "item_id", "room", "x", "y", "rotation", "placed_by"? }] }
-- Saves the caller's home. Items keep who placed them (default: the caller); members may move
-- or remove anyone's items, but only add items from their own inventory.
create or replace function public.save_layout(p_layout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
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
  v_owner := public.home_of(v_uid);
  select * into v_house from public.houses where owner_id = v_owner for update;
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
  if jsonb_array_length(coalesce(p_layout -> 'items', '[]'::jsonb)) > 300 then
    raise exception 'too many items (max 300)' using errcode = '22023';
  end if;

  drop table if exists pg_temp.layout_items;
  create temp table layout_items on commit drop as
  select r.ord, r.item_id, r.room, r.x, r.y, r.rotation, r.placed_by,
         i.id as known, i.category, i.layer, i.footprint_w as w, i.footprint_h as h,
         i.surface_host, i.min_house_level
    from (
      select e.ord,
             e.elem ->> 'item_id' as item_id,
             (e.elem ->> 'room')::int as room,
             (e.elem ->> 'x')::int as x,
             (e.elem ->> 'y')::int as y,
             coalesce((e.elem ->> 'rotation')::int, 0) as rotation,
             coalesce(nullif(e.elem ->> 'placed_by', '')::uuid, v_uid) as placed_by
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

  select item_id into v_bad from pg_temp.layout_items where not public.is_member(placed_by, v_owner) limit 1;
  if found then raise exception '% was placed by someone who does not live here', v_bad using errcode = '22023'; end if;

  select item_id into v_bad from pg_temp.layout_items where room < -1 or room >= v_dims.rooms limit 1;
  if found then raise exception '% is in a room this house does not have', v_bad using errcode = '22023'; end if;

  select item_id into v_bad from pg_temp.layout_items
   where (room = -1) <> (category = 'garden') limit 1;
  if found then raise exception '% is on the wrong side of the front door', v_bad using errcode = '22023'; end if;

  -- Bounds. Inside: wall items on row 0 only, everything else on the floor rows. Yard: 20×14.
  select item_id into v_bad from pg_temp.layout_items
   where (room >= 0 and (
            x < 0 or x + w > v_dims.width
            or (layer = 'wall' and (y <> 0 or h <> 1))
            or (layer <> 'wall' and (y < 1 or y + h > v_dims.height))))
      or (room = -1 and (x < 0 or x + w > 20 or y < 0 or y + h > 14 or layer = 'wall'))
   limit 1;
  if found then raise exception '% is outside the room or on the wrong layer', v_bad using errcode = '22023'; end if;

  -- Expand every item into the tiles it covers.
  drop table if exists pg_temp.layout_tiles;
  create temp table layout_tiles on commit drop as
  select l.ord, l.item_id, l.room, l.layer, l.surface_host, l.x + dx as tx, l.y + dy as ty
    from pg_temp.layout_items l
    cross join lateral generate_series(0, l.w - 1) dx
    cross join lateral generate_series(0, l.h - 1) dy;

  -- Yard tiles kept clear: the house (x 5–14, y 0–5), the path from the door (x 7–8, y 6–13),
  -- the path to the gate (x 0–6, y 12–13) and the signpost (0, 11).
  select item_id into v_bad from pg_temp.layout_tiles
   where room = -1 and (
     (tx between 5 and 14 and ty between 0 and 5)
     or (tx between 7 and 8 and ty between 6 and 13)
     or (tx between 0 and 6 and ty between 12 and 13)
     or (tx = 0 and ty = 11))
   limit 1;
  if found then raise exception '% blocks the house or a path', v_bad using errcode = '22023'; end if;

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

  -- Your own items: at most as many as you own (your placed items only live in your home).
  select l.item_id into v_bad from (
    select item_id, count(*) as n from pg_temp.layout_items where placed_by = v_uid group by item_id
  ) l left join public.inventory inv on inv.user_id = v_uid and inv.item_id = l.item_id
   where coalesce(inv.qty, 0) < l.n
   limit 1;
  if found then raise exception 'you do not own enough of %', v_bad using errcode = '22023'; end if;

  -- Housemates' items: moved or removed, never added on their behalf.
  select l.item_id into v_bad from (
    select item_id, placed_by, count(*) as n from pg_temp.layout_items
     where placed_by <> v_uid group by item_id, placed_by
  ) l
   where l.n > (select count(*) from public.placed_items p
                 where p.owner_id = v_owner and p.item_id = l.item_id and p.placed_by = l.placed_by)
   limit 1;
  if found then raise exception 'you can only add your own %', v_bad using errcode = '22023'; end if;

  -- Wallpaper and floor: keep the current one, or use one you own.
  if v_wallpaper is distinct from v_house.wallpaper and v_wallpaper is not null and not exists (
    select 1 from public.inventory inv join public.items i on i.id = inv.item_id
     where inv.user_id = v_uid and inv.item_id = v_wallpaper and inv.qty > 0 and i.category = 'wall') then
    raise exception 'you do not own wallpaper %', v_wallpaper using errcode = '22023';
  end if;
  if v_floor is distinct from v_house.floor and v_floor is not null and not exists (
    select 1 from public.inventory inv join public.items i on i.id = inv.item_id
     where inv.user_id = v_uid and inv.item_id = v_floor and inv.qty > 0 and i.category = 'floor') then
    raise exception 'you do not own floor %', v_floor using errcode = '22023';
  end if;

  delete from public.placed_items where owner_id = v_owner;
  insert into public.placed_items (owner_id, item_id, room, x, y, rotation, placed_by)
  select v_owner, item_id, room, x, y, rotation, placed_by from pg_temp.layout_items order by ord;
  get diagnostics v_count = row_count;
  update public.houses set wallpaper = v_wallpaper, floor = v_floor where owner_id = v_owner;

  return jsonb_build_object('items', v_count, 'wallpaper', v_wallpaper, 'floor', v_floor);
end;
$$;

-- Upgrades and settings apply to the caller's home; the caller pays.
create or replace function public.upgrade_house()
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
  select * into v_house from public.houses where owner_id = public.home_of(v_uid) for update;
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
  update public.houses set level = v_next.level where owner_id = v_house.owner_id;

  return jsonb_build_object(
    'level', v_next.level, 'coins', v_profile.coins,
    'width', v_next.width, 'height', v_next.height, 'rooms', v_next.rooms
  );
end;
$$;

create or replace function public.update_house_settings(p_visibility text, p_exterior_style text)
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
   where owner_id = public.home_of(auth.uid());
end;
$$;

-- Moving in and out ---------------------------------------------------------------------------

-- Internal: p_user moves into p_owner's house. Callers have checked who agreed to it.
create function public.move_in(p_user uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.home_of(p_owner) is distinct from p_owner then
    raise exception 'that household has moved out of its house' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where home_owner = p_user) then
    raise exception 'people live in your house; they need to move out first' using errcode = '22023';
  end if;
  if (select count(*) from public.profiles where coalesce(home_owner, id) = p_owner) >= 4 then
    raise exception 'that house is full (4 people)' using errcode = '22023';
  end if;
  delete from public.placed_items where placed_by = p_user;
  update public.profiles set home_owner = p_owner where id = p_user;
  delete from public.house_invites where user_id = p_user;
  -- Housemates are friends.
  if exists (select 1 from public.friendships
              where (user_id = p_user and friend_id = p_owner) or (user_id = p_owner and friend_id = p_user)) then
    update public.friendships set status = 'accepted'
     where (user_id = p_user and friend_id = p_owner) or (user_id = p_owner and friend_id = p_user);
  else
    insert into public.friendships (user_id, friend_id, status) values (p_user, p_owner, 'accepted');
  end if;
end;
$$;

-- Ask to move in with a player (into the house they live in). Accepts a standing invitation.
create function public.request_move_in(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_home uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select id into v_target from public.profiles where lower(username) = lower(trim(p_username));
  if not found then
    raise exception 'no player called %', p_username using errcode = '22023';
  end if;
  v_home := public.home_of(v_target);
  if v_target = v_uid or v_home = public.home_of(v_uid) then
    return 'already living there';
  end if;
  if exists (select 1 from public.house_invites
              where owner_id = v_home and user_id = v_uid and from_owner) then
    perform public.move_in(v_uid, v_home);
    return 'moved in';
  end if;
  insert into public.house_invites (owner_id, user_id, from_owner) values (v_home, v_uid, false)
  on conflict (owner_id, user_id) do nothing;
  return 'requested';
end;
$$;

-- Invite a friend to live in your home. Accepts their standing request.
create function public.invite_housemate(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_home uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select id into v_target from public.profiles where lower(username) = lower(trim(p_username));
  if not found then
    raise exception 'no player called %', p_username using errcode = '22023';
  end if;
  v_home := public.home_of(v_uid);
  if public.home_of(v_target) = v_home then
    return 'already living here';
  end if;
  if not public.are_friends(v_uid, v_target) then
    raise exception 'you can only invite friends' using errcode = '22023';
  end if;
  if exists (select 1 from public.house_invites
              where owner_id = v_home and user_id = v_target and not from_owner) then
    perform public.move_in(v_target, v_home);
    return 'moved in';
  end if;
  insert into public.house_invites (owner_id, user_id, from_owner) values (v_home, v_target, true)
  on conflict (owner_id, user_id) do update set from_owner = true, created_at = now();
  return 'invited';
end;
$$;

-- Answer a move-in request to your home (p_other = who asked), or an invitation to someone
-- else's home (p_other = that house's owner).
create function public.respond_house_invite(p_other uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_home uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  v_home := public.home_of(v_uid);
  if exists (select 1 from public.house_invites
              where owner_id = v_home and user_id = p_other and not from_owner) then
    delete from public.house_invites where owner_id = v_home and user_id = p_other;
    if p_accept then
      perform public.move_in(p_other, v_home);
      return 'moved in';
    end if;
    return 'declined';
  end if;
  if exists (select 1 from public.house_invites
              where owner_id = p_other and user_id = v_uid and from_owner) then
    delete from public.house_invites where owner_id = p_other and user_id = v_uid;
    if p_accept then
      perform public.move_in(v_uid, p_other);
      return 'moved in';
    end if;
    return 'declined';
  end if;
  raise exception 'no such invitation' using errcode = '22023';
end;
$$;

-- Move back to your own house. Your items in the shared house return to your inventory.
create function public.leave_home()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_home uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select home_owner into v_home from public.profiles where id = v_uid for update;
  if v_home is null then
    raise exception 'you already live in your own house' using errcode = '22023';
  end if;
  delete from public.placed_items where owner_id = v_home and placed_by = v_uid;
  update public.profiles set home_owner = null where id = v_uid;
end;
$$;

-- The owner asks a housemate to move out.
create function public.remove_housemate(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and home_owner = v_uid) then
    raise exception 'they do not live in your house' using errcode = '22023';
  end if;
  delete from public.placed_items where owner_id = v_uid and placed_by = p_user;
  update public.profiles set home_owner = null where id = p_user;
end;
$$;

-- Your home, its members and pending invitations (in both directions).
create function public.my_home()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as uid, public.home_of(auth.uid()) as home)
  select jsonb_build_object(
    'owner_id', h.owner_id,
    'owner_name', o.username,
    'level', h.level,
    'exterior_style', h.exterior_style,
    'visibility', h.visibility,
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', p.id, 'username', p.username, 'avatar', p.avatar,
               'is_owner', p.id = h.owner_id) order by p.id <> h.owner_id, p.username), '[]')
        from public.profiles p where coalesce(p.home_owner, p.id) = h.owner_id),
    'requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', p.id, 'username', p.username, 'avatar', p.avatar, 'from_owner', i.from_owner)
               order by i.created_at), '[]')
        from public.house_invites i join public.profiles p on p.id = i.user_id
       where i.owner_id = h.owner_id),
    'invites', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'owner_id', i.owner_id, 'owner_name', op.username, 'from_owner', i.from_owner)
               order by i.created_at), '[]')
        from public.house_invites i join public.profiles op on op.id = i.owner_id
       where i.user_id = me.uid)
  )
    from me
    join public.houses h on h.owner_id = me.home
    join public.profiles o on o.id = h.owner_id;
$$;

-- World map: your home, friends' homes you may visit and public homes. Houses whose owner
-- moved in with someone else are empty and left off.
create function public.world_map()
returns table (
  owner_id uuid, owner_name text, level int, exterior_style text, visibility text,
  members text[], relation text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as uid, public.home_of(auth.uid()) as home),
  homes as (
    select h.*, o.username as owner_name,
           array(select p.username from public.profiles p
                  where coalesce(p.home_owner, p.id) = h.owner_id
                  order by p.id <> h.owner_id, p.username) as members,
           exists (select 1 from public.profiles p
                    where coalesce(p.home_owner, p.id) = h.owner_id
                      and public.are_friends((select uid from me), p.id)) as friendly
      from public.houses h
      join public.profiles o on o.id = h.owner_id
     where o.home_owner is null
  )
  select owner_id, owner_name, level, exterior_style, visibility, members,
         case when owner_id = (select home from me) then 'home'
              when friendly then 'friend' else 'public' end
    from homes
   where owner_id = (select home from me)
      or visibility = 'public'
      or (visibility = 'friends' and friendly)
   order by owner_id <> (select home from me), not friendly, owner_name
   limit 60;
$$;

-- Friends now also report where they live.
drop function public.my_friends();
create function public.my_friends()
returns table (
  user_id uuid, username text, avatar jsonb, status text, incoming boolean,
  house_level int, can_visit boolean, home_owner uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.avatar, f.status, f.friend_id = auth.uid(),
         h.level, public.can_visit(auth.uid(), h.owner_id), h.owner_id
    from public.friendships f
    join public.profiles p
      on p.id = case when f.user_id = auth.uid() then f.friend_id else f.user_id end
    left join public.houses h on h.owner_id = coalesce(p.home_owner, p.id)
   where auth.uid() in (f.user_id, f.friend_id)
   order by f.status desc, p.username;
$$;

-- Privileges ----------------------------------------------------------------------------------

revoke all on function public.home_of(uuid) from public, anon, authenticated, service_role;
revoke all on function public.is_member(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.move_in(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.request_move_in(text) from public, anon, authenticated, service_role;
revoke all on function public.invite_housemate(text) from public, anon, authenticated, service_role;
revoke all on function public.respond_house_invite(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.leave_home() from public, anon, authenticated, service_role;
revoke all on function public.remove_housemate(uuid) from public, anon, authenticated, service_role;
revoke all on function public.my_home() from public, anon, authenticated, service_role;
revoke all on function public.world_map() from public, anon, authenticated, service_role;
revoke all on function public.my_friends() from public, anon, authenticated, service_role;

grant execute on function public.home_of(uuid) to service_role;
grant execute on function public.is_member(uuid, uuid) to service_role;
grant execute on function public.request_move_in(text) to authenticated;
grant execute on function public.invite_housemate(text) to authenticated;
grant execute on function public.respond_house_invite(uuid, boolean) to authenticated;
grant execute on function public.leave_home() to authenticated;
grant execute on function public.remove_housemate(uuid) to authenticated;
grant execute on function public.my_home() to authenticated;
grant execute on function public.world_map() to authenticated;
grant execute on function public.my_friends() to authenticated;
