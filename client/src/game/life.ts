import Phaser from 'phaser';
import { ABOVE_DEPTH } from './depths';

/**
 * Small touches that make the world feel alive: trees swaying in the wind, birds flapping
 * across the sky, butterflies around flowers, drifting leaves, cloud shadows, fireflies at
 * night and a gentle time-of-day tint. All client-side decoration; nothing here is synced.
 */

/** Tree atlas from tools/art/build_town.py (frames named after the source tree). */
export const TREES_KEY = 'town-trees';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** A tree as two sprites: the trunk stays put, the canopy sways a pixel or two. */
export function addTree(
  scene: Phaser.Scene,
  key: string,
  frame: string,
  x: number,
  y: number,
  w: number,
  h: number,
  trunkRows = 2,
): Phaser.GameObjects.Image[] {
  const bottom = y + h;
  const trunkH = Math.min(h, trunkRows * 16);
  const trunk = scene.add
    .image(x, y, key, frame)
    .setOrigin(0, 0)
    .setCrop(0, h - trunkH, w, trunkH)
    .setDepth(bottom);
  const canopy = scene.add
    .image(x, y, key, frame)
    .setOrigin(0, 0)
    .setCrop(0, 0, w, h - trunkH + 4)
    .setDepth(bottom + 0.1);
  swayCanopy(scene, canopy, x);
  return [trunk, canopy];
}

export function swayCanopy(scene: Phaser.Scene, canopy: Phaser.GameObjects.Image, x: number): void {
  scene.tweens.add({
    targets: canopy,
    x: x + (Math.random() < 0.3 ? 2 : 1),
    duration: rand(1300, 2300),
    delay: rand(0, 2000),
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
}

// ---------------------------------------------------------------------------------------------
// Tiny procedural sprites
// ---------------------------------------------------------------------------------------------

function pixelTexture(
  scene: Phaser.Scene,
  key: string,
  frames: string[][],
  palette: Record<string, string>,
): void {
  if (scene.textures.exists(key)) return;
  const h = frames[0]!.length;
  const w = frames[0]![0]!.length;
  const tex = scene.textures.createCanvas(key, w * frames.length, h);
  if (!tex) return;
  frames.forEach((rows, f) =>
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        const color = palette[ch];
        if (!color) return;
        tex.context.fillStyle = color;
        tex.context.fillRect(f * w + x, y, 1, 1);
      }),
    ),
  );
  frames.forEach((_, f) => tex.add(f, 0, f * w, 0, w, h));
  tex.refresh();
}

function softBlob(scene: Phaser.Scene, key: string, w: number, h: number): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const g = tex.context.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(20, 30, 40, 1)');
  g.addColorStop(0.6, 'rgba(20, 30, 40, 0.6)');
  g.addColorStop(1, 'rgba(20, 30, 40, 0)');
  tex.context.save();
  tex.context.scale(1, h / w);
  tex.context.fillStyle = g;
  tex.context.fillRect(0, 0, w, w);
  tex.context.restore();
  tex.refresh();
}

function makeTextures(scene: Phaser.Scene): void {
  pixelTexture(
    scene,
    'life-bird',
    [
      ['#.......#', '.#.....#.', '..#.#.#..', '...###...', '.........'],
      ['.........', '.........', '..##.##..', '.#.###.#.', '#.......#'],
    ],
    { '#': '#3b3340' },
  );
  pixelTexture(
    scene,
    'life-butterfly',
    [
      ['##.##', '#####', '.###.', '##.##'],
      ['.#.#.', '.###.', '.###.', '.#.#.'],
    ],
    { '#': '#ffffff' },
  );
  pixelTexture(scene, 'life-leaf', [['.##', '##.']], { '#': '#ffffff' });
  pixelTexture(scene, 'life-firefly', [['.#.', '###', '.#.']], { '#': '#fff6a8' });
  softBlob(scene, 'life-cloud', 220, 110);
  if (!scene.anims.exists('life-bird-flap')) {
    scene.anims.create({
      key: 'life-bird-flap',
      frames: [0, 1].map((frame) => ({ key: 'life-bird', frame })),
      frameRate: 7,
      repeat: -1,
    });
  }
  if (!scene.anims.exists('life-butterfly-flap')) {
    scene.anims.create({
      key: 'life-butterfly-flap',
      frames: [0, 1].map((frame) => ({ key: 'life-butterfly', frame })),
      frameRate: 10,
      repeat: -1,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// The life layer
// ---------------------------------------------------------------------------------------------

export interface LifeOptions {
  /** World area things wander in (px). */
  bounds: { x: number; y: number; width: number; height: number };
  /** Points butterflies hover around (flower beds…); random spots if empty. */
  flowers?: { x: number; y: number }[];
  butterflies?: number;
}

interface Flutter {
  sprite: Phaser.GameObjects.Sprite;
  home: { x: number; y: number };
  target: { x: number; y: number };
  phase: number;
}

interface Leaf {
  sprite: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  spin: number;
  phase: number;
}

const BUTTERFLY_TINTS = [0xffb347, 0xffffff, 0x8ec9ff, 0xffa3c7, 0xfff07a];
const LEAF_TINTS = [0x8fc46a, 0x6fae4f, 0xe0a33a, 0xd77a3a];

export class WorldLife {
  private butterflies: Flutter[] = [];
  private leaves: Leaf[] = [];
  private fireflies: Phaser.GameObjects.Image[] = [];
  private clouds: Phaser.GameObjects.Image[] = [];
  private tint: Phaser.GameObjects.Rectangle;
  private birdTimer: Phaser.Time.TimerEvent;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private active = true;
  private night = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly opts: LifeOptions,
  ) {
    makeTextures(scene);
    const b = opts.bounds;
    const spots = opts.flowers?.length
      ? opts.flowers
      : Array.from({ length: 6 }, () => ({
          x: rand(b.x, b.x + b.width),
          y: rand(b.y, b.y + b.height),
        }));
    for (let i = 0; i < (opts.butterflies ?? 6); i++) {
      const home = spots[i % spots.length]!;
      const sprite = scene.add
        .sprite(home.x, home.y, 'life-butterfly', 0)
        .setTint(BUTTERFLY_TINTS[i % BUTTERFLY_TINTS.length]!)
        .play({ key: 'life-butterfly-flap', startFrame: i % 2 });
      this.objects.push(sprite);
      this.butterflies.push({ sprite, home, target: { ...home }, phase: rand(0, 10) });
    }
    for (let i = 0; i < 10; i++) {
      const sprite = scene.add.image(0, 0, 'life-leaf').setTint(LEAF_TINTS[i % LEAF_TINTS.length]!);
      sprite.setDepth(ABOVE_DEPTH - 2).setAlpha(0.9);
      this.objects.push(sprite);
      this.leaves.push({ sprite, vx: 0, vy: 0, spin: 0, phase: rand(0, 10) });
      this.resetLeaf(this.leaves[i]!, true);
    }
    for (let i = 0; i < 3; i++) {
      const cloud = scene.add
        .image(rand(b.x, b.x + b.width), rand(b.y, b.y + b.height), 'life-cloud')
        .setScale(rand(1.4, 2.4), rand(1.2, 1.8))
        .setAlpha(0.07)
        .setDepth(ABOVE_DEPTH - 3);
      this.clouds.push(cloud);
      this.objects.push(cloud);
    }
    for (let i = 0; i < 14; i++) {
      const f = scene.add
        .image(rand(b.x, b.x + b.width), rand(b.y, b.y + b.height), 'life-firefly')
        .setDepth(ABOVE_DEPTH - 1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false);
      this.fireflies.push(f);
      this.objects.push(f);
    }
    // Time-of-day tint, fixed to the camera.
    this.tint = scene.add
      .rectangle(0, 0, 8000, 8000, 0x000000, 0)
      .setScrollFactor(0)
      .setDepth(ABOVE_DEPTH + 0.5);
    this.objects.push(this.tint);
    this.updateTimeOfDay();
    this.birdTimer = scene.time.addEvent({
      delay: rand(6000, 12000),
      loop: true,
      callback: () => {
        if (this.active && Math.random() < 0.7) this.flock();
        this.updateTimeOfDay();
      },
    });
  }

  /** Pause and hide everything (e.g. while you're indoors). */
  setActive(active: boolean): void {
    this.active = active;
    for (const o of this.objects) {
      const v = o as unknown as Phaser.GameObjects.Components.Visible;
      if (o === this.tint) continue;
      if (this.fireflies.includes(o as Phaser.GameObjects.Image))
        v.setVisible(active && this.night);
      else v.setVisible(active);
    }
  }

  update(_time: number, delta: number): void {
    if (!this.active) return;
    const dt = Math.min(delta, 50) / 1000;
    const b = this.opts.bounds;
    const t = this.scene.time.now / 1000;
    for (const f of this.butterflies) {
      const s = f.sprite;
      const dx = f.target.x - s.x;
      const dy = f.target.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) {
        f.target = { x: f.home.x + rand(-40, 40), y: f.home.y + rand(-28, 20) };
      } else {
        const speed = 18;
        s.x += (dx / d) * speed * dt;
        s.y += (dy / d) * speed * dt + Math.sin(t * 6 + f.phase) * 0.35;
        s.setFlipX(dx < 0);
      }
      s.setDepth(s.y + 24);
    }
    const view = this.scene.cameras.main.worldView;
    for (const leaf of this.leaves) {
      const s = leaf.sprite;
      s.x += leaf.vx * dt + Math.sin(t * 2 + leaf.phase) * 0.25;
      s.y += leaf.vy * dt;
      s.rotation += leaf.spin * dt;
      if (s.y > view.bottom + 10 || s.x > view.right + 20) this.resetLeaf(leaf, false);
    }
    for (const c of this.clouds) {
      c.x += 6 * dt;
      if (c.x - c.displayWidth / 2 > b.x + b.width) {
        c.x = b.x - c.displayWidth / 2;
        c.y = rand(b.y, b.y + b.height);
      }
    }
    if (this.night) {
      this.fireflies.forEach((f, i) => {
        f.x += Math.sin(t * 0.8 + i) * 0.25;
        f.y += Math.cos(t * 0.6 + i * 1.7) * 0.2;
        f.setAlpha(0.35 + 0.65 * Math.max(0, Math.sin(t * 2 + i * 2.3)));
      });
    }
  }

  private resetLeaf(leaf: Leaf, anywhere: boolean): void {
    const view = this.scene.cameras.main.worldView;
    const w = Math.max(view.width, 400);
    const h = Math.max(view.height, 300);
    const x0 = view.width ? view.x : this.opts.bounds.x;
    const y0 = view.height ? view.y : this.opts.bounds.y;
    leaf.sprite.setPosition(rand(x0 - 40, x0 + w), anywhere ? rand(y0, y0 + h) : y0 - rand(5, 60));
    leaf.vx = rand(6, 16);
    leaf.vy = rand(10, 20);
    leaf.spin = rand(-2, 2);
  }

  /** A few birds flapping across the sky, in a loose V. */
  private flock(): void {
    const view = this.scene.cameras.main.worldView;
    if (!view.width) return;
    const leftToRight = Math.random() < 0.5;
    const n = 2 + Math.floor(Math.random() * 4);
    const y = rand(view.y + 20, view.y + view.height * 0.6);
    const startX = leftToRight ? view.x - 30 : view.right + 30;
    const endX = leftToRight ? view.right + 60 : view.x - 60;
    for (let i = 0; i < n; i++) {
      const bird = this.scene.add
        .sprite(
          startX - (leftToRight ? i * 12 : -i * 12),
          y + Math.abs(i - n / 2) * 7,
          'life-bird',
          0,
        )
        .setDepth(ABOVE_DEPTH + 0.3)
        .setFlipX(!leftToRight)
        .play({ key: 'life-bird-flap', startFrame: i % 2 });
      this.scene.tweens.add({
        targets: bird,
        x: endX - (leftToRight ? i * 12 : -i * 12),
        y: bird.y + rand(-30, 30),
        duration: rand(7000, 10000),
        ease: 'Sine.easeInOut',
        onComplete: () => bird.destroy(),
      });
    }
  }

  /** Warm at dawn and dusk, blue at night (local time); fireflies come out after dark. */
  private updateTimeOfDay(): void {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    let color = 0x000000;
    let alpha = 0;
    if (h >= 20 || h < 5) [color, alpha] = [0x1d2a5c, 0.22];
    else if (h >= 18) [color, alpha] = [0xff8a3d, 0.1];
    else if (h < 7) [color, alpha] = [0xffb38a, 0.08];
    this.tint.setFillStyle(color, alpha);
    this.night = h >= 19.5 || h < 5.5;
    for (const f of this.fireflies) f.setVisible(this.active && this.night);
  }

  destroy(): void {
    this.birdTimer.remove();
    for (const o of this.objects) o.destroy();
    this.objects = [];
  }
}
