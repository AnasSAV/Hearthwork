import { supabase } from './supabase';

export interface MyHouse {
  ownerId: string;
  level: number;
  visibility: 'public' | 'friends' | 'private';
  exteriorStyle: 'cottage' | 'brick';
  plotIndex: number | null;
}

export interface HouseLevel {
  level: number;
  width: number;
  height: number;
  rooms: number;
  cost_coins: number;
  min_total_focus_min: number;
}

export interface Friend {
  user_id: string;
  username: string;
  avatar: unknown;
  status: 'pending' | 'accepted';
  incoming: boolean;
  house_level: number | null;
  can_visit: boolean;
}

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export async function fetchMyHouse(): Promise<MyHouse | null> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return null;
  const row = check(
    await supabase
      .from('houses')
      .select('owner_id, level, visibility, exterior_style, plot_index')
      .eq('owner_id', uid)
      .maybeSingle(),
  ) as {
    owner_id: string;
    level: number;
    visibility: MyHouse['visibility'];
    exterior_style: MyHouse['exteriorStyle'];
    plot_index: number | null;
  } | null;
  return (
    row && {
      ownerId: row.owner_id,
      level: row.level,
      visibility: row.visibility,
      exteriorStyle: row.exterior_style,
      plotIndex: row.plot_index,
    }
  );
}

export async function fetchHouseLevels(): Promise<HouseLevel[]> {
  return check(await supabase.from('house_levels').select('*').order('level')) as HouseLevel[];
}

export async function fetchMyProgress(): Promise<{ coins: number; totalFocusMin: number }> {
  const row = check(
    await supabase.from('profiles').select('coins, total_focus_min').maybeSingle(),
  ) as { coins: number; total_focus_min: number } | null;
  return { coins: row?.coins ?? 0, totalFocusMin: row?.total_focus_min ?? 0 };
}

export async function upgradeHouse(): Promise<{ level: number; coins: number }> {
  return check(await supabase.rpc('upgrade_house')) as { level: number; coins: number };
}

export async function updateHouseSettings(
  visibility: MyHouse['visibility'],
  exteriorStyle: MyHouse['exteriorStyle'],
): Promise<void> {
  check(
    await supabase.rpc('update_house_settings', {
      p_visibility: visibility,
      p_exterior_style: exteriorStyle,
    }),
  );
}

export async function fetchFriends(): Promise<Friend[]> {
  return check(await supabase.rpc('my_friends')) as Friend[];
}

export async function sendFriendRequest(username: string): Promise<string> {
  return check(await supabase.rpc('send_friend_request', { p_username: username })) as string;
}

export async function respondFriendRequest(from: string, accept: boolean): Promise<void> {
  check(await supabase.rpc('respond_friend_request', { p_from: from, p_accept: accept }));
}

export async function removeFriend(other: string): Promise<void> {
  check(await supabase.rpc('remove_friend', { p_other: other }));
}
