import Phaser from 'phaser';
import type { Direction } from '@focus-town/shared';
import { CHARACTERS_KEY, characterFrame, walkAnimKey } from './characters';

/** A player avatar with a name tag. The container's (x, y) is the point between the feet. */
export class PlayerSprite extends Phaser.GameObjects.Container {
  private readonly body_: Phaser.GameObjects.Sprite;
  private readonly label: Phaser.GameObjects.Text;
  /** Small line above the name, e.g. focus minutes. */
  private readonly badge: Phaser.GameObjects.Text;
  private dir: Direction = 'down';
  private moving = false;
  private moveTween: Phaser.Tweens.Tween | null = null;
  private bubble: Phaser.GameObjects.Text | null = null;
  private bubbleTimer: Phaser.Time.TimerEvent | null = null;
  private statusKey = '';

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly avatar: number,
    private readonly name_: string,
    private readonly isLocal: boolean,
    textResolution: number,
  ) {
    super(scene, x, y);
    this.body_ = scene.add.sprite(0, 1, CHARACTERS_KEY, characterFrame(avatar, 0, 'down'));
    this.body_.setOrigin(0.5, 1);
    const style = {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      fontStyle: 'bold',
      stroke: '#1d1b2a',
      strokeThickness: 2,
      resolution: textResolution,
    };
    this.label = scene.add
      .text(0, -17, name_, { ...style, fontSize: '6px', color: this.nameColor() })
      .setOrigin(0.5, 1);
    this.badge = scene.add
      .text(0, -24, '', { ...style, fontSize: '5px', color: '#b8f2c2' })
      .setOrigin(0.5, 1)
      .setVisible(false);
    this.add([this.body_, this.label, this.badge]);
    scene.add.existing(this);
    this.setDepth(y);
  }

  get playerName(): string {
    return this.name_;
  }

  /** Make the avatar clickable (remote players: click to whisper). */
  onClick(handler: () => void): void {
    this.body_.setInteractive({ useHandCursor: true });
    this.body_.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) handler();
    });
  }

  setTextResolution(resolution: number): void {
    this.label.setResolution(resolution);
    this.badge.setResolution(resolution);
    this.bubble?.setResolution(resolution);
  }

  /** Show a chat message in a speech bubble for a few seconds. */
  say(text: string, resolution: number): void {
    this.bubbleTimer?.remove();
    this.bubble?.destroy();
    const short = text.length > 60 ? `${text.slice(0, 57)}...` : text;
    this.bubble = this.scene.add
      .text(0, this.badge.visible ? -31 : -24, short, {
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: '6px',
        color: '#1d1b2a',
        backgroundColor: '#fdf6e3',
        padding: { x: 3, y: 2 },
        wordWrap: { width: 90 },
        align: 'center',
        resolution,
      })
      .setOrigin(0.5, 1);
    this.add(this.bubble);
    this.bubbleTimer = this.scene.time.delayedCall(5000 + short.length * 40, () => {
      this.bubble?.destroy();
      this.bubble = null;
    });
  }

  private nameColor(): string {
    return this.isLocal ? '#fff3b0' : '#ffffff';
  }

  /**
   * Show what the player is doing: focusing players get their verified minutes on a small line
   * above a shortened name (desks sit close together), dropped players are dimmed while the
   * server holds their seat.
   */
  setStatus(status: string, focusMin: number): void {
    const key = `${status}:${focusMin}`;
    if (key === this.statusKey) return;
    this.statusKey = key;
    this.setAlpha(status === 'away' ? 0.45 : 1);
    if (status === 'focusing') {
      const short = this.name_.length > 9 ? `${this.name_.slice(0, 8)}…` : this.name_;
      this.label.setText(short).setColor('#b8f2c2');
      this.badge.setText(`focusing ${focusMin}m`).setVisible(true);
    } else {
      this.label
        .setText(status === 'away' ? `${this.name_} (away)` : this.name_)
        .setColor(this.nameColor());
      this.badge.setVisible(false);
    }
  }

  /** Update facing + walk animation. */
  setMotion(dir: Direction, moving: boolean): void {
    if (dir === this.dir && moving === this.moving) return;
    this.dir = dir;
    this.moving = moving;
    if (moving) {
      this.body_.play(walkAnimKey(this.avatar, dir), true);
    } else {
      this.body_.stop();
      this.body_.setFrame(characterFrame(this.avatar, 0, dir));
    }
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
    super.destroy(fromScene);
  }
}
