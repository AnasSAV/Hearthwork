/**
 * Shop integration tests against local Supabase (`npm run test:db`).
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOG } from '../../shared/src/catalog.js';
import {
  dbConfigured,
  deleteUser,
  grantCoins,
  serviceClient,
  signUpPlayer,
  sql,
} from './helpers.js';

interface BuyResult {
  purchaseId: string;
  itemId: string;
  price: number;
  coins: number;
  qty: number;
  duplicate: boolean;
}

describe.skipIf(!dbConfigured)('shop (local Supabase)', () => {
  let player: SupabaseClient;
  let userId: string;

  const coins = () => Number(sql(`select coins from public.profiles where id = '${userId}'`));
  const qty = (item: string) =>
    Number(
      sql(
        `select coalesce(sum(qty),0) from public.inventory where user_id = '${userId}' and item_id = '${item}'`,
      ),
    );
  const buy = (item: string, requestId: string = randomUUID()) =>
    player.rpc('buy_item', { p_item_id: item, p_request_id: requestId });

  beforeAll(async () => {
    ({ client: player, userId } = await signUpPlayer());
  });
  afterAll(() => {
    if (userId) deleteUser(userId);
  });

  it('the catalog is readable by anyone and matches shared/src/catalog.ts', async () => {
    const { data, error } = await player.from('items').select('id, price').eq('active', true);
    expect(error).toBeNull();
    const db = new Map((data ?? []).map((r) => [r.id as string, r.price as number]));
    expect(db.size).toBe(CATALOG.length);
    for (const item of CATALOG) expect(db.get(item.id)).toBe(item.price);
  });

  it('refuses a purchase without enough coins and changes nothing', async () => {
    const { error } = await buy('table_side');
    expect(error?.message).toMatch(/not enough coins/);
    expect(coins()).toBe(0);
    expect(qty('table_side')).toBe(0);
  });

  it('deducts the catalog price, writes the ledger and adds to inventory', async () => {
    grantCoins(userId, 500);
    const { data, error } = await buy('table_side');
    expect(error).toBeNull();
    const r = data as BuyResult;
    expect(r).toMatchObject({
      itemId: 'table_side',
      price: 150,
      coins: 350,
      qty: 1,
      duplicate: false,
    });
    expect(coins()).toBe(350);
    const ledger = sql(
      `select delta || ',' || reason from public.coin_ledger where ref_id = '${r.purchaseId}'`,
    );
    expect(ledger).toBe('-150,purchase');
  });

  it('is idempotent: the same request id never charges twice', async () => {
    const requestId = randomUUID();
    const [a, b] = await Promise.all([buy('stool', requestId), buy('stool', requestId)]);
    const results = [a, b].map((x) => x.data as BuyResult | null);
    expect(results.filter((r) => r && !r.duplicate)).toHaveLength(1);
    expect(coins()).toBe(300);
    expect(qty('stool')).toBe(1);
  });

  it('serializes concurrent purchases so coins can never go negative', async () => {
    sql(
      `with l as (insert into public.coin_ledger (user_id, delta, reason, ref_id) values ('${userId}', -100, 'purchase', 'test-spend') returning delta)
       update public.profiles set coins = coins + (select delta from l) where id = '${userId}'`,
    );
    expect(coins()).toBe(200);
    // Five different clicks at once on a 150-coin item with 200 coins: exactly one succeeds.
    const results = await Promise.all(Array.from({ length: 5 }, () => buy('table_side')));
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error?.message.match(/not enough coins/))).toHaveLength(4);
    expect(coins()).toBe(50);
    expect(qty('table_side')).toBe(2);
  });

  it('enforces the house level and one-of-a-kind wallpapers', async () => {
    grantCoins(userId, 1000);
    const piano = await buy('piano');
    expect(piano.error?.message).toMatch(/house level 2/);

    expect((await buy('wall_wood')).error).toBeNull();
    expect((await buy('wall_wood')).error?.message).toMatch(/already owned/);
  });

  it('rejects unknown items, and nobody can write coins or inventory directly', async () => {
    expect((await buy('not_a_real_item')).error?.message).toMatch(/unknown item/);
    const before = coins();
    const upd = await player.from('profiles').update({ coins: 999999 }).eq('id', userId).select();
    expect(upd.error ?? (upd.data?.length ? null : 'no rows')).not.toBeNull();
    const inv = await player
      .from('inventory')
      .insert({ user_id: userId, item_id: 'piano', qty: 5 });
    expect(inv.error).not.toBeNull();
    const item = await player.from('items').update({ price: 1 }).eq('id', 'piano').select();
    expect(item.error ?? (item.data?.length ? null : 'no rows')).not.toBeNull();
    expect(coins()).toBe(before);
  });

  it('keeps the ledger invariant for everyone', async () => {
    const { data, error } = await serviceClient().rpc('ledger_mismatches');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
