import Phaser from 'phaser';
import type { Direction, Emote } from '@focus-town/shared';
import { ensureAvatarTexture, idleAnimKey, sitAnimKey, walkAnimKey } from './characters';
import { UI_KEY, ensureUiAnims } from './uiAtlas';

/** Sprite y while standing / sitting (LimeZu sit frames line up with a chair's bottom edge). */
const STAND_Y = 1;
const SIT_Y = 2;
/** Name tag centre, and where things above the head start. */
const TAG_Y = -27;
const ABOVE_Y = -39;

const FONT = 'Nunito, system-ui, sans-serif';
const INK = '#4b3527';

/**
 * A rounded "pill" with text: name tags and speech bubbles. Drawn with Graphics so it stays
 * crisp and matches the paper-and-wood interface.
 */
class Pill extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Graphics;
  readonly text: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    y: number,
    private fill: number,
    private stroke: number,
    color: string,
    fontSize: number,
    resolution: number,
    private readonly tail = false,
    wrap = 0,
  ) {
    super(scene, 0, y);
    this.bg = scene.add.graphics();
    this.text = scene.add
      .text(0, 0, '', {
        fontFamily: FONT,
        fontStyle: '800',
        fontSize: `${fontSize}px`,
        color,
        align: 'center',
        resolution,
        ...(wrap ? { wordWrap: { width: wrap } } : {}),
      })
      .setOrigin(0.5, 1);
    this.add([this.bg, this.text]);
  }

  set(text: string, fill = this.fill, stroke = this.stroke, color?: string): this {
    this.fill = fill;
    this.stroke = stroke;
    this.text.setText(text);
    if (color) this.text.setColor(color);
    const w = Math.ceil(this.text.width) + 6;
    const h = Math.ceil(this.text.height) + 2;
    const g = this.bg.clear();
    g.fillStyle(this.fill, 1).lineStyle(1, this.stroke, 1);
    g.fillRoundedRect(-w / 2, -h, w, h, Math.min(4, h / 2));
    g.strokeRoundedRect(-w / 2, -h, w, h, Math.min(4, h / 2));
    if (this.tail) {
      g.fillTriangle(-3, -0.5, 3, -0.5, 0, 3.5);
      g.lineBetween(-3, 0, 0, 3.5).lineBetween(3, 0, 0, 3.5);
    }
    this.text.setY(-1);
    return this;
  }

  setResolution(r: number): void {
    this.text.setResolution(r);
  }
}

/** A player avatar with a name tag. The container's (x, y) is the point between the feet. */
export class PlayerSprite extends Phaser.GameObjects.Container {
  private readonly body_: Phaser.GameObjects.Sprite;
  private readonly tag: Pill;
  /** Focus minutes, under the timer bubble while focusing. */
  private readonly badge: Pill;
  /** Animated bubble over the head: focusing timer or typing dots. */
  private readonly status_: Phaser.GameObjects.Sprite;
  private emoteIcon: Phaser.GameObjects.Image | null = null;
  private emoteTimer: Phaser.Time.TimerEvent | null = null;
  private dir: Direction = 'down';
  private moving = false;
  private typing = false;
  private moveTween: Phaser.Tweens.Tween | null = null;
  private bubble: Pill | null = null;
  private bubbleTimer: Phaser.Time.TimerEvent | null = null;
  private statusKey = '';
  private status = 'walking';
  private focusMin = 0;
  private resolution: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    /** encodeAvatar() form. */
    private avatar: string,
    private name_: string,
    private readonly isLocal: boolean,
    textResolution: number,
  ) {
    super(scene, x, y);
    this.resolution = textResolution;
    ensureUiAnims(scene);
    const shadow = scene.add.ellipse(0, 0, 11, 4, 0x2b1d12, 0.28);
    // 16x32 LimeZu frame; the feet touch the bottom edge and the head starts ~7px from the top.
    this.body_ = scene.add.sprite(0, STAND_Y, ensureAvatarTexture(scene, avatar));
    this.body_.setOrigin(0.5, 1);
    this.body_.play(idleAnimKey(avatar, 'down'));
    this.tag = new Pill(scene, TAG_Y, 0, 0, INK, 6, textResolution);
    this.badge = new Pill(scene, ABOVE_Y, 0xdff1e4, 0x4f8d66, '#2f6b45', 5, textResolution);
    this.badge.setVisible(false);
    this.status_ = scene.add
      .sprite(0, ABOVE_Y, UI_KEY, 'timer:0')
      .setOrigin(0.5, 1)
      .setVisible(false);
    this.add([shadow, this.body_, this.tag, this.badge, this.status_]);
    this.paintTag(name_);
    scene.add.existing(this);
    this.setDepth(y);
  }

  get playerName(): string {
    return this.name_;
  }

  get isFocusing(): boolean {
    return this.status === 'focusing';
  }

  /** The player saved a new character or name. */
  setLook(avatar: string, name: string): void {
    if (avatar !== this.avatar) {
      this.avatar = avatar;
      this.body_.setTexture(ensureAvatarTexture(this.scene, avatar));
      this.playAnim();
    }
    if (name !== this.name_) {
      this.name_ = name;
      this.statusKey = '';
      this.setStatus(this.status, this.focusMin);
    }
  }

  /** Make the avatar clickable (remote players: click to whisper). */
  onClick(handler: () => void): void {
    this.body_.setInteractive({ useHandCursor: true });
    this.body_.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) handler();
    });
  }

  setTextResolution(resolution: number): void {
    this.resolution = resolution;
    this.tag.setResolution(resolution);
    this.badge.setResolution(resolution);
    this.bubble?.setResolution(resolution);
  }

  /** Show a chat message in a speech bubble for a few seconds. */
  say(text: string, resolution: number): void {
    this.bubbleTimer?.remove();
    this.bubble?.destroy();
    const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
    this.bubble = new Pill(
      this.scene,
      this.topY() - 2,
      0xfff8ea,
      0xc9a576,
      INK,
      6,
      resolution,
      true,
      90,
    );
    this.bubble.set(short);
    this.add(this.bubble);
    this.pop(this.bubble);
    this.bubbleTimer = this.scene.time.delayedCall(5000 + short.length * 40, () => {
      const b = this.bubble;
      this.bubble = null;
      if (b)
        this.scene.tweens.add({
          targets: b,
          alpha: 0,
          y: b.y - 4,
          duration: 250,
          onComplete: () => b.destroy(),
        });
    });
  }

  /** Pop an emote bubble over the head for a couple of seconds. */
  emote(emote: Emote): void {
    this.emoteTimer?.remove();
    this.emoteIcon?.destroy();
    const icon = this.scene.add.image(0, this.topY(), UI_KEY, `emote:${emote}`).setOrigin(0.5, 1);
    this.emoteIcon = icon;
    this.add(icon);
    this.status_.setVisible(false);
    this.pop(icon);
    this.scene.tweens.add({
      targets: icon,
      y: icon.y - 2,
      yoyo: true,
      repeat: -1,
      duration: 500,
      ease: 'Sine.easeInOut',
    });
    this.emoteTimer = this.scene.time.delayedCall(2600, () => {
      this.scene.tweens.add({
        targets: icon,
        alpha: 0,
        scale: 0.6,
        duration: 200,
        onComplete: () => {
          icon.destroy();
          if (this.emoteIcon === icon) this.emoteIcon = null;
          this.refreshStatusBubble();
        },
      });
    });
  }

  setTyping(typing: boolean): void {
    if (typing === this.typing) return;
    this.typing = typing;
    this.refreshStatusBubble();
  }

  /**
   * Show what the player is doing: focusing players get a timer bubble and their verified
   * minutes over a shortened name (desks sit close together); dropped players are dimmed while
   * the server holds their seat.
   */
  setStatus(status: string, focusMin: number): void {
    const key = `${status}:${focusMin}:${this.name_}`;
    if (key === this.statusKey) return;
    this.statusKey = key;
    this.status = status;
    this.focusMin = focusMin;
    this.setAlpha(status === 'away' ? 0.45 : 1);
    this.playAnim();
    if (status === 'focusing') {
      const short = this.name_.length > 9 ? `${this.name_.slice(0, 8)}…` : this.name_;
      this.tag.set(short, 0xdff1e4, 0x4f8d66, '#2f6b45');
      this.badge.set(`${focusMin} min`).setVisible(true);
    } else {
      this.paintTag(status === 'away' ? `${this.name_} · away` : this.name_);
      this.badge.setVisible(false);
    }
    this.refreshStatusBubble();
  }

  /** Update facing + idle/walk animation. */
  setMotion(dir: Direction, moving: boolean): void {
    if (dir === this.dir && moving === this.moving) return;
    this.dir = dir;
    this.moving = moving;
    this.playAnim();
  }

  private paintTag(text: string): void {
    if (this.isLocal) this.tag.set(text, 0xf5b84e, 0xd28f2a, INK);
    else this.tag.set(text, 0xfff8ea, 0xc9a576, INK);
  }

  /** Top of the stack over the head (name tag, minutes badge). */
  private topY(): number {
    return this.badge.visible ? ABOVE_Y - 9 : ABOVE_Y;
  }

  /** Timer bubble while focusing, "…" while typing; hidden while an emote shows. */
  private refreshStatusBubble(): void {
    const s = this.status_;
    s.setY(this.topY());
    if (this.emoteIcon) {
      s.setVisible(false);
    } else if (this.typing) {
      s.setVisible(true).play('ui:typing', true);
    } else if (this.status === 'focusing') {
      s.setVisible(true).play('ui:timer', true);
    } else {
      s.setVisible(false).stop();
    }
  }

  private pop(
    target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject,
  ): void {
    target.setScale(0.2);
    this.scene.tweens.add({ targets: target, scale: 1, duration: 260, ease: 'Back.easeOut' });
  }

  /** Walk, stand, or sit (focusing in a side-facing chair; LimeZu only has side sit frames). */
  private playAnim(): void {
    const side = this.dir === 'left' || this.dir === 'right' ? this.dir : null;
    const sitting = this.status === 'focusing' && !this.moving && side !== null;
    this.body_.y = sitting ? SIT_Y : STAND_Y;
    this.body_.play(
      sitting && side
        ? sitAnimKey(this.avatar, side)
        : (this.moving ? walkAnimKey : idleAnimKey)(this.avatar, this.dir),
      true,
    );
  }

  /** Jump straight to a position (local player, corrections). */
  placeAt(x: number, y: number): void {
    this.moveTween?.stop();
    this.moveTween = null;
    this.setPosition(x, y);
    this.setDepth(y);
  }

  /** Smoothly glide to a server position (remote players). */
  glideTo(x: number, y: number, durationMs: number): void {
    this.moveTween?.stop();
    // Teleport if the gap is implausibly large (e.g. after a reconnect).
    if (Math.hypot(x - this.x, y - this.y) > 64) {
      this.placeAt(x, y);
      return;
    }
    this.moveTween = this.scene.tweens.add({
      targets: this,
      x,
      y,
      duration: durationMs,
      ease: 'Linear',
      onUpdate: () => this.setDepth(this.y),
    });
  }

  override destroy(fromScene?: boolean): void {
    this.moveTween?.stop();
    this.bubbleTimer?.remove();
    this.emoteTimer?.remove();
    super.destroy(fromScene);
  }
}
