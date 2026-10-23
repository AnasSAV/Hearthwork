import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CHAT_MAX_LEN, type ChatMessage } from '@focus-town/shared';
import { chat, useChat } from '../net/chat';
import { useUi } from '../store';

const isTextField = (el: Element | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

function Line({ m, mine, actions }: { m: ChatMessage; mine: boolean; actions: boolean }) {
  return (
    <div className="chat-line">
      <span className="chat-name">{mine ? 'You' : m.name}</span>{' '}
      <span className="chat-text">{m.text}</span>
      {actions && !mine && (
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
  );
}

/**
 * Room chat plus private whispers. Enter opens the input, Enter again sends, Esc closes.
 * Whisper to someone standing near you: click them, or pick them under "Nearby".
 */
export function ChatPanel() {
  const connected = useUi((s) => s.connection.kind === 'connected');
  const myName = useUi((s) => s.playerName);
  const messages = useChat((s) => s.messages);
  const muted = useChat((s) => s.muted);
  const notice = useChat((s) => s.notice);
  const nearby = useChat((s) => s.nearby);
  const conversations = useChat((s) => s.conversations);
  const tab = useChat((s) => s.tab);
  const focusRequest = useChat((s) => s.focusRequest);
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
    if (focusRequest > 0) input.current?.focus();
  }, [focusRequest]);

  const conversation = tab === 'room' ? null : conversations[tab];
  const shownMessages = conversation ? conversation.messages : messages;

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [shownMessages, open]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => chat.notice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  if (!connected) return null;

  const partnerInRange = conversation ? nearby.some((p) => p.sessionId === tab) : true;
  const visible = shownMessages.filter((m) => !muted.has(m.userId));
  const shown = open || conversation ? visible : visible.slice(-4);
  const tabs = Object.values(conversations);
  const unread = tabs.reduce((n, c) => n + c.unread, 0);

  function submit(e: FormEvent) {
    e.preventDefault();
    chat.send(text);
    setText('');
    input.current?.blur();
  }

  const placeholder = conversation
    ? partnerInRange
      ? `Whisper to ${conversation.partner.name}…`
      : `${conversation.partner.name} is too far away to whisper`
    : open
      ? 'Say something to the room… (Esc to close)'
      : 'Press Enter to chat';

  return (
    <div className={`chat${open || conversation ? ' open' : ''}`}>
      {(tabs.length > 0 || (open && nearby.length > 0)) && (
        <div className="chat-tabs panel">
          <button
            type="button"
            className={tab === 'room' ? 'selected' : ''}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => chat.setTab('room')}
          >
            Room
          </button>
          {tabs.map((c) => (
            <span
              key={c.partner.sessionId}
              className={`chat-tab${tab === c.partner.sessionId ? ' selected' : ''}`}
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => chat.setTab(c.partner.sessionId)}
              >
                🔒 {c.partner.name}
                {c.unread > 0 && <span className="badge">{c.unread}</span>}
              </button>
              <button
                type="button"
                className="close"
                aria-label={`Close conversation with ${c.partner.name}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => chat.closeWhisper(c.partner.sessionId)}
              >
                ×
              </button>
            </span>
          ))}
          {unread > 0 && tab === 'room' && <span className="chat-unread">{unread} new</span>}
        </div>
      )}

      {open && tab === 'room' && nearby.length > 0 && (
        <div className="chat-nearby">
          Whisper:{' '}
          {nearby.map((p) => (
            <button
              key={p.sessionId}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => chat.openWhisper(p)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {(shown.length > 0 || conversation) && (
        <div className={`chat-log panel${conversation ? ' private' : ''}`} ref={list}>
          {conversation && (
            <div className="chat-private-head">
              Private with {conversation.partner.name} ·{' '}
              {partnerInRange ? 'nearby' : 'walk closer to reply'}
            </div>
          )}
          {shown.map((m) => (
            <Line key={m.id} m={m} mine={m.name === myName} actions={open || !!conversation} />
          ))}
        </div>
      )}
      {notice && <div className="chat-notice">{notice}</div>}
      <form className="chat-form panel" onSubmit={submit}>
        <input
          ref={input}
          value={text}
          maxLength={CHAT_MAX_LEN}
          disabled={!!conversation && !partnerInRange}
          placeholder={placeholder}
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
