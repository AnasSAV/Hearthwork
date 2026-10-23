-- Focus Town: shop and inventory (Phase 3).
--
-- Players buy with `buy_item(item_id, request_id)`, called straight from the browser with their
-- own JWT. The function reads the price from `items` (the client never sends one), locks the
-- profile row so concurrent purchases serialize, and writes the coin change and its ledger row
-- in the same transaction. `request_id` makes retries and double-clicks idempotent.

create table public.items (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  category text not null check (category in ('furniture', 'wall', 'floor', 'decor', 'plant')),
  price int not null check (price > 0),
  footprint_w int not null default 1 check (footprint_w between 1 and 4),
  footprint_h int not null default 1 check (footprint_h between 1 and 4),
  layer text not null default 'floor' check (layer in ('floor', 'rug', 'wall', 'surface')),
  sprite_key text not null,
  min_house_level int not null default 1 references public.house_levels,
  -- Surface items (lamps, candles…) may be placed on top of items with this flag.
  surface_host boolean not null default false,
  -- Retired items stay for existing inventories but are hidden from the shop.
  active boolean not null default true
);

create table public.inventory (
  user_id uuid not null references public.profiles on delete cascade,
  item_id text not null references public.items,
  qty int not null check (qty >= 0),
  primary key (user_id, item_id)
);

-- One row per purchase. Its id doubles as the client's idempotency key.
create table public.purchases (
  id uuid primary key,
  user_id uuid not null references public.profiles on delete cascade,
  item_id text not null references public.items,
  price int not null check (price > 0),
  created_at timestamptz not null default now()
);
create index purchases_user on public.purchases (user_id, created_at desc);

revoke all on public.items, public.inventory, public.purchases from anon, authenticated, service_role;
grant select on public.items to anon, authenticated, service_role;
grant select on public.inventory, public.purchases to authenticated, service_role;

alter table public.items enable row level security;
alter table public.inventory enable row level security;
alter table public.purchases enable row level security;

create policy "catalog is public" on public.items
  for select to anon, authenticated using (true);
create policy "read own inventory" on public.inventory
  for select to authenticated using (user_id = (select auth.uid()));
create policy "read own purchases" on public.purchases
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- buy_item
-- ---------------------------------------------------------------------------------------------

create function public.buy_item(p_item_id text, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_item public.items;
  v_house_level int;
  v_purchase_id uuid := coalesce(p_request_id, gen_random_uuid());
  v_existing public.purchases;
  v_qty int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Lock the buyer's profile first: every purchase by this player runs one at a time.
  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'no profile' using errcode = '22023';
  end if;

  -- Same request again (double-click, network retry): report the original result, charge nothing.
  if p_request_id is not null then
    select * into v_existing from public.purchases where id = p_request_id;
    if found then
      if v_existing.user_id <> v_uid then
        raise exception 'request id already used' using errcode = '22023';
      end if;
      select qty into v_qty from public.inventory where user_id = v_uid and item_id = v_existing.item_id;
      return jsonb_build_object(
        'purchaseId', v_existing.id, 'itemId', v_existing.item_id, 'price', v_existing.price,
        'coins', v_profile.coins, 'qty', coalesce(v_qty, 0), 'duplicate', true
      );
    end if;
  end if;

  select * into v_item from public.items where id = p_item_id and active;
  if not found then
    raise exception 'unknown item' using errcode = '22023';
  end if;

  select level into v_house_level from public.houses where owner_id = v_uid;
  if coalesce(v_house_level, 1) < v_item.min_house_level then
    raise exception 'needs house level %', v_item.min_house_level using errcode = '22023';
  end if;

  -- Wallpapers and floors restyle the house; one of each is enough.
  if v_item.category in ('wall', 'floor') and exists (
    select 1 from public.inventory where user_id = v_uid and item_id = v_item.id and qty > 0
  ) then
    raise exception 'already owned' using errcode = '22023';
  end if;

  if v_profile.coins < v_item.price then
    raise exception 'not enough coins' using errcode = '22023';
  end if;

  update public.profiles set coins = coins - v_item.price where id = v_uid
  returning * into v_profile;

  insert into public.purchases (id, user_id, item_id, price)
  values (v_purchase_id, v_uid, v_item.id, v_item.price);

  insert into public.coin_ledger (user_id, delta, reason, ref_id)
  values (v_uid, -v_item.price, 'purchase', v_purchase_id::text);

  insert into public.inventory (user_id, item_id, qty) values (v_uid, v_item.id, 1)
  on conflict (user_id, item_id) do update set qty = public.inventory.qty + 1
  returning qty into v_qty;

  return jsonb_build_object(
    'purchaseId', v_purchase_id, 'itemId', v_item.id, 'price', v_item.price,
    'coins', v_profile.coins, 'qty', v_qty, 'duplicate', false
  );
end;
$$;

revoke all on function public.buy_item(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.buy_item(text, uuid) to authenticated;
