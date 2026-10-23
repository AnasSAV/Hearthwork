import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CHAT_MAX_LEN } from '@focus-town/shared';
import { chat, useChat } from '../net/chat';
import { useUi } from '../store';

const isTextField = (el: Element | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

/**
 * Room chat. Enter opens the input, Enter again sends, Esc closes. Hover a message to mute its
 * sender (remembered in this browser) or report it.
 */
export function ChatPanel() {
  const connected = useUi((s) => s.connection.kind === 'connected');
  const messages = useChat((s) => s.messages);
  const muted = useChat((s) => s.muted);
  const notice = useChat((s) => s.notice);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !isTextField(document.activeElement)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages, open]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => chat.notice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  if (!connected) return null;

  const visible = messages.filter((m) => !muted.has(m.userId));
  const shown = open ? visible : visible.slice(-4);

  function submit(e: FormEvent) {
    e.preventDefault();
    chat.send(text);
    setText('');
    input.current?.blur();
  }

  return (
    <div className={`chat${open ? ' open' : ''}`}>
      {shown.length > 0 && (
        <div className="chat-log panel" ref={list}>
          {shown.map((m) => (
            <div key={m.id} className="chat-line">
              <span className="chat-name">{m.name}</span>{' '}
              <span className="chat-text">{m.text}</span>
              {open && (
                <span className="chat-actions">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => chat.toggleMute(m.userId)}
                  >
                    mute
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => chat.report(m.id)}
                  >
                    report
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {notice && <div className="chat-notice">{notice}</div>}
      <form className="chat-form panel" onSubmit={submit}>
        <input
          ref={input}
          value={text}
          maxLength={CHAT_MAX_LEN}
          placeholder={open ? 'Say something… (Esc to close)' : 'Press Enter to chat'}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') input.current?.blur();
          }}
        />
        {open && muted.size > 0 && (
          <button
            type="button"
            className="link"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => [...muted].forEach((id) => chat.toggleMute(id))}
          >
            unmute all ({muted.size})
          </button>
        )}
      </form>
    </div>
  );
}
