import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { sfx } from '../../audio/sfx';
import { uiStore, useUi } from '../../store';
import { Icon, type IconName } from '../Icon';
import { CLOCK_VARIANTS, ClockWidget } from './ClockWidget';
import { NotesWidget, TodoWidget } from './NotesWidgets';
import { POMODORO_VARIANTS, PomodoroWidget } from './PomodoroWidget';
import { RadioWidget } from './RadioWidget';
import { useWidgets, widgets, type Widget, type WidgetType } from './store';

export const WIDGET_INFO: Record<WidgetType, { name: string; icon: IconName; color: string }> = {
  clock: { name: 'Clock', icon: 'timer', color: '#3f6fd8' },
  pomodoro: { name: 'Pomodoro', icon: 'flame', color: '#d8433f' },
  radio: { name: 'Radio', icon: 'music', color: '#6d4fb3' },
  todo: { name: 'Todo', icon: 'todo', color: '#2f9a55' },
  notes: { name: 'Notes', icon: 'notes', color: '#d77a1f' },
};

function Body({ w }: { w: Widget }) {
  switch (w.type) {
    case 'clock':
      return <ClockWidget variant={w.variant} onVariant={(v) => widgets.setVariant(w.id, v)} />;
    case 'pomodoro':
      return <PomodoroWidget id={w.id} variant={w.variant} />;
    case 'radio':
      return <RadioWidget />;
    case 'todo':
      return <TodoWidget id={w.id} />;
    case 'notes':
      return <NotesWidget id={w.id} />;
  }
}

/** One widget card: drag it by its header, close it with ×. */
function Frame({ w }: { w: Widget }) {
  const card = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const offset = useRef({ dx: 0, dy: 0 });
  const info = WIDGET_INFO[w.type];

  const down = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = card.current!.getBoundingClientRect();
    offset.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setDrag({ x: r.left, y: r.top });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    if (!drag) return;
    const r = card.current!.getBoundingClientRect();
    setDrag({
      x: Math.min(window.innerWidth - r.width, Math.max(0, e.clientX - offset.current.dx)),
      y: Math.min(window.innerHeight - 40, Math.max(0, e.clientY - offset.current.dy)),
    });
  };
  const up = () => {
    if (drag) widgets.move(w.id, Math.round(drag.x), Math.round(drag.y));
    setDrag(null);
  };

  const pos = drag ?? (w.x !== null && w.y !== null ? { x: w.x, y: w.y } : null);
  return (
    <div
      ref={card}
      className={`widget panel ${w.type}${drag ? ' dragging' : ''}`}
      style={pos ? { position: 'absolute', left: pos.x, top: pos.y } : undefined}
    >
      <div
        className="widget-head"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <span className="widget-chip" style={{ background: info.color }}>
          <Icon name={info.icon} size={12} />
        </span>
        <span className="widget-name">{info.name}</span>
        <button
          type="button"
          className="widget-close"
          aria-label={`Close ${info.name}`}
          onClick={() => {
            sfx.play('close');
            widgets.remove(w.id);
          }}
        >
          <Icon name="close" size={10} />
        </button>
      </div>
      <Body w={w} />
    </div>
  );
}

/** Widgets float over the game: unplaced ones stack in a column, dragged ones stay put. */
export function WidgetLayer() {
  const list = useWidgets();
  const focusing = useUi((s) => s.focus !== null);
  const connected = useUi((s) => s.connection.kind === 'connected');
  const seeded = useRef(false);

  // The first time you focus with no widgets, put out a clock and a todo list.
  useEffect(() => {
    if (!focusing || seeded.current || widgets.get().widgets.length > 0) return;
    seeded.current = true;
    widgets.add('clock', 'digital-seconds');
    widgets.add('todo');
  }, [focusing]);

  if (!connected || list.length === 0) return null;
  const stacked = list.filter((w) => w.x === null || w.y === null);
  const placed = list.filter((w) => w.x !== null && w.y !== null);
  return (
    <div className={`widget-layer${focusing ? ' focusing' : ''}`}>
      <div className="widget-column">
        {stacked.map((w) => (
          <Frame key={w.id} w={w} />
        ))}
      </div>
      {placed.map((w) => (
        <Frame key={w.id} w={w} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------------------------

const ORDER: WidgetType[] = ['clock', 'pomodoro', 'radio', 'todo', 'notes'];

function Preview({
  type,
  variant,
  name,
  hint,
}: {
  type: WidgetType;
  variant: string;
  name: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      className={`widget-preview ${type}`}
      onClick={() => {
        widgets.add(type, variant);
        sfx.play('pop');
      }}
    >
      <span className="widget-preview-body" aria-hidden="true">
        {type === 'clock' && <ClockWidget variant={variant} />}
        {type === 'pomodoro' && <span className="preview-big">25:00</span>}
        {type === 'radio' && <span className="disc big spinning" />}
        {type === 'todo' && <Icon name="todo" size={44} />}
        {type === 'notes' && <Icon name="notes" size={44} />}
      </span>
      <strong>{name}</strong>
      <small>{hint}</small>
    </button>
  );
}

export function WidgetPicker() {
  const open = useUi((s) => s.widgetPickerOpen);
  const [section, setSection] = useState<WidgetType>('clock');
  if (!open) return null;
  const close = () => uiStore.set({ widgetPickerOpen: false });

  const options: { variant: string; name: string; hint: string }[] =
    section === 'clock'
      ? CLOCK_VARIANTS.map((v) => ({ variant: v.id, name: v.name, hint: v.hint }))
      : section === 'pomodoro'
        ? POMODORO_VARIANTS.map((v) => ({ variant: v.id, name: v.name, hint: v.hint }))
        : section === 'radio'
          ? [{ variant: 'default', name: 'Radio', hint: 'Town Radio and live lofi streams' }]
          : section === 'todo'
            ? [{ variant: 'default', name: 'Todo list', hint: 'Tick off what you finish' }]
            : [{ variant: 'default', name: 'Notes', hint: 'Scribble ideas while you focus' }];

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="panel card widget-picker" onClick={(e) => e.stopPropagation()}>
        <header className="shop-header">
          <div>
            <h2 className="title">Widgets</h2>
            <p className="subtitle">Pin little helpers to your screen. Drag them anywhere.</p>
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="widget-cats">
          {ORDER.map((t) => (
            <button
              key={t}
              type="button"
              className={`widget-cat${section === t ? ' selected' : ''}`}
              style={{ background: WIDGET_INFO[t].color }}
              onClick={() => {
                setSection(t);
                sfx.play('click');
              }}
            >
              <span className="widget-cat-icon">
                <Icon name={WIDGET_INFO[t].icon} size={40} />
              </span>
              {WIDGET_INFO[t].name}
            </button>
          ))}
        </div>
        <div className="widget-options">
          {options.map((o) => (
            <Preview key={o.variant} type={section} {...o} />
          ))}
        </div>
      </div>
    </div>
  );
}
