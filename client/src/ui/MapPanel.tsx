import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { sfx } from '../audio/sfx';
import { goToHouse, goToTown } from '../game/navigation';
import { fetchWorldMap, type MapHome } from '../net/houses';
import { uiStore, useUi } from '../store';
import { AvatarSprite } from './AvatarSprite';
import { Icon } from './Icon';

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Atlas {
  url: string;
  w: number;
  h: number;
  frames: Record<string, Frame>;
}

/** A Phaser atlas JSON (houses, trees) as CSS sprite frames, loaded once per file. */
const atlases = new Map<string, Promise<Atlas>>();
function atlas(base: string): Promise<Atlas> {
  let p = atlases.get(base);
  if (!p) {
    p = fetch(`${base}.json`)
      .then(
        (r) =>
          r.json() as Promise<{
            frames: Record<string, { frame: Frame }>;
            meta: { size: { w: number; h: number } };
          }>,
      )
      .then((j) => ({
        url: `${base}.png`,
        w: j.meta.size.w,
        h: j.meta.size.h,
        frames: Object.fromEntries(Object.entries(j.frames).map(([k, v]) => [k, v.frame])),
      }));
    atlases.set(base, p);
  }
  return p;
}

function spriteStyle(a: Atlas, f: Frame, scale: number): CSSProperties {
  return {
    width: f.w * scale,
    height: f.h * scale,
    backgroundImage: `url(${a.url})`,
    backgroundSize: `${a.w * scale}px ${a.h * scale}px`,
    backgroundPosition: `-${f.x * scale}px -${f.y * scale}px`,
  };
}

const houseKey = (h: MapHome) =>
  `${h.exterior_style === 'brick' ? 'brick' : 'cottage'}-${Math.min(3, Math.max(1, h.level))}`;

// ---------- Layout: a little world with the town in the middle and homes on rings ----------

/** Homes per ring, and each ring's size (an ellipse: the map is wider than tall). */
const RING_CAP = (r: number) => 6 + r * 4;
const RX = (r: number) => 340 + r * 170;
const RY = (r: number) => 270 + r * 130;
/** The town picture (town-map.png, the town at 4 px a tile) fits this box on the map. */
const TOWN_BOX = { w: 420, h: 310 };
interface Size {
  w: number;
  h: number;
}

/** The town picture's size; the town editor can change it. */
let townPicture: Promise<Size> | null = null;
function townPictureSize(): Promise<Size> {
  townPicture ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 272, h: 200 });
    img.src = '/assets/sprites/town-map.png';
  });
  return townPicture;
}
const HOUSE_SCALE = 1;
const TREE_SCALE = 0.75;

const RELATIONS = ['home', 'friend', 'public'] as const;
const RELATION_LABEL: Record<MapHome['relation'], string> = {
  home: 'Your home',
  friend: 'Friend',
  public: 'Public',
};

/** A stable 0..1 number per string (FNV-1a), so homes keep their spot between visits. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
/** Seeded random numbers (mulberry32) for the scenery. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Point {
  x: number;
  y: number;
}
interface Placed extends Point {
  home: MapHome;
  /** The road from the edge of town to the front door, as an SVG path and sample points. */
  road: string;
  roadPts: Point[];
}
interface World {
  w: number;
  h: number;
  town: Point & Size;
  placed: Placed[];
}

function layout(homes: MapHome[], picture: Size): World {
  const fit = Math.min(TOWN_BOX.w / picture.w, TOWN_BOX.h / picture.h);
  const tw = Math.round(picture.w * fit);
  const th = Math.round(picture.h * fit);
  const order = [...homes].sort(
    (a, b) =>
      RELATIONS.indexOf(a.relation) - RELATIONS.indexOf(b.relation) ||
      a.owner_name.localeCompare(b.owner_name),
  );
  // Ring sizes first: the last ring spreads its homes evenly.
  const rings: number[] = [];
  for (let left = order.length; left > 0;) {
    const n = Math.min(RING_CAP(rings.length), left);
    rings.push(n);
    left -= n;
  }
  const outer = Math.max(2, rings.length - 1);
  const w = 2 * (RX(outer) + 260);
  const h = 2 * (RY(outer) + 220);
  const town = { x: w / 2, y: h / 2, w: tw, h: th };
  const placed: Placed[] = [];
  let i = 0;
  rings.forEach((n, r) => {
    for (let slot = 0; slot < n; slot++, i++) {
      const home = order[i]!;
      const j = hash(home.owner_id) - 0.5;
      const angle = (slot / n) * Math.PI * 2 - Math.PI / 2 + r * 0.5 + j * (0.6 / n);
      const x = town.x + Math.cos(angle) * (RX(r) + j * 40);
      const y = town.y + Math.sin(angle) * (RY(r) + j * 30);
      // A gently bending road from the town's edge to the door.
      const sx = town.x + Math.cos(angle) * (tw / 2 + 10);
      const sy = town.y + Math.sin(angle) * (th / 2 + 10);
      const bend = j * 160;
      const cx = (sx + x) / 2 - Math.sin(angle) * bend;
      const cy = (sy + y) / 2 + Math.cos(angle) * bend;
      const ey = y + 6;
      const roadPts = Array.from({ length: 11 }, (_, k) => {
        const t = k / 10;
        const u = 1 - t;
        return {
          x: u * u * sx + 2 * u * t * cx + t * t * x,
          y: u * u * sy + 2 * u * t * cy + t * t * ey,
        };
      });
      placed.push({ home, x, y, road: `M${sx} ${sy} Q${cx} ${cy} ${x} ${ey}`, roadPts });
    }
  });
  return { w, h, town, placed };
}

/** Scenery keeps to the corners, outside the rings of homes. */
function scenery(world: World) {
  const { w, h } = world;
  const river = [
    { x: w * 0.73, y: -30 },
    { x: w * 0.79, y: h * 0.08 },
    { x: w * 0.87, y: h * 0.1 },
    { x: w * 0.9, y: h * 0.19 },
    { x: w * 0.95, y: h * 0.27 },
    { x: w + 30, y: h * 0.3 },
  ];
  const riverPath =
    `M${river[0]!.x} ${river[0]!.y} C${river[1]!.x} ${river[1]!.y}, ${river[2]!.x} ${river[2]!.y}, ` +
    `${river[3]!.x} ${river[3]!.y} S${river[4]!.x} ${river[4]!.y}, ${river[5]!.x} ${river[5]!.y}`;
  const pond = { x: w * 0.13, y: h * 0.85, rx: 130, ry: 72 };

  const segDist = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  const nearLine = (p: Point, pts: Point[], d: number) =>
    pts.some((a, k) => k > 0 && segDist(p, pts[k - 1]!, a) < d);
  const clear = (p: Point) =>
    !(
      Math.abs(p.x - world.town.x) < world.town.w / 2 + 50 &&
      Math.abs(p.y - world.town.y) < world.town.h / 2 + 70
    ) &&
    !world.placed.some((h) => Math.abs(p.x - h.x) < 85 && p.y > h.y - 90 && p.y < h.y + 70) &&
    !world.placed.some((h) => nearLine(p, h.roadPts, 34)) &&
    !nearLine(p, river, 60) &&
    ((p.x - pond.x) / (pond.rx + 40)) ** 2 + ((p.y - pond.y) / (pond.ry + 50)) ** 2 > 1;

  const rand = seeded(424242);
  const kinds = ['Tree_1', 'Tree_13', 'Tree_49', 'Tree_9', 'Tree_61', 'Tree_185', 'Tree_197'];
  const trees: (Point & { frame: string })[] = [];
  const plant = (p: Point, pool = kinds) => {
    if (p.x < -10 || p.x > w + 10 || p.y < 20 || p.y > h + 30 || !clear(p)) return;
    trees.push({ ...p, frame: `Camping_16x16_${pool[Math.floor(rand() * pool.length)]!}` });
  };
  // A forest all the way round the edge, two trees deep.
  for (const inset of [8, 52]) {
    for (let x = 0; x <= w; x += 44) {
      plant({ x: x + rand() * 16, y: inset + 40 + rand() * 10 }, kinds.slice(0, 5));
      plant({ x: x + rand() * 16, y: h - inset + 20 + rand() * 10 }, kinds.slice(0, 5));
    }
    for (let y = 80; y <= h - 40; y += 40) {
      plant({ x: inset - 10 + rand() * 12, y: y + rand() * 12 }, kinds.slice(0, 5));
      plant({ x: w - inset + 10 + rand() * 12, y: y + rand() * 12 }, kinds.slice(0, 5));
    }
  }
  // Copses in between.
  for (let k = 0; k < 46; k++) {
    const c = { x: 120 + rand() * (w - 240), y: 140 + rand() * (h - 280) };
    const n = 2 + Math.floor(rand() * 4);
    for (let t = 0; t < n; t++)
      plant({ x: c.x + (rand() - 0.5) * 110, y: c.y + (rand() - 0.5) * 70 });
  }
  trees.sort((a, b) => a.y - b.y);

  const flowers: (Point & { color: string })[] = [];
  const colors = ['#fff3c4', '#f7a8c4', '#ffd166', '#c9b6ff', '#ffffff'];
  for (let k = 0; k < 60; k++) {
    const c = { x: 100 + rand() * (w - 200), y: 100 + rand() * (h - 200) };
    if (!clear(c)) continue;
    const color = colors[Math.floor(rand() * colors.length)]!;
    for (let t = 0; t < 6; t++)
      flowers.push({ x: c.x + (rand() - 0.5) * 40, y: c.y + (rand() - 0.5) * 24, color });
  }
  return { riverPath, pond, trees, flowers };
}

// ---------- The panel ----------

interface View {
  x: number;
  y: number;
  scale: number;
}
type Selection = { kind: 'town' } | { kind: 'home'; ownerId: string } | null;

/**
 * The world map: an explorable little world with the town in the middle and homes on roads
 * around it (yours, your friends' and public ones). Drag to look around, scroll to zoom, pick
 * a place to see who lives there and travel.
 */
export function MapPanel() {
  const open = useUi((s) => s.mapOpen);
  const here = useUi((s) => s.house?.ownerId ?? 'town');
  const focusing = useUi((s) => s.focus !== null);
  const avatar = useUi((s) => s.playerAvatar);
  const [homes, setHomes] = useState<MapHome[] | null>(null);
  const [houses, setHouses] = useState<Atlas | null>(null);
  const [trees, setTrees] = useState<Atlas | null>(null);
  const [picture, setPicture] = useState<Size>({ w: 272, h: 200 });
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Selection>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<View | null>(null);
  const drag = useRef<{ x: number; y: number; from: View; moved: boolean; id: number } | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      fetchWorldMap(),
      atlas('/assets/sprites/houses'),
      atlas('/assets/sprites/town-trees'),
      townPictureSize(),
    ])
      .then(([h, ha, ta, pic]) => {
        if (cancelled) return;
        setHomes(h);
        setHouses(ha);
        setTrees(ta);
        setPicture(pic);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const world = useMemo(() => layout(homes ?? [], picture), [homes, picture]);
  const scene = useMemo(() => scenery(world), [world]);

  if (!open) return null;

  const placedHere = world.placed.find((p) => p.home.owner_id === here);
  const youAt =
    here === 'town'
      ? { x: world.town.x, y: world.town.y - 6 }
      : placedHere
        ? { x: placedHere.x, y: placedHere.y - 96 * HOUSE_SCALE - 14 }
        : null;

  const box = () => viewport?.getBoundingClientRect() ?? { width: 900, height: 600 };
  const minScale = () => {
    const b = box();
    return Math.max(0.25, Math.min(b.width / world.w, b.height / world.h));
  };
  const clamp = (v: View): View => {
    const b = box();
    const scale = Math.max(minScale(), Math.min(1.6, v.scale));
    const fit = (pos: number, size: number, room: number) =>
      size <= room ? (room - size) / 2 : Math.min(0, Math.max(room - size, pos));
    return {
      scale,
      x: fit(v.x, world.w * scale, b.width),
      y: fit(v.y, world.h * scale, b.height),
    };
  };
  const centered = (p: Point, scale: number): View => {
    const b = box();
    return clamp({ scale, x: b.width / 2 - p.x * scale, y: b.height / 2 - p.y * scale });
  };
  // Until the player moves the map, it frames the town and the first ring of homes.
  const initial = () => {
    const b = box();
    return centered(
      world.town,
      Math.min(1.1, Math.max(0.45, Math.min(b.width / 1250, b.height / 900))),
    );
  };
  const current = view ?? initial();
  const update = (f: (v: View) => View) => setView((v) => clamp(f(v ?? initial())));

  const close = () => {
    setSelected(null);
    setSearch('');
    setView(null);
    uiStore.set({ mapOpen: false });
  };
  const travel = (go: () => void) => {
    if (focusing) return;
    sfx.play('whoosh');
    close();
    go();
  };
  const visit = (h: MapHome) =>
    travel(() =>
      goToHouse({
        ownerId: h.owner_id,
        at: h.relation === 'home' ? 'door' : 'gate',
        label: h.relation === 'home' ? 'Home' : `${h.owner_name}'s home`,
      }),
    );
  const zoomAt = (factor: number, px?: number, py?: number) =>
    update((v) => {
      const b = box();
      const cx = px ?? b.width / 2;
      const cy = py ?? b.height / 2;
      const scale = Math.max(minScale(), Math.min(1.6, v.scale * factor));
      return {
        scale,
        x: cx - ((cx - v.x) * scale) / v.scale,
        y: cy - ((cy - v.y) * scale) / v.scale,
      };
    });
  const focusOn = (p: Placed) => {
    setSelected({ kind: 'home', ownerId: p.home.owner_id });
    setView(centered({ x: p.x, y: p.y - 40 }, Math.max(current.scale, 0.9)));
  };

  const q = search.trim().toLowerCase();
  const matches = (h: MapHome) =>
    !q ||
    h.owner_name.toLowerCase().includes(q) ||
    h.members.some((m) => m.toLowerCase().includes(q));
  const results = q ? world.placed.filter((p) => matches(p.home)).slice(0, 6) : [];
  const selectedHome =
    selected?.kind === 'home'
      ? world.placed.find((p) => p.home.owner_id === selected.ownerId)?.home
      : undefined;

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="panel card world-map" onClick={(e) => e.stopPropagation()}>
        <header className="wm-header">
          <div>
            <h2 className="title">World map</h2>
            <p className="subtitle">
              {focusing
                ? 'Finish your focus session before travelling.'
                : 'Drag to look around, scroll to zoom, pick a place to visit.'}
            </p>
          </div>
          <div className="wm-search">
            <input
              value={search}
              placeholder="Find a home…"
              aria-label="Find a home"
              maxLength={20}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results[0]) focusOn(results[0]);
                e.stopPropagation();
              }}
            />
            {results.length > 0 && (
              <div className="wm-results">
                {results.map((p) => (
                  <button
                    key={p.home.owner_id}
                    type="button"
                    onClick={() => {
                      focusOn(p);
                      setSearch('');
                    }}
                  >
                    <i className={p.home.relation} />
                    {p.home.relation === 'home' ? 'Your home' : `${p.home.owner_name}'s home`}
                    <small>{p.home.members.join(', ')}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </header>
        {error && <div className="form-error">{error}</div>}

        <div
          ref={setViewport}
          className="wm-viewport"
          onPointerDown={(e) => {
            if (e.button !== 0 || (e.target as HTMLElement).closest('.wm-ui')) return;
            drag.current = {
              x: e.clientX,
              y: e.clientY,
              from: current,
              moved: false,
              id: e.pointerId,
            };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
            if (!d.moved) {
              // Only capture once it's a drag, so a plain click still reaches the place clicked.
              d.moved = true;
              e.currentTarget.setPointerCapture(d.id);
              e.currentTarget.classList.add('dragging');
            }
            setView(clamp({ ...d.from, x: d.from.x + dx, y: d.from.y + dy }));
          }}
          onPointerUp={(e) => {
            e.currentTarget.classList.remove('dragging');
            const d = drag.current;
            drag.current = null;
            if (d && !d.moved && !(e.target as HTMLElement).closest('.wm-place, .wm-ui')) {
              setSelected(null);
            }
          }}
          onPointerCancel={() => (drag.current = null)}
          onWheel={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
          }}
        >
          <div
            className="wm-world"
            style={{
              width: world.w,
              height: world.h,
              transform: `translate(${current.x}px, ${current.y}px) scale(${current.scale})`,
            }}
          >
            <svg className="wm-ground" width={world.w} height={world.h} aria-hidden="true">
              <defs>
                <radialGradient id="wm-meadow" cx="50%" cy="50%" r="65%">
                  <stop offset="0%" stopColor="#9ad384" />
                  <stop offset="55%" stopColor="#7cbf6c" />
                  <stop offset="100%" stopColor="#5b9c55" />
                </radialGradient>
                <pattern id="wm-tufts" width="64" height="48" patternUnits="userSpaceOnUse">
                  <path
                    d="M8 14l2-5 2 5M40 36l2-5 2 5M52 10l1.5-4 1.5 4M22 40l1.5-4 1.5 4"
                    stroke="#5f9f56"
                    strokeWidth="1.6"
                    fill="none"
                    strokeLinecap="round"
                  />
                </pattern>
              </defs>
              <rect width={world.w} height={world.h} fill="url(#wm-meadow)" />
              <rect width={world.w} height={world.h} fill="url(#wm-tufts)" />

              <ellipse
                cx={scene.pond.x}
                cy={scene.pond.y}
                rx={scene.pond.rx + 8}
                ry={scene.pond.ry + 8}
                fill="#d9c08a"
              />
              <ellipse
                cx={scene.pond.x}
                cy={scene.pond.y}
                rx={scene.pond.rx}
                ry={scene.pond.ry}
                fill="#4f9fcb"
              />
              <ellipse
                cx={scene.pond.x - 20}
                cy={scene.pond.y - 14}
                rx={scene.pond.rx * 0.55}
                ry={scene.pond.ry * 0.35}
                fill="#7fc0e2"
                opacity="0.7"
              />
              <g
                className="wm-ripples"
                stroke="#d4eefa"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              >
                <path d={`M${scene.pond.x + 30} ${scene.pond.y + 20}h18`} />
                <path d={`M${scene.pond.x - 60} ${scene.pond.y + 34}h12`} />
              </g>
              <path
                d={scene.riverPath}
                fill="none"
                stroke="#d9c08a"
                strokeWidth="78"
                strokeLinecap="round"
              />
              <path
                d={scene.riverPath}
                fill="none"
                stroke="#4f9fcb"
                strokeWidth="62"
                strokeLinecap="round"
              />
              <path
                d={scene.riverPath}
                className="wm-current"
                fill="none"
                stroke="#a8dcf2"
                strokeWidth="3"
                strokeDasharray="10 26"
                strokeLinecap="round"
              />

              {scene.flowers.map((f, i) => (
                <circle key={i} cx={f.x} cy={f.y} r="2.6" fill={f.color} />
              ))}

              {world.placed.map((p) => (
                <g key={p.home.owner_id} opacity={matches(p.home) ? 1 : 0.4}>
                  <ellipse cx={p.x} cy={p.y - 18} rx="78" ry="44" fill="#a5d98c" opacity="0.55" />
                  <path
                    d={p.road}
                    fill="none"
                    stroke="#c39a62"
                    strokeWidth="22"
                    strokeLinecap="round"
                  />
                  <path
                    d={p.road}
                    fill="none"
                    stroke="#ead2a0"
                    strokeWidth="16"
                    strokeLinecap="round"
                  />
                  <path
                    d={p.road}
                    fill="none"
                    stroke="#d6b77e"
                    strokeWidth="3"
                    strokeDasharray="1 12"
                    strokeLinecap="round"
                  />
                </g>
              ))}
              <rect
                x={world.town.x - world.town.w / 2 - 22}
                y={world.town.y - world.town.h / 2 - 22}
                width={world.town.w + 44}
                height={world.town.h + 44}
                rx="30"
                fill="#ead2a0"
                stroke="#c39a62"
                strokeWidth="5"
              />
            </svg>

            {trees &&
              scene.trees.map((t, i) => {
                const f = trees.frames[t.frame];
                if (!f) return null;
                return (
                  <span
                    key={i}
                    className="wm-tree"
                    style={{
                      ...spriteStyle(trees, f, TREE_SCALE),
                      left: t.x - (f.w * TREE_SCALE) / 2,
                      top: t.y - f.h * TREE_SCALE,
                      animationDelay: `${-(i % 13) * 0.37}s`,
                    }}
                  />
                );
              })}

            <button
              type="button"
              className={`wm-place wm-town${selected?.kind === 'town' ? ' selected' : ''}${here === 'town' ? ' here' : ''}`}
              style={{ left: world.town.x, top: world.town.y }}
              onClick={() => {
                sfx.play('click');
                setSelected({ kind: 'town' });
              }}
              onDoubleClick={() => here !== 'town' && travel(goToTown)}
            >
              <span className="wm-town-pic" style={{ width: world.town.w, height: world.town.h }} />
              <span className="wm-banner">Focus Town</span>
            </button>

            {world.placed.map((p) => {
              const h = p.home;
              const f = houses?.frames[houseKey(h)];
              return (
                <button
                  key={h.owner_id}
                  type="button"
                  className={`wm-place wm-home ${h.relation}${here === h.owner_id ? ' here' : ''}${
                    selectedHome?.owner_id === h.owner_id ? ' selected' : ''
                  }${matches(h) ? '' : ' dim'}`}
                  style={{ left: p.x, top: p.y }}
                  title={h.members.join(', ')}
                  onClick={() => {
                    sfx.play('click');
                    setSelected({ kind: 'home', ownerId: h.owner_id });
                  }}
                  onDoubleClick={() => here !== h.owner_id && visit(h)}
                >
                  {houses && f && (
                    <span className="wm-house" style={spriteStyle(houses, f, HOUSE_SCALE)} />
                  )}
                  <span className={`wm-plate ${h.relation}`}>
                    {h.relation === 'home' ? 'Home' : h.owner_name}
                  </span>
                </button>
              );
            })}

            {youAt && (
              <span className="wm-you" style={{ left: youAt.x, top: youAt.y }}>
                <span className="wm-you-pin">
                  <AvatarSprite avatar={avatar} scale={2} head />
                </span>
              </span>
            )}
          </div>

          <span className="wm-cloud one" />
          <span className="wm-cloud two" />
          <span className="wm-cloud three" />

          <svg className="wm-compass" viewBox="0 0 44 44" aria-hidden="true">
            <circle cx="22" cy="22" r="20" fill="#fff8ea" stroke="#a8744a" strokeWidth="3" />
            <path d="M22 7 L26.5 22 L22 37 L17.5 22 Z" fill="#c9a576" />
            <path d="M22 7 L26.5 22 L17.5 22 Z" fill="#ea7b74" />
            <circle cx="22" cy="22" r="2.5" fill="#4b3527" />
          </svg>

          <div className="wm-legend wm-ui">
            <span>
              <i className="home" /> Your home
            </span>
            <span>
              <i className="friend" /> Friends
            </span>
            <span>
              <i className="public" /> Public
            </span>
          </div>

          <div className="wm-zoom wm-ui">
            <button
              type="button"
              className="tool"
              aria-label="Zoom in"
              onClick={() => zoomAt(1.25)}
            >
              <Icon name="plus" size={16} />
            </button>
            <button
              type="button"
              className="tool"
              aria-label="Zoom out"
              onClick={() => zoomAt(1 / 1.25)}
            >
              <Icon name="minus" size={16} />
            </button>
            <button
              type="button"
              className="tool"
              aria-label="Where am I?"
              title="Where am I?"
              onClick={() =>
                youAt &&
                setView(centered({ x: youAt.x, y: youAt.y + 60 }, Math.max(current.scale, 0.9)))
              }
            >
              <Icon name="flag" size={16} />
            </button>
          </div>

          {!homes && !error && <div className="spinner wm-spinner" aria-label="Loading" />}

          {selected?.kind === 'town' && (
            <div className="wm-card wm-ui">
              <span className="wm-card-pic town" />
              <div className="wm-card-body">
                <strong>Focus Town</strong>
                <small>Study plaza, café terrace, park, library and the Furniture Shop.</small>
                <div className="row">
                  <button
                    type="button"
                    className="btn"
                    disabled={focusing || here === 'town'}
                    onClick={() => travel(goToTown)}
                  >
                    {here === 'town' ? 'You are here' : 'Go to town'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setSelected(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
          {selectedHome && (
            <div className="wm-card wm-ui">
              <span className={`wm-card-pic home ${selectedHome.relation}`}>
                {(() => {
                  const f = houses?.frames[houseKey(selectedHome)];
                  return houses && f ? (
                    <span
                      className="wm-house"
                      style={spriteStyle(houses, f, 56 / Math.max(f.w, f.h))}
                    />
                  ) : (
                    <Icon name="home" size={22} />
                  );
                })()}
              </span>
              <div className="wm-card-body">
                <strong>
                  {selectedHome.relation === 'home'
                    ? 'Your home'
                    : `${selectedHome.owner_name}'s home`}
                </strong>
                <small>
                  <span className={`wm-chip ${selectedHome.relation}`}>
                    {RELATION_LABEL[selectedHome.relation]}
                  </span>{' '}
                  Level {selectedHome.level} · {selectedHome.members.join(', ')}
                </small>
                <div className="row">
                  <button
                    type="button"
                    className="btn"
                    disabled={focusing || here === selectedHome.owner_id}
                    onClick={() => visit(selectedHome)}
                  >
                    {here === selectedHome.owner_id
                      ? 'You are here'
                      : selectedHome.relation === 'home'
                        ? 'Go home'
                        : 'Visit'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setSelected(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
