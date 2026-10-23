/**
 * Homes: housemates, yard layouts and the world map against local Supabase (`npm run test:db`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR } from '../../shared/src/avatar.js';
import { YARD_ROOM } from '../../shared/src/house.js';
import { dbConfigured, deleteUser, signUpPlayer, sql } from './helpers.js';

interface Player {
  client: SupabaseClient;
  userId: string;
  name: string;
}

const item = (item_id: string, x: number, y: number, room = 0, placed_by?: string) => ({
  item_id,
  room,
  x,
  y,
  rotation: 0,
  ...(placed_by ? { placed_by } : {}),
});

describe.skipIf(!dbConfigured)('homes (local Supabase)', () => {
  const players: Player[] = [];
  let ana: Player; // owns the shared house
  let ben: Player; // moves in with Ana
  let cat: Player; // a stranger with a public house

  async function player(prefix: string): Promise<Player> {
    const { client, userId } = await signUpPlayer();
    const name = `${prefix}${Date.now().toString(36).slice(-6)}`;
    await client.rpc('update_profile', { p_username: name, p_avatar: DEFAULT_AVATAR });
    sql(`insert into public.inventory (user_id, item_id, qty)
         select '${userId}', id, 2 from public.items`);
    const p = { client, userId, name };
    players.push(p);
    return p;
  }
  const save = (p: Player, items: ReturnType<typeof item>[]) =>
    p.client.rpc('save_layout', { p_layout: { wallpaper: null, floor: null, items } });
  const homeOf = (p: Player) =>
    sql(`select coalesce(home_owner, id) from public.profiles where id = '${p.userId}'`);

  beforeAll(async () => {
    ana = await player('ana');
    ben = await player('ben');
    cat = await player('cat');
  });
  afterAll(() => players.forEach((p) => deleteUser(p.userId)));

  it('decorates the yard with garden items only, keeping paths clear', async () => {
    expect((await save(ana, [item('garden_bush', 16, 8, YARD_ROOM)])).error).toBeNull();
    expect((await save(ana, [item('table_oval', 16, 8, YARD_ROOM)])).error).not.toBeNull();
    expect((await save(ana, [item('garden_bush', 1, 1)])).error).not.toBeNull();
    expect((await save(ana, [item('garden_hedge', 7, 9, YARD_ROOM)])).error).not.toBeNull();
    expect((await save(ana, [item('garden_bush', 6, 2, YARD_ROOM)])).error).not.toBeNull();
  });

  it('moves in after the owner accepts, and the mover’s items go back to their inventory', async () => {
    expect((await save(ben, [item('table_side', 2, 2)])).error).toBeNull();
    const asked = await ben.client.rpc('request_move_in', { p_username: ana.name });
    expect(asked.data).toBe('requested');
    expect(homeOf(ben)).toBe(ben.userId);

    const { data: home } = await ana.client.rpc('my_home');
    expect(home.requests.map((r: { user_id: string }) => r.user_id)).toEqual([ben.userId]);
    const accepted = await ana.client.rpc('respond_house_invite', {
      p_other: ben.userId,
      p_accept: true,
    });
    expect(accepted.data).toBe('moved in');
    expect(homeOf(ben)).toBe(ana.userId);
    expect(sql(`select count(*) from public.placed_items where placed_by = '${ben.userId}'`)).toBe(
      '0',
    );
    expect(
      sql(`select status from public.friendships
            where '${ben.userId}' in (user_id, friend_id) and '${ana.userId}' in (user_id, friend_id)`),
    ).toBe('accepted');
  });

  it('lets housemates decorate with their own items but not add on behalf of others', async () => {
    // Ben keeps Ana's bush where it is and adds his own table.
    const layout = [item('garden_bush', 16, 8, YARD_ROOM, ana.userId), item('table_side', 2, 2)];
    expect((await save(ben, layout)).error).toBeNull();
    expect(
      sql(`select placed_by from public.placed_items where item_id = 'table_side'
            and owner_id = '${ana.userId}'`),
    ).toBe(ben.userId);
    // Ben cannot place a second bush as Ana's.
    const forged = [...layout, item('garden_bush', 12, 8, YARD_ROOM, ana.userId)];
    expect((await save(ben, forged)).error).not.toBeNull();
    // Nor credit an outsider.
    expect(
      (await save(ben, [item('garden_bush', 16, 8, YARD_ROOM, cat.userId)])).error,
    ).not.toBeNull();
  });

  it('shows home, friends and public houses on the world map', async () => {
    sql(`update public.houses set visibility = 'public' where owner_id = '${cat.userId}'`);
    sql(`update public.houses set visibility = 'friends' where owner_id = '${ana.userId}'`);
    const { data: benMap } = await ben.client.rpc('world_map');
    const rel = new Map(
      benMap.map((r: { owner_id: string; relation: string }) => [r.owner_id, r.relation]),
    );
    expect(rel.get(ana.userId)).toBe('home');
    expect(rel.get(cat.userId)).toBe('public');
    expect(rel.has(ben.userId)).toBe(false); // Ben's own house is empty while he lives at Ana's
    const { data: catMap } = await cat.client.rpc('world_map');
    expect(catMap.some((r: { owner_id: string }) => r.owner_id === ana.userId)).toBe(false);
  });

  it('moves out again, taking their items back', async () => {
    expect((await ben.client.rpc('leave_home')).error).toBeNull();
    expect(homeOf(ben)).toBe(ben.userId);
    expect(
      sql(`select count(*) from public.placed_items
            where owner_id = '${ana.userId}' and placed_by = '${ben.userId}'`),
    ).toBe('0');
    expect(sql(`select count(*) from public.placed_items where owner_id = '${ana.userId}'`)).toBe(
      '1',
    );
  });

  it('only invites friends, and an invitation can be accepted by the invitee', async () => {
    const stranger = await ana.client.rpc('invite_housemate', { p_username: cat.name });
    expect(stranger.error).not.toBeNull();
    const invited = await ana.client.rpc('invite_housemate', { p_username: ben.name });
    expect(invited.data).toBe('invited');
    const accepted = await ben.client.rpc('respond_house_invite', {
      p_other: ana.userId,
      p_accept: true,
    });
    expect(accepted.data).toBe('moved in');
    expect((await ana.client.rpc('remove_housemate', { p_user: ben.userId })).error).toBeNull();
    expect(homeOf(ben)).toBe(ben.userId);
  });
});
