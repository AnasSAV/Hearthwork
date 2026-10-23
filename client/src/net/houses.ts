import { supabase } from './supabase';

export type Visibility = 'public' | 'friends' | 'private';
export type ExteriorStyle = 'cottage' | 'brick';

export interface HomeMember {
  user_id: string;
  username: string;
  avatar: unknown;
  is_owner: boolean;
}

/** The home you live in (yours, or a friend's you moved into), from `my_home()`. */
export interface MyHome {
  owner_id: string;
  owner_name: string;
  level: number;
  exterior_style: ExteriorStyle;
  visibility: Visibility;
  members: HomeMember[];
  /** People asking to move in (from_owner false) or invited by your household (true). */
  requests: (HomeMember & { from_owner: boolean })[];
  /** Your own pending invitations (from_owner true) and requests (false) elsewhere. */
  invites: { owner_id: string; owner_name: string; from_owner: boolean }[];
}

/** A home on the world map, from `world_map()`. */
export interface MapHome {
  owner_id: string;
  owner_name: string;
  level: number;
  exterior_style: ExteriorStyle;
  visibility: Visibility;
  members: string[];
  relation: 'home' | 'friend' | 'public';
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
  /** Owner of the house they live in (theirs, or one they moved into). */
  home_owner: string | null;
}

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export async function fetchMyHome(): Promise<MyHome> {
  return check(await supabase.rpc('my_home')) as MyHome;
}

export async function fetchWorldMap(): Promise<MapHome[]> {
  return check(await supabase.rpc('world_map')) as MapHome[];
}

export async function requestMoveIn(username: string): Promise<string> {
  return check(await supabase.rpc('request_move_in', { p_username: username })) as string;
}

export async function inviteHousemate(username: string): Promise<string> {
  return check(await supabase.rpc('invite_housemate', { p_username: username })) as string;
}

/** Answer a move-in request (other = who asked) or an invitation (other = that home's owner). */
export async function respondHouseInvite(other: string, accept: boolean): Promise<string> {
  return check(
    await supabase.rpc('respond_house_invite', { p_other: other, p_accept: accept }),
  ) as string;
}

export async function leaveHome(): Promise<void> {
  check(await supabase.rpc('leave_home'));
}

export async function removeHousemate(userId: string): Promise<void> {
  check(await supabase.rpc('remove_housemate', { p_user: userId }));
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
  visibility: Visibility,
  exteriorStyle: ExteriorStyle,
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
