import { goToTown } from '../game/navigation';
import { editor, useEditor } from '../house/editor';
import { uiStore, useUi } from '../store';

/** Shown at a home: whose it is, and Decorate / Settings for the people who live there. */
export function HouseBar() {
  const house = useUi((s) => s.house);
  const editing = useEditor((s) => s.active);
  if (!house) return null;
  return (
    <div className="panel house-bar">
      <span>
        <strong>{house.isMember ? 'Your home' : `${house.ownerName}'s home`}</strong> · Level{' '}
        {house.level}
      </span>
      {house.isMember && !editing && (
        <>
          <button type="button" className="btn" onClick={() => void editor.begin()}>
            Decorate
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => uiStore.set({ houseSettingsOpen: true })}
          >
            Settings
          </button>
        </>
      )}
      {!editing && (
        <button type="button" className="btn btn-secondary" onClick={() => goToTown()}>
          Town
        </button>
      )}
    </div>
  );
}
