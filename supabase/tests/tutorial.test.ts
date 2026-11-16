/** The introduction is remembered per account, once, and only by its owner. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbConfigured, signUpPlayer, sql } from './helpers.js';

describe.skipIf(!dbConfigured)('introduction (local Supabase)', () => {
  let player: SupabaseClient;
  let userId: string;
  let other: string;

  beforeAll(async () => {
    ({ client: player, userId } = await signUpPlayer());
    ({ userId: other } = await signUpPlayer());
  });

  afterAll(() => {
    for (const id of [userId, other]) if (id) sql(`delete from auth.users where id = '${id}'`);
  });

  const seenAt = (id: string) =>
    sql(`select coalesce(tutorial_seen_at::text, '') from public.profiles where id = '${id}'`);

  it('starts unseen and is marked seen by the player', async () => {
    const { data } = await player
      .from('profiles')
      .select('tutorial_seen_at')
      .eq('id', userId)
      .single();
    expect(data).toEqual({ tutorial_seen_at: null });
    const { error } = await player.rpc('finish_tutorial');
    expect(error).toBeNull();
    expect(seenAt(userId)).not.toBe('');
  });

  it('keeps the first time it was seen', async () => {
    const first = seenAt(userId);
    await player.rpc('finish_tutorial');
    expect(seenAt(userId)).toBe(first);
  });

  it("only touches the caller's own profile", () => {
    expect(seenAt(other)).toBe('');
  });
});
