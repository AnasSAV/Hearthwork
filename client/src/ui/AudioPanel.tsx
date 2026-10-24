import { useState } from 'react';
import { AMBIENT_LABEL, AMBIENT_SOUNDS, ambient, useAmbient } from '../audio/ambient';
import { music, STATIONS, stationOf, useMusic } from '../audio/music';
import { useRadio } from '../audio/radio';
import { sfx, useSfxVolume } from '../audio/sfx';
import { useUi } from '../store';
import { Icon } from './Icon';
import { widgets } from './widgets/store';

/**
 * The music player, bottom left: what's on, play/pause, and a panel with stations, volumes and
 * your own ambience mix (rain, birds, café…).
 */
export function AudioPanel() {
  const connected = useUi((s) => s.connection.kind === 'connected');
  const [open, setOpen] = useState(false);
  const stationId = useMusic((s) => s.stationId);
  const playing = useMusic((s) => s.playing);
  const volume = useMusic((s) => s.volume);
  const track = useRadio((s) => s.track);
  const error = useRadio((s) => s.error);
  const levels = useAmbient();
  const sfxVolume = useSfxVolume();
  if (!connected) return null;
  const station = stationOf(stationId);
  const title = station.kind === 'town' && playing && track ? track.title : station.name;
  const sub = station.kind === 'town' && playing && track ? 'Town Radio · in sync' : station.desc;

  const tune = (id: string) => {
    sfx.play('click');
    // Live streams play in the Radio widget's visible YouTube player.
    if (stationOf(id).kind === 'youtube') widgets.add('radio');
    void music.tune(id);
  };

  return (
    <div className="music">
      {open && (
        <div className="panel audio-panel">
          <h3 className="drawer-group">Stations</h3>
          <div className="stations">
            {STATIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`station${s.id === stationId ? ' selected' : ''}`}
                onClick={() => tune(s.id)}
              >
                <span className="swatch-dot" style={{ background: s.color }} />
                <span>
                  <strong>{s.name}</strong>
                  <small>{s.desc}</small>
                </span>
              </button>
            ))}
          </div>
          <label className="slider">
            <span>Music</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => music.setVolume(Number(e.target.value))}
            />
          </label>
          <label className="slider">
            <span>Effects</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={sfxVolume}
              onChange={(e) => sfx.setVolume(Number(e.target.value))}
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <h3 className="drawer-group">Ambience</h3>
          {AMBIENT_SOUNDS.map((s) => (
            <label key={s} className="slider">
              <span>{AMBIENT_LABEL[s]}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={levels[s]}
                onChange={(e) => void ambient.setVolume(s, Number(e.target.value))}
              />
            </label>
          ))}
          <p className="fine-print">Tip: with music on, pick audio-only when you focus.</p>
        </div>
      )}
      <div className="panel music-bar">
        <span
          className={`disc${playing ? ' spinning' : ''}`}
          style={{ borderColor: station.color }}
        />
        <span className="music-meta">
          <strong>{title}</strong>
          <small>{sub}</small>
        </span>
        <button
          type="button"
          className="round-btn"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => {
            if (station.kind === 'youtube') widgets.add('radio');
            music.toggle();
          }}
        >
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>
        <button
          type="button"
          className="round-btn ghost"
          aria-label="Stations and sound"
          onClick={() => {
            setOpen(!open);
            sfx.play(open ? 'close' : 'open');
            if (!open) void ambient.resume();
          }}
        >
          <Icon name="volume" size={16} />
        </button>
      </div>
    </div>
  );
}
