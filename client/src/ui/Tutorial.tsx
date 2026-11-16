import { useEffect, useRef, useState, type ReactNode } from 'react';
import { decodeAvatar, GAMES, GAME_IDS } from '@focus-town/shared';
import { sfx } from '../audio/sfx';
import { supabase } from '../net/supabase';
import { uiStore, useUi } from '../store';
import { AvatarSprite } from './AvatarSprite';
import { Icon, type IconName } from './Icon';

interface Step {
  title: string;
  picture: ReactNode;
  body: (touch: boolean) => ReactNode;
}

function Badge({ icon, tone }: { icon: IconName; tone: string }) {
  return (
    <span className={`tut-badge ${tone}`}>
      <Icon name={icon} size={34} />
    </span>
  );
}

function Key({ children }: { children: string }) {
  return <kbd>{children}</kbd>;
}

function steps(avatar: string): Step[] {
  return [
    {
      title: 'Welcome to Hearthwork',
      picture: avatar ? (
        <span className="tut-avatar">
          <AvatarSprite avatar={decodeAvatar(avatar)} scale={4} />
        </span>
      ) : (
        <Badge icon="home" tone="honey" />
      ),
      body: () => (
        <>
          A cozy town where time spent focusing earns coins, and coins make your home yours.
          Here&apos;s how it works in five quick steps.
        </>
      ),
    },
    {
      title: 'Getting around',
      picture: <Badge icon="map" tone="sky" />,
      body: (touch) => (
        <>
          {touch ? (
            <>
              Put your thumb anywhere and <b>drag to walk</b>. Pinch to zoom.
            </>
          ) : (
            <>
              Walk with <Key>W</Key> <Key>A</Key> <Key>S</Key> <Key>D</Key> or the arrow keys.
            </>
          )}{' '}
          The <b>map</b> button takes you to the town, your home and your friends&apos; homes; the{' '}
          <b>home</b> button brings you back.
        </>
      ),
    },
    {
      title: 'Focus to earn coins',
      picture: <Badge icon="timer" tone="sage" />,
      body: (touch) => (
        <>
          Walk up to any desk in town and {touch ? 'tap' : 'press'}{' '}
          {touch ? <b>Sit down and focus</b> : <Key>E</Key>}. Pick 25 or 50 minutes, or an open
          session. You earn about <b>1 coin a minute</b>, plus a bonus for finishing a block.{' '}
          {touch
            ? 'Keep the screen open while you focus.'
            : 'Minimize the window and work: the timer keeps going.'}{' '}
          Every 25 minutes you&apos;ll be asked if you&apos;re still there.
        </>
      ),
    },
    {
      title: 'Make your home yours',
      picture: <Badge icon="bag" tone="honey" />,
      body: () => (
        <>
          Spend your coins at the <b>Furniture Shop</b> in town (look for its sign). Then go home
          and press <b>Decorate</b> to place what you bought, inside or in your garden.
        </>
      ),
    },
    {
      title: 'Friends',
      picture: <Badge icon="friends" tone="plum" />,
      body: (touch) => (
        <>
          Add friends by username in the <b>Friends</b> panel. Visit their homes, move in together,
          and <b>pinch</b> them to say hi. {touch ? 'Tap' : 'Click'} a player near you to whisper;{' '}
          <Key>↵</Key> opens the chat.
        </>
      ),
    },
    {
      title: 'Take a break',
      picture: <Badge icon="game" tone="rose" />,
      body: () => (
        <>
          The <b>Games</b> button has{' '}
          {GAME_IDS.map((id, i) => (
            <span key={id}>
              {i > 0 && (i === GAME_IDS.length - 1 ? ' and ' : ', ')}
              <b>{GAMES[id].name}</b>
            </span>
          ))}
          . Playing earns half what focusing does. Put on the town radio, and you&apos;re all set!
        </>
      ),
    },
  ];
}

/** Has this player seen the introduction? Asked once per sign-in. */
async function seenBefore(): Promise<boolean> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return true;
  const { data } = await supabase
    .from('profiles')
    .select('tutorial_seen_at')
    .eq('id', userId)
    .single();
  // If the column can't be read (an older database), don't nag.
  return !data || (data as { tutorial_seen_at: string | null }).tutorial_seen_at !== null;
}

/**
 * The introduction new players get the first time they arrive, step by step. The "How to play"
 * button opens it again any time.
 */
export function Tutorial() {
  const open = useUi((s) => s.tutorialOpen);
  const touch = useUi((s) => s.touch);
  const avatar = useUi((s) => s.playerAvatar);
  const arrived = useUi(
    (s) =>
      s.connection.kind === 'connected' && s.transition.phase === 'idle' && s.playerName !== '',
  );
  const [step, setStep] = useState(0);
  // Checked once per sign-in.
  const checked = useRef(false);

  // The first time a player is in the world, see whether they need the introduction.
  useEffect(() => {
    if (!arrived || checked.current) return;
    checked.current = true;
    void seenBefore().then((seen) => {
      if (seen) return;
      setStep(0);
      uiStore.set({ tutorialOpen: true });
      // Remembered as soon as it's shown, so closing the tab halfway doesn't bring it back
      // (the "How to play" button is always there).
      // (Supabase only sends a query once something waits for it.)
      void supabase.rpc('finish_tutorial').then(({ error }) => {
        if (error) console.warn('finish_tutorial failed', error.message);
      });
    });
  }, [arrived]);

  if (!open) return null;
  const all = steps(avatar);
  const current = all[Math.min(step, all.length - 1)]!;
  const last = step >= all.length - 1;
  const finish = () => {
    sfx.play('close');
    uiStore.set({ tutorialOpen: false });
    setStep(0);
  };
  const go = (to: number) => {
    sfx.play('click');
    setStep(to);
  };

  return (
    <div className="modal-backdrop tutorial-backdrop">
      <div className="panel card tutorial" role="dialog" aria-label="How to play">
        <div className="tut-picture" key={step}>
          {current.picture}
        </div>
        <h2 className="title">{current.title}</h2>
        <p className="subtitle tut-body">{current.body(touch)}</p>
        <div className="tut-dots" aria-hidden="true">
          {all.map((_, i) => (
            <span key={i} className={i === step ? 'on' : ''} />
          ))}
        </div>
        <div className="row tut-actions">
          {step > 0 ? (
            <button type="button" className="btn btn-secondary" onClick={() => go(step - 1)}>
              Back
            </button>
          ) : (
            <button type="button" className="link" onClick={finish}>
              Skip
            </button>
          )}
          <button
            type="button"
            className="btn"
            autoFocus
            onClick={() => (last ? finish() : go(step + 1))}
          >
            {last ? "Let's go!" : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
