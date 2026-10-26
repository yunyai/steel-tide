import { boundKeys, onBindings } from './Keybinds';

// Global keyboard / mouse / gamepad state with per-frame edge detection.

export class Input {
  private down = new Set<string>();
  private pressedNow = new Set<string>();
  mouseDx = 0;
  mouseDy = 0;
  wheel = 0;
  buttons = 0;
  private buttonsPressed = 0;
  locked = false;
  /** Set when the browser refuses pointer lock: the mouse then aims from plain cursor motion. */
  fallback = false;
  private everLocked = false;
  /** Browsers report a bogus jump on the first move after the pointer is captured. */
  private skipMove = true;
  /** Without pointer lock the cursor stalls at the window edge; resting there keeps turning (-1..1). */
  edge = 0;
  private padPrev: boolean[][] = [[], [], [], []];
  private padNow: boolean[][] = [[], [], [], []];
  onLockChange: ((locked: boolean) => void) | null = null;
  /** Swallow browser defaults for game keys (on during battle only, so menus stay keyboard-usable). */
  capture = false;
  private bound = boundKeys();

  constructor(private canvas: HTMLElement) {
    onBindings(() => (this.bound = boundKeys()));
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressedNow.add(e.code);
      if (this.capture && this.isGameKey(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.buttons = 0;
      this.edge = 0;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.aiming) return;
      if (this.fallback && !this.locked) {
        const r = this.canvas.getBoundingClientRect();
        const nx = (e.clientX - r.left) / Math.max(1, r.width);
        this.edge = nx < 0.03 ? -1 : nx > 0.97 ? 1 : 0;
      }
      if (this.skipMove || Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) {
        this.skipMove = false;
        return;
      }
      this.mouseDx += e.movementX;
      this.mouseDy += e.movementY;
    });
    document.addEventListener('mouseleave', () => (this.edge = 0));
    canvas.addEventListener('mousedown', (e) => {
      // Middle click locks a target; stop the browser's autoscroll.
      if (e.button === 1) e.preventDefault();
      // The click that grabs the mouse must not also fire a salvo.
      if (!this.aiming) return;
      this.buttons |= 1 << e.button;
      this.buttonsPressed |= 1 << e.button;
    });
    window.addEventListener('mouseup', (e) => {
      this.buttons &= ~(1 << e.button);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    // Once a lock has worked, later errors are the browser's re-lock cooldown, not a missing feature.
    document.addEventListener('pointerlockerror', () => {
      if (!this.everLocked) this.fallback = true;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.everLocked = true;
      this.skipMove = true;
      this.edge = 0;
      if (!this.locked) this.buttons = 0;
      this.onLockChange?.(this.locked);
    });
  }

  private isGameKey(code: string): boolean {
    return this.bound.has(code) || code === 'Space' || code === 'Tab' || code === 'F3' || code.startsWith('Arrow') || code === 'Quote' || code === 'Slash';
  }

  /** Mouse movement and buttons drive the ship (pointer locked, or lock unavailable). */
  get aiming(): boolean {
    return this.locked || this.fallback;
  }

  requestLock(): void {
    if (this.fallback || document.pointerLockElement === this.canvas) return;
    if (!this.canvas.requestPointerLock) {
      this.fallback = true;
      return;
    }
    const p = this.canvas.requestPointerLock() as unknown;
    if (p instanceof Promise)
      p.catch(() => {
        if (!this.everLocked) this.fallback = true;
      });
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string | undefined): boolean {
    return !!code && this.down.has(code);
  }

  pressed(code: string | undefined): boolean {
    return !!code && this.pressedNow.has(code);
  }

  mouseDown(button: number): boolean {
    return (this.buttons & (1 << button)) !== 0;
  }

  mousePressed(button: number): boolean {
    return (this.buttonsPressed & (1 << button)) !== 0;
  }

  /** Poll gamepads; call once per frame before reading them. */
  pollPads(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < 4; i++) {
      this.padPrev[i] = this.padNow[i];
      const p = pads[i];
      this.padNow[i] = p ? p.buttons.map((b) => b.pressed) : [];
    }
  }

  pad(i: number): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    return pads[i] ?? null;
  }

  padDown(i: number, b: number): boolean {
    return !!this.padNow[i]?.[b];
  }

  padPressed(i: number, b: number): boolean {
    return !!this.padNow[i]?.[b] && !this.padPrev[i]?.[b];
  }

  /** A menu action must not reach the helm when that action resumes the battle. */
  consumePadPress(i: number, b: number): void {
    this.padPrev[i] ??= [];
    this.padPrev[i][b] = !!this.padNow[i]?.[b];
  }

  padReleased(i: number, b: number): boolean {
    return !this.padNow[i]?.[b] && !!this.padPrev[i]?.[b];
  }

  endFrame(): void {
    this.pressedNow.clear();
    this.buttonsPressed = 0;
    this.mouseDx = this.mouseDy = 0;
    this.wheel = 0;
  }
}
