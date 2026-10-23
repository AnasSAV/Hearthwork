/**
 * Houses, layouts, upgrades, friends and visiting against local Supabase (`npm run test:db`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR } from '../../shared/src/avatar.js';
import { CATALOG } from '../../shared/src/catalog.js';
import { validateLayout, type Placement } from '../../shared/src/house.js';
import {
  dbConfigured,
  deleteUser,
  grantCoins,
  serviceClient,
  signUpPlayer,
  sql,
} from './helpers.js';

const L1 = { width: 8, height: 6, rooms: 1 };

interface LayoutItem {
  item_id: string;
  room: number;
  x: number;
  y: number;
  rotation?: number;
}
const it_ = (item_id: string, x: number, y: number, room = 0): LayoutItem => ({
  item_id,
  room,
  x,
  y,
  rotation: 0,
});

describe.skipIf(!dbConfigured)('houses (local Supabase)', () => {
  let owner: SupabaseClient;
  let ownerId: string;
  let visitor: SupabaseClient;
  let visitorId: string;

  const ownerName = `own${Date.now().toString(36).slice(-6)}`;
  const visitorName = `vis${Date.now().toString(36).slice(-6)}`;

  /** Give the owner one or more of every catalog item, without spending coins. */
  function stockInventory(qty = 2) {
    sql(`insert into public.inventory (user_id, item_id, qty)
         select '${ownerId}', id, ${qty} from public.items
         on conflict (user_id, item_id) do update set qty = excluded.qty`);
  }
  const save = (items: LayoutItem[], extra: Record<string, unknown> = {}) =>
    owner.rpc('save_layout', { p_layout: { wallpaper: null, floor: null, items, ...extra } });

  beforeAll(async () => {
    ({ client: owner, userId: ownerId } = await signUpPlayer());
    ({ client: visitor, userId: visitorId } = await signUpPlayer());
    await owner.rpc('update_profile', { p_username: ownerName, p_avatar: DEFAULT_AVATAR });
    await visitor.rpc('update_profile', { p_username: visitorName, p_avatar: DEFAULT_AVATAR });
  });
  afterAll(() => {
    if (ownerId) deleteUser(ownerId);
    if (visitorId) deleteUser(visitorId);
  });

  it('saves a valid layout and reads it back in order', async () => {
    stockInventory();
    const layout = [
      it_('rug_amber', 1, 3),
      it_('table_oval', 1, 2),
      it_('candelabra_gold', 2, 2),
      it_('painting_meadow', 0, 0),
    ];
    const { error } = await save(layout);
    expect(error).toBeNull();
    const { data } = await owner
      .from('placed_items')
      .select('item_id, room, x, y')
      .eq('owner_id', ownerId);
    expect(data).toHaveLength(4);
    expect(new Set(data!.map((r) => r.item_id))).toEqual(new Set(layout.map((l) => l.item_id)));
  });

  it('rejects overlaps, bad layers, blocked doors, unowned items and missing hosts', async () => {
    const cases: [LayoutItem[], RegExp][] = [
      [[it_('table_side', 2, 2), it_('stool', 2, 2)], /overlap/],
      [[it_('table_side', 2, 0)], /outside the room or on the wrong layer/],
      [[it_('painting_meadow', 2, 3)], /wrong layer/],
      [[it_('stool', 4, 5)], /doorway/],
      [[it_('candelabra_gold', 3, 3)], /table or desk/],
      [[it_('stool', 1, 1), it_('stool', 2, 1), it_('stool', 3, 1)], /do not own enough/],
      [[it_('wall_wood', 1, 0)], /cannot be placed/],
      [[it_('piano', 1, 1)], /bigger house/],
      [[it_('stool', 1, 1, 1)], /room this house does not have/],
    ];
    for (const [items, message] of cases) {
      const { error } = await save(items);
      expect(error?.message, JSON.stringify(items)).toMatch(message);
    }
    // The previous layout is untouched after failed saves.
    expect(
      Number(sql(`select count(*) from public.placed_items where owner_id = '${ownerId}'`)),
    ).toBe(4);
  });

  it('agrees with shared canPlace() on a batch of layouts', async () => {
    const ids = CATALOG.filter(
      (c) => c.category !== 'wall' && c.category !== 'floor' && c.minHouseLevel === 1,
    ).map((c) => c.id);
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % n;
    };
    for (let i = 0; i < 25; i++) {
      const items = Array.from({ length: 1 + rand(3) }, () =>
        it_(ids[rand(ids.length)]!, rand(8), rand(6)),
      );
      const placements: Placement[] = items.map((l) => ({
        itemId: l.item_id,
        room: l.room,
        x: l.x,
        y: l.y,
        rotation: 0,
      }));
      const ts = validateLayout(L1, placements).ok;
      const { error } = await save(items);
      expect(error === null, `${JSON.stringify(items)} ts=${ts} sql=${error?.message}`).toBe(ts);
    }
  });

  it('sets owned wallpaper and floor only', async () => {
    expect((await save([], { wallpaper: 'wall_wood', floor: 'floor_oak' })).error).toBeNull();
    sql(`delete from public.inventory where user_id = '${ownerId}' and item_id = 'wall_pale'`);
    expect((await save([], { wallpaper: 'wall_pale' })).error?.message).toMatch(
      /do not own wallpaper/,
    );
    expect((await save([], { floor: 'wall_stone' })).error?.message).toMatch(/do not own floor/);
  });

  it('upgrades only with enough focus time and coins, charging through the ledger', async () => {
    const noFocus = await owner.rpc('upgrade_house');
    expect(noFocus.error?.message).toMatch(/20 hours of total focus/);

    sql(`update public.profiles set total_focus_min = 1300 where id = '${ownerId}'`);
    expect((await owner.rpc('upgrade_house')).error?.message).toMatch(/not enough coins/);

    grantCoins(ownerId, 1600);
    const ok = await owner.rpc('upgrade_house');
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ level: 2, coins: 100, width: 12, height: 8, rooms: 1 });
    expect(
      sql(
        `select delta || ',' || reason from public.coin_ledger where user_id = '${ownerId}' and reason = 'upgrade'`,
      ),
    ).toBe('-1500,upgrade');

    // Existing furniture stays where it was; level-2 items can now be placed.
    expect((await save([it_('piano', 9, 3), it_('table_oval', 1, 2)])).error).toBeNull();
  });

  it('visibility: friends-only houses open up once a friend request is accepted', async () => {
    // Default visibility is 'friends' and they aren't friends yet.
    let seen = await visitor.from('houses').select('owner_id').eq('owner_id', ownerId);
    expect(seen.data).toHaveLength(0);
    const svc = serviceClient();
    expect((await svc.rpc('can_visit', { p_visitor: visitorId, p_owner: ownerId })).data).toBe(
      false,
    );

    expect(
      (await visitor.rpc('send_friend_request', { p_username: ownerName.toUpperCase() })).data,
    ).toBe('requested');
    expect((await visitor.rpc('send_friend_request', { p_username: ownerName })).data).toBe(
      'already requested',
    );
    const incoming = await owner.rpc('my_friends');
    expect(incoming.data).toEqual([
      expect.objectContaining({ user_id: visitorId, status: 'pending', incoming: true }),
    ]);

    expect(
      (await owner.rpc('respond_friend_request', { p_from: visitorId, p_accept: true })).error,
    ).toBeNull();
    seen = await visitor.from('houses').select('owner_id').eq('owner_id', ownerId);
    expect(seen.data).toHaveLength(1);
    const layout = await visitor.from('placed_items').select('item_id').eq('owner_id', ownerId);
    expect(layout.data!.length).toBeGreaterThan(0);
    expect((await svc.rpc('can_visit', { p_visitor: visitorId, p_owner: ownerId })).data).toBe(
      true,
    );
  });

  it('private houses stay closed even to friends; public ones are open to all', async () => {
    expect(
      (
        await owner.rpc('update_house_settings', {
          p_visibility: 'private',
          p_exterior_style: 'brick',
        })
      ).error,
    ).toBeNull();
    expect(
      (await visitor.from('houses').select('owner_id').eq('owner_id', ownerId)).data,
    ).toHaveLength(0);

    await visitor.rpc('remove_friend', { p_other: ownerId });
    await owner.rpc('update_house_settings', {
      p_visibility: 'public',
      p_exterior_style: 'cottage',
    });
    expect(
      (await visitor.from('houses').select('owner_id').eq('owner_id', ownerId)).data,
    ).toHaveLength(1);
    expect(
      (
        await owner.rpc('update_house_settings', {
          p_visibility: 'everyone',
          p_exterior_style: 'cottage',
        })
      ).error,
    ).not.toBeNull();
  });

  it('nobody writes houses or layouts directly', async () => {
    const upd = await owner.from('houses').update({ level: 3 }).eq('owner_id', ownerId).select();
    expect(upd.error ?? (upd.data?.length ? null : 'no rows')).not.toBeNull();
    const ins = await visitor
      .from('placed_items')
      .insert({ owner_id: ownerId, item_id: 'stool', x: 1, y: 1 });
    expect(ins.error).not.toBeNull();
    const fr = await visitor
      .from('friendships')
      .insert({ user_id: visitorId, friend_id: ownerId, status: 'accepted' });
    expect(fr.error).not.toBeNull();
  });

  it('keeps the ledger invariant', async () => {
    const { data } = await serviceClient().rpc('ledger_mismatches');
    expect(data).toEqual([]);
  });
});
