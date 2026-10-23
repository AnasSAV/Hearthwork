import { useEffect, useRef, useState } from 'react';
import type { ItemCategory } from '@focus-town/shared';
import { buyItem, fetchCatalog, fetchHouseLevel, fetchInventory, type ShopItem } from '../net/shop';
import { uiStore, useUi } from '../store';
import { ItemSprite } from './ItemSprite';

const TABS: { id: ItemCategory; label: string }[] = [
  { id: 'furniture', label: 'Furniture' },
  { id: 'decor', label: 'Decor' },
  { id: 'plant', label: 'Plants' },
  { id: 'garden', label: 'Garden' },
  { id: 'wall', label: 'Wallpaper' },
  { id: 'floor', label: 'Floors' },
];

const LAYER_LABEL: Record<string, string> = {
  floor: 'floor',
  rug: 'rug',
  surface: 'goes on a table',
  wall: 'hangs on the wall',
};

interface Loaded {
  items: ShopItem[];
  owned: Map<string, number>;
  houseLevel: number;
}

export function ShopPanel() {
  const open = useUi((s) => s.shopOpen);
  const coins = useUi((s) => s.wallet?.coins ?? 0);
  const [tab, setTab] = useState<ItemCategory>('furniture');
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  /** Guards against a second click landing before React re-renders the disabled button. */
  const inFlight = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([fetchCatalog(), fetchInventory(), fetchHouseLevel()])
      .then(([items, owned, houseLevel]) => {
        if (!cancelled) setData({ items, owned, houseLevel });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const close = () => {
    uiStore.set({ shopOpen: false });
    setNotice(null);
    setError(null);
  };

  async function buy(item: ShopItem) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(item.id);
    setError(null);
    setNotice(null);
    try {
      // A fresh idempotency key per click: retries of this click can never charge twice.
      const result = await buyItem(item.id, crypto.randomUUID());
      const wallet = uiStore.get().wallet;
      if (wallet) uiStore.set({ wallet: { ...wallet, coins: result.coins } });
      uiStore.set({ inventoryVersion: uiStore.get().inventoryVersion + 1 });
      setData((d) => d && { ...d, owned: new Map(d.owned).set(item.id, result.qty) });
      setNotice(`Bought ${item.name} for ${result.price} coins.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  const items = data?.items.filter((i) => i.category === tab) ?? [];

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="panel shop" onClick={(e) => e.stopPropagation()}>
        <header className="shop-header">
          <div>
            <h2 className="title">Furniture Shop</h2>
            <p className="subtitle">Everything you buy goes to your inventory.</p>
          </div>
          <div className="shop-coins">● {coins.toLocaleString()}</div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close shop">
            ✕
          </button>
        </header>

        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === tab ? 'selected' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {error && <div className="form-error">{error}</div>}
        {notice && <div className="form-notice">{notice}</div>}
        {!data && !error && <div className="spinner" aria-label="Loading" />}

        <div className="shop-grid">
          {items.map((item) => {
            const owned = data?.owned.get(item.id) ?? 0;
            const locked = (data?.houseLevel ?? 1) < item.min_house_level;
            const oneOff = item.category === 'wall' || item.category === 'floor';
            const short = item.price - coins;
            let label = `Buy · ${item.price}`;
            if (pending === item.id) label = 'Buying…';
            else if (locked) label = `House level ${item.min_house_level}`;
            else if (oneOff && owned > 0) label = 'Owned';
            else if (short > 0) label = `Need ${short} more`;
            const disabled = pending !== null || locked || (oneOff && owned > 0) || short > 0;
            return (
              <div key={item.id} className={`shop-card${locked ? ' locked' : ''}`}>
                <ItemSprite spriteKey={item.sprite_key} box={72} />
                <div className="shop-card-name">{item.name}</div>
                <div className="shop-card-meta">
                  {item.footprint_w}×{item.footprint_h} ·{' '}
                  {item.category === 'garden'
                    ? 'for the yard'
                    : (LAYER_LABEL[item.layer] ?? item.layer)}
                  {owned > 0 && !oneOff && <span className="owned"> · own {owned}</span>}
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={disabled}
                  onClick={() => void buy(item)}
                >
                  {label}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
