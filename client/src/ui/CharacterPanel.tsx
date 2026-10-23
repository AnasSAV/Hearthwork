import { useEffect, useState } from 'react';
import { ClientMsg } from '@focus-town/shared';
import { sendToRoom } from '../net/roomBridge';
import { supabase } from '../net/supabase';
import { showNotice, uiStore, useUi } from '../store';
import { ProfileSetup } from './ProfileSetup';

interface ProfileRow {
  username: string;
  avatar: unknown;
}

/** In-game editor for the player's name and character. */
export function CharacterPanel() {
  const open = useUi((s) => s.characterOpen);
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) return;
      const { data, error } = await supabase
        .from('profiles')
        .select('username, avatar')
        .eq('id', userId)
        .single<ProfileRow>();
      if (cancelled) return;
      if (error) {
        showNotice(error.message);
        uiStore.set({ characterOpen: false });
      } else setProfile(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open || !profile) return null;
  const close = () => {
    setProfile(null);
    uiStore.set({ characterOpen: false });
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <div onClick={(e) => e.stopPropagation()}>
        <ProfileSetup
          initialUsername={profile.username}
          initialAvatar={profile.avatar}
          onCancel={close}
          onDone={() => {
            // The server re-reads the saved profile; it never takes the look from the client.
            sendToRoom(ClientMsg.ProfileReload);
            close();
          }}
        />
      </div>
    </div>
  );
}
