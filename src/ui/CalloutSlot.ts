/**
 * The HUD's one centre-screen callout. A callout normally replaces the one showing; a held one (the
 * Tungsten jackpot) keeps the slot for a while, and whatever arrives meanwhile waits and shows when
 * the hold ends (the newest wins). Without the hold, the jackpot's own damage filling the ultimate
 * would swap its callout for "Ultimate ready" in the same frame.
 */
export class CalloutSlot<T> {
  private heldUntil = -Infinity;
  private waiting: T | null = null;

  constructor(private readonly show: (callout: T) => void) {}

  /** Show a callout now, or after the current hold; `hold` seconds keep it up against later ones. */
  push(callout: T, now: number, hold = 0): void {
    if (hold <= 0 && now < this.heldUntil) {
      this.waiting = callout;
      return;
    }
    this.show(callout);
    if (hold > 0) this.heldUntil = now + hold;
  }

  /** Show the callout that waited out a hold, once it is over. */
  update(now: number): void {
    if (this.waiting === null || now < this.heldUntil) return;
    const callout = this.waiting;
    this.waiting = null;
    this.show(callout);
  }
}
