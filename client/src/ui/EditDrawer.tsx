import { useEffect, useState } from 'react';
import { CATALOG, CATALOG_BY_ID, spriteKey, type ItemCategory } from '@focus-town/shared';
import { editor, useEditor } from '../house/editor';
import { ItemSprite } from './ItemSprite';

const GROUPS: { id: ItemCategory; label: string }[] = [
  { id: 'furniture', label: 'Furniture' },
  { id: 'decor', label: 'Decor' },
  { id: 'plant', label: 'Plants' },
];

/**
 * Edit mode: drag (or click) items from here into the room. A green ghost means it fits, red
 * means it doesn't. Click a placed item to pick it back up; right-click or Esc puts the carried
 * item back. Nothing is saved until "Save layout".
 */
export function EditDrawer() {
  const active = useEditor((s) => s.active);
  const owned = useEditor((s) => s.owned);
  const carrying = useEditor((s) => s.carrying);
  const wallpaper = useEditor((s) => s.wallpaper);
  const floor = useEditor((s) => s.floor);
  const saving = useEditor((s) => s.saving);
  const error = useEditor((s) => s.error);
  useEditor((s) => s.version); // re-render counts when the layout changes
  const [hint, setHint] = useState(true);

  // A drag released anywhere but the room becomes click-to-place instead of getting stuck.
  useEffect(() => {
    const onUp = (e: PointerEvent) => {
      if (editor.get().dragging && !(e.target instanceof HTMLCanvasElement)) editor.stopDragging();
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, []);

  if (!active) return null;

  const placeable = CATALOG.filter(
    (i) => i.category !== 'wall' && i.category !== 'floor' && (owned.get(i.id) ?? 0) > 0,
  );
  const ownedOf = (category: 'wall' | 'floor') =>
    CATALOG.filter((i) => i.category === category && (owned.get(i.id) ?? 0) > 0);

  return (
    <aside className="panel drawer edit-drawer">
      <header className="shop-header">
        <h2 className="title">Decorate</h2>
      </header>
      {hint && (
        <p className="fine-print">
          Drag an item into the room (or click it, then click a spot). Click furniture to pick it
          up; right-click or Esc to put it back.{' '}
          <button type="button" className="link" onClick={() => setHint(false)}>
            Got it
          </button>
        </p>
      )}

      <div className="look-row">
        <label className="field">
          <span>Wallpaper</span>
          <select
            value={wallpaper ?? ''}
            onChange={(e) => editor.setLook({ wallpaper: e.target.value || null })}
          >
            <option value="">Plaster (default)</option>
            {ownedOf('wall').map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Floor</span>
          <select
            value={floor ?? ''}
            onChange={(e) => editor.setLook({ floor: e.target.value || null })}
          >
            <option value="">Planks (default)</option>
            {ownedOf('floor').map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {placeable.length === 0 && (
        <p className="subtitle">Your inventory is empty. Buy furniture at the shop in town.</p>
      )}
      {GROUPS.map((g) => {
        const rows = placeable.filter((i) => i.category === g.id);
        if (!rows.length) return null;
        return (
          <section key={g.id}>
            <h3 className="drawer-group">{g.label}</h3>
            <div className="drawer-grid">
              {rows.map((item) => {
                const left = editor.available(item.id);
                const selected = carrying === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`drawer-item edit-item${selected ? ' selected' : ''}`}
                    title={`${item.name}: ${left} left`}
                    disabled={left <= 0 && !selected}
                    // No preventDefault here: it would suppress the mouse events Phaser needs
                    // to see the drag arrive over the room.
                    onPointerDown={() => editor.carry(item.id, true)}
                    onClick={() => editor.carry(item.id, false)}
                  >
                    <ItemSprite spriteKey={spriteKey(item.sprite)} box={48} />
                    <span className="qty">×{left}</span>
                    <span className="drawer-name">{item.name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {carrying && (
        <div className="form-notice">
          Carrying {CATALOG_BY_ID.get(carrying)?.name}. Click a green spot to place it.
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="row drawer-actions">
        <button type="button" className="btn" disabled={saving} onClick={() => void editor.save()}>
          {saving ? 'Saving…' : 'Save layout'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={saving}
          onClick={() => editor.stop()}
        >
          Cancel
        </button>
      </div>
    </aside>
  );
}
