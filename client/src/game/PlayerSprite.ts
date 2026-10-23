import Phaser from 'phaser';
import type { Direction } from '@focus-town/shared';
import { CHARACTERS_KEY, characterFrame, walkAnimKey } from './characters';

/** A player avatar with a name tag. The container's (x, y) is the point between the feet. */
export class PlayerSprite extends Phaser.GameObjects.Container {
  private readonly body_: Phaser.GameObjects.Sprite;
  private readonly label: Phaser.GameObjects.Text;
  private dir: Direction = 'down';
  private moving = false;
  private moveTween: Phaser.Tweens.Tween | null = null;
  private away = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly avatar: number,
    private readonly name_: string,
    isLocal: boolean,
    textResolution: number,
  ) {
    super(scene, x, y);
    this.body_ = scene.add.sprite(0, 1, CHARACTERS_KEY, characterFrame(avatar, 0, 'down'));
    this.body_.setOrigin(0.5, 1);
    this.label = scene.add
      .text(0, -17, name_, {
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: '6px',
        fontStyle: 'bold',
        color: isLocal ? '#fff3b0' : '#ffffff',
        stroke: '#1d1b2a',
        strokeThickness: 2,
        resolution: textResolution,
      })
      .setOrigin(0.5, 1);
    this.add([this.body_, this.label]);
    scene.add.existing(this);
    this.setDepth(y);
  }

  setTextResolution(resolution: number): void {
    this.label.setResolution(resolution);
  }

  /** Dim the avatar while its connection is dropped and the server is holding its seat. */
  setAway(away: boolean): void {
    if (away === this.away) return;
    this.away = away;
    this.setAlpha(away ? 0.45 : 1);
    this.label.setText(away ? `${this.name_} (away)` : this.name_);
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
    super.destroy(fromScene);
  }
}
