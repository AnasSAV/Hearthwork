import { useEffect, useState } from 'react';
import type { ItemCategory } from '@focus-town/shared';
import { fetchCatalog, fetchInventory, type ShopItem } from '../net/shop';
import { uiStore, useUi } from '../store';
import { ItemSprite } from './ItemSprite';

const GROUPS: { id: ItemCategory; label: string }[] = [
  { id: 'furniture', label: 'Furniture' },
  { id: 'decor', label: 'Decor' },
  { id: 'plant', label: 'Plants' },
  { id: 'garden', label: 'Garden' },
  { id: 'wall', label: 'Wallpaper' },
  { id: 'floor', label: 'Floors' },
];

type Owned = { item: ShopItem; qty: number }[];

/** Side drawer listing what the player owns. Phase 4 adds dragging items into the house. */
export function InventoryDrawer() {
  const open = useUi((s) => s.inventoryOpen);
  const version = useUi((s) => s.inventoryVersion);
  const [owned, setOwned] = useState<Owned | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([fetchCatalog(), fetchInventory()])
      .then(([items, inv]) => {
        if (cancelled) return;
        setOwned(
          items
            .filter((i) => (inv.get(i.id) ?? 0) > 0)
            .map((i) => ({ item: i, qty: inv.get(i.id)! })),
        );
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, version]);

  if (!open) return null;

  return (
    <aside className="panel drawer">
      <header className="shop-header">
        <h2 className="title">Inventory</h2>
        <button
          type="button"
          className="icon-btn"
          onClick={() => uiStore.set({ inventoryOpen: false })}
          aria-label="Close inventory"
        >
          ✕
        </button>
      </header>
      {error && <div className="form-error">{error}</div>}
      {!owned && !error && <div className="spinner" aria-label="Loading" />}
      {owned?.length === 0 && (
        <p className="subtitle">
          Nothing here yet. Earn coins at a desk, then visit the Furniture Shop (the red-roofed
          house in the north-west).
        </p>
      )}
      {owned && owned.length > 0 && (
        <>
          {GROUPS.map((g) => {
            const rows = owned.filter((o) => o.item.category === g.id);
            if (!rows.length) return null;
            return (
              <section key={g.id}>
                <h3 className="drawer-group">{g.label}</h3>
                <div className="drawer-grid">
                  {rows.map(({ item, qty }) => (
                    <div key={item.id} className="drawer-item" title={item.name}>
                      <ItemSprite spriteKey={item.sprite_key} box={48} />
                      {qty > 1 && <span className="qty">×{qty}</span>}
                      <span className="drawer-name">{item.name}</span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          <p className="fine-print">Placing furniture in your house arrives with houses.</p>
        </>
      )}
    </aside>
  );
}
