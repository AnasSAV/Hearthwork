import { uiStore, useUi } from '../store';

export function Toast() {
  const notice = useUi((s) => s.notice);
  if (!notice) return null;
  return (
    <div className="toast panel" role="status" onClick={() => uiStore.set({ notice: null })}>
      {notice}
    </div>
  );
}
