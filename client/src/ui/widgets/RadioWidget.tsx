import { useEffect, useRef } from 'react';
import { music, STATIONS, stationOf, useMusic } from '../../audio/music';
import { useRadio } from '../../audio/radio';
import { Icon } from '../Icon';

// Minimal typing for the YouTube IFrame Player API (https://developers.google.com/youtube/iframe_api_reference).
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  setVolume(volume: number): void;
  loadVideoById(id: string): void;
  destroy(): void;
}
interface YTPlayerOptions {
  videoId: string;
  width: number;
  height: number;
  playerVars: Record<string, number>;
  events: { onReady: () => void; onError: () => void };
}
interface YTNamespace {
  Player: new (el: HTMLElement, options: YTPlayerOptions) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;
function youtubeApi(): Promise<YTNamespace> {
  apiPromise ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () =>
      window.YT ? resolve(window.YT) : reject(new Error('YouTube'));
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => reject(new Error('Could not load YouTube'));
    document.head.append(script);
  });
  return apiPromise;
}

/**
 * The YouTube player for live stations, visible as YouTube's terms require (≥ 200×200).
 * Our play/pause and volume drive it through the IFrame API.
 */
function YouTubeEmbed({ videoId }: { videoId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  const playing = useMusic((s) => s.playing);
  const volume = useMusic((s) => s.volume);

  useEffect(() => {
    let cancelled = false;
    const el = document.createElement('div');
    host.current?.append(el);
    youtubeApi()
      .then((YT) => {
        if (cancelled) return;
        player.current = new YT.Player(el, {
          videoId,
          width: 240,
          height: 200,
          playerVars: { autoplay: 1, controls: 0, modestbranding: 1, playsinline: 1, rel: 0 },
          events: {
            onReady: () => {
              ready.current = true;
              player.current?.setVolume(Math.round(music.get().volume * 100));
              if (music.get().playing) player.current?.playVideo();
            },
            onError: () => music.stop(),
          },
        });
      })
      .catch(() => music.stop());
    return () => {
      cancelled = true;
      ready.current = false;
      player.current?.destroy();
      player.current = null;
      el.remove();
    };
  }, [videoId]);

  useEffect(() => {
    if (!ready.current) return;
    if (playing) player.current?.playVideo();
    else player.current?.pauseVideo();
  }, [playing]);

  useEffect(() => {
    if (ready.current) player.current?.setVolume(Math.round(volume * 100));
  }, [volume]);

  return <div className="yt-host" ref={host} />;
}

export function RadioWidget() {
  const stationId = useMusic((s) => s.stationId);
  const playing = useMusic((s) => s.playing);
  const volume = useMusic((s) => s.volume);
  const track = useRadio((s) => s.track);
  const station = stationOf(stationId);

  return (
    <div className="radio-widget">
      {station.kind === 'youtube' && station.videoId ? (
        <YouTubeEmbed videoId={station.videoId} />
      ) : (
        <div className="radio-art" style={{ background: station.color }}>
          <span className={`disc big${playing ? ' spinning' : ''}`} />
        </div>
      )}
      <div className="radio-meta">
        <strong>{station.kind === 'town' && track && playing ? track.title : station.name}</strong>
        <small>{station.kind === 'town' && track && playing ? station.name : station.desc}</small>
      </div>
      <div className="radio-controls">
        <button
          type="button"
          className="round-btn ghost"
          aria-label="Previous station"
          onClick={() => {
            const i = STATIONS.findIndex((s) => s.id === stationId);
            void music.tune(STATIONS[(i - 1 + STATIONS.length) % STATIONS.length]!.id);
          }}
        >
          <span style={{ transform: 'scaleX(-1)', display: 'grid' }}>
            <Icon name="next" size={14} />
          </span>
        </button>
        <button
          type="button"
          className="round-btn"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => music.toggle()}
        >
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>
        <button
          type="button"
          className="round-btn ghost"
          aria-label="Next station"
          onClick={() => {
            const i = STATIONS.findIndex((s) => s.id === stationId);
            void music.tune(STATIONS[(i + 1) % STATIONS.length]!.id);
          }}
        >
          <Icon name="next" size={14} />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label="Volume"
          onChange={(e) => music.setVolume(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
