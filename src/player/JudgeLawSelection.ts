/** Local selection only: simulation receives a law index together with E after confirmation. */
export class JudgeLawSelection {
  open = false;
  cursor = 0;
  toggle() {
    this.open = !this.open;
  }
  move(delta: number) {
    this.cursor = (this.cursor + delta + 6) % 6;
  }
  confirm(): number | null {
    if (!this.open) return null;
    this.open = false;
    return this.cursor;
  }
  cancel() {
    this.open = false;
  }
}
