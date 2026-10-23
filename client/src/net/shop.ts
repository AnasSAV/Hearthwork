import type { ItemCategory, ItemLayer } from '@focus-town/shared';
import { supabase } from './supabase';

/** A row of the `items` catalog as the shop shows it. Prices always come from the database. */
export interface ShopItem {
  id: string;
  name: string;
  category: ItemCategory;
  price: number;
  footprint_w: number;
  footprint_h: number;
  layer: ItemLayer;
  sprite_key: string;
  min_house_level: number;
}

export interface BuyResult {
  purchaseId: string;
  itemId: string;
  price: number;
  coins: number;
  qty: number;
  duplicate: boolean;
}

const ITEM_COLUMNS =
  'id, name, category, price, footprint_w, footprint_h, layer, sprite_key, min_house_level';

export async function fetchCatalog(): Promise<ShopItem[]> {
  const { data, error } = await supabase
    .from('items')
    .select(ITEM_COLUMNS)
    .eq('active', true)
    .order('price');
  if (error) throw new Error(error.message);
  return data as ShopItem[];
}

/** item id → quantity owned. */
export async function fetchInventory(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('inventory').select('item_id, qty').gt('qty', 0);
  if (error) throw new Error(error.message);
  return new Map((data as { item_id: string; qty: number }[]).map((r) => [r.item_id, r.qty]));
}

export async function fetchHouseLevel(): Promise<number> {
  // Players can read friends' and public houses too, so pick their own explicitly.
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return 1;
  const { data, error } = await supabase
    .from('houses')
    .select('level')
    .eq('owner_id', uid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { level: number } | null)?.level ?? 1;
}

/**
 * Buy one item. Sends only the item id and a fresh request id (idempotency key); the price,
 * balance check and coin change all happen inside the `buy_item` SQL function.
 */
export async function buyItem(itemId: string, requestId: string): Promise<BuyResult> {
  const { data, error } = await supabase.rpc('buy_item', {
    p_item_id: itemId,
    p_request_id: requestId,
  });
  if (error) throw new Error(error.message);
  return data as BuyResult;
}
