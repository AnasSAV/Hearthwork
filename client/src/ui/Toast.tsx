import { uiStore, useUi } from '../store';
import { Icon } from './Icon';

export function Toast() {
  const notice = useUi((s) => s.notice);
  if (!notice) return null;
  return (
    <div
      className="toast panel"
      role="status"
      key={notice}
      onClick={() => uiStore.set({ notice: null })}
    >
      <Icon name="sparkle" size={16} />
      {notice}
    </div>
  );
}
