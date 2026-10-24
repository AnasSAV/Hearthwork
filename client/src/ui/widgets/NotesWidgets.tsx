import { useEffect, useState, type FormEvent } from 'react';
import { sfx } from '../../audio/sfx';
import { Icon } from '../Icon';
import { loadValue, saveValue } from './store';

interface Todo {
  id: string;
  text: string;
  done: boolean;
}

/** A small checklist, saved in this browser. */
export function TodoWidget({ id }: { id: string }) {
  const [items, setItems] = useState<Todo[]>(() => loadValue<Todo[]>(id, []));
  const [text, setText] = useState('');
  useEffect(() => saveValue(id, items), [id, items]);

  function add(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setItems((list) => [
      ...list,
      { id: Date.now().toString(36), text: t.slice(0, 120), done: false },
    ]);
    setText('');
  }

  const done = items.filter((i) => i.done).length;
  return (
    <div className="todo">
      <ul>
        {items.map((item) => (
          <li key={item.id} className={item.done ? 'done' : ''}>
            <button
              type="button"
              className="todo-check"
              aria-label={item.done ? 'Mark not done' : 'Mark done'}
              onClick={() => {
                if (!item.done) sfx.play('coin');
                setItems((list) =>
                  list.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
                );
              }}
            >
              {item.done && <Icon name="check" size={12} />}
            </button>
            <span>{item.text}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Delete"
              onClick={() => setItems((list) => list.filter((i) => i.id !== item.id))}
            >
              <Icon name="close" size={10} />
            </button>
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <div className="todo-progress">
          <span style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      )}
      <form onSubmit={add}>
        <input
          className="text-input"
          value={text}
          maxLength={120}
          placeholder="Add a task…"
          onChange={(e) => setText(e.target.value)}
        />
      </form>
    </div>
  );
}

/** Free-form notes, saved in this browser as you type. */
export function NotesWidget({ id }: { id: string }) {
  const [text, setText] = useState(() => loadValue<string>(id, ''));
  useEffect(() => {
    const t = setTimeout(() => saveValue(id, text), 300);
    return () => clearTimeout(t);
  }, [id, text]);
  return (
    <textarea
      className="notes"
      value={text}
      maxLength={4000}
      placeholder="Jot something down…"
      onChange={(e) => setText(e.target.value)}
    />
  );
}
