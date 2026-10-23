import { goToTown } from '../game/navigation';
import { editor, useEditor } from '../house/editor';
import { uiStore, useUi } from '../store';

/** Shown inside a house: whose house it is, and the owner's Edit / Settings buttons. */
export function HouseBar() {
  const house = useUi((s) => s.house);
  const editing = useEditor((s) => s.active);
  if (!house) return null;
  return (
    <div className="panel house-bar">
      <span>
        <strong>{house.isOwner ? 'Your house' : `${house.ownerName}'s house`}</strong> · Level{' '}
        {house.level}
      </span>
      {house.isOwner && !editing && (
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
          Back to town
        </button>
      )}
    </div>
  );
}
