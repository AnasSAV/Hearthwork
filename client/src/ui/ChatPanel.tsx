import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CHAT_MAX_LEN, EMOTES, type ChatMessage } from '@focus-town/shared';
import { sfx } from '../audio/sfx';
import { chat, useChat } from '../net/chat';
import { roomActions } from '../net/roomBridge';
import { useUi } from '../store';
import { Icon } from './Icon';
import { UiSprite } from './UiSprite';

const isTextField = (el: Element | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

/** Warm, readable colours for name initials, picked from the user id. */
const COLORS = ['#e07a5f', '#81b29a', '#9271d8', '#f2a541', '#5fa8d3', '#d77fa1', '#6c9a8b'];
const colorFor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length]!;
};

function Message({ m, mine, actions }: { m: ChatMessage; mine: boolean; actions: boolean }) {
  return (
    <div className={`msg${mine ? ' mine' : ''}`}>
      <span className="msg-avatar" style={{ background: colorFor(m.userId) }}>
        {m.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="msg-bubble">
        {!mine && (
          <span className="msg-name" style={{ color: colorFor(m.userId) }}>
            {m.name}
            {actions && (
              <span className="msg-actions">
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
          </span>
        )}
        {m.text}
      </span>
    </div>
  );
}

/**
 * Room chat plus private whispers. Enter opens the input, Enter again sends, Esc closes.
 * Whisper to someone near you: click them, or pick them under "Nearby". Number keys 1–0
 * (when not typing) pop an emote over your head.
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
  const [emotes, setEmotes] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typing = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextField(document.activeElement)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        input.current?.focus();
        return;
      }
      const n = '1234567890'.indexOf(e.key);
      if (n >= 0 && n < EMOTES.length && !e.ctrlKey && !e.metaKey && !e.altKey) {
        roomActions.emote(EMOTES[n]!);
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
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [shownMessages, open]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => chat.notice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  /** Tell the room we're typing (the "…" bubble), only when it changes. */
  const setTyping = (now: boolean) => {
    if (typing.current === now) return;
    typing.current = now;
    roomActions.typing(now);
  };

  if (!connected) return null;

  const partnerInRange = conversation ? nearby.some((p) => p.sessionId === tab) : true;
  const visible = shownMessages.filter((m) => !muted.has(m.userId));
  const tabs = Object.values(conversations);
  const unread = tabs.reduce((n, c) => n + c.unread, 0);
  const expanded = open || !!conversation;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim()) sfx.play('pop');
    chat.send(text);
    setText('');
    setTyping(false);
    input.current?.blur();
  }

  const placeholder = conversation
    ? partnerInRange
      ? `Whisper to ${conversation.partner.name}…`
      : `${conversation.partner.name} is too far away`
    : 'Say something nice…';

  return (
    <div className="chat">
      {!expanded && visible.length > 0 && (
        <div className="chat-peek">
          {visible.slice(-3).map((m) => (
            <Message key={m.id} m={m} mine={m.name === myName} actions={false} />
          ))}
        </div>
      )}
      {notice && <div className="chat-notice">{notice}</div>}

      {expanded && (
        <div className="chat-window panel">
          {(tabs.length > 0 || nearby.length > 0) && (
            <div className="chat-tabs">
              <button
                type="button"
                className={tab === 'room' ? 'selected' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => chat.setTab('room')}
              >
                <Icon name="chat" size={12} /> Everyone
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
                    <Icon name="lock" size={12} /> {c.partner.name}
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

          {tab === 'room' && nearby.length > 0 && (
            <div className="chat-nearby">
              Nearby:
              {nearby.map((p) => (
                <button
                  key={p.sessionId}
                  type="button"
                  title={`Whisper to ${p.name}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => chat.openWhisper(p)}
                >
                  <Icon name="lock" size={10} /> {p.name}
                </button>
              ))}
            </div>
          )}

          <div className={`chat-log${conversation ? ' private' : ''}`} ref={list}>
            {conversation && (
              <div className="chat-private-head">
                <Icon name="lock" size={12} /> Just you and {conversation.partner.name} ·{' '}
                {partnerInRange ? 'nearby' : 'walk closer to reply'}
              </div>
            )}
            {visible.length === 0 && !conversation && (
              <p className="fine-print">No messages yet. Say hi!</p>
            )}
            {visible.map((m) => (
              <Message key={m.id} m={m} mine={m.name === myName} actions />
            ))}
          </div>

          {emotes && (
            <div className="emote-bar">
              {EMOTES.map((e, i) => (
                <button
                  key={e}
                  type="button"
                  className="emote-btn"
                  title={e}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => {
                    roomActions.emote(e);
                    sfx.play('pop');
                  }}
                >
                  <UiSprite frame={`emote:${e}`} scale={2} />
                  <kbd>{(i + 1) % 10}</kbd>
                </button>
              ))}
            </div>
          )}
          {open && muted.size > 0 && (
            <button
              type="button"
              className="link"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => [...muted].forEach((id) => chat.toggleMute(id))}
            >
              Unmute everyone ({muted.size})
            </button>
          )}
        </div>
      )}

      <form className={`chat-form${expanded ? '' : ' panel chat-launcher'}`} onSubmit={submit}>
        <button
          type="button"
          className="icon-btn"
          title="Emotes"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setEmotes(!emotes);
            input.current?.focus();
          }}
        >
          <Icon name="smile" size={18} />
        </button>
        <input
          ref={input}
          value={text}
          maxLength={CHAT_MAX_LEN}
          disabled={!!conversation && !partnerInRange}
          placeholder={expanded ? placeholder : 'Press Enter to chat'}
          onChange={(e) => {
            setText(e.target.value);
            setTyping(e.target.value.length > 0);
          }}
          onFocus={() => {
            setOpen(true);
            sfx.play('open');
          }}
          onBlur={() => {
            setOpen(false);
            setEmotes(false);
            setTyping(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') input.current?.blur();
          }}
        />
        {expanded ? (
          <button
            type="submit"
            className="icon-btn send"
            aria-label="Send"
            onMouseDown={(e) => e.preventDefault()}
          >
            <Icon name="send" size={16} />
          </button>
        ) : (
          unread > 0 && <span className="badge">{unread}</span>
        )}
      </form>
    </div>
  );
}
